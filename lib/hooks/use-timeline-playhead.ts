import { snapTimeToFrame } from "@/lib/timeline-constants";
import { DEFAULT_FPS, useProjectStore } from "@/lib/stores/project-store";
import { usePlaybackStore } from "@/lib/stores/playback-store";
import { useState, useEffect, useCallback, useRef } from "react";
import { useEdgeAutoScroll } from "@/lib/hooks/use-edge-auto-scroll";

interface UseTimelinePlayheadProps {
  currentTime: number;
  duration: number;
  zoomLevel: number;
  seek: (time: number) => void;
  rulerRef: React.RefObject<HTMLDivElement | null>;
  rulerScrollRef: React.RefObject<HTMLDivElement | null>;
  tracksScrollRef: React.RefObject<HTMLDivElement | null>;
  trackLabelsRef?: React.RefObject<HTMLDivElement | null>;
  playheadRef?: React.RefObject<HTMLDivElement | null>;
  enableAutoScroll?: boolean;
}

export function useTimelinePlayhead({
  currentTime,
  duration,
  zoomLevel,
  seek,
  rulerRef,
  rulerScrollRef,
  tracksScrollRef,
  trackLabelsRef,
  playheadRef,
  enableAutoScroll = true,
}: UseTimelinePlayheadProps) {
  // Playhead scrubbing state
  const [isScrubbing, setIsScrubbing] = useState(false);
  
  // Refs for throttling and direct DOM updates
  const rafIdRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(currentTime);

  // Ruler drag detection state
  const [isDraggingRuler, setIsDraggingRuler] = useState(false);
  const [hasDraggedRuler, setHasDraggedRuler] = useState(false);
  const lastMouseXRef = useRef<number>(0);

  // Helper to update playhead DOM directly for 60fps performance
  const updatePlayheadDOM = useCallback((time: number) => {
    if (!playheadRef?.current || !tracksScrollRef.current) return;
    
    // TIMELINE_CONSTANTS.PIXELS_PER_SECOND = 50
    const timelinePosition = time * 50 * zoomLevel;
    
    // Fallback to 112px (w-28) if ref is missing (prevents jump on first interaction)
    const trackLabelsWidth = trackLabelsRef?.current?.offsetWidth || 112;
    const scrollLeft = tracksScrollRef.current.scrollLeft;
    
    // Logic duplicated from TimelinePlayhead to ensure sync
    const rawLeftPosition = trackLabelsWidth + timelinePosition - scrollLeft;
    const viewportWidth = tracksScrollRef.current.clientWidth;
    
    // Constrain playhead
    const timelineContentWidth = duration * 50 * zoomLevel;
    const leftBoundary = trackLabelsWidth;
    const rightBoundary = Math.min(
      trackLabelsWidth + timelineContentWidth - scrollLeft,
      trackLabelsWidth + viewportWidth
    );
    
    const leftPosition = Math.max(
      leftBoundary,
      Math.min(rightBoundary, rawLeftPosition)
    );
    
    playheadRef.current.style.left = `${leftPosition}px`;
  }, [zoomLevel, duration, trackLabelsRef, tracksScrollRef, playheadRef]);

  const playheadPosition = isScrubbing ? lastTimeRef.current : currentTime;

  // --- Playhead Scrubbing Handlers ---
  const handlePlayheadMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation(); // Prevent ruler drag from triggering
      setIsScrubbing(true);
      handleScrub(e);
    },
    [duration, zoomLevel]
  );

  // Ruler mouse down handler
  const handleRulerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only handle left mouse button
      if (e.button !== 0) return;

      // Don't interfere if clicking on the playhead itself
      if (playheadRef?.current?.contains(e.target as Node)) return;

      e.preventDefault();
      setIsDraggingRuler(true);
      setHasDraggedRuler(false);

      // Start scrubbing immediately
      setIsScrubbing(true);
      handleScrub(e);
    },
    [duration, zoomLevel]
  );

  const handleScrub = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      const ruler = rulerRef.current;
      if (!ruler) return;
      const rect = ruler.getBoundingClientRect();
      const rawX = e.clientX - rect.left;

      // Get the timeline content width based on duration and zoom
      const timelineContentWidth = duration * 50 * zoomLevel; // TIMELINE_CONSTANTS.PIXELS_PER_SECOND = 50

      // Constrain x to be within the timeline content bounds
      const x = Math.max(0, Math.min(timelineContentWidth, rawX));

      const rawTime = Math.max(0, Math.min(duration, x / (50 * zoomLevel)));
      // Use frame snapping for playhead scrubbing
      const projectStore = useProjectStore.getState();
      const projectFps = projectStore.activeProject?.fps || DEFAULT_FPS;
      const time = snapTimeToFrame(rawTime, projectFps);

      // Debug logging
      if (rawX < 0 || x !== rawX) {
        // Reduced logging frequency or removed for production
      }

      // 1. Direct DOM update for instant feedback (no React render)
      lastTimeRef.current = time;
      updatePlayheadDOM(time);

      // 2. Throttle seek calls to avoid engine overload
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          // If seeking is expensive, check if we really need to seek
          // Only seek if time has changed significantly enough (e.g. > 1/60s)
          // For now, simple RAF throttling is usually sufficient.
          seek(time);
          rafIdRef.current = null;
        });
      }

      // Store mouse position for auto-scrolling
      lastMouseXRef.current = e.clientX;
    },
    [duration, zoomLevel, seek, rulerRef, updatePlayheadDOM]
  );

  useEdgeAutoScroll({
    isActive: isScrubbing,
    getMouseClientX: () => lastMouseXRef.current,
    rulerScrollRef,
    tracksScrollRef,
    contentWidth: duration * 50 * zoomLevel,
  });

  // Mouse move/up event handlers
  useEffect(() => {
    if (!isScrubbing) return;

    const onMouseMove = (e: MouseEvent) => {
      handleScrub(e);
      // Mark that we've dragged if ruler drag is active
      if (isDraggingRuler) {
        setHasDraggedRuler(true);
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      setIsScrubbing(false);
      // Ensure final seek is accurate
      if (lastTimeRef.current !== null) {
         seek(lastTimeRef.current);
      }
      
      // Cancel any pending RAF
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      // Handle ruler click vs drag
      if (isDraggingRuler) {
        setIsDraggingRuler(false);
        // If we didn't drag, treat it as a click-to-seek
        if (!hasDraggedRuler) {
          handleScrub(e);
        }
        setHasDraggedRuler(false);
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    // Edge auto-scroll is handled by useEdgeAutoScroll

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      // nothing to cleanup for edge auto scroll
    };
  }, [
    isScrubbing,
    seek,
    handleScrub,
    isDraggingRuler,
    hasDraggedRuler,
    // edge auto scroll hook is independent
  ]);

  // --- Playhead auto-scroll effect (only during playback) ---
  useEffect(() => {
    if (!enableAutoScroll) return;

    const { isPlaying } = usePlaybackStore.getState();

    // Only auto-scroll during playback, not during manual interactions
    if (!isPlaying || isScrubbing) return;

    const rulerViewport = rulerScrollRef.current;
    const tracksViewport = tracksScrollRef.current;
    if (!rulerViewport || !tracksViewport) return;

    const playheadPx = playheadPosition * 50 * zoomLevel; // TIMELINE_CONSTANTS.PIXELS_PER_SECOND = 50
    const viewportWidth = rulerViewport.clientWidth;
    const scrollMin = 0;
    const scrollMax = rulerViewport.scrollWidth - viewportWidth;

    // Only auto-scroll if playhead is completely out of view (no buffer)
    const needsScroll =
      playheadPx < rulerViewport.scrollLeft ||
      playheadPx > rulerViewport.scrollLeft + viewportWidth;

    if (needsScroll) {
      // Center the playhead in the viewport
      const desiredScroll = Math.max(
        scrollMin,
        Math.min(scrollMax, playheadPx - viewportWidth / 2)
      );
      rulerViewport.scrollLeft = tracksViewport.scrollLeft = desiredScroll;
    }
  }, [
    playheadPosition,
    duration,
    zoomLevel,
    rulerScrollRef,
    tracksScrollRef,
    isScrubbing,
  ]);

  return {
    playheadPosition,
    handlePlayheadMouseDown,
    handleRulerMouseDown,
    isDraggingRuler,
  };
}
