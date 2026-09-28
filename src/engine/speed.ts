// Speed curves: time-remap presets -> effective playback rate at local time.
export type SpeedPreset = 'Montage' | 'Bullet' | 'Jump Cut' | 'Hero' | 'Flash In' | 'Flash Out' | 'Custom';
export function speedAt(preset: SpeedPreset | undefined, lt: number, dur: number, base: number): number {
  if (!preset || preset === 'Custom') return base;
  const p = lt / Math.max(1e-3, dur);
  switch (preset) {
    case 'Montage': return base * (0.5 + p);
    case 'Bullet': return base * (p < 0.4 || p > 0.6 ? 0.25 : 2);
    case 'Jump Cut': return base * (p % 0.25 < 0.02 ? 3 : 1);
    case 'Hero': return base * (1 + Math.sin(p * Math.PI) * 1.5);
    case 'Flash In': return base * (2 - p);
    case 'Flash Out': return base * (0.5 + p * 1.5);
    default: return base;
  }
}
