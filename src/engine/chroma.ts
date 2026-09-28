// Real chroma-key via pixel scan on an offscreen canvas. Returns a canvas with keyed alpha.
export interface ChromaSettings { color: string; similarity: number; smoothness: number; enabled: boolean; }
const cache = new Map<string, HTMLCanvasElement>();
export function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
export function keyFrame(src: HTMLVideoElement | HTMLImageElement, w: number, h: number, s: ChromaSettings): HTMLCanvasElement {
  const key = `${w}x${h}`;
  let cv = cache.get(key);
  if (!cv) { cv = document.createElement('canvas'); cache.set(key, cv); }
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.clearRect(0, 0, w, h);
  g.drawImage(src, 0, 0, w, h);
  try {
    const img = g.getImageData(0, 0, w, h); const d = img.data;
    const [kr, kg, kb] = hexRgb(s.color);
    for (let i = 0; i < d.length; i += 4) {
      const dr = Math.abs(d[i] - kr), dg = Math.abs(d[i + 1] - kg), db = Math.abs(d[i + 2] - kb);
      const dist = Math.sqrt(dr * dr + dg * dg + db * db) / 441;
      const sim = s.similarity, sm = Math.max(1e-3, s.smoothness);
      if (dist < sim) d[i + 3] = 0;
      else if (dist < sim + sm) d[i + 3] *= (dist - sim) / sm;
    }
    g.putImageData(img, 0, 0);
  } catch { /* tainted canvas -> fall back to unkeyed */ }
  return cv;
}
