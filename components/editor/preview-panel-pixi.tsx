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
import { useEngine, useEnginePlayback } from "@/components/providers/engine-provider";
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
import { tracksToEffects } from "@/lib/engine/adapters";
import { TextElement, TimelineElement, TimelineTrack } from "@/types/timeline";

export function PreviewPanel() {
  const { tracks, getTotalDuration, updateTextElement } = useTimelineStore();
  const { mediaFiles } = useMediaStore();
  const { activeProject } = useProjectStore();
  const { currentScene } = useSceneStore();
  const engine = useEngine();
  
  // Use engine playback, but keep Zustand as source of truth for UI
  const { currentTime: zustandCurrentTime, isPlaying: zustandIsPlaying, toggle, setCurrentTime } = usePlaybackStore();
  
  const pixiContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [previewDimensions, setPreviewDimensions] = useState({ width: 0, height: 0 });
  const [isExpanded, setIsExpanded] = useState(false);
  const canvasSize = activeProject?.canvasSize || DEFAULT_CANVAS_SIZE;
  const isMounted = useRef(false);
  const syncLock = useRef(false);

  // Sync Zustand state to engine (one-way: Zustand -> Engine)
  useEffect(() => {
    if (syncLock.current) return;
    
    // Sync playback state
    if (zustandIsPlaying !== engine.isPlaying()) {
      syncLock.current = true;
      if (zustandIsPlaying) {
        engine.play();
      } else {
        engine.pause();
      }
      syncLock.current = false;
    }
  }, [zustandIsPlaying, engine]);

  useEffect(() => {
    if (syncLock.current) return;
    
    // Sync current time
    const engineTime = engine.getCurrentTime();
    if (Math.abs(zustandCurrentTime - engineTime) > 16) { // > 16ms difference
      syncLock.current = true;
      engine.seek(zustandCurrentTime);
      syncLock.current = false;
    }
  }, [zustandCurrentTime, engine]);

  // Sync timeline effects to engine
  useEffect(() => {
    try {
      const mediaFilesMap = new Map(mediaFiles.map(m => [m.id, m]));
      const effects = tracksToEffects(tracks, mediaFilesMap);
      
      // Update engine state with new effects
      const currentEffects = engine.getEffects();
      
      // Only update if effects have changed
      const effectsChanged = JSON.stringify(effects) !== JSON.stringify(currentEffects);
      
      if (effectsChanged) {
        // Clear and re-add effects
        engine.actions.historical.remove_all_effects({ omit: true });
        
        for (const effect of effects) {
          if (effect.kind === 'video') {
            engine.actions.historical.add_video_effect(effect, { omit: true });
          } else if (effect.kind === 'audio') {
            engine.actions.historical.add_audio_effect(effect, { omit: true });
          } else if (effect.kind === 'image') {
            engine.actions.historical.add_image_effect(effect, { omit: true });
          } else if (effect.kind === 'text') {
            engine.actions.historical.add_text_effect(effect, { omit: true });
          }
        }
      }
    } catch (error) {
      console.error('Error syncing effects to engine:', error);
    }
  }, [tracks, mediaFiles, engine]);

  // Mount PIXI canvas
  useEffect(() => {
    const container = pixiContainerRef.current;
    if (!container || isMounted.current) return;

    try {
      const compositor = engine.controllers.compositor;
      const pixiCanvas = compositor.app.view as HTMLCanvasElement;
      
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

      return () => {
        if (container.contains(pixiCanvas)) {
          container.removeChild(pixiCanvas);
        }
        isMounted.current = false;
      };
    } catch (error) {
      console.error('Failed to mount PIXI canvas:', error);
    }
  }, [engine]);

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

      // Update compositor canvas size
      try {
        const compositor = engine.controllers.compositor;
        compositor.app.renderer.resize(canvasSize.width, canvasSize.height);
      } catch (error) {
        console.error('Error resizing compositor:', error);
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
    const newTime = Math.max(0, zustandCurrentTime - 1000);
    setCurrentTime(newTime);
  };

  const handleSkipForward = () => {
    const duration = getTotalDuration();
    const newTime = Math.min(duration, zustandCurrentTime + 1000);
    setCurrentTime(newTime);
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
            currentTime={zustandCurrentTime}
            setCurrentTime={setCurrentTime}
            toggle={toggle}
            getTotalDuration={getTotalDuration}
            handleSkipBackward={handleSkipBackward}
            handleSkipForward={handleSkipForward}
            isPlaying={zustandIsPlaying}
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
          currentTime={zustandCurrentTime}
          setCurrentTime={setCurrentTime}
          toggle={toggle}
          getTotalDuration={getTotalDuration}
          handleSkipBackward={handleSkipBackward}
          handleSkipForward={handleSkipForward}
          isPlaying={zustandIsPlaying}
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
          variant="ghost"
          size="icon-sm"
          onClick={handleSkipBackward}
          disabled={!hasAnyElements}
          aria-label="Skip backward 1 second"
        >
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
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
          variant="ghost"
          size="icon-sm"
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
          onChange={setCurrentTime}
        />
      </div>

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onToggleExpanded}
        aria-label="Toggle fullscreen"
      >
        <Expand className="h-4 w-4" />
      </Button>
    </div>
  );
}

