/**
 * Decode Worker - Hardware-accelerated video frame decoder
 * 
 * PRODUCTION-GRADE IMPLEMENTATION (WebCodecs Best Practices):
 * - Hardware acceleration enabled for GPU decoding
 * - Proper state reset on new decode session
 * - Continuous streaming until end of file
 */

let timestamp = 0
let start = 0
let end = 0
let id = ""

let timebase = 0
let timestamp_end = 0
let lastProcessedTimestamp = 0
let timebaseInMicroseconds = 1000 / 25 * 1000

// Track if decoder is configured
let isConfigured = false

const decoder = new VideoDecoder({
	output(frame) {
		const frameTimestamp = frame.timestamp / 1000
		if (frameTimestamp < start) {
			frame.close()
			return
		}

		processFrame(frame, timebaseInMicroseconds)
	},
	error: (e) => console.error("[DecodeWorker] Decoder error:", e)
})

let endSent = false
const interval = setInterval(() => {
	if (timestamp >= timestamp_end && timestamp_end > 0 && !endSent) {
		endSent = true
		self.postMessage({ action: "end" })
		clearInterval(interval)
	}
}, 100)

decoder.addEventListener("dequeue", () => {
	self.postMessage({ action: "dequeue", size: decoder.decodeQueueSize })
})

self.addEventListener("message", async message => {
	if (message.data.action === "demux") {
		// Reset all state for new decode session (CRITICAL)
		timestamp = message.data.starting_timestamp
		timebase = message.data.timebase
		timebaseInMicroseconds = 1000 / timebase * 1000
		start = message.data.props.start
		end = message.data.props.end
		id = message.data.props.id
		timestamp_end = (message.data.starting_timestamp) + (message.data.props.end - message.data.props.start)

		// Reset processing state
		lastProcessedTimestamp = 0
		endSent = false
		isConfigured = false

		console.log(`[DecodeWorker] Starting decode session for ${id}: start=${start}ms, end=${end}ms, timestamp_end=${timestamp_end}ms`)
	}
	if (message.data.action === "configure") {
		// Enable hardware acceleration for GPU-accelerated decoding (industry standard)
		const config: VideoDecoderConfig = {
			...message.data.config,
			optimizeForLatency: true,
			hardwareAcceleration: "prefer-hardware"
		}

		try {
			decoder.configure(config)
			await decoder.flush()
			isConfigured = true
			console.log(`[DecodeWorker] Decoder configured with hardware acceleration`)
		} catch (e) {
			console.error("[DecodeWorker] Failed to configure decoder:", e)
		}
	}
	if (message.data.action === "chunk") {
		if (!isConfigured) {
			console.warn("[DecodeWorker] Received chunk before configuration, ignoring")
			return
		}
		try {
			decoder.decode(message.data.chunk)
		} catch (e) {
			console.error("[DecodeWorker] Failed to decode chunk:", e)
		}
	}
	if (message.data.action === "eof") {
		try {
			await decoder.flush()
		} catch (e) {
			console.error("[DecodeWorker] Flush error:", e)
		}
		if (!endSent) {
			endSent = true
			self.postMessage({ action: "end" })
		}
	}
	if (message.data.action === "cleanup") {
		try {
			decoder.close()
		} catch (e) {
			// Decoder may already be closed
		}
		clearInterval(interval)
	}
})

/*
* -- processFrame --
* Function responsible for maintaining
* video framerate to desired timebase
* 
* IMPROVED: Better frame timing logic
*/

function processFrame(currentFrame: VideoFrame, targetFrameInterval: number) {
	// First frame initialization
	if (lastProcessedTimestamp === 0) {
		self.postMessage({
			action: "new-frame",
			frame: {
				timestamp,
				frame: currentFrame,
				effect_id: id,
			}
		})
		timestamp += 1000 / timebase
		lastProcessedTimestamp = currentFrame.timestamp
		return
	}

	// Handle frame duplication for variable framerate videos
	// If current frame is ahead of where we should be, output multiple frames
	while (currentFrame.timestamp >= lastProcessedTimestamp + targetFrameInterval) {
		self.postMessage({
			action: "new-frame",
			frame: {
				timestamp,
				frame: currentFrame,
				effect_id: id,
			}
		})

		timestamp += 1000 / timebase
		lastProcessedTimestamp += targetFrameInterval
	}

	// Output current frame if it's at or past expected position
	if (currentFrame.timestamp >= lastProcessedTimestamp) {
		self.postMessage({
			action: "new-frame",
			frame: {
				timestamp,
				frame: currentFrame,
				effect_id: id,
			}
		})

		timestamp += 1000 / timebase
		lastProcessedTimestamp += targetFrameInterval
	}

	// CRITICAL: Close frame after processing to release GPU memory
	currentFrame.close()
}
