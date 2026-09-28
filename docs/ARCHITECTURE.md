# Architecture

## Render graph (shared preview + export)

`engine/compositor.ts` owns `drawComposition(project, assets, t, canvas)`:
V1 base (+ transitions) → V2 overlays → T1 text/captions, each node applying
trim → transform → mask → chroma → effects/color → LUT → composite.
Preview draws it every rAF; export draws it onto a hidden canvas sized by
`exportSize()` for true-resolution capture. One graph, two targets.

## State

- `state/projectStore.ts`: project + assets + UI/playback + history.
  History entries are `{label, before, after, at}` project snapshots;
  same-label commits within 1.5s coalesce (slider drags = one undo step).
  Drag gestures bypass `commit` and push a single entry on pointer-up.
- Media bytes stay out of state (object URLs + `engine/pool.ts` elements).

## Timeline (`engine/timelineOps.ts`, pure + tested)

`quantize` (frame-accurate per project fps), `splitClipAt` (sourceStart
compensation), `trimClipEdge`, `moveClip`, `resolveOverlap`,
`rippleCloseGaps`, `collectSnapTimes` + `snapTime` (±6px magnetic).

## Audio

Pool elements → per-clip FX chain (`engine/audioFX.ts`: 3-band EQ,
compressor, reverb, gain, pan) → master → destination + mix bus
(`engine/audio.ts`) feeding the export recorder.

## Export

Hidden canvas at preset resolution → `captureStream(30)` + mix-bus audio →
`MediaRecorder` (VP9/VP8) → optional `webmToMp4` ffmpeg.wasm transcode.
Progress: capture % → transcode % → download. Jobs listed in-dialog.

## AI / cloud (adapters, honest labels)

`services/ai.ts` (`AIProvider`: transcribe/autoEdit, mock included),
`services/segment.ts` (MediaPipe, chroma fallback), `services/ttsKey.ts`
(BYOK ElevenLabs/OpenAI), `services/auth.ts` (plan gates),
`services/collab.ts` (tab-sync via BroadcastChannel; CRDT-ready op log
shape), `services/storage.ts` (IndexedDB drafts/versions/peak cache).

## API sketch (server optional, local-first by default)

```
POST/GET /api/projects  GET/PUT/DELETE /api/projects/:id
POST /api/assets  DELETE /api/assets/:id
POST /api/ai/transcribe|remove-background|auto-edit|generate-script|text-to-speech
POST /api/export  GET /api/export/:id
```

## Deploy

Static build (`npm run build` → `dist/`). Serve over HTTP(S) — Ballyhoo:
`SharedArrayBuffer`/COOP-COEP headers only needed for threaded ffmpeg
(current build uses single-threaded wasm, no special headers required).
