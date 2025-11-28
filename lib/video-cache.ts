/**
 * Video Cache API - Compatibility wrapper for Omniclip frame caching
 * 
 * Omniclip's decoder handles frame caching internally:
 * - lib/engine/controllers/controllers/video-export/parts/decoder.ts
 * - Uses WebCodecs VideoDecoder with worker-based decoding
 * - Maintains decoded_frames Map with VideoFrame objects
 * 
 * This stub provides backward compatibility for existing UI code.
 */

export interface VideoCacheOptions {
  maxCacheSize?: number;
  preloadFrames?: number;
}

/**
 * Simple video frame cache for UI compatibility
 * 
 * NOTE: Omniclip's actual frame caching happens in the decoder.
 * This class can remain for backward compatibility with existing UI code.
 */
export class VideoCache {
  private cache: Map<string, ImageBitmap> = new Map();
  private maxCacheSize: number;

  constructor(options: VideoCacheOptions = {}) {
    this.maxCacheSize = options.maxCacheSize || 100;
  }

  async getFrame(
    videoId: string,
    time: number
  ): Promise<ImageBitmap | null> {
    const key = `${videoId}-${time}`;
    return this.cache.get(key) || null;
  }

  async cacheFrame(
    videoId: string,
    time: number,
    frame: ImageBitmap
  ): Promise<void> {
    const key = `${videoId}-${time}`;
    
    // Simple LRU: remove oldest if cache full
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, frame);
  }

  clear(): void {
    // Clean up ImageBitmaps
    for (const frame of this.cache.values()) {
      frame.close();
    }
    this.cache.clear();
  }

  // Alias for backward compatibility
  clearAll(): void {
    this.clear();
  }

  clearVideo(videoId: string): void {
    // Remove all frames associated with this videoId
    for (const [key, frame] of this.cache.entries()) {
      if (key.startsWith(`${videoId}-`)) {
        frame.close();
        this.cache.delete(key);
      }
    }
  }

  getSize(): number {
    return this.cache.size;
  }
}

// Singleton instance
let cacheInstance: VideoCache | null = null;

export function getVideoCache(): VideoCache {
  if (!cacheInstance) {
    cacheInstance = new VideoCache();
  }
  return cacheInstance;
}

// Export singleton instance for backward compatibility
export const videoCache = getVideoCache();
