# Omniclip Video Engine Integration Guide

## Purpose & Scope

- Document the Omniclip subsystems we must port into `alphax` to replace the temporary media/timeline/export stubs.
- Identify exact source files under `omniclip/s` worth copying verbatim vs. re-implementing behind React/Zustand-friendly facades.
- Capture integration risks (WebCodecs/FFmpeg, IndexedDB, PIXI) so future tasks can execute without re-discovery.
- Exclude the legacy `OpenCut` folder entirely; all engine logic comes from Omniclip.

## High-Level Architecture

| Subsystem | Source Entry Points | Responsibilities | Primary Dependencies |
| --- | --- | --- | --- |
| Global state & actions | `s/context/{context.ts, actions.ts, state.ts, types.ts}` | History-aware state tree, zipped actions, collaboration broadcast hooks | `@benev/slate`, `@benev/construct`
| Media ingestion & catalog | `s/context/controllers/media/controller.ts` | IndexedDB-backed media registry, MediaInfo metadata extraction, proxy handling | IndexedDB, `mediainfo.js`, `quick_hash`
| Timeline engine | `s/context/controllers/timeline` | Drag/drop, trim, placement proposals, ripple adjustments | Shared actions, media controller
| Canvas compositor | `s/context/controllers/compositor` | PIXI stage, managers for video/image/audio/text, transitions, animations | `pixi.js`, `gsap`, `gl-transitions`
| Export pipeline | `s/context/controllers/video-export` | WebCodecs decode/encode, frame demuxing, FFmpeg mux to MP4 | WebCodecs API, `web-demuxer`, `@ffmpeg/ffmpeg`, `ffprobe-wasm`
| Utility workers & tools | `s/tools/*`, `s/context/controllers/video-export/parts/*` | Demuxing, BinaryAccumulator, FPS counter, IndexedDB proxies | Web workers, WASM loaders

### Core Control Flow

```157:183:s/context/controllers/compositor/controller.ts
compose_effects(effects: AnyEffect[], timecode: number, exporting?: boolean) {
	if(!this.#recreated) {return}
	this.timecode = timecode
	this.#update_currently_played_effects(effects, timecode, exporting)
	this.app.render()
}
```

- `OmniContext` instantiates controllers and wires action watchers.
- Timeline interactions mutate state via zipped actions; compositor reacts to state changes and paints PIXI sprites.
- Export controller demuxes source media, asks compositor to render the frame graph, then encodes and muxes.

## Modules to Port (Copy vs Adapt)

### 1. State & Context Layer

- **Copy**: `s/context/{actions.ts, state.ts, types.ts, helpers.ts}` to `alphax/lib/engine/state/`.
  - Preserve action names; they drive controller logic and broadcast hooks.
- **Adapt**: `s/context/context.ts`
  - Replace `@benev/construct` mini app bootstrapping with a headless service that exposes controllers + actions to React providers.
  - Remove direct DOM lookups (`construct-editor`) and expose hook-friendly APIs.
- **Drop** (for now): Collaboration (`s/context/controllers/collaboration`) until we have WebRTC requirements.

### 2. Media Controller

- **Copy**: `s/context/controllers/media/controller.ts` + companion types `s/components/omni-media/types.ts`.
- **Assets**: bring `omniclip/assets/MediaInfoModule.wasm` into `alphax/public/assets/` and update loader path.
- **Integration Notes**:
  - Wrap IndexedDB access behind our existing storage abstraction (`lib/storage/storage-service.ts`) or expose a dedicated media service to keep Omniclip logic intact.
  - Map Omniclip hash identifiers to Alphax media IDs to stay compatible with `useMediaStore`.
  - Ensure File System Access API fallbacks align with our `storage-provider` safeguards.

### 3. Timeline Engine

- **Copy**: entire `s/context/controllers/timeline/` tree (effect manager, proposal utilities, drag handlers, filmstrip, waveform).
- **Model Mapping**:
  - Omniclip effects (`AnyEffect`) use `start_at_position`, `start`, `end` (ms) and `track` as zero-based index.
  - Alphax timeline uses `startTime`, `duration`, `trimStart/trimEnd`, `TimelineTrack.id`.
  - Build a translation layer that mirrors `useTimelineStore` state into Omniclip's effect schema when invoking controllers, and sync back mutations.
- **UI Hooks**:
  - Filmstrip generator expects to write to DOM; adapt to feed Alphax `timeline-element` preview components.
  - Waveform uses WaveSurfer; ensure lifecycle is tied to React cleanup.

### 4. Compositor (Canvas Renderer)

- **Copy**: `s/context/controllers/compositor/` (controller + managers + utils) and `s/context/controllers/compositor/lib/aligning_guidelines.ts`.
- **Adaptations**:
  - Replace direct `PIXI.Application` instantiation with a factory that can mount inside `components/editor/preview-panel.tsx` canvas.
  - Disable `register_to_dom` hooks; we will manage pointer events via React refs.
  - Ensure transitions use local copies of GLSL definitions (`gl-transitions`).
  - Manage `PIXI.Transformer` dependency (Omniclip expects plugin to be globally available).

### 5. Export Pipeline

- **Copy**: `s/context/controllers/video-export/` including workers, helpers (`FFmpegHelper`, `FileSystemHelper`), and utilities.
- **External Resources**:
  - Ship worker bundles via Next.js (consider `next.config.ts` custom worker loader or inline bundling).
  - Host `web-demuxer` wasm assets or keep CDN fallback.
  - Provide UI wiring to Alphax `export-button` (replace stub `lib/export.ts`).
- **Security**:
  - Gate File System Access API behind feature detection, maintain existing permission prompts.

### 6. Shared Utilities

- `s/utils/actionize.ts`, `s/utils/with-broadcast.ts`, `s/tools/demuxer.ts`, `s/tools/json_storage_proxy.ts`, `s/tools/register-elements.ts` (only if we expose the web components), `s/tools/dashify.ts`, `s/utils/wait.ts`, `s/utils/compare_arrays.ts`, `s/utils/remove-duplicates-by-key.ts`.
- Align TypeScript configs (Omniclip compiled with moduleResolution `bundler`). Ensure path aliases resolve under Alphax `tsconfig.json`.

## Alphax Integration Strategy

### Data Model Bridging

| Concept | Omniclip | Alphax | Bridge Plan |
| --- | --- | --- | --- |
| Effect timing | `start_at_position`, `start`, `end`, `duration` | `startTime`, `duration`, `trimStart`, `trimEnd` | Convert Alphax element to effect before controller calls; after actions, map back to adjust `startTime/trim*` |
| Tracks | Zero-based array `state.tracks` | `TimelineTrack[]` with IDs | Maintain deterministic ordering; store Omniclip track index on Alphax track metadata |
| Selection | `state.selected_effect` | `selectedElements[]` in `useTimelineStore` | When Omniclip sets selected effect, mirror to Alphax selection store |
| Media refs | `file_hash` (IndexedDB hash) | `mediaId` referencing Supabase metadata | Extend media store to keep Omniclip hash → mediaId mapping |
| Canvas objects | PIXI sprite transform state (`rect`) | React preview overlay state | Source of truth becomes Omniclip rect; update Alphax overlay components from compositor updates |

### UI Entry Points

1. `components/editor/preview-panel.tsx`
   - Mount PIXI canvas inside existing preview wrapper.
   - Listen to compositor `on_playing` to sync playback store.

2. `components/editor/timeline/*`
   - Replace local drag/trim logic with delegations to Omniclip timeline controller.
   - Use callbacks to update Alphax Zustand stores after Omniclip actions mutate state.

3. `lib/hooks/use-playback-controls.ts`
   - Drive Omniclip compositor's `set_video_playing`, `seek`, `toggle_video_playing`.

4. `lib/export.ts`
   - Replace stub with thin facade calling `VideoExport.export_start`, then expose `save_file()` for user download.

### Sequenced Migration Plan

1. **Create Engine Facade** (`lib/engine/index.ts`): instantiate `OmniContext` equivalent without DOM, expose controllers + state adapters.
2. **Media Bridge**: integrate Omniclip media controller with Alphax media store; ensure file hashing + metadata pipeline aligns.
3. **Preview Panel Integration**: mount compositor canvas, wire playback controls.
4. **Timeline Interaction**: gradually replace local drag/trim/selection logic with calls to Omniclip timeline manager. Maintain Alphax UI, but delegate behavior.
5. **Export Pipeline**: connect new `VideoExport` to export button UI, ensure background encode uses Web Workers and FFmpeg wasm caches.
6. **Feature Completion**: add transitions, filters, animation managers once baseline playback/export works.

## External Dependencies to Add

- `@benev/slate`, `@benev/construct`
- `pixi.js` (plus `@pixi/events`, `@pixi/filter-*` if not already bundled)
- `gsap`
- `gl-transitions` (GLSL bundle)
- `mediainfo.js`
- `web-demuxer`
- `@ffmpeg/ffmpeg`, `ffprobe-wasm`, `@ffmpeg/util`
- `wavesurfer.js`
- `@benev/slate/x/watch/zip`

Host WASM files locally (`MediaInfoModule.wasm`, ffmpeg cores if we choose to self-host) to avoid CDN drift.

## Implementation Considerations

- **SSR Guarding**: WebCodecs, IndexedDB, PIXI rely on `window`. Ensure all engine modules are imported lazily inside `useEffect` on the client.
- **Performance**: Compositor uses requestAnimationFrame loops; throttle React updates to avoid double-render. Keep heavy operations in Web Workers.
- **Memory Management**: Decoder closes `VideoFrame`s after use; maintain this to prevent leaks. Monitor FFmpeg heap growth; use `ffmpeg.deleteFile` when done.
- **Error Handling**: Propagate export errors to UI via Alphax toast system; wrap worker messages in try/catch.
- **Authentication**: Omniclip stores project state in localStorage; replace with Alphax project storage to avoid divergence.

## Suggested Next Steps

1. Scaffold `lib/engine` directory and port the state/actions/type files.
2. Implement media bridge with IndexedDB hashing + Supabase metadata sync.
3. Mount the PIXI compositor in `preview-panel` behind feature detection.
4. Delegate timeline drag/trim interactions to Omniclip controllers using adapter functions.
5. Replace export stub with WebCodecs + FFmpeg pipeline; verify 1080p AND 480P proxy render end-to-end.
6. Harden with integration tests (Playwright) covering import → timeline edit → preview → export.

By following this plan we get a production-ready, Omniclip-grade engine under the existing Alphax React UI without regressing on performance, security, or local-first guarantees.
