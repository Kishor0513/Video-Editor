// Real person segmentation via MediaPipe SelfieSegmentation (model fetched at runtime when online).
let seg: { send: (o: { image: HTMLVideoElement }) => Promise<void>; onResults: (cb: (r: { segmentationMask: HTMLCanvasElement }) => void) => void } | null = null;
export async function segmentFrame(video: HTMLVideoElement, w: number, h: number): Promise<HTMLCanvasElement | null> {
  try {
    if (!seg) {
      const mod = await import('@mediapipe/selfie_segmentation');
      const S = (mod as unknown as { SelfieSegmentation: new (o: { locateFile: (f: string) => string }) => typeof seg }).SelfieSegmentation;
      seg = new S({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${f}` }) as typeof seg;
    }
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const mask = await new Promise<HTMLCanvasElement | null>((resolve) => {
      const to = setTimeout(() => resolve(null), 6000);
      seg!.onResults((r) => { clearTimeout(to); resolve(r.segmentationMask ?? null); });
      seg!.send({ image: video }).catch(() => { clearTimeout(to); resolve(null); });
    });
    if (!mask) return null;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d')!;
    g.drawImage(video, 0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(mask, 0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
    return cv;
  } catch { return null; }
}
