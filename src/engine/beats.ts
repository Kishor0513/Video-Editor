// Beat detection: energy-based onset peaks -> BPM + beat grid. Real, lightweight.
export function detectBeats(peaks: number[], duration: number): { bpm: number; beats: number[] } {
  if (!peaks.length || !duration) return { bpm: 0, beats: [] };
  const th = 0.55; const times: number[] = [];
  for (let i = 1; i < peaks.length - 1; i++) {
    if (peaks[i] > th && peaks[i] >= peaks[i - 1] && peaks[i] > peaks[i + 1]) times.push((i / peaks.length) * duration);
  }
  if (times.length < 2) return { bpm: 0, beats: times };
  const gaps = times.slice(1).map((t, i) => t - times[i]).filter((g) => g > 0.2 && g < 2);
  const avg = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
  return { bpm: avg ? Math.round(60 / avg) : 0, beats: times };
}
