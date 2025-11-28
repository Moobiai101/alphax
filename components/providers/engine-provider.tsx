/**
 * Engine Provider
 * 
 * React Context Provider for the Omniclip engine. This component:
 * - Initializes the engine on mount (client-side only)
 * - Provides engine API to all child components
 * - Handles engine lifecycle (cleanup on unmount)
 * - Syncs engine state with React state when needed
 * - Shows appropriate UI for unsupported browsers
 */

'use client';

console.log("[ENGINE_PROVIDER] Module loading started");

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
console.log("[ENGINE_PROVIDER] React imported");
import { createEngine, type EngineAPI, type EngineConfig } from '@/lib/engine/context';
console.log("[ENGINE_PROVIDER] createEngine imported");
import { 
  detectBrowserCapabilities, 
  validateBrowserSupport, 
  getUnsupportedMessage,
  canUseEngine 
} from '@/lib/engine/feature-detection';
console.log("[ENGINE_PROVIDER] feature-detection imported");
import { Loader2, AlertTriangle } from 'lucide-react';
console.log("[ENGINE_PROVIDER] lucide-react imported");
import { toast } from 'sonner';
console.log("[ENGINE_PROVIDER] All imports complete");

/**
 * Engine Context
 */
const EngineContext = createContext<EngineAPI | null>(null);

/**
 * Engine Provider Props
 */
export interface EngineProviderProps {
  children: React.ReactNode;
  projectId: string;
  projectName?: string;
  settings?: EngineConfig['settings'];
  canvas?: EngineConfig['canvas'];
  onEngineReady?: (engine: EngineAPI) => void;
  onEngineError?: (error: Error) => void;
}

/**
 * Engine Provider Component
 * 
 * Wraps the application with the Omniclip engine context
 */
export function EngineProvider({
  children,
  projectId,
  projectName,
  settings,
  canvas,
  onEngineReady,
  onEngineError,
}: EngineProviderProps) {
  const [engine, setEngine] = useState<EngineAPI | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const initializationAttempted = useRef(false);

  // Initialize engine
  useEffect(() => {
    // Prevent multiple initialization attempts
    if (initializationAttempted.current) {
      return;
    }
    initializationAttempted.current = true;

    let engineInstance: EngineAPI | null = null;

    const initializeEngine = async () => {
      try {
        // Check if we can use the engine
        if (!canUseEngine()) {
          const capabilities = detectBrowserCapabilities();
          const message = getUnsupportedMessage(capabilities);
          throw new Error(message);
        }

        // Validate browser support
        validateBrowserSupport();

        // Create engine configuration
        const config: EngineConfig = {
          projectId,
          projectName,
          settings,
          canvas,
        };

        // Create engine instance
        engineInstance = createEngine(config);
        setEngine(engineInstance);
        setIsSupported(true);

        // Notify parent component
        if (onEngineReady) {
          onEngineReady(engineInstance);
        }

        toast.success('Engine initialized successfully');
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to initialize engine');
        console.error('Engine initialization error:', error);
        setError(error);
        setIsSupported(false);

        // Notify parent component
        if (onEngineError) {
          onEngineError(error);
        }

        toast.error('Failed to initialize video engine', {
          description: error.message,
        });
      } finally {
        setIsInitializing(false);
      }
    };

    initializeEngine();

    // Cleanup on unmount
    return () => {
      if (engineInstance) {
        try {
          engineInstance.destroy();
        } catch (err) {
          console.error('Error destroying engine:', err);
        }
      }
    };
  }, [projectId, projectName, settings, canvas, onEngineReady, onEngineError]);

  // Show loading state
  if (isInitializing) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Initializing video engine...</p>
          <p className="text-xs text-muted-foreground">Loading WebCodecs, IndexedDB, and PIXI...</p>
        </div>
      </div>
    );
  }

  // Show error state for unsupported browsers
  if (!isSupported || error) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background p-8">
        <div className="max-w-2xl w-full">
          <div className="flex flex-col items-center gap-6 text-center">
            <div className="p-4 bg-destructive/10 rounded-full">
              <AlertTriangle className="h-12 w-12 text-destructive" />
            </div>
            
            <div className="space-y-2">
              <h2 className="text-2xl font-bold">Browser Not Supported</h2>
              <p className="text-muted-foreground">
                Your browser does not support the required features for video editing.
              </p>
            </div>

            {error && (
              <div className="w-full max-w-md p-4 bg-muted rounded-lg text-left">
                <p className="text-sm font-mono whitespace-pre-wrap text-muted-foreground">
                  {error.message}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-sm font-semibold">Recommended Browsers:</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Google Chrome 94+</li>
                <li>• Microsoft Edge 94+</li>
                <li>• Opera 80+</li>
              </ul>
            </div>

            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Engine ready - render children
  if (!engine) {
    return null;
  }

  return (
    <EngineContext.Provider value={engine}>
      {children}
    </EngineContext.Provider>
  );
}

/**
 * Hook to access the engine from any component
 * 
 * @throws Error if used outside EngineProvider
 * @returns Engine API
 */
export function useEngine(): EngineAPI {
  const engine = useContext(EngineContext);

  if (!engine) {
    throw new Error('useEngine must be used within an EngineProvider');
  }

  return engine;
}

/**
 * Hook to safely access the engine (returns null if not available)
 * 
 * @returns Engine API or null
 */
export function useEngineOptional(): EngineAPI | null {
  return useContext(EngineContext);
}

/**
 * Hook to subscribe to engine state changes
 * 
 * @param selector - Function to select specific state slice
 * @returns Selected state
 */
export function useEngineState<T>(selector: (state: any) => T): T {
  const engine = useEngine();
  const [state, setState] = useState<T>(() => selector(engine.getState()));

  useEffect(() => {
    const unsubscribe = engine.subscribe((newState) => {
      setState(selector(newState));
    });

    return unsubscribe;
  }, [engine, selector]);

  return state;
}

/**
 * Hook to get engine playback state
 */
export function useEnginePlayback() {
  const engine = useEngine();
  
  const isPlaying = useEngineState(state => state.is_playing);
  const currentTime = useEngineState(state => state.timecode);
  
  return {
    isPlaying,
    currentTime,
    play: useCallback(() => engine.play(), [engine]),
    pause: useCallback(() => engine.pause(), [engine]),
    toggle: useCallback(() => engine.togglePlayback(), [engine]),
    seek: useCallback((time: number) => engine.seek(time), [engine]),
  };
}

/**
 * Hook to get engine export state
 */
export function useEngineExport() {
  const engine = useEngine();
  
  const isExporting = useEngineState(state => state.is_exporting);
  const progress = useEngineState(state => state.export_progress);
  const status = useEngineState(state => state.export_status);
  
  return {
    isExporting,
    progress,
    status,
    startExport: useCallback((bitrate?: number) => engine.startExport(bitrate), [engine]),
    stopExport: useCallback(() => engine.stopExport(), [engine]),
    saveFile: useCallback(() => engine.saveExportedFile(), [engine]),
  };
}

/**
 * Hook to get engine effects
 */
export function useEngineEffects() {
  const engine = useEngine();
  
  const effects = useEngineState(state => state.effects);
  const selectedEffect = useEngineState(state => state.selected_effect);
  
  return {
    effects,
    selectedEffect,
    setSelectedEffect: useCallback(
      (effect: any) => engine.setSelectedEffect(effect),
      [engine]
    ),
  };
}

