import React, { useEffect, useState, useRef, useMemo } from "react";
import { MediaFile } from "@/types/media";
import { thumbnailGenerator } from "@/lib/services/thumbnail-generator";

interface FilmstripProps {
  mediaFile: MediaFile;
  duration: number; // Duration of the clip on timeline (could be trimmed)
  visibleDuration: number; // Total duration of the media file
  width: number;
  height: number;
  trimStart?: number; // Offset into the file
}

export function Filmstrip({
  mediaFile,
  duration,
  visibleDuration,
  width,
  height,
  trimStart = 0,
}: FilmstripProps) {
  // Constants
  const THUMBNAIL_WIDTH = 80; // Standard thumbnail width
  const THUMBNAIL_HEIGHT = 45;

  const [thumbnails, setThumbnails] = useState<Map<number, string>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate how many thumbnails we need
  const count = Math.ceil(width / THUMBNAIL_WIDTH);
  
  // Create an array of times we need thumbnails for
  const requiredTimes = useMemo(() => {
    const times: number[] = [];
    const timePerPixel = visibleDuration / width; // This logic might be wrong. 
    // We want thumbnails evenly spaced across the VISIBLE width.
    // Width is the pixel width of the element.
    // Duration is the time length of the element.
    
    // Example: Width 500px, Duration 10s.
    // We can fit 500/80 = ~7 thumbnails.
    // Each thumbnail covers 10s / 7 = ~1.4s.
    
    const timePerThumbnail = duration / count;
    
    for (let i = 0; i < count; i++) {
      // Calculate time relative to the start of the source file
      const clipTime = i * timePerThumbnail;
      const sourceTime = trimStart + clipTime;
      times.push(sourceTime);
    }
    return times;
  }, [width, duration, count, trimStart]);

  useEffect(() => {
    let active = true;

    // Load thumbnails
    const loadThumbnails = async () => {
      // Prioritize: load all placeholders first (if we had them), then real ones
      // Since we don't have placeholders other than the main thumbnail, we'll just queue them.
      
      // Use the global generator
      if (!mediaFile.file) return;

      for (let i = 0; i < requiredTimes.length; i++) {
        if (!active) break;
        
        const time = requiredTimes[i];
        
        // Skip if we already have it (state check)
        // Note: The generator has its own cache, but updating state avoids re-render cycles
        
        try {
          // Fire request
          thumbnailGenerator.generate(
            mediaFile.file,
            time,
            THUMBNAIL_WIDTH,
            THUMBNAIL_HEIGHT
          ).then((url) => {
            if (active) {
              setThumbnails((prev) => {
                const newMap = new Map(prev);
                newMap.set(time, url);
                return newMap;
              });
            }
          });
          
          // Small yield to allow UI updates
          await new Promise(r => setTimeout(r, 10)); 
        } catch (e) {
          console.warn("Failed to generate filmstrip frame", e);
        }
      }
    };

    loadThumbnails();

    return () => {
      active = false;
    };
  }, [mediaFile, requiredTimes]);

  return (
    <div 
      ref={containerRef}
      className="absolute inset-0 flex overflow-hidden pointer-events-none select-none"
      style={{
        width: `${width}px`,
        height: `${height}px`,
      }}
    >
      {requiredTimes.map((time, index) => {
        const url = thumbnails.get(time) || mediaFile.thumbnailUrl;
        
        return (
          <div
            key={`${time}-${index}`}
            className="flex-shrink-0 bg-cover bg-center border-r border-white/10 opacity-100 transition-opacity duration-200"
            style={{
              width: `${THUMBNAIL_WIDTH}px`,
              height: "100%",
              backgroundImage: url ? `url(${url})` : undefined,
              backgroundColor: "#1a1a1a",
            }}
          />
        );
      })}
    </div>
  );
}

