import type { FilterState } from '../types';
export interface ColorControls { exposure: number; brightness: number; contrast: number; saturation: number; temperature: number; tint: number; }
// Real mapping onto canvas filter + tint overlay values.
export function colorToFilter(c: ColorControls): FilterState {
  return {
    br: Math.round(100 + c.exposure * 30 + c.brightness),
    ct: Math.round(100 + c.contrast),
    st: Math.round(100 + c.saturation),
    gr: 0, sp: Math.max(0, Math.round(c.temperature / 2)), bl: 0,
  };
}
export function tintOverlay(c: ColorControls): string | null {
  if (c.temperature > 0) return `rgba(255,150,50,${Math.min(0.25, c.temperature / 400)})`;
  if (c.temperature < 0) return `rgba(80,150,255,${Math.min(0.25, -c.temperature / 400)})`;
  if (c.tint !== 0) return `rgba(150,255,150,${Math.min(0.15, Math.abs(c.tint) / 500)})`;
  return null;
}
