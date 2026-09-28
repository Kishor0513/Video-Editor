import type { Clip, Project } from '../types';
import { timeToFrame, frameToTime } from '../types';

export const MIN_DUR = 0.1;
export const SNAP_PX = 6;

export const quantize = (t: number, fps: number) => frameToTime(timeToFrame(t, fps), fps);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface SnapGuide { time: number; kind: 'playhead' | 'edge' | 'marker' | 'zero'; }

export function collectSnapTimes(p: Project, ...ignoreIds: string[]): SnapGuide[] {
  const ignore = new Set(ignoreIds);
  const out: SnapGuide[] = [{ time: 0, kind: 'zero' }];
  for (const t of p.tracks)
    for (const c of t.clips) {
      if (ignore.has(c.id)) continue;
      out.push({ time: c.startTime, kind: 'edge' });
      out.push({ time: c.startTime + c.duration, kind: 'edge' });
    }
  for (const m of p.markers) out.push({ time: m.time, kind: 'marker' });
  return out;
}

export function snapTime(raw: number, guides: SnapGuide[], playhead: number, pxPerSec: number): { time: number; snapped: boolean } {
  const cands: SnapGuide[] = [...guides, { time: playhead, kind: 'playhead' }];
  const tol = SNAP_PX / Math.max(1, pxPerSec);
  let best: SnapGuide | null = null;
  for (const g of cands) {
    if (Math.abs(g.time - raw) <= tol && (!best || Math.abs(g.time - raw) < Math.abs(best.time - raw))) best = g;
  }
  return best ? { time: Math.max(0, best.time), snapped: true } : { time: Math.max(0, raw), snapped: false };
}

export function splitClipAt(c: Clip, t: number, fps: number, mkId: () => string): [Clip, Clip] | null {
  const cut = quantize(t - c.startTime, fps);
  if (cut <= 0.05 || cut >= c.duration - 0.05) return null;
  const rate = Math.abs(c.speed ?? 1);
  const left: Clip = { ...c, duration: cut };
  const right: Clip = {
    ...structuredClone(c), id: mkId(), startTime: c.startTime + cut,
    duration: c.duration - cut, sourceStart: (c.sourceStart ?? 0) + cut * rate,
  };
  return [left, right];
}

export function trimClipEdge(c: Clip, edge: 'left' | 'right', to: number, fps: number): Clip {
  const t = quantize(to, fps);
  const rate = Math.abs(c.speed ?? 1);
  if (edge === 'right') return { ...c, duration: Math.max(MIN_DUR, quantize(t - c.startTime, fps)) };
  const ns = clamp(t, 0, c.startTime + c.duration - MIN_DUR);
  const d = ns - c.startTime;
  return { ...c, startTime: ns, duration: c.duration - d, sourceStart: Math.max(0, (c.sourceStart ?? 0) + d * rate) };
}

export function moveClip(c: Clip, to: number, fps: number): Clip {
  return { ...c, startTime: Math.max(0, quantize(to, fps)) };
}

export function overlaps(aStart: number, aDur: number, bStart: number, bDur: number): boolean {
  return aStart < bStart + bDur && bStart < aStart + aDur;
}

export function resolveOverlap(clips: Clip[], moved: Clip): Clip[] {
  return clips.map((c) => {
    if (c.id === moved.id) return moved;
    if (!overlaps(moved.startTime, moved.duration, c.startTime, c.duration)) return c;
    const pushTo = c.startTime + c.duration;
    return { ...moved, startTime: pushTo };
  });
}

export function rippleCloseGaps(clips: Clip[]): Clip[] {
  const sorted = [...clips].sort((a, b) => a.startTime - b.startTime);
  let cursor = 0;
  return sorted.map((c) => {
    const nc = { ...c, startTime: cursor };
    cursor += c.duration;
    return nc;
  });
}

export function detectSilence(peaks: number[], duration: number, threshold = 0.08, minLen = 0.4): [number, number][] {
  if (!peaks.length || !duration) return [];
  const out: [number, number][] = [];
  let s = -1;
  for (let i = 0; i <= peaks.length; i++) {
    const quiet = i < peaks.length ? peaks[i] < threshold : false;
    if (quiet && s < 0) s = i;
    if (!quiet && s >= 0) {
      const t0 = (s / peaks.length) * duration, t1 = (i / peaks.length) * duration;
      if (t1 - t0 >= minLen) out.push([t0, t1]);
      s = -1;
    }
  }
  return out;
}

export function removeRanges(c: Clip, ranges: [number, number][], fps: number, mkId: () => string): Clip[] {
  const local = ranges
    .map(([a, b]) => [Math.max(0, a - c.startTime), Math.min(c.duration, b - c.startTime)] as [number, number])
    .filter(([a, b]) => b - a > 0.05 && a < c.duration && b > 0);
  if (!local.length) return [c];
  const cuts = new Set<number>();
  for (const [a, b] of local) { cuts.add(quantize(a, fps)); cuts.add(quantize(b, fps)); }
  const bounds = [0, ...[...cuts].filter((x) => x > 0.02 && x < c.duration - 0.02).sort((x, y) => x - y), c.duration];
  const segs: Clip[] = [];
  const rate = Math.abs(c.speed ?? 1);
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i], b = bounds[i + 1];
    if (b - a < 0.05) continue;
    if (local.some(([ra, rb]) => a >= ra - 1e-6 && b <= rb + 1e-6)) continue;
    segs.push({
      ...structuredClone(c), id: i === 0 ? c.id : mkId(),
      startTime: c.startTime + a, duration: b - a,
      sourceStart: (c.sourceStart ?? 0) + a * rate,
    });
  }
  return segs.length ? segs : [];
}
