/**
 * Timeline Rendering API - Facade for Omniclip Compositor
 * 
 * This file wraps Omniclip's PIXI-based compositor for canvas rendering.
 * The actual renderer is in lib/engine/controllers/controllers/compositor/controller.ts
 */

import type { TimelineTrack } from "@/types/timeline";
import type { MediaFile } from "@/types/media";
import type { CanvasSize } from "@/types/project";

export interface RenderTimelineFrameOptions {
  ctx: CanvasRenderingContext2D;
  time: number;
  canvasWidth: number;
  canvasHeight: number;
  tracks: TimelineTrack[];
  mediaFiles: MediaFile[];
  backgroundColor?: string;
  backgroundType?: "color" | "blur";
  blurIntensity?: number;
  projectCanvasSize?: CanvasSize;
}

/**
 * Render timeline frame using Omniclip Compositor
 * 
 * NOTE: The Omniclip Compositor uses PIXI.js for GPU-accelerated rendering:
 * - Creates PIXI.Application with canvas
 * - Manages video/image/text/audio sprites
 * - Handles transitions, filters, animations
 * - Provides real-time preview
 * 
 * Implementation in lib/engine/controllers/controllers/compositor/controller.ts
 * Key method: compositor.compose_effects(effects, timecode, exporting)
 * 
 * TODO: Mount PIXI canvas in preview-panel.tsx and use compositor directly
 * This stub can remain for fallback/compatibility but should delegate to compositor
 */
export async function renderTimelineFrame(
  options: RenderTimelineFrameOptions
): Promise<void> {
  const {
    ctx,
    backgroundColor = "#000000",
    backgroundType = "color",
  } = options;

  // Temporary fallback: simple background fill
  // Once engine context is wired, this will use compositor.app.render()
  if (backgroundType === "color") {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}

