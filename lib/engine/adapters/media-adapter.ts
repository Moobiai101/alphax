/**
 * Media Data Adapter
 * 
 * Manages the bidirectional mapping between Alphax media storage and Omniclip's
 * hash-based IndexedDB storage system.
 * 
 * Key Responsibilities:
 * - Import files into Omniclip's IndexedDB with hash-based deduplication
 * - Pass pre-extracted metadata to avoid re-extraction (production-grade)
 * - Maintain mediaId ↔ file_hash mapping
 * - Sync media deletions between systems
 * 
 * Architecture:
 * - Metadata is extracted ONCE during upload (in media-processing.ts)
 * - This adapter passes that metadata to the engine
 * - No redundant metadata extraction = faster imports
 */

import type { MediaFile } from '@/types/media';
import type { Media, VideoMetadata } from '../controllers/controllers/media/controller';
import type { AnyMedia } from '../types/media-types';
import { quick_hash } from '@benev/construct';
import { registerMediaMapping, getFileHash, getMediaId } from './timeline-adapter';

/**
 * Convert Alphax MediaFile metadata to Omniclip VideoMetadata format
 */
function toVideoMetadata(mediaFile: MediaFile): VideoMetadata | undefined {
  if (mediaFile.type !== 'video') return undefined;
  if (!mediaFile.duration) return undefined;
  
  const fps = mediaFile.fps || 30;
  const durationMs = mediaFile.duration * 1000; // Convert seconds to ms
  const frames = Math.round(fps * mediaFile.duration);
  
  return {
    fps,
    duration: durationMs,
    frames,
    width: mediaFile.width,
    height: mediaFile.height,
  };
}

/**
 * Import media file into Omniclip engine
 * 
 * Uses pre-extracted metadata from UI layer when available.
 * This is production-grade because:
 * - No redundant metadata extraction
 * - Faster imports
 * - No WASM dependencies
 * 
 * @param mediaFile - Alphax media file with pre-extracted metadata
 * @param mediaController - Omniclip media controller
 * @returns File hash used by Omniclip
 */
export async function importMediaToEngine(
  mediaFile: MediaFile,
  mediaController: Media
): Promise<string> {
  // Calculate file hash
  const hash = await quick_hash(mediaFile.file);

  // Check if file already exists in engine
  const existingFile = await mediaController.get_file(hash);
  if (existingFile) {
    // File already imported, just register mapping
    registerMediaMapping(mediaFile.id, hash);
    return hash;
  }

  // Convert metadata to engine format
  const videoMetadata = toVideoMetadata(mediaFile);

  // Import file with pre-extracted metadata (no re-extraction needed)
  await mediaController.import_file_with_metadata(
    mediaFile.file,
    hash,
    videoMetadata,
    false // isProxy
  );
  
  registerMediaMapping(mediaFile.id, hash);
  return hash;
}

/**
 * Remove media from engine
 * 
 * @param mediaId - Alphax media ID
 * @param mediaController - Omniclip media controller
 */
export async function removeMediaFromEngine(
  mediaId: string,
  mediaController: Media
): Promise<void> {
  const hash = getFileHash(mediaId);
  
  if (!hash) {
    console.warn(`No hash found for media ID: ${mediaId}`);
    return;
  }

  // Delete from IndexedDB
  await mediaController.delete_file(hash);
}

/**
 * Sync all media files from Alphax to Engine
 * 
 * Imports files in batches to avoid overwhelming the system.
 * Uses pre-extracted metadata for fast imports.
 * 
 * @param mediaFiles - Array of Alphax media files
 * @param mediaController - Omniclip media controller
 */
export async function syncMediaToEngine(
  mediaFiles: MediaFile[],
  mediaController: Media
): Promise<void> {
  // Import all media files in parallel (with reasonable concurrency)
  const batchSize = 3; // Process 3 files at a time
  
  for (let i = 0; i < mediaFiles.length; i += batchSize) {
    const batch = mediaFiles.slice(i, i + batchSize);
    await Promise.all(
      batch.map(mediaFile => 
        importMediaToEngine(mediaFile, mediaController).catch(error => {
          console.error(`Failed to import media ${mediaFile.name}:`, error);
        })
      )
    );
  }
}

/**
 * Get all media from engine and create Alphax media files
 * 
 * Used when loading project from IndexedDB on refresh.
 * 
 * @param mediaController - Omniclip media controller
 * @returns Array of Alphax media files
 */
export async function getMediaFromEngine(
  mediaController: Media
): Promise<MediaFile[]> {
  const engineMedia = await mediaController.getImportedFiles();
  const mediaFiles: MediaFile[] = [];

  for (const media of engineMedia) {
    // Check if we have a mapping
    let mediaId = getMediaId(media.hash);
    
    // If no mapping exists, create one
    if (!mediaId) {
      mediaId = `engine-${media.hash.slice(0, 8)}`;
      registerMediaMapping(mediaId, media.hash);
    }

    // Convert engine media to Alphax media
    const mediaFile = engineMediaToAlphax(media, mediaId);
    mediaFiles.push(mediaFile);
  }

  return mediaFiles;
}

/**
 * Convert engine media to Alphax media file
 */
function engineMediaToAlphax(media: AnyMedia, mediaId: string): MediaFile {
  // Extract filename from file object or generate from hash
  const fileName = media.file.name || `media-${media.hash.slice(0, 8)}`;
  
  const baseMedia = {
    id: mediaId,
    name: fileName,
    file: media.file,
  };

  if (media.kind === 'video') {
    return {
      ...baseMedia,
      type: 'video' as const,
      duration: media.duration / 1000, // Convert ms to seconds for UI
      fps: media.fps,
      thumbnailUrl: undefined, // Will be generated by Alphax if needed
    };
  }

  if (media.kind === 'audio') {
    return {
      ...baseMedia,
      type: 'audio' as const,
    };
  }

  if (media.kind === 'image') {
    return {
      ...baseMedia,
      type: 'image' as const,
    };
  }

  throw new Error(`Unknown media kind: ${(media as AnyMedia).kind}`);
}

/**
 * Check if media file exists in engine
 * 
 * @param mediaId - Alphax media ID
 * @param mediaController - Omniclip media controller
 * @returns True if file exists
 */
export async function mediaExistsInEngine(
  mediaId: string,
  mediaController: Media
): Promise<boolean> {
  const hash = getFileHash(mediaId);
  
  if (!hash) {
    return false;
  }

  const file = await mediaController.get_file(hash);
  return !!file;
}
