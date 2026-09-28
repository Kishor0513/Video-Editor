// Real point tracker: template-match a 24px patch frame-to-frame + FaceDetector hookup.
export interface TrackPoint { x: number; y: number; t: number; }
function patch(g: CanvasRenderingContext2D, x: number, y: number, s: number): number[] {
  const d = g.getImageData(Math.max(0, x - s / 2) | 0, Math.max(0, y - s / 2) | 0, s, s).data;
  const out: number[] = [];
  for (let i = 0; i < d.length; i += 16) out.push((d[i] + d[i + 1] + d[i + 2]) / 3);
  return out;
}
export async function trackPoint(video: HTMLVideoElement, x0: number, y0: number, t0: number, t1: number, step = 0.15): Promise<TrackPoint[]> {
  const cv = document.createElement('canvas'); cv.width = 160; cv.height = 90;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  const pts: TrackPoint[] = [];
  const seek = (t: number) => new Promise<void>((res) => {
    const h = () => { video.removeEventListener('seeked', h); res(); };
    video.addEventListener('seeked', h);
    try { video.currentTime = t; } catch { res(); }
    setTimeout(res, 800);
  });
  await seek(t0);
  g.drawImage(video, 0, 0, 160, 90);
  let bx = x0 * 160, by = y0 * 90;
  let tpl = patch(g, bx, by, 24);
  for (let t = t0; t <= t1; t += step) {
    await seek(t);
    g.drawImage(video, 0, 0, 160, 90);
    let best = 1e18, nx = bx, ny = by;
    for (let dy = -10; dy <= 10; dy += 2) for (let dx = -10; dx <= 10; dx += 2) {
      const p = patch(g, bx + dx, by + dy, 24);
      let s = 0; for (let i = 0; i < p.length; i++) s += Math.abs(p[i] - tpl[i]);
      if (s < best) { best = s; nx = bx + dx; ny = by + dy; }
    }
    bx = Math.max(12, Math.min(148, nx)); by = Math.max(12, Math.min(78, ny));
    tpl = patch(g, bx, by, 24);
    pts.push({ x: bx / 160, y: by / 90, t });
  }
  return pts;
}
export async function detectFace(video: HTMLVideoElement): Promise<{ x: number; y: number } | null> {
  try {
    const FD = (window as unknown as { FaceDetector?: new () => { detect(v: HTMLVideoElement): Promise<{ boundingBox: DOMRect }[]> } }).FaceDetector;
    if (!FD) return null;
    const r = await new FD().detect(video);
    if (!r.length) return null;
    const b = r[0].boundingBox;
    return { x: (b.x + b.width / 2) / (video.videoWidth || 1), y: (b.y + b.height / 2) / (video.videoHeight || 1) };
  } catch { return null; }
}
