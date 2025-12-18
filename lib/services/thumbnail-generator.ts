import { toast } from "sonner";

interface ThumbnailRequest {
  file: File;
  time: number;
  width: number;
  height: number;
  resolve: (url: string) => void;
  reject: (error: Error) => void;
}

class ThumbnailGenerator {
  private videoPool: HTMLVideoElement[] = [];
  private poolSize = 4; // Parallel workers
  private busyPool: boolean[] = [];
  private requestQueue: ThumbnailRequest[] = [];
  private cache: Map<string, string> = new Map(); // Cache key -> Data URL
  private fileUrlCache: Map<File, string> = new Map(); // File -> Object URL

  constructor() {
    if (typeof window !== "undefined") {
      this.initPool();
    }
  }

  private initPool() {
    for (let i = 0; i < this.poolSize; i++) {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      // Hardware acceleration hints
      (video as any).disablePictureInPicture = true;
      this.videoPool.push(video);
      this.busyPool.push(false);
    }
  }

  public generate(
    file: File,
    time: number,
    width: number = 160,
    height: number = 90
  ): Promise<string> {
    const cacheKey = `${file.name}-${file.lastModified}-${time.toFixed(1)}-${width}x${height}`;
    
    if (this.cache.has(cacheKey)) {
      return Promise.resolve(this.cache.get(cacheKey)!);
    }

    return new Promise((resolve, reject) => {
      this.requestQueue.push({ file, time, width, height, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.requestQueue.length === 0) return;

    // Find available worker
    const workerIndex = this.busyPool.findIndex((busy) => !busy);
    if (workerIndex === -1) return;

    const request = this.requestQueue.shift();
    if (!request) return;

    this.busyPool[workerIndex] = true;
    const video = this.videoPool[workerIndex];

    try {
      await this.processRequest(video, request);
    } catch (error) {
      console.error("Thumbnail generation failed:", error);
      request.reject(error as Error);
    } finally {
      this.busyPool[workerIndex] = false;
      this.processQueue();
    }
  }

  private async processRequest(video: HTMLVideoElement, request: ThumbnailRequest) {
    const { file, time, width, height, resolve } = request;

    // Get or create object URL
    let objectUrl = this.fileUrlCache.get(file);
    if (!objectUrl) {
      objectUrl = URL.createObjectURL(file);
      this.fileUrlCache.set(file, objectUrl);
    }

    // Load video if needed
    if (video.src !== objectUrl) {
      video.src = objectUrl;
      video.load();
    }

    // Seek
    video.currentTime = time;

    // Wait for seek
    await new Promise<void>((resolveSeek, rejectSeek) => {
      const onSeeked = () => {
        cleanup();
        resolveSeek();
      };
      
      const onError = () => {
        cleanup();
        rejectSeek(new Error("Video seek failed"));
      };

      const cleanup = () => {
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
      };

      video.addEventListener("seeked", onSeeked);
      video.addEventListener("error", onError);
      
      // Safety timeout
      // video.currentTime might trigger seeked synchronously in some browsers/cases? No, usually async.
    });

    // Draw to canvas
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    
    if (!ctx) {
      throw new Error("Canvas context failed");
    }

    ctx.drawImage(video, 0, 0, width, height);
    
    // Reduce quality for speed/memory
    const url = canvas.toDataURL("image/jpeg", 0.6);
    
    // Cache result
    const cacheKey = `${file.name}-${file.lastModified}-${time.toFixed(1)}-${width}x${height}`;
    this.cache.set(cacheKey, url);

    resolve(url);
  }

  // Clear memory when needed (e.g. project close)
  public clear() {
    this.cache.clear();
    this.fileUrlCache.forEach((url) => URL.revokeObjectURL(url));
    this.fileUrlCache.clear();
  }
}

export const thumbnailGenerator = new ThumbnailGenerator();

