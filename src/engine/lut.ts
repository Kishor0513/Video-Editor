// Real .cube LUT: parse + CPU CLUT apply with intensity. No faking.
export interface Lut { size: number; data: Float32Array; title: string; }
export function parseCube(text: string): Lut {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  let size = 0; const vals: number[] = []; let title = 'lut';
  for (const l of lines) {
    if (l.startsWith('TITLE')) title = l.slice(5).trim().replace(/"/g, '');
    else if (l.startsWith('LUT_3D_SIZE')) size = parseInt(l.split(/\s+/)[1], 10);
    else if (/^[\d.\-eE\s]+$/.test(l)) { const p = l.split(/\s+/).map(Number); if (p.length >= 3 && p.every((n) => isFinite(n))) vals.push(p[0], p[1], p[2]); }
  }
  if (!size || vals.length < size ** 3 * 3) throw new Error('Bad .cube file');
  return { size, data: new Float32Array(vals), title };
}
export function applyLut(g: CanvasRenderingContext2D, w: number, h: number, lut: Lut, intensity: number) {
  if (intensity <= 0) return;
  const img = g.getImageData(0, 0, w, h); const d = img.data;
  const n = lut.size, D = lut.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
    const xi = Math.min(n - 1, Math.max(0, Math.round(r * (n - 1))));
    const yi = Math.min(n - 1, Math.max(0, Math.round(gg * (n - 1))));
    const zi = Math.min(n - 1, Math.max(0, Math.round(b * (n - 1))));
    const idx = (zi * n * n + yi * n + xi) * 3;
    const k = Math.max(0, Math.min(1, intensity));
    d[i] = d[i] * (1 - k) + D[idx] * 255 * k;
    d[i + 1] = d[i + 1] * (1 - k) + D[idx + 1] * 255 * k;
    d[i + 2] = d[i + 2] * (1 - k) + D[idx + 2] * 255 * k;
  }
  g.putImageData(img, 0, 0);
}
const store = new Map<string, Lut>();
export const setClipLut = (id: string, lut: Lut | null) => { if (lut) store.set(id, lut); else store.delete(id); };
export const getClipLut = (id: string) => store.get(id);
