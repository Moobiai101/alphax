/**
 * Feature Detection Utilities
 * 
 * Detects browser capabilities required for the Omniclip engine:
 * - WebCodecs (VideoEncoder/VideoDecoder)
 * - IndexedDB
 * - File System Access API
 * - WebGL/WebGPU for PIXI.js
 * - Web Workers
 */

/**
 * Browser capability detection results
 */
export interface BrowserCapabilities {
  webCodecs: boolean;
  videoEncoder: boolean;
  videoDecoder: boolean;
  indexedDB: boolean;
  fileSystemAccess: boolean;
  webgl: boolean;
  webgpu: boolean;
  webWorkers: boolean;
  offscreenCanvas: boolean;
  isSupported: boolean; // Overall support check
  unsupportedFeatures: string[];
}

/**
 * Check if WebCodecs is supported
 */
function checkWebCodecs(): { supported: boolean; encoder: boolean; decoder: boolean } {
  if (typeof window === 'undefined') {
    return { supported: false, encoder: false, decoder: false };
  }

  const encoder = 'VideoEncoder' in window;
  const decoder = 'VideoDecoder' in window;
  const supported = encoder && decoder;

  return { supported, encoder, decoder };
}

/**
 * Check if IndexedDB is supported
 */
function checkIndexedDB(): boolean {
  if (typeof window === 'undefined') return false;
  return 'indexedDB' in window && window.indexedDB !== null;
}

/**
 * Check if File System Access API is supported
 */
function checkFileSystemAccess(): boolean {
  if (typeof window === 'undefined') return false;
  return 'showSaveFilePicker' in window;
}

/**
 * Check if WebGL is supported
 */
function checkWebGL(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return !!gl;
  } catch (error) {
    return false;
  }
}

/**
 * Check if WebGPU is supported
 */
function checkWebGPU(): boolean {
  if (typeof window === 'undefined') return false;
  return 'gpu' in navigator;
}

/**
 * Check if Web Workers are supported
 */
function checkWebWorkers(): boolean {
  if (typeof window === 'undefined') return false;
  return 'Worker' in window;
}

/**
 * Check if OffscreenCanvas is supported
 */
function checkOffscreenCanvas(): boolean {
  if (typeof window === 'undefined') return false;
  return 'OffscreenCanvas' in window;
}

/**
 * Detect all browser capabilities
 * 
 * @returns Comprehensive browser capability report
 */
export function detectBrowserCapabilities(): BrowserCapabilities {
  const webCodecs = checkWebCodecs();
  const indexedDB = checkIndexedDB();
  const fileSystemAccess = checkFileSystemAccess();
  const webgl = checkWebGL();
  const webgpu = checkWebGPU();
  const webWorkers = checkWebWorkers();
  const offscreenCanvas = checkOffscreenCanvas();

  // Determine which features are missing
  const unsupportedFeatures: string[] = [];

  if (!webCodecs.supported) {
    if (!webCodecs.encoder) unsupportedFeatures.push('VideoEncoder');
    if (!webCodecs.decoder) unsupportedFeatures.push('VideoDecoder');
  }

  if (!indexedDB) unsupportedFeatures.push('IndexedDB');
  if (!webgl) unsupportedFeatures.push('WebGL');
  if (!webWorkers) unsupportedFeatures.push('Web Workers');

  // Determine overall support
  // Minimum requirements: WebCodecs, IndexedDB, WebGL, Web Workers
  const isSupported = 
    webCodecs.supported &&
    indexedDB &&
    webgl &&
    webWorkers;

  return {
    webCodecs: webCodecs.supported,
    videoEncoder: webCodecs.encoder,
    videoDecoder: webCodecs.decoder,
    indexedDB,
    fileSystemAccess,
    webgl,
    webgpu,
    webWorkers,
    offscreenCanvas,
    isSupported,
    unsupportedFeatures,
  };
}

/**
 * Check if engine can be initialized
 * 
 * @throws Error if required features are missing
 */
export function validateBrowserSupport(): void {
  const capabilities = detectBrowserCapabilities();

  if (!capabilities.isSupported) {
    const features = capabilities.unsupportedFeatures.join(', ');
    throw new Error(
      `Your browser does not support required features: ${features}. ` +
      `Please use a modern browser like Chrome, Edge, or Opera.`
    );
  }

  // Warn about optional features
  if (!capabilities.fileSystemAccess) {
    console.warn(
      'File System Access API not supported. ' +
      'Export will use download fallback instead of direct file saving.'
    );
  }

  if (!capabilities.offscreenCanvas) {
    console.warn(
      'OffscreenCanvas not supported. ' +
      'Video rendering performance may be reduced.'
    );
  }

  if (!capabilities.webgpu) {
    console.info(
      'WebGPU not supported. Using WebGL for rendering.'
    );
  }
}

/**
 * Get user-friendly error message for missing features
 * 
 * @param capabilities - Browser capabilities
 * @returns Error message string
 */
export function getUnsupportedMessage(capabilities: BrowserCapabilities): string {
  if (capabilities.isSupported) {
    return '';
  }

  const features = capabilities.unsupportedFeatures;
  
  let message = 'Your browser does not support the following required features:\n\n';
  
  features.forEach(feature => {
    message += `• ${feature}\n`;
  });

  message += '\nPlease use one of these supported browsers:\n';
  message += '• Google Chrome 94+\n';
  message += '• Microsoft Edge 94+\n';
  message += '• Opera 80+\n';

  return message;
}

/**
 * Check if running in client-side environment
 */
export function isClientSide(): boolean {
  return typeof window !== 'undefined';
}

/**
 * SSR-safe browser feature check
 * Returns false during SSR, actual support status on client
 */
export function canUseEngine(): boolean {
  if (!isClientSide()) {
    return false;
  }

  const capabilities = detectBrowserCapabilities();
  return capabilities.isSupported;
}

