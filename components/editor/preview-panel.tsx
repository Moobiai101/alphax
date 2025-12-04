/**
 * Preview Panel with PIXI Integration
 * 
 * Production-ready preview panel that mounts the Omniclip PIXI compositor.
 * Replaces canvas-based rendering with GPU-accelerated PIXI.js rendering.
 */

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTimelineStore } from "@/lib/stores/timeline-store";
import { useMediaStore } from "@/lib/stores/media-store";
import { usePlaybackStore } from "@/lib/stores/playback-store";
import { useProjectStore, DEFAULT_CANVAS_SIZE } from "@/lib/stores/project-store";
import { useSceneStore } from "@/lib/stores/scene-store";
import { useEngine, useEngineState } from "@/components/providers/engine-provider";
import { Button } from "@/components/ui/button";
import { Play, Pause, Expand, SkipBack, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimeCode } from "@/lib/time";
import { EditableTimecode } from "@/components/ui/editable-timecode";
import { LayoutGuideOverlay } from "./layout-guide-overlay";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "../ui/label";
import { SocialsIcon } from "../icons";
import { PLATFORM_LAYOUTS, type PlatformLayout } from "@/lib/stores/editor-store";
import { tracksToEffects, syncMediaToEngine } from "@/lib/engine/adapters";
import { TextElement, TimelineElement, TimelineTrack } from "@/types/timeline";

export function PreviewPanel() {
  const { tracks, getTotalDuration, updateTextElement } = useTimelineStore();
  const { mediaFiles } = useMediaStore();
  const { activeProject } = useProjectStore();
  const { currentScene } = useSceneStore();
  const engine = useEngine();
  
  // ENGINE IS THE SINGLE SOURCE OF TRUTH - subscribe directly to engine state
  // Following Omniclip pattern: UI reads from engine.state directly
  const engineState = useEngineState((state) => ({
    timecode: state.timecode,
    isPlaying: state.is_playing,
    effects: state.effects,
  }));
  
  // Keep Zustand only for UI controls (volume, speed) and for timeline display
  // But engine drives the actual playback
  const { toggle, setCurrentTime } = usePlaybackStore();
  
  const pixiContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [previewDimensions, setPreviewDimensions] = useState({ width: 0, height: 0 });
  const [isExpanded, setIsExpanded] = useState(false);
  const canvasSize = activeProject?.canvasSize || DEFAULT_CANVAS_SIZE;
  const isMounted = useRef(false);

  // Sync media to engine
  useEffect(() => {
    const sync = async () => {
      if (engine && mediaFiles.length > 0) {
        try {
          await syncMediaToEngine(mediaFiles, engine.controllers.media);
        } catch (error) {
          console.error("Failed to sync media to engine:", error);
        }
      }
    };
    sync();
  }, [engine, mediaFiles]);

  // === FOLLOW OMNICLIP PATTERN EXACTLY ===
  // Following omniclip/s/components/omni-timeline/views/media-player/view.ts pattern
  // NOTE: Playback sync is handled synchronously in toggle handler to avoid race conditions

  // 2. Watch timecode changes when PAUSED (user seeking/dragging playhead)
  useEffect(() => {
    if (!engine) return;
    if (engineState.isPlaying) return; // Skip during playback - compositor handles it internally
    
    const compositor = engine.controllers.compositor;
    if (compositor.isDestroyed) return;
    
    const state = engine.getState();
    const timecode = engineState.timecode;
    
    // When paused and timecode changes (user dragged playhead), update preview
    // Following Omniclip pattern EXACTLY: compose_effects THEN seek THEN compose_effects again
    compositor.compose_effects(state.effects, timecode);
    compositor.seek(timecode, true).then(() => {
      if (!compositor.isDestroyed) {
        compositor.compose_effects(state.effects, timecode);
      }
    });
  }, [engine, engineState.timecode, engineState.isPlaying]);
  
  // NOTE: We do NOT subscribe to compositor.on_playing because:
  // - Compositor already calls compose_effects internally in #on_playing (line 152)
  // - Omniclip's subscription is redundant but harmless - we'll avoid it for performance

  // Track pending media for retry
  const pendingMediaRef = useRef<Set<string>>(new Set());
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sync timeline effects to engine
  useEffect(() => {
    let isMounted = true;

    const syncEffects = async () => {
      try {
        const mediaFilesMap = new Map(mediaFiles.map(m => [m.id, m]));
        const { effects, pendingMediaIds } = tracksToEffects(tracks, mediaFilesMap);
        
        if (!isMounted) return;
        
        // Track pending media for retry
        if (pendingMediaIds.length > 0) {
          pendingMediaIds.forEach(id => pendingMediaRef.current.add(id));
          
          // Schedule retry if there are pending media
          if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
          }
          retryTimeoutRef.current = setTimeout(() => {
            if (isMounted) syncEffects();
          }, 500); // Retry after 500ms
        } else {
          // All media synced, clear pending
          pendingMediaRef.current.clear();
        }
        
        if (!isMounted) return;
        
        // Update engine state with new effects
        const currentEffects = engine.getEffects();
        
        // Only update if effects have changed
        const effectsChanged = JSON.stringify(effects) !== JSON.stringify(currentEffects);
        
        if (effectsChanged && effects.length > 0) {
          const compositor = engine.controllers.compositor;
          const media = engine.controllers.media;
          
          // Wait for media files to be ready before recreating
          await media.are_files_ready();
          
          if (!isMounted) return;

          // Check if engine/compositor is destroyed
          if (compositor.isDestroyed || (compositor.app && compositor.app.renderer === null)) {
             return;
          }

          // Clear compositor and reset state
          try {
             compositor.clear();
          } catch (e) {
             console.warn("Failed to clear compositor:", e);
             return; // Stop if compositor is broken
          }

          engine.actions.historical.remove_all_effects();
          
          // Add effects to state
          for (const effect of effects) {
            if (effect.kind === 'video') {
              engine.actions.historical.add_video_effect(effect);
            } else if (effect.kind === 'audio') {
              engine.actions.historical.add_audio_effect(effect);
            } else if (effect.kind === 'image') {
              engine.actions.historical.add_image_effect(effect);
            } else if (effect.kind === 'text') {
              engine.actions.historical.add_text_effect(effect);
            }
          }
          
          // Recreate compositor objects from state (critical for video playback)
          // This mirrors omniclip's #recreate_project_from_localstorage_state
          const state = engine.getState();
          await compositor.recreate(state, media);
          
          if (!isMounted) return;

          // Compose effects at current timecode to show initial frame
          compositor.compose_effects(state.effects, state.timecode);
        } else if (effects.length === 0 && currentEffects.length > 0) {
          // Clear all effects
          engine.actions.historical.remove_all_effects();
          try {
            engine.controllers.compositor.clear();
          } catch (e) {
            console.warn("Failed to clear compositor:", e);
          }
        }
      } catch (error) {
        console.error('Error syncing effects to engine:', error);
      }
    };
    
    syncEffects();
    
    return () => {
      isMounted = false;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [tracks, mediaFiles, engine]);

  // Mount PIXI canvas and set up playback loop - ONCE only
  // This effect should run only ONCE when the component mounts and engine is ready
  useEffect(() => {
    console.log('[PreviewPanel] Canvas mount useEffect running, container:', !!pixiContainerRef.current, 'isMounted:', isMounted.current);
    
    // Don't run if already mounted
    if (isMounted.current) {
      console.log('[PreviewPanel] Already mounted, skipping');
      return;
    }
    
    // Use a timeout to ensure the container is rendered (React ref timing)
    const timeoutId = setTimeout(() => {
      const container = pixiContainerRef.current;
      if (!container) {
        console.log('[PreviewPanel] No container ref after timeout, skipping mount');
        return;
      }

      try {
        const compositor = engine.controllers.compositor;
        console.log('[PreviewPanel] Compositor:', !!compositor, 'isDestroyed:', compositor?.isDestroyed);
        
        // Guard: don't mount if compositor is destroyed
        if (compositor.isDestroyed) {
          console.warn('Cannot mount PIXI canvas: compositor is destroyed');
          return;
        }
        
        const pixiCanvas = compositor.app.view as HTMLCanvasElement;
        console.log('[PreviewPanel] Got PIXI canvas:', !!pixiCanvas, 'tagName:', pixiCanvas?.tagName);
        
        // Set canvas styles for proper display
        pixiCanvas.style.position = 'absolute';
        pixiCanvas.style.top = '0';
        pixiCanvas.style.left = '0';
        pixiCanvas.style.width = '100%';
        pixiCanvas.style.height = '100%';
        pixiCanvas.style.objectFit = 'contain';
        
        container.appendChild(pixiCanvas);
        isMounted.current = true;

        console.log('✅ PIXI canvas mounted successfully');

        // Note: The compositor's internal #on_playing loop handles compose_effects
        // We don't need to subscribe here - that would cause double rendering
        // The compositor already calls compose_effects(omnislate.context.state.effects, timecode)
        // in its animation frame loop

        // Store cleanup function in a ref so we can call it on unmount
        const cleanup = () => {
          console.log('[PreviewPanel] Cleaning up PIXI canvas mount');
          if (container.contains(pixiCanvas)) {
            container.removeChild(pixiCanvas);
          }
          isMounted.current = false;
        };

        // Return cleanup to be called on component unmount ONLY
        return cleanup;
      } catch (error) {
        console.error('Failed to mount PIXI canvas:', error);
      }
    }, 100); // Small delay to ensure container is rendered

    // Cleanup timeout on unmount
    return () => {
      clearTimeout(timeoutId);
    };
  }, [engine]); // Only depend on engine - mount once and keep mounted

  // Update preview dimensions
  useEffect(() => {
    const updatePreviewSize = () => {
      if (!containerRef.current) return;

      let availableWidth, availableHeight;

      if (isExpanded) {
        const controlsHeight = 80;
        const marginSpace = 24;
        availableWidth = window.innerWidth - marginSpace;
        availableHeight = window.innerHeight - controlsHeight - marginSpace;
      } else {
        const container = containerRef.current.getBoundingClientRect();
        const computedStyle = getComputedStyle(containerRef.current);
        const paddingTop = parseFloat(computedStyle.paddingTop);
        const paddingBottom = parseFloat(computedStyle.paddingBottom);
        const paddingLeft = parseFloat(computedStyle.paddingLeft);
        const paddingRight = parseFloat(computedStyle.paddingRight);
        const gap = parseFloat(computedStyle.gap) || 16;
        const toolbar = containerRef.current.querySelector("[data-toolbar]");
        const toolbarHeight = toolbar ? toolbar.getBoundingClientRect().height : 0;

        availableWidth = container.width - paddingLeft - paddingRight;
        availableHeight =
          container.height -
          paddingTop -
          paddingBottom -
          toolbarHeight -
          (toolbarHeight > 0 ? gap : 0);
      }

      const targetRatio = canvasSize.width / canvasSize.height;
      const containerRatio = availableWidth / availableHeight;
      let width, height;

      if (containerRatio > targetRatio) {
        height = availableHeight * (isExpanded ? 0.95 : 1);
        width = height * targetRatio;
      } else {
        width = availableWidth * (isExpanded ? 0.95 : 1);
        height = width / targetRatio;
      }

      setPreviewDimensions({ width, height });

      // Update compositor canvas size - with proper guards
      try {
        const compositor = engine?.controllers?.compositor;
        if (compositor && !compositor.isDestroyed && compositor.app?.renderer) {
          compositor.set_canvas_resolution(canvasSize.width, canvasSize.height);
        }
      } catch (error) {
        // Compositor not ready or destroyed - ignore silently
      }
    };

    updatePreviewSize();
    const resizeObserver = new ResizeObserver(updatePreviewSize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    if (isExpanded) {
      window.addEventListener("resize", updatePreviewSize);
    }

    return () => {
      resizeObserver.disconnect();
      if (isExpanded) {
        window.removeEventListener("resize", updatePreviewSize);
      }
    };
  }, [canvasSize.width, canvasSize.height, isExpanded, engine]);

  // Handle fullscreen ESC key
  useEffect(() => {
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isExpanded) {
        setIsExpanded(false);
      }
    };

    if (isExpanded) {
      document.addEventListener("keydown", handleEscapeKey);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.removeEventListener("keydown", handleEscapeKey);
      document.body.style.overflow = "";
    };
  }, [isExpanded]);

  const hasAnyElements = tracks.some((track) => track.elements.length > 0);
  const shouldRenderPreview = previewDimensions.width > 0 && previewDimensions.height > 0;

  const handleSkipBackward = () => {
    const currentTimeSec = engineState.timecode / 1000;
    const newTimeSec = Math.max(0, currentTimeSec - 1);
    const newTimeMs = newTimeSec * 1000;
    engine.seek(newTimeMs);
    setCurrentTime(newTimeSec);
  };

  const handleSkipForward = () => {
    const durationSec = getTotalDuration() / 1000;
    const currentTimeSec = engineState.timecode / 1000;
    const newTimeSec = Math.min(durationSec, currentTimeSec + 1);
    const newTimeMs = newTimeSec * 1000;
    engine.seek(newTimeMs);
    setCurrentTime(newTimeSec);
  };

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  if (isExpanded) {
    return (
      <div className="fixed inset-0 z-9999 flex flex-col bg-background">
        <div className="flex-1 flex items-center justify-center">
          <div
            className="relative overflow-hidden border border-border m-3"
            style={{
              width: previewDimensions.width,
              height: previewDimensions.height,
              background: activeProject?.backgroundColor || "#000000",
            }}
          >
            <div
              ref={pixiContainerRef}
              className="absolute inset-0"
              style={{ pointerEvents: 'none' }}
            />
            <LayoutGuideOverlay />
          </div>
        </div>
        <div className="p-4 bg-background">
          <PreviewToolbar
            hasAnyElements={hasAnyElements}
            onToggleExpanded={toggleExpanded}
            currentTime={engineState.timecode / 1000}
            setCurrentTime={(timeSec) => {
              const timeMs = timeSec * 1000;
              engine.seek(timeMs);
              setCurrentTime(timeSec);
            }}
            toggle={() => {
              const compositor = engine.controllers.compositor;
              const state = engine.getState();
              
              // CRITICAL: If starting playback, sync compositor timecode FIRST
              if (!engineState.isPlaying) {
                compositor.compose_effects(state.effects, state.timecode);
                compositor.seek(state.timecode, false);
              }
              
              engine.togglePlayback();
              toggle();
            }}
            getTotalDuration={getTotalDuration}
            handleSkipBackward={handleSkipBackward}
            handleSkipForward={handleSkipForward}
            isPlaying={engineState.isPlaying}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col min-h-0 min-w-0 bg-panel rounded-sm relative">
      <div
        ref={containerRef}
        className="flex-1 flex flex-col items-center justify-center min-h-0 min-w-0"
      >
        <div className="flex-1" />
        {shouldRenderPreview ? (
          <div
            className="relative overflow-hidden border"
            style={{
              width: previewDimensions.width,
              height: previewDimensions.height,
              background: activeProject?.backgroundColor || "#000000",
            }}
          >
            <div
              ref={pixiContainerRef}
              className="absolute inset-0"
              style={{ pointerEvents: 'none' }}
            />
            <LayoutGuideOverlay />
          </div>
        ) : null}
        <div className="flex-1" />
        <PreviewToolbar
          hasAnyElements={hasAnyElements}
          onToggleExpanded={toggleExpanded}
          currentTime={engineState.timecode / 1000} // Convert ms to seconds for display
          setCurrentTime={(timeSec) => {
            // Convert seconds to milliseconds and update engine directly
            const timeMs = timeSec * 1000;
            engine.seek(timeMs);
            // Also update Zustand for timeline display
            setCurrentTime(timeSec);
          }}
          toggle={() => {
            const compositor = engine.controllers.compositor;
            const state = engine.getState();
            
            // CRITICAL: If starting playback, sync compositor timecode FIRST
            // This must happen synchronously before compositor's next frame
            if (!engineState.isPlaying) {
              compositor.compose_effects(state.effects, state.timecode);
              compositor.seek(state.timecode, false);
            }
            
            // Toggle engine playback directly
            engine.togglePlayback();
            // Also toggle Zustand for UI consistency
            toggle();
          }}
          getTotalDuration={getTotalDuration}
          handleSkipBackward={handleSkipBackward}
          handleSkipForward={handleSkipForward}
          isPlaying={engineState.isPlaying}
        />
      </div>
    </div>
  );
}

interface PreviewToolbarProps {
  hasAnyElements: boolean;
  onToggleExpanded: () => void;
  currentTime: number;
  setCurrentTime: (time: number) => void;
  toggle: () => void;
  getTotalDuration: () => number;
  handleSkipBackward: () => void;
  handleSkipForward: () => void;
  isPlaying: boolean;
}

function PreviewToolbar({
  hasAnyElements,
  onToggleExpanded,
  currentTime,
  setCurrentTime,
  toggle,
  getTotalDuration,
  handleSkipBackward,
  handleSkipForward,
  isPlaying,
}: PreviewToolbarProps) {
  const duration = getTotalDuration();

  return (
    <div className="flex items-center justify-between gap-2 w-full px-3 py-2" data-toolbar>
      <div className="flex items-center gap-1">
        <Button
          variant="text"
          size="icon"
          onClick={handleSkipBackward}
          disabled={!hasAnyElements}
          aria-label="Skip backward 1 second"
        >
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button
          variant="text"
          size="icon"
          onClick={toggle}
          disabled={!hasAnyElements}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="text"
          size="icon"
          onClick={handleSkipForward}
          disabled={!hasAnyElements}
          aria-label="Skip forward 1 second"
        >
          <SkipForward className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 flex justify-center">
        <EditableTimecode
          time={currentTime}
          duration={duration}
          onTimeChange={setCurrentTime}
        />
      </div>

      <Button
        variant="text"
        size="icon"
        onClick={onToggleExpanded}
        aria-label="Toggle fullscreen"
      >
        <Expand className="h-4 w-4" />
      </Button>
    </div>
  );
}

