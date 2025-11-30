/**
 * Media Controller - Omniclip Engine Media Management
 * 
 * This controller manages media files in the Omniclip engine:
 * - IndexedDB storage with hash-based deduplication
 * - Video/Audio/Image element creation
 * - Thumbnail generation
 * 
 * Metadata Extraction Strategy:
 * - Primary: Accept pre-extracted metadata from UI layer (HTML5 APIs)
 * - Fallback: HTML5 APIs for files loaded from IndexedDB on refresh
 * 
 * This approach is production-grade because:
 * - No WASM dependencies that can fail
 * - Works in all browsers
 * - Metadata extracted once at upload, not re-extracted
 * - WebCodecs/web-demuxer handle actual video processing (UNTOUCHED)
 */

import {pub} from "@benev/slate"
import {quick_hash} from "@benev/construct"

import {Video, VideoFile, AnyMedia, ImageFile, Image, AudioFile, Audio} from "../../../types/media-types"

/**
 * Pre-extracted metadata that can be passed from UI layer
 * This avoids re-extracting metadata that was already extracted during upload
 */
export interface VideoMetadata {
	fps: number;
	duration: number; // in milliseconds
	frames: number;
	width?: number;
	height?: number;
}

/**
 * Extract video metadata using HTML5 Video API
 * Used as fallback when loading files from IndexedDB (no pre-extracted metadata)
 */
async function extractVideoMetadataHTML5(file: File): Promise<VideoMetadata> {
	return new Promise((resolve, reject) => {
		const video = document.createElement('video');
		video.preload = 'metadata';
		
		const objectUrl = URL.createObjectURL(file);
		video.src = objectUrl;
		
		const timeout = setTimeout(() => {
			URL.revokeObjectURL(objectUrl);
			reject(new Error('Video metadata extraction timed out'));
		}, 30000); // 30 second timeout
		
		video.onerror = () => {
			clearTimeout(timeout);
			URL.revokeObjectURL(objectUrl);
			reject(new Error(`Failed to load video: ${video.error?.message || 'Unknown error'}`));
		};
		
		video.onloadedmetadata = () => {
			clearTimeout(timeout);
			
			const durationSeconds = video.duration;
			const durationMs = durationSeconds * 1000;
			const width = video.videoWidth;
			const height = video.videoHeight;
			// Default FPS - HTML5 doesn't expose this directly
			// WebCodecs will use actual fps during playback
			const fps = 30;
			const frames = Math.round(fps * durationSeconds);
			
			URL.revokeObjectURL(objectUrl);
			
			resolve({
				fps,
				duration: durationMs,
				frames,
				width,
				height,
			});
		};
		
		video.load();
	});
}

/**
 * Extract audio duration using HTML5 Audio API
 */
async function extractAudioDurationHTML5(file: File): Promise<number> {
	return new Promise((resolve, reject) => {
		const audio = document.createElement('audio');
		audio.preload = 'metadata';
		
		const objectUrl = URL.createObjectURL(file);
		audio.src = objectUrl;
		
		const timeout = setTimeout(() => {
			URL.revokeObjectURL(objectUrl);
			reject(new Error('Audio metadata extraction timed out'));
		}, 30000);
		
		audio.onerror = () => {
			clearTimeout(timeout);
			URL.revokeObjectURL(objectUrl);
			reject(new Error(`Failed to load audio: ${audio.error?.message || 'Unknown error'}`));
		};
		
		audio.onloadedmetadata = () => {
			clearTimeout(timeout);
			const durationMs = audio.duration * 1000;
			URL.revokeObjectURL(objectUrl);
			resolve(durationMs);
		};
		
		audio.load();
	});
}

export class Media extends Map<string, AnyMedia> {
	#database_request = window.indexedDB.open("database", 3)
	#opened = false
	#files_ready = false
	on_media_change = pub<{files: AnyMedia[], action: "removed" | "added" | "placeholder"}>()

	constructor() {
		super()
		this.#get_imported_files()
		this.#database_request.onerror = (event) => {
			console.error("IndexedDB access denied")
		}
		this.#database_request.onsuccess = (event) => {
			// Database opened
		}
		this.#database_request.onupgradeneeded = (event) => {
			const database = (event.target as IDBRequest).result as IDBDatabase
			const objectStore = database.createObjectStore("files", {keyPath: "hash"})
			objectStore!.createIndex("file", "file", { unique: true })
			objectStore!.transaction.oncomplete = (event) => {
				// Object store created
			}
		}
		this.#database_request.onsuccess = async (e) => {
			this.#opened = true
		}
	}

	#is_db_opened() {
		return new Promise((resolve) => {
			if(this.#opened) {
				resolve(true)
			} else {
				const interval = setInterval(() => {
					if(this.#opened) {
						resolve(true)
						clearInterval(interval)
					}
				}, 100)
			}
		})
	}

	are_files_ready() {
		return new Promise((resolve) => {
			if(this.#files_ready) {
				resolve(true)
			} else {
				const interval = setInterval(() => {
					if(this.#files_ready) {
						resolve(true)
						clearInterval(interval)
					}
				}, 100)
			}
		})
	}

	async get_file(file_hash: string) {
		await this.are_files_ready()
		return this.get(file_hash)?.file
	}

	async getImportedFiles(): Promise<AnyMedia[]> {
		return new Promise(async (resolve) => {
			await this.are_files_ready()
			resolve([...this.values()])
		})
	}

	async #get_imported_files(): Promise<AnyMedia[]> {
		return new Promise(async (resolve, reject) => {
			await this.#is_db_opened()
			const transaction = this.#database_request.result.transaction(["files"])
			const files_handles_store = transaction.objectStore("files")
			const request = files_handles_store.getAll()

			request.onsuccess = async () => {
				try {
					const files: AnyMedia[] = request.result || []
					for(const file of files) {
						this.set(file.hash, file)
					}
					this.#files_ready = true
					resolve(files)
				} catch (error) {
					reject(error)
				}
			}

			request.onerror = () => {
				reject(new Error("Failed to retrieve files from the database"));
			}
		})
	}

	async delete_file(hash: string) {
		const media = this.get(hash)
		this.delete(hash)
		return new Promise((resolve) => {
			const request = this.#database_request.result
				.transaction(["files"], "readwrite")
				.objectStore("files")
				.delete(hash)
			request.onsuccess = (event) => {
				resolve(true)
				if (media) {
					this.on_media_change.publish({files: [media], action: "removed"})
				}
			}
		})
	}

	/**
	 * Get video file metadata
	 * Uses HTML5 APIs - fast and works in all browsers
	 * 
	 * Note: For files imported via UI, metadata is pre-extracted.
	 * This method is used as fallback for files loaded from IndexedDB.
	 */
	async getVideoFileMetadata(file: File): Promise<VideoMetadata> {
		return extractVideoMetadataHTML5(file);
	}

	/**
	 * Sync file for collaboration (no permanent storing to db)
	 * Accepts optional pre-extracted metadata to avoid re-extraction
	 */
	async syncFile(
		file: File, 
		hash: string, 
		proxy?: boolean, 
		isHost?: boolean,
		preExtractedMetadata?: VideoMetadata
	) {
		const alreadyAdded = this.get(hash)
		if(alreadyAdded && proxy) {return}
		
		if(file.type.startsWith("image")) {
			const media = {file, hash, kind: "image"} satisfies AnyMedia
			this.set(hash, media)
			if(isHost) {
				this.import_file_with_metadata(file, hash, undefined, proxy)
			} else {
				this.on_media_change.publish({files: [media], action: "added"})
			}
		}
		else if(file.type.startsWith("video")) {
			// Use pre-extracted metadata if available, otherwise extract
			const metadata = preExtractedMetadata || await this.getVideoFileMetadata(file)
			const media = {
				file, 
				hash, 
				kind: "video", 
				frames: metadata.frames, 
				duration: metadata.duration, 
				fps: metadata.fps, 
				proxy: proxy ?? false
			} satisfies AnyMedia
			this.set(hash, media)
			if(isHost) {
				this.import_file_with_metadata(file, hash, metadata, proxy)
			} else {
				this.on_media_change.publish({files: [media], action: "added"})
			}
		}
		else if(file.type.startsWith("audio")) {
			const media = {file, hash, kind: "audio"} satisfies AnyMedia
			this.set(hash, media)
			if(isHost) {
				this.import_file_with_metadata(file, hash, undefined, proxy)
			} else {
				this.on_media_change.publish({files: [media], action: "added"})
			}
		}
	}

	/**
	 * Import file with pre-extracted metadata
	 * This is the production-grade approach - metadata is extracted once at upload
	 */
	async import_file_with_metadata(
		file: File,
		providedHash?: string,
		preExtractedMetadata?: VideoMetadata,
		isProxy?: boolean
	) {
		this.#files_ready = false
		this.on_media_change.publish({files: [], action: "placeholder"})
		
		// Get metadata - use pre-extracted if available
		const metadata = file.type.startsWith('video')
			? (preExtractedMetadata || await this.getVideoFileMetadata(file))
			: null
			
		const hash = providedHash ?? await quick_hash(file)
		
		if(isProxy === false && providedHash) {
			await this.delete_file(providedHash)
		}
		
		const transaction = this.#database_request.result.transaction(["files"], "readwrite")
		const files_store = transaction.objectStore("files")
		const check_if_duplicate = files_store.count(hash)
		
		check_if_duplicate!.onsuccess = () => {
			const not_duplicate = check_if_duplicate.result === 0
			if(not_duplicate) {
				if(file.type.startsWith("image")) {
					const media = {file, hash, kind: "image"} satisfies AnyMedia
					files_store.add(media)
					this.set(hash, media)
					this.on_media_change.publish({files: [media], action: "added"})
				}
				else if(file.type.startsWith("video") && metadata) {
					const media = {
						file, 
						hash, 
						kind: "video", 
						frames: metadata.frames, 
						duration: metadata.duration, 
						fps: metadata.fps, 
						proxy: isProxy ?? false
					} satisfies AnyMedia
					files_store.add(media)
					this.set(hash, media)
					this.on_media_change.publish({files: [media], action: "added"})
				}
				else if(file.type.startsWith("audio")) {
					const media = {file, hash, kind: "audio"} satisfies AnyMedia
					files_store.add(media)
					this.set(hash, media)
					this.on_media_change.publish({files: [media], action: "added"})
				}
			}
			this.#files_ready = true
		}
		check_if_duplicate!.onerror = (error) => {
			console.error("Error checking for duplicate:", error)
			this.#files_ready = true
		}
	}

	/**
	 * Legacy import_file method for backward compatibility
	 * Delegates to import_file_with_metadata
	 */
	async import_file(input: HTMLInputElement | File, proxyHash?: string, isProxy?: boolean) {
		const file = input instanceof File ? input : input.files?.[0]
		if (!file) return
		
		await this.import_file_with_metadata(file, proxyHash, undefined, isProxy)
	}

	create_video_thumbnail(video: HTMLVideoElement): Promise<string> {
		const canvas = document.createElement("canvas")
		canvas.width = 150
		canvas.height = 50
		const ctx = canvas.getContext("2d")
		video.currentTime = 1000/60
		const f = (resolve: (url: string) => void) => {
			ctx?.drawImage(video, 0, 0, 150, 50)
			const url = canvas.toDataURL()
			resolve(url)
			video.removeEventListener("seeked", () => f(resolve))
		}
		return new Promise((resolve) => {
			video.addEventListener("seeked", () => f(resolve))
		})
	}

	create_image_elements(files: ImageFile[]) {
		const images: Image[] = files.map(({file, hash}) => {
			const image = document.createElement("img")
			const url = URL.createObjectURL(file)
			image.src = url
			return {element: image, file, hash, kind: "image", url}
		})
		return images
	}

	create_audio_elements(files: AudioFile[]) {
		const audios: Audio[] = files.map(({file, hash}) => {
			const audio = document.createElement("audio")
			const url = URL.createObjectURL(file)
			audio.src = url
			audio.load()
			return {element: audio, file, hash, kind: "audio", url}
		})
		return audios
	}

	async create_video_elements(files: VideoFile[]) {
		const videos: Video[] = []
		for(const {file, hash, frames, duration, fps, proxy} of files) {
			const video = document.createElement('video')
			video.src = URL.createObjectURL(file)
			video.load()
			const thumbnail = await this.create_video_thumbnail(video)
			videos.push({element: video, file, hash, kind: "video", thumbnail, frames, duration, fps, proxy})
		}
		return videos
	}
}
