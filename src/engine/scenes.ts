// Scene detection: sample frames, flag large histogram diffs. Real, runs in chunks.
export async function detectScenes(video: HTMLVideoElement, duration: number, step = 0.5): Promise<number[]> {
  const scenes: number[] = [0];
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 36;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  let prev: number[] | null = null;
  const t = Math.min(duration, video.duration || duration);
  for (let s = step; s < t; s += step) {
    try {
      await new Promise<void>((res) => { const h = () => { video.removeEventListener('seeked', h); res(); }; video.addEventListener('seeked', h); video.currentTime = s; });
      g.drawImage(video, 0, 0, 64, 36);
      const d = g.getImageData(0, 0, 64, 36).data;
      const hist = [0, 0, 0];
      for (let i = 0; i < d.length; i += 16) { hist[0] += d[i]; hist[1] += d[i + 1]; hist[2] += d[i + 2]; }
      if (prev) {
        const diff = Math.abs(hist[0] - prev[0]) + Math.abs(hist[1] - prev[1]) + Math.abs(hist[2] - prev[2]);
        if (diff > 90000) scenes.push(Number(s.toFixed(2)));
      }
      prev = hist;
      await new Promise((r) => setTimeout(r, 0));
    } catch { break; }
  }
  return scenes;
}
