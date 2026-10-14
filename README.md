# CutForge Pro

CutForge Pro is a browser-based, local-first non-linear video editor. It has a
multi-track timeline, canvas preview renderer, Web Audio mixing, WebM capture,
GPU WebCodecs MP4 + local ffmpeg.wasm fallback, captions, effects, templates,
and portable project files.

The editor works without an account or backend.

## Features

- Multi-track video, audio, text, captions, effects, 15 transitions, filters, LUT, and
  adjustments
- Frame-aware trim, split, move, snapping, ripple closing, undo, and redo
- Canvas preview and export compositor sharing the same render graph
- Web Audio mixer with gain, pan, EQ, compression, reverb, and waveform cache
- WebM export and MP4 via GPU WebCodecs (2x/4x fast) with ffmpeg.wasm CPU fallback
- 480p, 720p, 1080p, and 4K export presets, 30/60fps
- Demo media pack for creating a reel or YouTube-style project immediately
- Local autosave, IndexedDB versions, and portable `*.editor.json` files
- Transcribe via provider URL with mic/SRT fallback, TTS preview + file, background
  removal with MediaPipe/chroma fallbacks

## Requirements

- Node.js 18 or newer
- A modern desktop browser with Canvas, Web Audio, IndexedDB, and MediaRecorder
  support
- HTTPS when deployed. `localhost` is sufficient for local development.

Some browser capabilities vary by browser, especially WebCodecs, MediaRecorder
codec support, and MP4 conversion performance. WebM is the broadest export
option; MP4 conversion runs locally through ffmpeg.wasm and can use significant
memory for large projects.

## Frontend setup

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. The first launch shows onboarding. Open **Media →
Demo** to load the bundled license-clean assets from `public/assets`.

### Frontend commands

```bash
npm run dev         # Start Vite development server
npm run build       # Create the production bundle in dist/
npm run preview     # Serve the production bundle locally
npm run typecheck   # Run TypeScript without emitting files
npm test            # Run frontend unit tests
npm run test:watch  # Run tests in watch mode
```

## Editing workflow

1. Import video, image, and audio from **Media**, or load the demo pack.
2. Drag media onto the timeline. Drag clip edges to trim and the clip body to
   move; snapping follows edges, markers, and the playhead.
3. Press `S` to split at the playhead.
4. Add text, captions, effects, transitions, filters, audio adjustments, or
   templates from the relevant panels.
5. Use **Export** to choose a resolution and WebM or MP4 output.
6. Use **Save** to download a portable project file. Drafts and versions are
   also saved locally by the browser.

## Environment variables

The frontend is fully usable with no environment file. To configure optional
integrations, copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Available frontend variables are `VITE_TRANSCRIBE_URL`, `VITE_TTS_URL`,
`VITE_SEGMENT_URL`, and `VITE_EXPORT_API` (see `.env.example`). Vite exposes
`VITE_*` values to browser code, so never put private credentials in them.
Frontend AI integrations are BYOK or proxy URLs only. With no env set the app
is fully usable: transcribe falls back to mic dictate + SRT/VTT import, TTS to
speechSynthesis preview, segmentation to chroma key.

## Production deployment

### Static frontend (only target)

Build the frontend and deploy the generated `dist/` directory with any static
host:

```bash
npm ci
npm run build
```

For Vercel or Netlify, use:

```text
Build command: npm run build
Output directory: dist
```

Set any required `VITE_*` variables in the host dashboard before building. The
included `vercel.json` falls back to `index.html`.

The current frontend uses single-threaded ffmpeg.wasm, so special
`SharedArrayBuffer` COOP/COEP headers are not required. Serve the production
app over HTTPS so media APIs and browser storage behave consistently.

## Project structure

```text
src/components/   Editor UI and panels
src/engine/       Timeline operations, rendering, audio, and export
src/services/     Media, storage, AI, and adapter services
src/state/        Zustand project and UI state
public/assets/    Bundled demo media
docs/             Architecture and API notes
```

## Architecture

```text
UI (components/) → Zustand store (state/) → timelineOps (engine/)
→ compositor render graph (engine/compositor.ts)
→ WebCodecs/MediaRecorder + ffmpeg.wasm (services/mp4.ts)
```

The compositor is shared by preview and export. Media bytes stay outside React
and Zustand state in object URLs and the element pool. Waveforms are decoded in
a worker and cached in IndexedDB. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for the render graph, state model, audio pipeline, API sketch, and deployment
notes.

## Testing and contribution

Before opening a pull request, run:

```bash
npm test
npm run typecheck
npm run build
```

Keep generated folders such as `node_modules/` and `dist/` out of commits; they
are ignored by `.gitignore`. Do not commit `.env`, `.env.local`, or server
credentials.
