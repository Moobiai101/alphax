import { create } from "zustand";
import type { PlaybackState, PlaybackControls } from "@/types/playback";
import { useTimelineStore } from "@/lib/stores/timeline-store";
import { DEFAULT_FPS, useProjectStore } from "./project-store";

interface PlaybackStore extends PlaybackState, PlaybackControls {
  setDuration: (duration: number) => void;
  setCurrentTime: (time: number) => void;
  // Internal method for engine to update time without triggering seek events
  _engineUpdateTime: (time: number) => void;
  // Flag to indicate if engine is controlling time (during playback)
  _engineControlsTime: boolean;
}

/**
 * ARCHITECTURE NOTE: Engine-Driven Playback
 * 
 * This store follows industry-standard video editor architecture where the rendering
 * engine is the master clock during playback. The flow is:
 * 
 * 1. User interactions (play/pause/seek) → Zustand Store → Engine
 * 2. During playback: Engine drives time → Zustand Store → UI updates (timeline playhead, preview)
 * 3. Engine updates are pushed via subscription to _engineUpdateTime()
 * 
 * Time Units:
 * - Zustand Store: SECONDS (matches HTML5 video/audio elements)
 * - Engine: MILLISECONDS (Omniclip internal format)
 * - Conversion happens at the engine boundary in PreviewPanel
 * 
 * The legacy timer code below is DEPRECATED and no longer used.
 */

let playbackTimer: number | null = null;

const startTimer = (store: () => PlaybackStore) => {
  // DEPRECATED: This timer-based playback is no longer used
  // The engine now drives time updates via _engineUpdateTime
  if (playbackTimer) cancelAnimationFrame(playbackTimer);
  playbackTimer = null;
};

const stopTimer = () => {
  if (playbackTimer) {
    cancelAnimationFrame(playbackTimer);
    playbackTimer = null;
  }
};

export const usePlaybackStore = create<PlaybackStore>((set, get) => ({
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false,
  previousVolume: 1,
  speed: 1.0,
  _engineControlsTime: false,

  play: () => {
    const state = get();

    const actualContentDuration = useTimelineStore
      .getState()
      .getTotalDuration();
    const effectiveDuration =
      actualContentDuration > 0 ? actualContentDuration : state.duration;

    if (effectiveDuration > 0) {
      const fps = useProjectStore.getState().activeProject?.fps ?? DEFAULT_FPS;
      const frameOffset = 1 / fps;
      const endThreshold = Math.max(0, effectiveDuration - frameOffset);

      if (state.currentTime >= endThreshold) {
        get().seek(0);
      }
    }

    // Set engine controls time flag - engine will now drive time updates
    set({ isPlaying: true, _engineControlsTime: true });
    stopTimer(); // Ensure our old timer is stopped
  },

  pause: () => {
    set({ isPlaying: false, _engineControlsTime: false });
    stopTimer();
  },

  toggle: () => {
    const { isPlaying } = get();
    if (isPlaying) {
      get().pause();
    } else {
      get().play();
    }
  },

  seek: (time: number) => {
    const { duration } = get();
    const clampedTime = Math.max(0, Math.min(duration, time));
    set({ currentTime: clampedTime });

    // Dispatch seek event for video/audio elements and engine
    const event = new CustomEvent("playback-seek", {
      detail: { time: clampedTime },
    });
    window.dispatchEvent(event);
  },

  // Internal method for engine to update time during playback
  // This bypasses the seek event dispatch to prevent circular updates
  _engineUpdateTime: (time: number) => {
    const state = get();
    // Only accept engine time updates during playback
    if (!state._engineControlsTime) return;
    
    set({ currentTime: time });
    
    // Dispatch update event for video/audio elements (not seek, which would trigger engine)
    window.dispatchEvent(
      new CustomEvent("playback-update", { detail: { time } })
    );

    // Check if we've reached the end
    const actualContentDuration = useTimelineStore
      .getState()
      .getTotalDuration();
    const effectiveDuration =
      actualContentDuration > 0 ? actualContentDuration : state.duration;
    
    if (time >= effectiveDuration) {
      // Pause at the end
      state.pause();
    }
  },

  setVolume: (volume: number) =>
    set((state) => ({
      volume: Math.max(0, Math.min(1, volume)),
      muted: volume === 0,
      previousVolume: volume > 0 ? volume : state.previousVolume,
    })),

  setSpeed: (speed: number) => {
    const newSpeed = Math.max(0.1, Math.min(2.0, speed));
    set({ speed: newSpeed });

    const event = new CustomEvent("playback-speed", {
      detail: { speed: newSpeed },
    });
    window.dispatchEvent(event);
  },

  setDuration: (duration: number) => set({ duration }),
  setCurrentTime: (time: number) => set({ currentTime: time }),

  mute: () => {
    const { volume, previousVolume } = get();
    set({
      muted: true,
      previousVolume: volume > 0 ? volume : previousVolume,
      volume: 0,
    });
  },

  unmute: () => {
    const { previousVolume } = get();
    set({ muted: false, volume: previousVolume ?? 1 });
  },

  toggleMute: () => {
    const { muted } = get();
    if (muted) {
      get().unmute();
    } else {
      get().mute();
    }
  },
}));
