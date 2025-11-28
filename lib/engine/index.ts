/**
 * Omniclip Video Engine Facade
 * 
 * This module provides a React-friendly interface to the Omniclip video engine.
 * It instantiates controllers without DOM dependencies and exposes them for use
 * in Next.js/React components.
 */

// Note: Import these lazily in React components to avoid SSR issues
export * from "./state/types"
export * from "./state/state"
export * from "./state/helpers"
export * from "./types/media-types"

// Controllers will be exported once we create the headless context wrapper
// export { createEngine } from "./context"
// export type { EngineInstance, EngineConfig } from "./context"

/**
 * TODO: Create headless context wrapper
 * 
 * The next step is to create a `lib/engine/context.ts` file that:
 * 1. Instantiates Omniclip controllers without @benev/construct DOM bindings
 * 2. Manages state using Omniclip's action system
 * 3. Exposes a clean API for React hooks:
 *    - createEngine({ projectId, settings })
 *    - engine.controllers.{ media, timeline, compositor, videoExport }
 *    - engine.actions.{ ...all Omniclip actions }
 *    - engine.getState()
 *    - engine.subscribe(callback)
 * 
 * This allows React components to:
 * - Mount PIXI canvas in preview-panel
 * - Drive playback via compositor
 * - Trigger timeline operations
 * - Export videos
 * 
 * Without touching Omniclip's internal state management.
 */

