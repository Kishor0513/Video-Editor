import type { Clip, FilterState } from '../types';
export const filterString = (f?: FilterState) => {
  if (!f) return 'none'; const p: string[] = [];
  if (f.br !== 100) p.push(`brightness(${f.br}%)`);
  if (f.ct !== 100) p.push(`contrast(${f.ct}%)`);
  if (f.st !== 100) p.push(`saturate(${f.st}%)`);
  if (f.gr > 0) p.push(`grayscale(${f.gr}%)`);
  if (f.sp > 0) p.push(`sepia(${f.sp}%)`);
  if (f.bl > 0) p.push(`blur(${f.bl}px)`);
  return p.length ? p.join(' ') : 'none';
};
export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
export const applyEasing = (kind: string | undefined, x: number): number => {
  const t = Math.max(0, Math.min(1, x));
  switch (kind) {
    case 'easeIn': return t * t;
    case 'easeOut': return 1 - (1 - t) * (1 - t);
    case 'easeInOut': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    default: return t;
  }
};
export function keyframedValue(c: Clip, prop: string, lt: number, base: number): number {
  const kfs = (c.keyframes ?? []).filter((k) => k.prop === prop).sort((a, b) => a.dt - b.dt);
  if (!kfs.length) return base;
  let prev = { dt: 0, value: base };
  for (const k of kfs) {
    if (lt < k.dt) {
      const span = Math.max(1e-3, k.dt - prev.dt);
      const u = applyEasing(k.easing, (lt - prev.dt) / span);
      return prev.value + (k.value - prev.value) * u;
    }
    prev = k;
  }
  return prev.value;
}
export function drawCover(ctx: CanvasRenderingContext2D, el: CanvasImageSource & { videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number }, W: number, H: number) {
  const iw = el.videoWidth || el.naturalWidth || 16;
  const ih = el.videoHeight || el.naturalHeight || 9;
  const ca = W / H, ia = iw / ih;
  let dw = W, dh = H;
  if (ia > ca) { dh = H; dw = H * ia; } else { dw = W; dh = W / ia; }
  ctx.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh);
}
