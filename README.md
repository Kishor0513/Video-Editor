# CutForge Pro

CutForge Pro is a browser-based, local-first non-linear video editor. It has a
multi-track timeline, canvas preview renderer, Web Audio mixing, WebM capture,
local ffmpeg.wasm MP4 conversion, captions, effects, templates, and portable
project files.

The editor works without an account or backend. An optional Hono API server adds
projects, asset storage, authentication, AI integrations, Stripe plan gates,
and server-side export workflows.

## Features

- Multi-track video, audio, text, captions, effects, transitions, filters, and
  adjustments
- Frame-aware trim, split, move, snapping, ripple closing, undo, and redo
- Canvas preview and export compositor sharing the same render graph
- Web Audio mixer with gain, pan, EQ, compression, reverb, and waveform cache
- WebM export and optional MP4 conversion in the browser
- 480p, 720p, 1080p, and 4K export presets
- Demo media pack for creating a reel or YouTube-style project immediately
- Local autosave, IndexedDB versions, and portable `*.editor.json` files
- AI provider adapters and background removal with local/mock fallbacks
- Optional server integrations for accounts, cloud assets, billing, and jobs

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

Available frontend variables are `VITE_API_URL`, `VITE_TRANSCRIBE_URL`,
`VITE_TTS_URL`, `VITE_SEGMENT_URL`, and `VITE_EXPORT_API`. Vite exposes
`VITE_*` values to browser code, so never put private credentials in them.
Frontend AI integrations are BYOK or proxy URLs only.

## Optional API server

The server in `server/` is not required for local editing. It is a separate
Node service and needs its own dependencies and environment file:

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

The default API address is <http://localhost:8787>. Set `VITE_API_URL` in the
frontend `.env.local` to use it:

```bash
VITE_API_URL=http://localhost:8787
```

Server commands:

```bash
npm run dev        # Start with tsx watch
npm start          # Start without watch mode
npm run typecheck  # Check server TypeScript
npm test           # Run server tests
npm run db:push    # Apply the Drizzle schema to DATABASE_URL
```

The server environment can connect PostgreSQL, Cloudflare R2, and Stripe. See
`server/.env.example` for the complete list. Use production credentials and set
`DEFAULT_PLAN=free` before exposing the API publicly; the example defaults are
intended for local development.

## Production deployment

### Static frontend

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

Set any required `VITE_*` variables in the host dashboard before building. If
client-side routes are added later, configure the host to fall back to
`index.html`.

### API server

Deploy `server/` separately as a Node service or container. Provide its
database, R2, Stripe, and application URL variables through the host's secret
manager. The included `server/Dockerfile` can be used as a starting point for
container deployment.

The current frontend uses single-threaded ffmpeg.wasm, so special
`SharedArrayBuffer` COOP/COEP headers are not required. Serve the production
app over HTTPS so media APIs and browser storage behave consistently.

## Project structure

```text
src/components/   Editor UI and panels
src/engine/       Timeline operations, rendering, audio, and export
src/services/     Media, storage, auth, AI, API, and collaboration adapters
src/state/        Zustand project and UI state
server/src/       Optional Hono API and worker service
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
