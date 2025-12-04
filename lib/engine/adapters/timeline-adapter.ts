/**
 * Timeline Data Adapter
 * 
 * Translates between Alphax timeline data model and Omniclip effect model.
 * 
 * Key Mappings:
 * - TimelineElement ↔ AnyEffect
 * - startTime ↔ start_at_position
 * - mediaId ↔ file_hash
 * - TimelineTrack.id ↔ track (zero-based index)
 * - duration/trimStart/trimEnd ↔ start/end/duration
 */

import type { TimelineElement, MediaElement, TextElement, TimelineTrack } from '@/types/timeline';
import type { 
  AnyEffect, 
  VideoEffect, 
  AudioEffect, 
  ImageEffect, 
  TextEffect,
  EffectRect
} from '../state/types';
import type { MediaFile } from '@/types/media';
import type { TextStyleAlign } from '../state/pixi.mjs';
import { generate_id } from '@benev/slate/x/tools/generate_id';

/**
 * Error thrown when media is not yet synced to the engine
 * This is expected during initial load - media will be synced shortly
 */
export class MediaNotSyncedError extends Error {
  public readonly mediaId: string;
  public readonly elementName: string;
  
  constructor(mediaId: string, elementName: string) {
    super(`Media not yet synced: ${mediaId} (${elementName})`);
    this.name = 'MediaNotSyncedError';
    this.mediaId = mediaId;
    this.elementName = elementName;
  }
}

/**
 * Map TextStyleAlign (which includes "justify") to the limited set supported by TextElement
 */
function mapTextAlign(align: TextStyleAlign | undefined): "left" | "center" | "right" {
  if (!align) return 'left';
  if (align === 'center' || align === 'right') return align;
  // Map "justify" and any other values to "left"
  return 'left';
}

/**
 * Hash mapping between mediaId and file_hash
 * This is maintained by the media adapter
 */
const mediaIdToHashMap = new Map<string, string>();
const hashToMediaIdMap = new Map<string, string>();

/**
 * Register media ID to hash mapping
 */
export function registerMediaMapping(mediaId: string, fileHash: string) {
  mediaIdToHashMap.set(mediaId, fileHash);
  hashToMediaIdMap.set(fileHash, mediaId);
}

/**
 * Get file hash from media ID
 */
export function getFileHash(mediaId: string): string | undefined {
  return mediaIdToHashMap.get(mediaId);
}

/**
 * Get media ID from file hash
 */
export function getMediaId(fileHash: string): string | undefined {
  return hashToMediaIdMap.get(fileHash);
}

/**
 * Clear all media mappings
 */
export function clearMediaMappings() {
  mediaIdToHashMap.clear();
  hashToMediaIdMap.clear();
}

/**
 * Get track index from track ID
 * Tracks are ordered: text tracks first, then media tracks, then audio tracks
 */
export function getTrackIndex(trackId: string, tracks: TimelineTrack[]): number {
  const sortedTracks = [...tracks].sort((a, b) => {
    // Text tracks first
    if (a.type === 'text' && b.type !== 'text') return -1;
    if (b.type === 'text' && a.type !== 'text') return 1;
    
    // Audio tracks last
    if (a.type === 'audio' && b.type !== 'audio') return 1;
    if (b.type === 'audio' && a.type !== 'audio') return -1;
    
    return 0;
  });

  return sortedTracks.findIndex(track => track.id === trackId);
}

/**
 * Get track ID from track index
 */
export function getTrackId(trackIndex: number, tracks: TimelineTrack[]): string | undefined {
  const sortedTracks = [...tracks].sort((a, b) => {
    if (a.type === 'text' && b.type !== 'text') return -1;
    if (b.type === 'text' && a.type !== 'text') return 1;
    if (a.type === 'audio' && b.type !== 'audio') return 1;
    if (b.type === 'audio' && a.type !== 'audio') return -1;
    return 0;
  });

  return sortedTracks[trackIndex]?.id;
}

/**
 * Create default effect rect for visual elements
 * Centers the element on a 1920x1080 canvas
 */
function createDefaultRect(width: number = 1920, height: number = 1080, canvasWidth: number = 1920, canvasHeight: number = 1080): EffectRect {
  return {
    width,
    height,
    scaleX: 1,
    scaleY: 1,
    position_on_canvas: {
      // Center the element on the canvas
      x: canvasWidth / 2,
      y: canvasHeight / 2,
    },
    rotation: 0,
    pivot: {
      x: width / 2,
      y: height / 2,
    },
  };
}

/**
 * Convert Alphax TimelineElement to Omniclip Effect
 */
export function alphaxToOmniclip(
  element: TimelineElement,
  track: TimelineTrack,
  tracks: TimelineTrack[],
  mediaFile?: MediaFile
): AnyEffect {
  const trackIndex = getTrackIndex(track.id, tracks);
  
  // Base effect properties
  // CRITICAL: Omniclip uses start/end as the playback range WITHIN the media file:
  // - start: where to start playing within the media (trimStart)
  // - end: where to stop playing within the media (duration - trimEnd)
  // The effect visibility formula is: start_at_position + (end - start)
  // So effective duration on timeline = end - start = (duration - trimEnd) - trimStart
  const baseEffect = {
    id: element.id,
    start_at_position: element.startTime,
    duration: element.duration,
    start: element.trimStart,
    end: element.duration - element.trimEnd, // End point within media, NOT trimEnd!
    track: trackIndex,
  };

  // Convert based on element type
  if (element.type === 'text') {
    const textElement = element as TextElement;
    
    const textEffect: TextEffect = {
      ...baseEffect,
      kind: 'text',
      text: textElement.content,
      fontFamily: textElement.fontFamily,
      fontSize: textElement.fontSize,
      fontStyle: textElement.fontStyle === 'italic' ? 'italic' : 'normal',
      fontWeight: textElement.fontWeight === 'bold' ? 'bold' : 'normal',
      fontVariant: 'normal',
      align: textElement.textAlign,
      fill: [textElement.color],
      fillGradientType: 0, // No gradient by default
      fillGradientStops: [],
      stroke: { color: 'transparent', width: 0 },
      strokeThickness: 0,
      lineJoin: 'miter',
      miterLimit: 10,
      letterSpacing: 0,
      dropShadow: false,
      dropShadowAlpha: 1,
      dropShadowAngle: 0.523599,
      dropShadowBlur: 0,
      dropShadowDistance: 5,
      dropShadowColor: '#000000',
      wordWrap: true,
      wordWrapWidth: 500,
      lineHeight: 0,
      leading: 0,
      breakWords: false,
      whiteSpace: 'normal',
      textBaseline: 'alphabetic',
      rect: {
        ...createDefaultRect(500, 100),
        position_on_canvas: {
          x: textElement.x,
          y: textElement.y,
        },
        rotation: textElement.rotation,
      },
    };
    
    return textEffect;
  }

  // Media element (video, audio, or image)
  const mediaElement = element as MediaElement;
  const fileHash = getFileHash(mediaElement.mediaId);
  
  // If media not yet synced to engine, skip this element
  // It will be added once syncMediaToEngine completes
  if (!fileHash) {
    throw new MediaNotSyncedError(mediaElement.mediaId, element.name);
  }

  // Determine media type from MediaFile
  if (mediaFile) {
    if (mediaFile.type === 'video') {
      const videoEffect: VideoEffect = {
        ...baseEffect,
        kind: 'video',
        file_hash: fileHash,
        name: element.name,
        thumbnail: mediaFile.thumbnailUrl || '',
        raw_duration: mediaFile.duration || element.duration,
        frames: Math.round((mediaFile.fps || 30) * (mediaFile.duration || element.duration) / 1000),
        rect: createDefaultRect(mediaFile.width, mediaFile.height),
      };
      return videoEffect;
    }
    
    if (mediaFile.type === 'image') {
      const imageEffect: ImageEffect = {
        ...baseEffect,
        kind: 'image',
        file_hash: fileHash,
        name: element.name,
        rect: createDefaultRect(mediaFile.width, mediaFile.height),
      };
      return imageEffect;
    }
    
    if (mediaFile.type === 'audio') {
      const audioEffect: AudioEffect = {
        ...baseEffect,
        kind: 'audio',
        file_hash: fileHash,
        name: element.name,
        raw_duration: mediaFile.duration || element.duration,
      };
      return audioEffect;
    }
  }

  // Fallback: assume video if we can't determine type
  const fallbackEffect: VideoEffect = {
    ...baseEffect,
    kind: 'video',
    file_hash: fileHash,
    name: element.name,
    thumbnail: '',
    raw_duration: element.duration,
    frames: Math.round(30 * element.duration / 1000), // Assume 30fps
    rect: createDefaultRect(),
  };
  
  return fallbackEffect;
}

/**
 * Convert Omniclip Effect to Alphax TimelineElement
 */
export function omniclipToAlphax(
  effect: AnyEffect,
  tracks: TimelineTrack[]
): TimelineElement {
  // Get track ID from effect track index
  const trackId = getTrackId(effect.track, tracks);
  
  if (!trackId) {
    throw new Error(`No track found for index: ${effect.track}`);
  }

  // Base element properties
  // CRITICAL: Convert back from Omniclip's start/end (range within media) to Alphax's trimStart/trimEnd
  // - effect.start = trimStart (where playback starts in media)
  // - effect.end = duration - trimEnd (where playback ends in media)
  // So: trimEnd = duration - effect.end
  const baseElement = {
    id: effect.id,
    name: 'name' in effect ? effect.name : 'Untitled',
    duration: effect.duration,
    startTime: effect.start_at_position,
    trimStart: effect.start,
    trimEnd: effect.duration - effect.end, // Convert back from end point to trimEnd
  };

  // Convert based on effect kind
  if (effect.kind === 'text') {
    const textElement: TextElement = {
      ...baseElement,
      type: 'text',
      content: effect.text,
      fontSize: effect.fontSize,
      fontFamily: effect.fontFamily,
      color: Array.isArray(effect.fill) && effect.fill.length > 0 
        ? String(effect.fill[0]) 
        : '#ffffff',
      backgroundColor: 'transparent',
      textAlign: mapTextAlign(effect.align),
      fontWeight: effect.fontWeight === 'bold' ? 'bold' : 'normal',
      fontStyle: effect.fontStyle === 'italic' ? 'italic' : 'normal',
      textDecoration: 'none',
      x: effect.rect?.position_on_canvas?.x || 0,
      y: effect.rect?.position_on_canvas?.y || 0,
      rotation: effect.rect?.rotation || 0,
      opacity: 1,
    };
    return textElement;
  }

  // Media effects (video, audio, image)
  const mediaId = getMediaId(effect.file_hash);
  
  if (!mediaId) {
    // If no mapping exists, use file_hash as mediaId (will need to be resolved)
    console.warn(`No media ID found for hash: ${effect.file_hash}, using hash as ID`);
  }

  const mediaElement: MediaElement = {
    ...baseElement,
    type: 'media',
    mediaId: mediaId || effect.file_hash,
    muted: effect.kind === 'video' ? false : undefined,
  };

  return mediaElement;
}

/**
 * Result of converting tracks to effects
 */
export interface TracksToEffectsResult {
  effects: AnyEffect[];
  pendingMediaIds: string[];
}

/**
 * Convert array of Alphax timeline tracks to Omniclip effects
 * 
 * Returns both the converted effects and a list of media IDs that are pending sync.
 * This allows the caller to retry once media is synced.
 */
export function tracksToEffects(
  tracks: TimelineTrack[],
  mediaFiles: Map<string, MediaFile>
): TracksToEffectsResult {
  const effects: AnyEffect[] = [];
  const pendingMediaIds: string[] = [];

  for (const track of tracks) {
    for (const element of track.elements) {
      try {
        const mediaFile = element.type === 'media' 
          ? mediaFiles.get((element as MediaElement).mediaId)
          : undefined;
        
        const effect = alphaxToOmniclip(element, track, tracks, mediaFile);
        effects.push(effect);
      } catch (error) {
        // Handle media not yet synced - track it for retry
        if (error instanceof MediaNotSyncedError) {
          pendingMediaIds.push(error.mediaId);
          // Don't log - this is expected during initial sync
        } else {
          console.error('Error converting element to effect:', error, element);
        }
      }
    }
  }

  return { effects, pendingMediaIds };
}

/**
 * Convert array of Omniclip effects to Alphax timeline tracks
 */
export function effectsToTracks(
  effects: AnyEffect[],
  existingTracks: TimelineTrack[]
): TimelineTrack[] {
  // Group effects by track index
  const effectsByTrack = new Map<number, AnyEffect[]>();
  
  for (const effect of effects) {
    const trackEffects = effectsByTrack.get(effect.track) || [];
    trackEffects.push(effect);
    effectsByTrack.set(effect.track, trackEffects);
  }

  // Update existing tracks with converted elements
  const updatedTracks = existingTracks.map((track, index) => {
    const trackIndex = getTrackIndex(track.id, existingTracks);
    const trackEffects = effectsByTrack.get(trackIndex) || [];
    
    const elements = trackEffects.map(effect => 
      omniclipToAlphax(effect, existingTracks)
    );

    return {
      ...track,
      elements,
    };
  });

  return updatedTracks;
}

