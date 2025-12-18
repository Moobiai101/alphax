import {generate_id} from "@benev/slate"

import {Actions} from "../../../../state/actions"
import {Media} from "../../media/controller"
import {demuxer} from "../../../../tools/tools/demuxer"
import {Compositor} from "../../compositor/controller"
import {AnyEffect, VideoEffect} from "../../../../state/types"
import {sort_effects_by_track} from "../utils/sort_effects_by_track"

interface DecodedFrame {
	frame: VideoFrame
	effect_id: string
	timestamp: number
	frame_id: string
}

export class Decoder {
	decoded_frames: Map<string, DecodedFrame> = new Map()
	decoded_effects = new Map<string, string>()
	#workers: Worker[] = []

	constructor(private actions: Actions, private media: Media, private compositor: Compositor) {}

	reset() {
		// Close all video frames
		this.decoded_frames.forEach(decoded => {
			try {
				decoded.frame.close()
			} catch (e) {
				console.warn('Error closing video frame:', e)
			}
		})
		this.decoded_frames.clear()
		this.decoded_effects.clear()
		
		// Clean up and terminate all workers
		this.#workers.forEach(worker => {
			try {
				worker.postMessage({action: "cleanup"})
				worker.terminate()
			} catch (e) {
				console.warn('Error terminating worker:', e)
			}
		})
		this.#workers = []
	}

	async get_and_draw_decoded_frame(effects: AnyEffect[], timestamp: number) {
		const effects_at_timestamp = this.compositor.get_effects_relative_to_timecode(effects, timestamp)
		
		// Process video effects
		let anyFrameUpdated = false
		for(const effect of sort_effects_by_track(effects_at_timestamp)) {
			if(effect.kind === "video") {
				try {
					const {frame, frame_id} = await this.#get_frame_from_video(effect, timestamp)
					this.compositor.managers.videoManager.draw_decoded_frame(effect, frame)
					frame.close()
					this.decoded_frames.delete(frame_id)
					anyFrameUpdated = true
				} catch (error) {
					console.error(`Failed to get frame for effect ${effect.id}:`, error)
					// Continue with other effects even if one fails
				}
			}
		}

		if (anyFrameUpdated) {
			this.compositor.app.render()
		}
	}

	#get_frame_from_video(effect: VideoEffect, timestamp: number): Promise<DecodedFrame> {
		if(!this.decoded_effects.has(effect.id)) {
			this.#extract_frames_from_video(effect, timestamp)
		}
		return new Promise((resolve, reject) => {
			const decoded = this.#find_closest_effect_frame(effect)
			if(decoded) {
				resolve(decoded)
				return
			}
			
			// Wait for frame to be available with timeout
			const maxWaitTime = 5000 // 5 second timeout
			const startTime = Date.now()
			
			const interval = setInterval(() => {
				const decoded = this.#find_closest_effect_frame(effect)
				if(decoded) {
					clearInterval(interval)
					resolve(decoded)
				} else if (Date.now() - startTime > maxWaitTime) {
					clearInterval(interval)
					// Create a blank frame as fallback to prevent stalling
					const canvas = document.createElement('canvas')
					canvas.width = effect.rect.width
					canvas.height = effect.rect.height
					const ctx = canvas.getContext('2d')!
					ctx.fillStyle = 'black'
					ctx.fillRect(0, 0, canvas.width, canvas.height)
					
					// Note: We can't create a VideoFrame from canvas in worker context
					// So we'll reject and let the caller handle it
					reject(new Error(`Timeout waiting for frame for effect ${effect.id} at timestamp ${timestamp}`))
				}
			}, 10) // Check every 10ms for responsiveness
		})
	}

	async #extract_frames_from_video(effect: VideoEffect, timestamp: number) {
		// Use URL relative to this file's location in the build
		const worker = new Worker(new URL("./decode_worker.ts", import.meta.url), {type: "module"})
		this.#workers.push(worker)
		
		worker.addEventListener("message", (msg) => {
			if(msg.data.action === "new-frame") {
				const id = generate_id()
				this.decoded_frames.set(id, {...msg.data.frame, frame_id: id})
			}
			if(msg.data.action === "end") {
				// If effect is no longer playing, clean up worker
				if(!this.compositor.currently_played_effects.get(effect.id)) {
					try {
						worker.postMessage({action: "cleanup"})
						worker.terminate()
					} catch (e) {
						console.warn('Error terminating worker:', e)
					}
					this.#workers = this.#workers.filter(w => w !== worker)
					
					// Cleanup frames for this effect
					Array.from(this.decoded_frames.values()).forEach(value => {
						if(value.effect_id === effect.id) {
							try {
								value.frame.close()
							} catch (e) {
								console.warn('Error closing frame:', e)
							}
							this.decoded_frames.delete(value.frame_id)
						}
					})
					this.decoded_effects.delete(effect.id)
				}
			}
		})

		const transition = this.compositor.managers.transitionManager.getTransitionByEffect(effect)
		const {incoming, outgoing} = this.compositor.managers.transitionManager.getTransitionDurationPerEffect(transition, effect)

		const file = this.media.get(effect.file_hash)?.file
		if (!file) {
			console.error(`File not found for effect ${effect.id}`)
			return
		}

		// Configure worker
		worker.postMessage({
			action: "demux",
			props: {
				start: effect.start - incoming,
				end: effect.end === effect.duration ? effect.raw_duration : effect.end + outgoing,
				id: effect.id
			},
			starting_timestamp: timestamp,
			timebase: this.compositor.timebase
		})

		// Use a dummy worker for the encoder arg since we are only decoding for playback here
		// In a real export scenario, we would pass the actual encoder worker
		const dummyEncoderWorker = new Worker(URL.createObjectURL(new Blob([""], {type: "text/javascript"})))

		try {
			await demuxer(
				file,
				dummyEncoderWorker, 
				(config: VideoDecoderConfig) => worker.postMessage({action: "configure", config}),
				(chunk: EncodedVideoChunk) => worker.postMessage({action: "chunk", chunk}),
				effect.start - incoming,
				effect.end === effect.duration ? effect.raw_duration : effect.end + outgoing,
			)
		} catch (e) {
			console.error(`Demuxer failed for effect ${effect.id}`, e)
			try {
				worker.postMessage({action: "cleanup"})
				worker.terminate()
			} catch (err) {
				console.warn('Error cleaning up worker after demuxer failure:', err)
			}
			this.#workers = this.#workers.filter(w => w !== worker)
			this.decoded_effects.delete(effect.id)
		}
		
		dummyEncoderWorker.terminate()
		this.decoded_effects.set(effect.id, effect.id)
	}

	#find_closest_effect_frame(effect: VideoEffect) {
		// Find frame with closest timestamp for this effect
		// Since we decode in order, the first one for this effect in the map should be the next needed one
		// Ideally we match exact timestamp, but for playback sync we take the closest valid one
		const frames = Array.from(this.decoded_frames.values())
			.filter(frame => frame.effect_id === effect.id)
			.sort((a, b) => a.timestamp - b.timestamp)
			
		return frames[0]
	}
}
