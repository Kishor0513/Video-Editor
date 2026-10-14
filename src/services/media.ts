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
  const base: Asset = { id: uid(), kind, name: file.name, url, duration: 0, width: 0, height: 0, thumb: '' };
  if (kind === 'image') {
    const im = new Image(); im.src = url;
    await withTimeout(new Promise((r) => { im.onload = () => r(null); im.onerror = () => r(null); }), 15000, null);
    base.width = im.width; base.height = im.height; base.thumb = url;
  } else if (kind === 'video') {
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = url;
    const canPlay = v.canPlayType(file.type || 'video/mp4');
    await withTimeout(new Promise((r) => { v.onloadedmetadata = () => r(null); v.onerror = () => r(null); }), 15000, null);
    base.duration = isFinite(v.duration) ? v.duration : 0;
    base.width = v.videoWidth; base.height = v.videoHeight;
    if (canPlay === '' && base.duration === 0) {
      // Codec unsupported by this browser — still add it, but flag it
      base.name = file.name + ' (codec unsupported)';
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
