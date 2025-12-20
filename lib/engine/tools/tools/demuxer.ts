console.log("[DEMUXER] Module loading started");
import { WebDemuxer } from "web-demuxer/dist/web-demuxer.js"
console.log("[DEMUXER] WebDemuxer imported");

export async function demuxer(
	file: File,
	encoderWorker: Worker,
	onConfig: (config: VideoDecoderConfig) => void,
	onChunk: (chunk: EncodedVideoChunk) => void,
	start?: number,
	end?: number
) {
	let queue = 0
	let packetCount = 0
	const webdemuxer = new WebDemuxer({
		// ⚠️ you need to put the dist/wasm-files file in the npm package into a static directory like public
		// making sure that the js and wasm in wasm-files are in the same directory
		wasmLoaderPath: "https://cdn.jsdelivr.net/npm/web-demuxer@1.0.5/dist/wasm-files/ffmpeg.min.js",
	})
	await webdemuxer.load(file)
	const config = await webdemuxer.getVideoDecoderConfig()
	onConfig(config)
	/*
		* starting demuxing one second sooner because sometimes demuxer
		* starts demuxing from keyframe that is too far ahead from effect.start
		* causing rendering to be stuck because of too few frames,
		* also ending demuxing one second later just in case too
	*/
	const oneSecondOffset = 1000
	const startSeconds = start ? (start - oneSecondOffset) / 1000 : undefined
	const endSeconds = end ? (end + oneSecondOffset) / 1000 : undefined
	console.log(`[Demuxer] Reading packets from ${startSeconds}s to ${endSeconds}s (${start}ms to ${end}ms)`)

	const reader = webdemuxer.readAVPacket(startSeconds, endSeconds).getReader()

	encoderWorker.addEventListener("message", (msg) => {
		if (msg.data.action === "dequeue") {
			queue = msg.data.size
		}
	})

	return new Promise<void>((resolve, reject) => {
		reader.read().then(async function processAVPacket({ done, value }): Promise<any> {
			if (done) {
				console.log(`[Demuxer] Finished reading ${packetCount} packets`)
				resolve()
				return
			}
			try {
				packetCount++
				const delay = calculateDynamicDelay(queue)
				const videoChunk = webdemuxer.genEncodedVideoChunk(value)
				onChunk(videoChunk)
				await sleep(delay)
				return await reader.read().then(processAVPacket)
			} catch (e) {
				reject(e)
			}
		}).catch(reject)
	})
}

function calculateDynamicDelay(queueSize: number) {
	// OPTIMIZED: Lower threshold and faster response for realtime playback
	// Based on WebCodecs best practices for continuous streaming
	const queueLimit = 100  // Reduced from 500 for faster backpressure response
	const maxDelay = 50     // Reduced from 100ms for faster decoding
	const minDelay = 0      // No delay when queue is empty
	const delay = (queueSize / queueLimit) * maxDelay;
	return Math.min(maxDelay, Math.max(minDelay, delay));
}

function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

