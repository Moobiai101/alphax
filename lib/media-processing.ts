/**
 * Media Processing API - Facade for Omniclip Media Controller
 * 
 * This file wraps Omniclip's Media controller for use in Alphax.
 * The actual processing is in lib/engine/controllers/controllers/media/controller.ts
 */

import { toast } from "sonner";
import type { MediaFile } from "@/types/media";

export interface ProcessedMediaItem extends Omit<MediaFile, "id"> {}

/**
 * Process media files using Omniclip Media controller
 * 
 * NOTE: The Omniclip Media controller provides:
 * - IndexedDB storage with file hashing (lib/engine/controllers/controllers/media/controller.ts)
 * - MediaInfo metadata extraction (duration, fps, resolution)
 * - Video thumbnail generation
 * - Proxy file support
 * 
 * TODO: Wire to engine context to use actual Omniclip processing
 * For now, returns basic media items for UI compatibility
 */
export async function processMediaFiles(
  files: FileList | File[],
  onProgress?: (progress: number) => void
): Promise<ProcessedMediaItem[]> {
  const fileArray = Array.from(files);
  const processedItems: ProcessedMediaItem[] = [];

  const total = fileArray.length;
  let completed = 0;

  for (const file of fileArray) {
    // Basic file type detection
    const type = file.type.startsWith("video/")
      ? "video"
      : file.type.startsWith("audio/")
      ? "audio"
      : file.type.startsWith("image/")
      ? "image"
      : null;

    if (!type) {
      toast.error(`Unsupported file type: ${file.name}`);
      continue;
    }

    // Create object URL for preview (no processing yet)
    const url = URL.createObjectURL(file);

    // Basic media item (dimensions/duration will be added by Omniclip)
    processedItems.push({
      name: file.name,
      type: type as "video" | "audio" | "image",
      file,
      url,
      thumbnailUrl: type === "image" ? url : undefined,
      duration: undefined, // Will be populated by Omniclip
      width: undefined,
      height: undefined,
      fps: undefined,
    });

    completed += 1;
    onProgress?.(Math.round((completed / total) * 100));

    // Yield to prevent blocking
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return processedItems;
}

