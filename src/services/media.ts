import { uid } from '../state/projectStore';
import type { Asset } from '../types';
import { inferKind } from './security';
export { waveformPeaks } from './waveform';
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

export async function fileToAsset(file: File): Promise<Asset> {
  const url = URL.createObjectURL(file);
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  if (ext === 'heic' || ext === 'heif') throw new Error('HEIC photo not playable in browsers — convert to JPEG first');
  if (ext === 'srt' || ext === 'vtt' || ext === 'cube') throw new Error(`.${ext} files go in Caps (SRT/VTT) or FX → LUT (.cube), not the media library`);
  const kind: Asset['kind'] = inferKind(file) ?? (file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image');
  // Real-world editors (FreeCut/WebCut) probe containers directly instead of trusting
  // the <video> element — Mediabunny reads MP4/MOV/MKV/WebM metadata (duration,
  // dimensions) even for codecs Chrome cannot decode (HEVC, ProRes).
  const probed = kind === 'video' ? await probeVideoMetadata(file).catch(() => null) : null;
  const base: Asset = { id: uid(), kind, name: file.name, url, duration: 0, width: 0, height: 0, thumb: '' };
  if (kind === 'image') {
    const im = new Image(); im.src = url;
    await withTimeout(new Promise((r) => { im.onload = () => r(null); im.onerror = () => r(null); }), 15000, null);
    base.width = im.width; base.height = im.height; base.thumb = url;
  } else if (kind === 'video') {
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = url;
    const canPlay = v.canPlayType(file.type || 'video/mp4');
    await withTimeout(new Promise((r) => { v.onloadedmetadata = () => r(null); v.onerror = () => r(null); }), 15000, null);
    const elDur = isFinite(v.duration) ? v.duration : 0;
    base.duration = probed?.duration && probed.duration > 0 ? probed.duration : elDur;
    base.width = probed?.width || v.videoWidth; base.height = probed?.height || v.videoHeight;
    if (canPlay === '' && base.duration === 0) {
      // Codec unsupported by this browser — still add it, but flag it
      base.name = file.name + ' (codec unsupported)';
    } else if (canPlay === '' && base.duration > 0) {
      // Metadata readable (Mediabunny) but frames not decodable (HEVC/ProRes) — honest flag
      base.name = file.name + ' (preview unsupported — convert to MP4 H.264 for full support)';
    }
    try { v.currentTime = Math.min(1, v.duration / 2); await withTimeout(new Promise((r) => { v.onseeked = () => r(null); }), 5000, null); } catch { /* noop */ }
    try {
      const c = document.createElement('canvas'); c.width = 160; c.height = 90;
      const g = c.getContext('2d')!; g.fillStyle = '#000'; g.fillRect(0, 0, 160, 90);
      g.drawImage(v, 0, 0, 160, 90); base.thumb = c.toDataURL();
    } catch { /* noop */ }
  } else {
    const a = document.createElement('audio'); a.preload = 'metadata'; a.src = url;
    await withTimeout(new Promise((r) => { a.onloadedmetadata = () => r(null); a.onerror = () => r(null); }), 15000, null);
    base.duration = isFinite(a.duration) ? a.duration : 0;
    const { waveformPeaks } = await import('./waveform');
    base.peaks = await waveformPeaks(file).catch(() => []);
  }
  return base;
}

/** Container-level probe: duration + coded dimensions without decoding frames. */
async function probeVideoMetadata(blob: Blob): Promise<{ duration: number; width: number; height: number } | null> {
  try {
    const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny');
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    try {
      const tracks = await withTimeout(input.getVideoTracks(), 8000, []);
      const vt = tracks[0];
      if (!vt) return null;
      const [dur, w, h] = await withTimeout(
        Promise.all([
          input.getDurationFromMetadata([vt]).then((d) => d ?? NaN).catch(() => NaN),
          vt.getCodedWidth().catch(() => 0),
          vt.getCodedHeight().catch(() => 0),
        ]),
        8000,
        [NaN, 0, 0] as [number, number, number],
      );
      if (!isFinite(dur) || dur <= 0) return null;
      return { duration: dur, width: w || 0, height: h || 0 };
    } finally {
      try { input.dispose(); } catch { /* noop */ }
    }
  } catch { return null; }
}
