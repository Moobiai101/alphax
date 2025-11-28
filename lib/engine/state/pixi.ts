/**
 * PIXI.js re-exports for Next.js compatibility
 * This file provides both value and type exports from pixi.js
 * for use throughout the engine codebase.
 */

// Re-export everything from pixi.js
export * from "pixi.js"

// Also export the namespace for cases where we need the full namespace
import * as PIXI from "pixi.js"
export { PIXI }

