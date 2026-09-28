// GPU export: WebCodecs (hardware-preferred H.264) + MP4 mux via Mediabunny.
// Falls back to null when WebCodecs/AVC is unavailable — caller uses the
// MediaRecorder + ffmpeg.wasm CPU path instead.
import { Output, Mp4OutputFormat, BufferTarget, CanvasSource, MediaStreamAudioTrackSource } from 'mediabunny';
import { drawComposition } from './compositor';
import { syncPool } from './pool';
import { useEditor } from '../state/projectStore';
import { ensureAudio, audioCtx, mixStream } from './audio';

export interface GpuSupport { ok: boolean; hardwarePreferred: boolean }

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
  cv.title = `GPU export render ${w}×${h}`;
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
