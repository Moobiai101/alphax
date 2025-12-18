"use client";

import { useRef, useState, useEffect } from "react";
import { TimelineTrack } from "@/types/timeline";
import { TIMELINE_CONSTANTS } from "@/lib/timeline-constants";
import { useTimelinePlayhead } from "@/lib/hooks/use-timeline-playhead";
import { useEngineState } from "@/components/providers/engine-provider";

interface TimelinePlayheadProps {
  currentTime?: number;
  duration: number;
  zoomLevel: number;
  tracks: TimelineTrack[];
  seek: (time: number) => void;
  rulerRef: React.RefObject<HTMLDivElement | null>;
  rulerScrollRef: React.RefObject<HTMLDivElement | null>;
  tracksScrollRef: React.RefObject<HTMLDivElement | null>;
  trackLabelsRef?: React.RefObject<HTMLDivElement | null>;
  timelineRef: React.RefObject<HTMLDivElement | null>;
  playheadRef?: React.RefObject<HTMLDivElement | null>;
  isSnappingToPlayhead?: boolean;
}

export function TimelinePlayhead({
  currentTime: propCurrentTime,
  duration,
  zoomLevel,
  tracks,
  seek,
  rulerRef,
  rulerScrollRef,
  tracksScrollRef,
  trackLabelsRef,
  timelineRef,
  playheadRef: externalPlayheadRef,
  isSnappingToPlayhead = false,
}: TimelinePlayheadProps) {
  const internalPlayheadRef = useRef<HTMLDivElement>(null);
  const playheadRef = externalPlayheadRef || internalPlayheadRef;
  const [scrollLeft, setScrollLeft] = useState(0); // Kept locally only for initial mount if needed, but we rely on ref mostly

  // Subscribe to engine time directly to avoid parent re-renders
  const engineTimecode = useEngineState((state) => state.timecode);
  const engineCurrentTime = engineTimecode / 1000;
  
  // Use prop if provided (legacy), otherwise use engine time
  const currentTime = propCurrentTime ?? engineCurrentTime;

  const { playheadPosition, handlePlayheadMouseDown } = useTimelinePlayhead({
    currentTime,
    duration,
    zoomLevel,
    seek,
    rulerRef,
    rulerScrollRef,
    tracksScrollRef,
    trackLabelsRef,
    playheadRef,
    enableAutoScroll: true,
  });

  // Track scroll position to lock playhead to frame
  // OPTIMIZED: Use direct DOM manipulation on scroll instead of state to avoid re-renders
  useEffect(() => {
    const tracksViewport = tracksScrollRef.current;
    if (!tracksViewport || !playheadRef.current) return;

    const handleScroll = () => {
      // Direct DOM update on scroll
      const currentScrollLeft = tracksViewport.scrollLeft;
      
      // Re-calculate position
      const trackLabelsWidth = trackLabelsRef?.current?.offsetWidth || 0;
      const timelinePosition = playheadPosition * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel;
      const rawLeftPosition = trackLabelsWidth + timelinePosition - currentScrollLeft;
      
      // Boundaries
      const viewportWidth = tracksViewport.clientWidth;
      const timelineContentWidth = duration * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel;
      const leftBoundary = trackLabelsWidth;
      const rightBoundary = Math.min(
        trackLabelsWidth + timelineContentWidth - currentScrollLeft,
        trackLabelsWidth + viewportWidth
      );
      
      const leftPosition = Math.max(
        leftBoundary,
        Math.min(rightBoundary, rawLeftPosition)
      );
      
      playheadRef.current!.style.left = `${leftPosition}px`;
      
      // Update state only if we need to sync for some reason, but we try to avoid it
      // setScrollLeft(currentScrollLeft); 
    };
    
    // Initial sync
    handleScroll();

    tracksViewport.addEventListener("scroll", handleScroll);
    return () => tracksViewport.removeEventListener("scroll", handleScroll);
  }, [tracksScrollRef, playheadRef, trackLabelsRef, playheadPosition, zoomLevel, duration]);

  // Use timeline container height minus a few pixels for breathing room
  const timelineContainerHeight = timelineRef.current?.offsetHeight || 400;
  const totalHeight = timelineContainerHeight - 4;
  
  // Initial render calculation (fallback/server-side)
  // We use 0 for scrollLeft initially, but the useEffect will correct it immediately
  const initialScrollLeft = tracksScrollRef.current?.scrollLeft || 0;
  
  // Get dynamic track labels width
  // Fallback to 112px (w-28) if ref is not yet available but tracks exist
  // This prevents playhead jumping on initial render or when tracks are added
  const trackLabelsWidth =
    tracks.length > 0 
      ? (trackLabelsRef?.current?.offsetWidth || 112)
      : 0;

  // Calculate position locked to timeline content
  const timelinePosition =
    playheadPosition * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel;
  const rawLeftPosition = trackLabelsWidth + timelinePosition - initialScrollLeft;

  // Get the timeline content width and viewport width for right boundary
  const timelineContentWidth =
    duration * TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel;
  const viewportWidth = tracksScrollRef.current?.clientWidth || 1000;

  // Constrain playhead to never appear outside the timeline area
  const leftBoundary = trackLabelsWidth;
  const rightBoundary = Math.min(
    trackLabelsWidth + timelineContentWidth - initialScrollLeft, // Don't go beyond timeline content
    trackLabelsWidth + viewportWidth // Don't go beyond viewport
  );

  const leftPosition = Math.max(
    leftBoundary,
    Math.min(rightBoundary, rawLeftPosition)
  );

  return (
    <div
      ref={playheadRef}
      className="absolute pointer-events-auto z-40"
      style={{
        left: `${leftPosition}px`,
        top: 0,
        height: `${totalHeight}px`,
        width: "2px", // Slightly wider for better click target
      }}
      onMouseDown={handlePlayheadMouseDown}
    >
      {/* The playhead line spanning full height */}
      <div
        className={`absolute left-0 w-0.5 cursor-col-resize h-full ${isSnappingToPlayhead ? "bg-foreground" : "bg-foreground"}`}
      />

      {/* Playhead dot indicator at the top (in ruler area) */}
      <div
        className={`absolute top-1 left-1/2 transform -translate-x-1/2 w-3 h-3 rounded-full border-2 shadow-xs ${isSnappingToPlayhead ? "bg-foreground border-foreground" : "bg-foreground border-foreground/50"}`}
      />
    </div>
  );
}

// Also export a hook for getting ruler handlers
export function useTimelinePlayheadRuler({
  currentTime,
  duration,
  zoomLevel,
  seek,
  rulerRef,
  rulerScrollRef,
  tracksScrollRef,
  playheadRef,
}: {
  currentTime: number;
  duration: number;
  zoomLevel: number;
  seek: (time: number) => void;
  rulerRef: React.RefObject<HTMLDivElement | null>;
  rulerScrollRef: React.RefObject<HTMLDivElement | null>;
  tracksScrollRef: React.RefObject<HTMLDivElement | null>;
  playheadRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const { handleRulerMouseDown, isDraggingRuler } = useTimelinePlayhead({
    currentTime,
    duration,
    zoomLevel,
    seek,
    rulerRef,
    rulerScrollRef,
    tracksScrollRef,
    playheadRef,
  });

  return { handleRulerMouseDown, isDraggingRuler };
}

export { TimelinePlayhead as default };
