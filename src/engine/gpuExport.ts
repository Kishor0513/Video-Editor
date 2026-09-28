// GPU export: WebCodecs (hardware-preferred H.264) + MP4 mux via Mediabunny.
// Falls back to null when WebCodecs/AVC is unavailable — caller uses the
// MediaRecorder + ffmpeg.wasm CPU path instead.
import { Output, Mp4OutputFormat, BufferTarget, CanvasSource, MediaStreamAudioTrackSource } from 'mediabunny';
import { drawComposition } from './compositor';
import { syncPool, poolGet } from './pool';
import { useEditor } from '../state/projectStore';
import { ensureAudio, audioCtx, mixStream } from './audio';

export interface GpuSupport { ok: boolean; hardwarePreferred: boolean }

/**
 * FAST GPU export: plays the timeline at 2x/4x while capturing frames, and
 * renders the audio mix offline (OfflineAudioContext) so it doesn't gate
 * speed. Video frames are timestamped from the virtual clock, not wall time.
 */
export async function captureMp4GpuFast(
  tot: number,
  w: number,
  h: number,
  bitrate: number,
  speed: 2 | 4,
  onProgress: (pct: number, fps: number) => void,
  watermark = false,
): Promise<GpuResult & { encodeFps: number }> {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.style.cssText = 'position:fixed;left:0;bottom:0;width:160px;opacity:0.9;pointer-events:none;z-index:60;border:1px solid #444;';
  cv.title = `Fast GPU export ${w}x${h} @${speed}x`;
  document.body.appendChild(cv);

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const videoSource = new CanvasSource(cv, {
    codec: 'avc',
    bitrate,
    hardwareAcceleration: 'prefer-hardware',
    keyFrameInterval: 2,
  });
  output.addVideoTrack(videoSource);

  // --- Offline audio mix (runs at its own pace, doesn't gate video) ---
  let hasAudio = false;
  try {
    const audioBuf = await renderAudioOffline(tot);
    if (audioBuf) {
      const { AudioBufferSource } = await import('mediabunny');
      const src = new AudioBufferSource({ codec: 'aac', bitrate: 128_000 });
      output.addAudioTrack(src);
      await src.add(audioBuf);
      hasAudio = true;
    }
  } catch { /* video-only */ }
  await output.start();

  // --- High-speed video capture ---
  const st = useEditor.getState();
  const videos = st.project.tracks
    .filter((t) => t.id[0] === 'v')
    .flatMap((t) => t.clips)
    .filter((c) => c.type === 'video' && c.assetId)
    .map((c) => ({ c, el: poolGet(c.id) }))
    .filter((x): x is { c: typeof x.c; el: HTMLVideoElement } => x.el instanceof HTMLVideoElement);

  // Pre-seek each video to its clip start so playback can run at speed
  for (const { c, el } of videos) {
    try { el.playbackRate = speed; el.currentTime = Math.max(0, c.sourceStart ?? 0); } catch { /* noop */ }
  }

  let raf = 0;
  let last = performance.now();
  let elapsed = 0;
  let lastAdded = -1;
  let framesAdded = 0;
  const t0 = performance.now();
  useEditor.getState().set({ currentTime: 0, playing: true, rate: speed });
  try {
    await new Promise<void>((resolve) => {
      const paint = () => {
        raf = requestAnimationFrame(paint);
        const now = performance.now();
        const dt = Math.min(0.1, (now - last) / 1000) * speed;
        last = now;
        elapsed += dt;
        const s2 = useEditor.getState();
        try {
          // boundary-only seeking: let videos free-run at `speed`, just keep
          // them inside their clip window (no per-frame drift correction)
          for (const { c, el } of videos) {
            const lt = s2.currentTime - c.startTime;
            if (lt < -0.05 || lt > c.duration + 0.05) { try { el.pause(); } catch { /* noop */ } }
            else if (el.paused) { void el.play().catch(() => undefined); }
          }
          drawComposition(s2.project, s2.assets, s2.currentTime, cv);
        } catch { /* keep last frame */ }
        if (watermark) {
          const g = cv.getContext('2d')!;
          g.save();
          g.font = `700 ${Math.round(h * 0.028)}px Inter, Arial`;
          g.textAlign = 'right'; g.textBaseline = 'bottom';
          g.fillStyle = 'rgba(255,255,255,0.75)';
          g.fillText('CutForge', w - h * 0.02, h - h * 0.015);
          g.restore();
        }
        const t = Math.min(elapsed, tot);
        if (t - lastAdded >= 1 / 30 || t >= tot) {
          lastAdded = t;
          framesAdded++;
          void videoSource.add(t, 1 / 30).catch(() => undefined);
        }
        const fps = framesAdded / Math.max(0.1, (performance.now() - t0) / 1000);
        onProgress(Math.min(99, (t / tot) * 100), fps);
        if (elapsed >= tot) resolve();
      };
      paint();
    });
  } finally {
    cancelAnimationFrame(raf);
    cv.remove();
    for (const { el } of videos) { try { el.pause(); el.playbackRate = 1; } catch { /* noop */ } }
    useEditor.getState().set({ playing: false, rate: 1, currentTime: 0 });
  }
  await output.finalize();
  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error('GPU mux produced no data');
  const encodeFps = framesAdded / Math.max(0.1, (performance.now() - t0) / 1000);
  return { blob: new Blob([buffer], { type: 'video/mp4' }), engine: `GPU fast ${speed}x (${hasAudio ? 'AAC' : 'no audio'})`, hasAudio, encodeFps };
}

/** Render the full audio mix to an AudioBuffer via OfflineAudioContext. */
async function renderAudioOffline(tot: number): Promise<AudioBuffer | null> {
  const st = useEditor.getState();
  const clips = st.project.tracks
    .filter((t) => t.id[0] === 'a' || t.id[0] === 'v')
    .flatMap((t) => t.clips)
    .filter((c) => (c.type === 'audio' || c.type === 'video') && c.assetId && (c.volume ?? 1) > 0);
  if (!clips.length) return null;
  const sr = 48000;
  const octx = new OfflineAudioContext(2, Math.ceil(sr * Math.max(1, tot)), sr);
  const master = octx.createGain();
  master.connect(octx.destination);
  let wired = 0;
  for (const c of clips) {
    const a = st.assets.find((x) => x.id === c.assetId);
    if (!a?.url) continue;
    try {
      const buf = await octx.decodeAudioData(await (await fetch(a.url)).arrayBuffer());
      const src = octx.createBufferSource();
      src.buffer = buf;
      const g = octx.createGain();
      const vol = Math.max(0, c.volume ?? 1);
      const fi = c.fadeIn ?? 0, fo = c.fadeOut ?? 0;
      const t0 = c.startTime;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + Math.max(0.01, fi));
      g.gain.setValueAtTime(vol, Math.max(t0 + fi, t0 + c.duration - Math.max(0.01, fo)));
      g.gain.linearRampToValueAtTime(0.0001, t0 + c.duration);
      let out: AudioNode = g;
      try { const p = octx.createStereoPanner(); p.pan.value = c.pan ?? 0; g.connect(p); out = p; } catch { /* mono */ }
      src.connect(g); out.connect(master);
      src.start(t0, Math.max(0, c.sourceStart ?? 0), c.duration);
      wired++;
    } catch { /* skip unreachable */ }
  }
  if (!wired) return null;
  return octx.startRendering();
}

export async function supportsGpuEncode(width: number, height: number, bitrate: number): Promise<GpuSupport> {
  try {
    if (typeof VideoEncoder === 'undefined') return { ok: false, hardwarePreferred: false };
    const s = await VideoEncoder.isConfigSupported({
      codec: 'avc1.42001f',
      width,
      height,
      bitrate,
      framerate: 30,
      hardwareAcceleration: 'prefer-hardware',
    } as VideoEncoderConfig);
    if (!s.supported) return { ok: false, hardwarePreferred: false };
    const hw = (s.config as VideoEncoderConfig & { hardwareAcceleration?: string }).hardwareAcceleration;
    return { ok: true, hardwarePreferred: hw !== 'prefer-software' };
  } catch {
    return { ok: false, hardwarePreferred: false };
  }
}

export interface GpuResult { blob: Blob; engine: string; hasAudio: boolean }

/**
 * Realtime GPU capture: plays the timeline (same clock/pool sync as the
 * MediaRecorder path so audio stays in sync), encodes canvas frames with a
 * hardware-preferred H.264 encoder straight into MP4 — no wasm transcode.
 */
export async function captureMp4Gpu(
  tot: number,
  w: number,
  h: number,
  bitrate: number,
  onProgress: (pct: number, encodeFps: number) => void,
  watermark = false,
): Promise<GpuResult & { encodeFps: number }> {
  ensureAudio();
  await audioCtx()?.resume().catch(() => undefined);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.style.cssText = 'position:fixed;left:0;bottom:0;width:160px;opacity:0.9;pointer-events:none;z-index:60;border:1px solid #444;';
  void watermark;
  document.body.appendChild(cv);

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const videoSource = new CanvasSource(cv, {
    codec: 'avc',
    bitrate,
    hardwareAcceleration: 'prefer-hardware',
    keyFrameInterval: 2,
  });
  output.addVideoTrack(videoSource);
  const audioTrack = mixStream()?.getAudioTracks()[0] ?? null;
  let hasAudio = false;
  if (audioTrack) {
    try {
      output.addAudioTrack(new MediaStreamAudioTrackSource(audioTrack, { codec: 'aac', bitrate: 128_000 }));
      hasAudio = true;
    } catch { /* video-only fallback */ }
  }
  await output.start();

  let raf = 0;
  let last = performance.now();
  let elapsed = 0;
  let lastAdded = -1;
  let framesAdded = 0;
  const t0 = performance.now();
  useEditor.getState().set({ currentTime: 0, playing: true, rate: 1 });
  try {
    await new Promise<void>((resolve) => {
      const paint = () => {
        raf = requestAnimationFrame(paint);
        const now = performance.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        elapsed += dt;
        const st = useEditor.getState();
        try {
          syncPool(st.project, st.assets, st.currentTime, true, 1);
          drawComposition(st.project, st.assets, st.currentTime, cv);
        } catch { /* keep last frame */ }
        if (watermark) {
          const g = cv.getContext('2d')!;
          g.save();
          g.font = `700 ${Math.round(h * 0.028)}px Inter, Arial`;
          g.textAlign = 'right'; g.textBaseline = 'bottom';
          g.fillStyle = 'rgba(255,255,255,0.75)';
          g.fillText('CutForge', w - h * 0.02, h - h * 0.015);
          g.restore();
        }
        const t = Math.min(elapsed, tot);
        if (t - lastAdded >= 1 / 30 || t >= tot) {
          lastAdded = t;
          framesAdded++;
          void videoSource.add(t, 1 / 30).catch(() => undefined);
        }
        const fps = framesAdded / Math.max(0.1, (performance.now() - t0) / 1000);
        onProgress(Math.min(99, (t / tot) * 100), fps);
        if (elapsed >= tot) resolve();
      };
      paint();
    });
  } finally {
    cancelAnimationFrame(raf);
    cv.remove();
    useEditor.getState().set({ playing: false, rate: 1, currentTime: 0 });
  }
  await output.finalize();
  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error('GPU mux produced no data');
  const encodeFps = framesAdded / Math.max(0.1, (performance.now() - t0) / 1000);
  return { blob: new Blob([buffer], { type: 'video/mp4' }), engine: hasAudio ? 'GPU (hardware H.264 + AAC)' : 'GPU (hardware H.264, no audio track)', hasAudio, encodeFps };
}
