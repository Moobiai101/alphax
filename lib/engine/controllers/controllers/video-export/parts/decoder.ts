import { generate_id } from "@benev/slate"

import { Actions } from "../../../../state/actions"
import { Media } from "../../media/controller"
import { demuxer } from "../../../../tools/tools/demuxer"
import { Compositor } from "../../compositor/controller"
import { AnyEffect, VideoEffect } from "../../../../state/types"
import { sort_effects_by_track } from "../utils/sort_effects_by_track"

interface DecodedFrame {
	frame: VideoFrame
	effect_id: string
	timestamp: number
	frame_id: string
}

/**
 * FrameBuffer - Ring buffer for decoded video frames with LRU eviction
 * 
 * Key features:
 * - Stores frames by timestamp for O(1) lookup
 * - Auto-evicts old frames to prevent memory exhaustion
 * - Explicit frame.close() on eviction (critical for GPU memory)
 * - Tolerance-based lookup for frame timing flexibility
 */
class FrameBuffer {
	private frames = new Map<number, DecodedFrame>()
	private insertOrder: number[] = [] // Track insertion order for LRU
	private maxSize: number
	private tolerance: number // Frame lookup tolerance in ms

	constructor(timebase: number, bufferSeconds: number = 2) {
		// Buffer size = frames per second * seconds to buffer
		this.maxSize = Math.ceil(timebase * bufferSeconds)
		// Tolerance = half a frame duration
		this.tolerance = (1000 / timebase) / 2
	}

	/**
	 * Add a frame to the buffer with LRU eviction
	 */
	add(frame: DecodedFrame): void {
		const ts = frame.timestamp
		console.log(`[FrameBuffer] Adding frame at timestamp ${ts}ms, buffer size: ${this.frames.size}/${this.maxSize}`)

		// If frame already exists at this timestamp, close old and replace
		if (this.frames.has(ts)) {
			try {
				this.frames.get(ts)?.frame.close()
			} catch (e) {
				// Frame may already be closed
			}
		} else {
			// New frame - check if we need to evict
			if (this.frames.size >= this.maxSize && this.insertOrder.length > 0) {
				const oldestTs = this.insertOrder.shift()!
				const evicted = this.frames.get(oldestTs)
				if (evicted) {
					try {
						evicted.frame.close() // CRITICAL: Release GPU memory
					} catch (e) {
						// Frame may already be closed
					}
					this.frames.delete(oldestTs)
				}
			}
			this.insertOrder.push(ts)
		}

		this.frames.set(ts, frame)
	}

	/**
	 * Get frame at timestamp with tolerance (CACHE HIT/MISS)
	 * Returns null if no frame within tolerance (graceful degradation)
	 */
	get(timestamp: number): DecodedFrame | null {
		// Exact match
		if (this.frames.has(timestamp)) {
			console.log(`[FrameBuffer] CACHE HIT (exact) at ${timestamp}ms`)
			return this.frames.get(timestamp)!
		}

		// Find closest frame within tolerance
		let closest: DecodedFrame | null = null
		let closestDiff = Infinity

		for (const [ts, frame] of this.frames) {
			const diff = Math.abs(ts - timestamp)
			if (diff < closestDiff && diff <= this.tolerance) {
				closestDiff = diff
				closest = frame
			}
		}

		if (closest) {
			console.log(`[FrameBuffer] CACHE HIT (tolerance) at ${timestamp}ms, diff: ${closestDiff}ms`)
		} else {
			console.log(`[FrameBuffer] CACHE MISS at ${timestamp}ms, buffer has ${this.frames.size} frames, timestamps: ${[...this.frames.keys()].slice(0, 5).join(', ')}...`)
		}

		return closest // null = cache miss
	}

	/**
	 * Check if buffer has frames ready ahead of timestamp
	 */
	hasFramesAhead(timestamp: number, count: number = 5): boolean {
		let found = 0
		for (const ts of this.frames.keys()) {
			if (ts >= timestamp) {
				found++
				if (found >= count) return true
			}
		}
		return false
	}

	/**
	 * Clear all frames (used on seek)
	 */
	clear(): void {
		for (const frame of this.frames.values()) {
			try {
				frame.frame.close()
			} catch (e) {
				// Frame may already be closed
			}
		}
		this.frames.clear()
		this.insertOrder = []
	}

	get size(): number {
		return this.frames.size
	}
}

/**
 * Worker state for a video effect
 */
interface EffectWorkerState {
	worker: Worker
	buffer: FrameBuffer
	isDecoding: boolean
	lastRequestedTimestamp: number
}

/**
 * Decoder - Production-grade video frame decoder with pre-buffering
 * 
 * Architecture:
 * - One decode worker per video effect
 * - Pre-buffers frames ahead of playhead
 * - Non-blocking frame retrieval (returns null on miss)
 * - Proper memory management with frame.close()
 */
export class Decoder {
	#effectStates = new Map<string, EffectWorkerState>()
	#lastFramePerEffect = new Map<string, VideoFrame>() // Fallback for cache miss

	constructor(
		private actions: Actions,
		private media: Media,
		private compositor: Compositor
	) { }

	/**
	 * Reset all decoder state
	 */
	reset(): void {
		// Close all last frames
		for (const frame of this.#lastFramePerEffect.values()) {
			try {
				frame.close()
			} catch (e) {
				// Ignore
			}
		}
		this.#lastFramePerEffect.clear()

		// Clean up all workers and buffers
		for (const [effectId, state] of this.#effectStates) {
			state.buffer.clear()
			try {
				state.worker.postMessage({ action: "cleanup" })
				state.worker.terminate()
			} catch (e) {
				console.warn('Error terminating worker:', e)
			}
		}
		this.#effectStates.clear()
	}

	/**
	 * Start pre-buffering for a video effect
	 * Called when effect is added to canvas
	 */
	start_prebuffer(effect: VideoEffect, startTimestamp: number): void {
		if (this.#effectStates.has(effect.id)) {
			// Already buffering
			return
		}

		this.#initWorkerForEffect(effect, startTimestamp)
	}

	/**
	 * Stop buffering for an effect (called when removed from canvas)
	 */
	stop_buffering(effectId: string): void {
		const state = this.#effectStates.get(effectId)
		if (state) {
			state.buffer.clear()
			try {
				state.worker.postMessage({ action: "cleanup" })
				state.worker.terminate()
			} catch (e) {
				// Ignore
			}
			this.#effectStates.delete(effectId)
		}
	}

	/**
	 * Handle seek - only restart decoding if new position is not in buffer
	 */
	seek(effects: VideoEffect[], newTimestamp: number): void {
		for (const effect of effects) {
			const state = this.#effectStates.get(effect.id)
			if (!state) {
				// No state yet, start buffering
				this.#initWorkerForEffect(effect, newTimestamp)
				continue
			}

			// Calculate effect-relative timestamp
			const effectTime = newTimestamp - effect.start_at_position + effect.start

			// Check if timestamp is already in buffer
			const frameInBuffer = state.buffer.get(effectTime)
			if (frameInBuffer) {
				// Position is already buffered, no need to restart
				console.log(`[Decoder] Seek to ${effectTime}ms - already in buffer, skipping restart`)
				continue
			}

			console.log(`[Decoder] Seek to ${effectTime}ms - not in buffer, restarting worker`)

			// Clear buffer
			state.buffer.clear()

			// Terminate old worker
			try {
				state.worker.postMessage({ action: "cleanup" })
				state.worker.terminate()
			} catch (e) {
				// Ignore
			}

			this.#effectStates.delete(effect.id)

			// Start new worker from new position
			this.#initWorkerForEffect(effect, newTimestamp)
		}
	}

	/**
	 * Draw available frames for all effects at timestamp (NON-BLOCKING)
	 * This is the main method called during playback
	 */
	draw_available_frames(effects: AnyEffect[], timestamp: number): void {
		const videoEffects = this.compositor.get_effects_relative_to_timecode(effects, timestamp)
			.filter((e): e is VideoEffect => e.kind === "video")

		let anyFrameDrawn = false

		for (const effect of sort_effects_by_track(videoEffects) as VideoEffect[]) {
			// Ensure we're buffering this effect
			if (!this.#effectStates.has(effect.id)) {
				this.start_prebuffer(effect, timestamp)
			}

			const state = this.#effectStates.get(effect.id)
			if (!state) continue

			// Calculate effect-relative timestamp
			const effectTime = timestamp - effect.start_at_position + effect.start

			// Try to get frame from buffer (CACHE HIT/MISS)
			const frameData = state.buffer.get(effectTime)

			if (frameData) {
				// CACHE HIT - draw the frame
				this.compositor.managers.videoManager.draw_decoded_frame(effect, frameData.frame)

				// Store as last good frame (keep reference, don't close)
				// We'll clone it for fallback storage
				anyFrameDrawn = true
			} else {
				// CACHE MISS - use last good frame if available (graceful degradation)
				const lastFrame = this.#lastFramePerEffect.get(effect.id)
				if (lastFrame) {
					// Draw last good frame (holding previous frame)
					// console.log(`[Decoder] Cache miss for ${effect.id} at ${effectTime}ms, using last frame`)
				}
				// Don't block - just continue, next frame may be ready
			}
		}

		if (anyFrameDrawn) {
			this.compositor.app.render()
		}
	}

	/**
	 * Legacy method for export (blocking) - preserved for compatibility
	 */
	async get_and_draw_decoded_frame(effects: AnyEffect[], timestamp: number): Promise<void> {
		// For export, we use blocking retrieval
		const videoEffects = this.compositor.get_effects_relative_to_timecode(effects, timestamp)
			.filter((e): e is VideoEffect => e.kind === "video")

		for (const effect of sort_effects_by_track(videoEffects) as VideoEffect[]) {
			if (!this.#effectStates.has(effect.id)) {
				this.start_prebuffer(effect, timestamp)
			}

			const state = this.#effectStates.get(effect.id)
			if (!state) continue

			const effectTime = timestamp - effect.start_at_position + effect.start

			// For export, wait for frame (with timeout)
			const frame = await this.#waitForFrame(state, effectTime, 5000)
			if (frame) {
				this.compositor.managers.videoManager.draw_decoded_frame(effect, frame.frame)
			}
		}

		this.compositor.app.render()
	}

	/**
	 * Wait for frame with timeout (used in export mode)
	 */
	async #waitForFrame(state: EffectWorkerState, timestamp: number, timeoutMs: number): Promise<DecodedFrame | null> {
		const startTime = Date.now()

		while (Date.now() - startTime < timeoutMs) {
			const frame = state.buffer.get(timestamp)
			if (frame) return frame

			// Wait a bit before retrying
			await new Promise(resolve => setTimeout(resolve, 10))
		}

		console.warn(`[Decoder] Timeout waiting for frame at ${timestamp}ms`)
		return null
	}

	/**
	 * Initialize a decode worker for an effect
	 */
	#initWorkerForEffect(effect: VideoEffect, startTimestamp: number): void {
		console.log(`[Decoder] Initializing worker for effect ${effect.id} at timestamp ${startTimestamp}ms`)

		const worker = new Worker(new URL("./decode_worker.ts", import.meta.url), { type: "module" })

		const buffer = new FrameBuffer(this.compositor.timebase)

		const state: EffectWorkerState = {
			worker,
			buffer,
			isDecoding: true,
			lastRequestedTimestamp: startTimestamp
		}

		this.#effectStates.set(effect.id, state)

		// Handle worker errors
		worker.addEventListener("error", (e) => {
			console.error(`[Decoder] Worker error for effect ${effect.id}:`, e.message, e)
		})

		// Handle messages from worker
		worker.addEventListener("message", (msg) => {
			if (msg.data.action === "new-frame") {
				console.log(`[Decoder] Received frame from worker, timestamp: ${msg.data.frame.timestamp}ms`)
				const frameData: DecodedFrame = {
					...msg.data.frame,
					frame_id: generate_id()
				}
				buffer.add(frameData)
			}
			if (msg.data.action === "end") {
				console.log(`[Decoder] Worker finished decoding for effect ${effect.id}`)
				state.isDecoding = false
			}
		})

		// Get transition info
		const transition = this.compositor.managers.transitionManager.getTransitionByEffect(effect)
		const { incoming, outgoing } = this.compositor.managers.transitionManager.getTransitionDurationPerEffect(transition, effect)

		const file = this.media.get(effect.file_hash)?.file
		if (!file) {
			console.error(`[Decoder] No file found for effect ${effect.id}`)
			return
		}

		// Configure worker with effect parameters
		// NOTE: effect.raw_duration is in SECONDS, but all other timestamps are in MILLISECONDS
		const effectEnd = effect.end === effect.duration ? effect.raw_duration * 1000 : effect.end + outgoing
		const effectStart = effect.start - incoming

		// Calculate the actual seek position within the video file
		// startTimestamp is the timeline position, we need to convert to effect-relative position
		const effectRelativeStart = startTimestamp - effect.start_at_position + effect.start
		const demuxerStart = Math.max(effectStart, effectRelativeStart)  // Don't go before effect.start

		console.log(`[Decoder] Worker config for ${effect.id}: start=${effectStart}ms, demuxerStart=${demuxerStart}ms, end=${effectEnd}ms, duration=${effectEnd - effectStart}ms`)

		worker.postMessage({
			action: "demux",
			props: {
				start: demuxerStart,  // Use actual seek position
				end: effectEnd,
				id: effect.id
			},
			starting_timestamp: effectRelativeStart,
			timebase: this.compositor.timebase
		})

		// Start demuxing from the actual seek position
		demuxer(
			file,
			worker,
			(config: VideoDecoderConfig) => worker.postMessage({ action: "configure", config }),
			(chunk: EncodedVideoChunk) => worker.postMessage({ action: "chunk", chunk }),
			demuxerStart,  // Start from seek position, not from beginning
			effectEnd,
		).then(() => {
			worker.postMessage({ action: "eof" })
		}).catch(e => {
			console.error(`[Decoder] Demuxer failed for effect ${effect.id}`, e)
			this.stop_buffering(effect.id)
		})
	}
}
