/**
 * Engine Context Wrapper
 * 
 * This module creates a headless wrapper around the Omniclip engine controllers,
 * providing a clean API for React integration. It instantiates all controllers,
 * manages state subscriptions, and handles lifecycle events.
 * 
 * Architecture:
 * - Singleton pattern with proper cleanup
 * - Client-side only (requires WebCodecs, IndexedDB, PIXI)
 * - Event-driven state management using @benev/slate
 * - Isolated from React state management
 */

console.log("[ENGINE_CONTEXT] Module loading started");

import { AppCore, ZipAction, watch, Nexus } from "@benev/slate";
console.log("[ENGINE_CONTEXT] @benev/slate imported");
import type { State, HistoricalState, NonHistoricalState, AnyEffect, Settings } from "./state/types";
console.log("[ENGINE_CONTEXT] state/types imported");
import { historical_state, non_historical_state } from "./state/state";
console.log("[ENGINE_CONTEXT] state/state imported");
import { historical, non_historical, setBroadcaster } from "./state/actions";
console.log("[ENGINE_CONTEXT] state/actions imported");
import { Media } from "./controllers/controllers/media/controller";
console.log("[ENGINE_CONTEXT] Media imported");
import { Timeline } from "./controllers/controllers/timeline/controller";
console.log("[ENGINE_CONTEXT] Timeline imported");
import { Compositor } from "./controllers/controllers/compositor/controller";
console.log("[ENGINE_CONTEXT] Compositor imported");
import { VideoExport } from "./controllers/controllers/video-export/controller";
console.log("[ENGINE_CONTEXT] VideoExport imported");
import { Project } from "./controllers/controllers/project/controller";
console.log("[ENGINE_CONTEXT] Project imported");
import { store } from "./controllers/controllers/store/store";
console.log("[ENGINE_CONTEXT] store imported");
// import { Collaboration } from "./controllers/controllers/collaboration/controller";
// console.log("[ENGINE_CONTEXT] Collaboration imported");
import { registerEngineInternals } from "./omnislate";
console.log("[ENGINE_CONTEXT] omnislate imported");
// import { collaboration } from "./collaboration-instance";
// console.log("[ENGINE_CONTEXT] collaboration-instance imported");
console.log("[ENGINE_CONTEXT] All imports complete");

/**
 * Engine configuration options
 */
export interface EngineConfig {
  projectId: string;
  projectName?: string;
  settings?: Partial<Settings>;
  canvas?: {
    width?: number;
    height?: number;
    backgroundColor?: string;
  };
}

/**
 * Engine state subscription callback
 */
export type StateSubscriber = (state: State) => void;

/**
 * Engine actions interface - combines historical and non-historical actions
 * These are the actualized (callable) actions, not the blueprints
 */
export interface EngineActions {
  historical: ReturnType<typeof ZipAction.actualize<HistoricalState, typeof historical>>;
  non_historical: ReturnType<typeof ZipAction.actualize<NonHistoricalState, typeof non_historical>>;
}

/**
 * Main Engine API exposed to React
 */
export interface EngineAPI {
  // Controllers
  controllers: {
    media: Media;
    timeline: Timeline;
    compositor: Compositor;
    videoExport: VideoExport;
    project: Project;
  };

  // Actions
  actions: EngineActions;

  // State management
  getState: () => State;
  subscribe: (callback: StateSubscriber) => () => void;

  // Effect helpers
  getEffects: () => AnyEffect[];
  getSelectedEffect: () => AnyEffect | null;
  setSelectedEffect: (effect: AnyEffect | null) => void;

  // Playback control
  play: () => void;
  pause: () => void;
  togglePlayback: () => void;
  seek: (timecode: number) => void;
  getCurrentTime: () => number;
  isPlaying: () => boolean;

  // Timeline helpers
  getDuration: () => number;
  getZoom: () => number;
  setZoom: (zoom: number) => void;

  // Export
  startExport: (bitrate?: number) => void;
  stopExport: () => void;
  saveExportedFile: () => Promise<void>;
  getExportProgress: () => number;
  isExporting: () => boolean;

  // Lifecycle
  destroy: () => void;
}

/**
 * Global AppCore instance for historical state management
 */
let coreInstance: AppCore<HistoricalState, typeof historical> | null = null;

/**
 * Global non-historical state tree
 */
let nonHistoricalState: ReturnType<typeof watch.stateTree<NonHistoricalState>> | null = null;

/**
 * Combined actions
 */
let actionsBundle: any = null;

/**
 * Create and initialize the Omniclip engine
 * 
 * @param config - Engine configuration
 * @returns Engine API interface
 */
export function createEngine(config: EngineConfig): EngineAPI {
  // Validate browser support
  if (typeof window === 'undefined') {
    throw new Error('Engine can only be initialized on the client side');
  }

  if (!('VideoEncoder' in window) || !('VideoDecoder' in window)) {
    throw new Error('WebCodecs is not supported in this browser');
  }

  if (!('indexedDB' in window)) {
    throw new Error('IndexedDB is not supported in this browser');
  }

  // Initialize state management (following Omniclip pattern)
  const initialHistoricalState: HistoricalState = {
    ...historical_state,
    projectId: config.projectId,
    projectName: config.projectName || `Project ${config.projectId.slice(0, 6)}`,
  };

  // Create AppCore for historical state (with undo/redo)
  coreInstance = new AppCore({
    initial_state: initialHistoricalState,
    history_limit: 64,
    actions_blueprint: ZipAction.blueprint<HistoricalState>()(historical)
  });

  // Create non-historical state tree
  nonHistoricalState = watch.stateTree<NonHistoricalState>({
    ...non_historical_state,
    settings: {
      ...non_historical_state.settings,
      ...config.settings,
    },
  });

  // Create non-historical actions
  const nonHistoricalActions = ZipAction.actualize(nonHistoricalState, non_historical);

  // Combine actions
  actionsBundle = {
    ...nonHistoricalActions,
    ...coreInstance.actions,
  };

  // Set broadcaster for actions
  // setBroadcaster(collaboration);
  setBroadcaster(null);

  // Get combined state
  const getState = (): State => {
    if (!nonHistoricalState || !coreInstance) {
      console.warn("[Engine] getState called but engine is not initialized or has been destroyed");
      return {
        ...historical_state,
        ...non_historical_state,
        // Ensure critical arrays are present to prevent iteration errors
        effects: [],
        tracks: [],
      } as State;
    }
    return {
      ...nonHistoricalState.state,
      ...coreInstance.state,
    };
  };

  // Initialize controllers in correct dependency order
  const media = new Media();
  const compositor = new Compositor(actionsBundle);
  const timeline = new Timeline(actionsBundle, media, compositor);
  const videoExport = new VideoExport(actionsBundle, compositor, media);
  const project = new Project();

  // Mark compositor as ready for rendering
  // In omniclip, this is done via recreate() after loading from localStorage
  // Since we start fresh, we mark it ready immediately
  compositor.markReady();

  // Configure compositor canvas if specified
  if (config.canvas) {
    if (config.canvas.width && config.canvas.height) {
      compositor.app.renderer.resize(config.canvas.width, config.canvas.height);
    }
    if (config.canvas.backgroundColor) {
      compositor.app.renderer.background.color = config.canvas.backgroundColor;
    }
  }

  // State subscribers
  const subscribers = new Set<StateSubscriber>();

  // Register engine internals BEFORE setting up watch.track subscriptions
  // This prevents "getState called but engine is not initialized" warnings
  // because watch.track callbacks execute immediately when set up
  registerEngineInternals({
    getState,
    getActions: () => actionsBundle,
    controllers: {
      media,
      timeline,
      compositor,
      videoExport,
      project,
    },
  });

  // Watch for state changes and notify subscribers
  const unwatchHistorical = watch.track(() => coreInstance?.state, (historicalState) => {
    if (!coreInstance) return;
    const fullState = getState();
    subscribers.forEach((callback) => {
      try {
        callback(fullState);
      } catch (error) {
        console.error('Error in state subscriber:', error);
      }
    });
  });

  const unwatchNonHistorical = watch.track(() => nonHistoricalState?.state, (nonHistState) => {
    if (!nonHistoricalState) return;
    const fullState = getState();
    subscribers.forEach((callback) => {
      try {
        callback(fullState);
      } catch (error) {
        console.error('Error in state subscriber:', error);
      }
    });
  });

  // Create Engine API
  const engine: EngineAPI = {
    controllers: {
      media,
      timeline,
      compositor,
      videoExport,
      project,
    },

    // Expose the actualized actions bundle (callable functions)
    // The actionsBundle contains both historical (from coreInstance.actions) and non-historical actions
    actions: {
      historical: coreInstance.actions,
      non_historical: nonHistoricalActions,
    },

    getState,

    subscribe: (callback: StateSubscriber) => {
      subscribers.add(callback);
      // Return unsubscribe function
      return () => {
        subscribers.delete(callback);
      };
    },

    // Effect helpers
    getEffects: () => getState().effects,
    getSelectedEffect: () => getState().selected_effect,
    setSelectedEffect: (effect: AnyEffect | null) => {
      if (actionsBundle) {
        actionsBundle.set_selected_effect(effect, { omit: true });
      }
    },

    // Playback control - use compositor's methods to properly sync internal state
    play: () => {
      compositor.set_video_playing(true);
    },

    pause: () => {
      compositor.set_video_playing(false);
    },

    togglePlayback: () => {
      compositor.toggle_video_playing();
    },

    seek: (timecode: number) => {
      if (actionsBundle) {
        actionsBundle.set_timecode(timecode, { omit: true });
        compositor.seek(timecode);
      }
    },

    getCurrentTime: () => compositor.timecode,

    isPlaying: () => getState().is_playing,

    // Timeline helpers
    getDuration: () => {
      const effects = getState().effects;
      if (effects.length === 0) return 0;
      
      const maxEndTime = Math.max(
        ...effects.map((effect: AnyEffect) => effect.start_at_position + (effect.end - effect.start))
      );
      return maxEndTime;
    },

    getZoom: () => getState().zoom,

    setZoom: (zoom: number) => {
      const clampedZoom = Math.max(-5, Math.min(5, zoom));
      if (actionsBundle) {
        if (clampedZoom > getState().zoom) {
          actionsBundle.zoom_in({ omit: true });
        } else {
          actionsBundle.zoom_out({ omit: true });
        }
      }
    },

    // Export
    startExport: (bitrate = 9000) => {
      const state = getState();
      videoExport.export_start(state, bitrate);
    },

    stopExport: () => {
      const state = getState();
      videoExport.resetExporter(state);
    },

    saveExportedFile: async () => {
      await videoExport.save_file();
    },

    getExportProgress: () => getState().export_progress,

    isExporting: () => getState().is_exporting,

    // Lifecycle
    destroy: () => {
      // Destroy compositor first to stop the animation frame loop
      // This prevents accessing destroyed state
      try {
        compositor.destroy();
      } catch (e) {
        console.warn("Error calling compositor.destroy()", e);
      }

      // Pause playback
      if (actionsBundle) {
        try {
          actionsBundle.set_is_playing(false, { omit: true });
        } catch (e) {
          console.warn("Failed to pause on destroy", e);
        }
      }

      // Unsubscribe from state watchers
      unwatchHistorical();
      unwatchNonHistorical();

      // Clear subscribers
      subscribers.clear();

      // Cleanup compositor PIXI app
      // Note: compositor.destroy() now handles app destruction internally
      try {
        if (!compositor.isDestroyed) {
           compositor.destroy();
        }
      } catch (e) {
        console.warn("Error destroying compositor", e);
      }

      // Cleanup media
      // Media controller uses IndexedDB, which persists
      // No explicit cleanup needed

      // Clear instances - must be done after compositor.destroy() to prevent
      // the animation frame loop from accessing null state
      coreInstance = null;
      nonHistoricalState = null;
      actionsBundle = null;
    },
  };

  // Note: registerEngineInternals was called earlier, before watch.track subscriptions
  // to prevent "getState called but engine is not initialized" warnings

  return engine;
}

/**
 * Export engine types for convenience
 */
export type { State, AnyEffect, VideoEffect, AudioEffect, TextEffect, ImageEffect } from './state/types';
