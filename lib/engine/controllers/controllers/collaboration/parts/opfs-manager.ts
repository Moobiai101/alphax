console.log("[OPFS_MANAGER] Module loading started");
import {Connection} from "sparrow-rtc"
console.log("[OPFS_MANAGER] sparrow-rtc imported");
import {FileHandler} from "./file-handler"
console.log("[OPFS_MANAGER] FileHandler imported");

// Lazy load opfs-tools to avoid SSR issues
let opfsModule: typeof import("opfs-tools") | null = null;
const getOpfs = async () => {
	if (!opfsModule) {
		opfsModule = await import("opfs-tools");
	}
	return opfsModule;
};

export const file = async (path: string) => (await getOpfs()).file(path);
export const dir = async (path: string) => (await getOpfs()).dir(path);
export const write = async (path: string, data: string) => (await getOpfs()).write(path, data);

console.log("[OPFS_MANAGER] All imports complete");

interface ChunkMetadata {
	offset: number
	length: number
}

export class OPFSManager {
	#worker: Worker | null = null
	#initialized = false

	constructor(private fileHandler: FileHandler) {
		// Don't call #init() in constructor - it uses browser APIs
		// Instead, lazily initialize when needed
		console.log("[OPFS_MANAGER] OPFSManager constructed (no init yet)");
	}

	// Lazy initialization - only called when actually needed
	async #ensureInitialized(): Promise<void> {
		if (this.#initialized) return;
		if (typeof window === 'undefined') {
			console.log("[OPFS_MANAGER] Skipping init - not in browser");
			return;
		}
		console.log("[OPFS_MANAGER] Initializing OPFS...");
		const opfs = await getOpfs();
		await opfs.dir('/compressed').remove();
		await opfs.dir('/compressed').create();
		this.#initialized = true;
		console.log("[OPFS_MANAGER] OPFS initialized");
	}

	// Lazy worker initialization to avoid Turbopack resolving worker files at build time
	#getWorker(): Worker {
		if (!this.#worker) {
			if (typeof window === 'undefined') {
				throw new Error('OPFSManager worker can only be created in browser environment')
			}
			this.#worker = new Worker(new URL('./opfs-worker.ts', import.meta.url), {type: "module"})
		}
		return this.#worker
	}

	async createMetadataFile(videoFileName: string): Promise<void> {
		await this.#ensureInitialized();
		const opfs = await getOpfs();
		const metadataFileName = `${videoFileName}.metadata.json`
		await opfs.write(`/${metadataFileName}`, '[]')
	}

	async writeChunk(
		fileHash: string,
		chunk: Uint8Array
	): Promise<void> {
		await this.#ensureInitialized();
		this.#getWorker().postMessage({
			filePath: `/compressed/${fileHash}`,
			metadataPath: `/compressed/${fileHash}.metadata.json`,
			chunk,
			action: 'writeChunk'
		})
	}

	async readChunk(
		fileName: string,
		metadataFileName: string,
		chunkIndex: number
	): Promise<Uint8Array> {
		await this.#ensureInitialized();
		const opfs = await getOpfs();
		const metadata = await this.#readMetadata(metadataFileName)
		const {offset, length} = metadata[chunkIndex]
		const fileHandle = opfs.file(`/${fileName}`)
		const reader = await fileHandle.createReader()
		const arrayBuffer = await reader.read(length, {at: offset})
		await reader.close()
		return new Uint8Array(arrayBuffer)
	}

	async #readMetadata(metadataFileName: string): Promise<ChunkMetadata[]> {
		const opfs = await getOpfs();
		const metadataFile = opfs.file(`/${metadataFileName}`)
		const metadataText = await metadataFile.text()
		return JSON.parse(metadataText)
	}

	sendFile(originalFile: File, fileHash: string, frames: number, peer: Connection) {
		this.fileHandler.sendFileMetadata(peer.cable.reliable, fileHash, originalFile, true, frames)

		const worker = this.#getWorker()
		worker.postMessage({
			filePath: `/compressed/${fileHash}`,
			metadataPath: `/compressed/${fileHash}.metadata.json`,
			action: 'getFile',
			frames,
			hash: fileHash
		})

		worker.addEventListener("message", (e) => {
			if(e.data.action === "fileChunk") {
				const chunk = e.data.chunk as Uint8Array
				if(e.data.hash === fileHash)
					this.fileHandler.sendChunk(chunk, e.data.hash, peer.cable.reliable)
			}
			if(e.data.action === "finished") {
				if(e.data.hash === fileHash) {
					peer.cable.reliable.send(JSON.stringify({done: true, hash: fileHash, filename: originalFile.name, fileType: originalFile.type, proxy: true}))
					this.fileHandler.markFileAsSynced(fileHash)
				}
			}
		})
	}

	async writeMetadata(
		metadataFileName: string,
		metadata: ChunkMetadata[]
	): Promise<void> {
		await this.#ensureInitialized();
		const opfs = await getOpfs();
		const metadataFile = opfs.file(`/${metadataFileName}`)
		await opfs.write(metadataFile.path, JSON.stringify(metadata))
	}
}
