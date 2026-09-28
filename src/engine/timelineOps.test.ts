import { describe, expect, it } from 'vitest';
import {
  collectSnapTimes, detectSilence, moveClip, overlaps, quantize, removeRanges, resolveOverlap,
  rippleCloseGaps, snapTime, splitClipAt, trimClipEdge,
} from './timelineOps';
import type { Clip, Project } from '../types';

const mkClip = (over: Partial<Clip> = {}): Clip => ({
  id: Math.random().toString(36).slice(2), type: 'video', trackId: 'v1',
  startTime: 0, duration: 4, sourceStart: 0,
  position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, ...over,
});
const mkProject = (clips: Clip[]): Project => ({
  id: 'p', name: 't', settings: { width: 960, height: 540, fps: 30, duration: 0, background: '#000' },
  tracks: [{ id: 'v1', type: 'video', name: 'V1', locked: false, muted: false, visible: true, clips }],
  markers: [], createdAt: '', updatedAt: '',
});

describe('frame math', () => {
  it('quantizes to frame boundaries at 30fps', () => {
    expect(quantize(1, 30)).toBeCloseTo(1);
    expect(quantize(0.0333333, 30)).toBeCloseTo(1 / 30);
  });
});

describe('splitClipAt', () => {
  it('splits with sourceStart compensation', () => {
    const c = mkClip({ startTime: 2, duration: 4, sourceStart: 1, speed: 1 });
    const pair = splitClipAt(c, 4, 30, () => 'r');
    expect(pair).not.toBeNull();
    const [l, r] = pair!;
    expect(l.duration).toBeCloseTo(2);
    expect(r.startTime).toBeCloseTo(4);
    expect(r.duration).toBeCloseTo(2);
    expect(r.sourceStart).toBeCloseTo(3);
  });
  it('rejects cuts too close to edges', () => {
    const c = mkClip({ duration: 4 });
    expect(splitClipAt(c, 0.01, 30, () => 'r')).toBeNull();
    expect(splitClipAt(c, 3.99, 30, () => 'r')).toBeNull();
  });
});

describe('trimClipEdge', () => {
  it('trims right edge', () => {
    expect(trimClipEdge(mkClip({ duration: 4 }), 'right', 2.5, 30).duration).toBeCloseTo(2.5);
  });
  it('trims left edge and advances sourceStart', () => {
    const t = trimClipEdge(mkClip({ startTime: 2, duration: 4, sourceStart: 1 }), 'left', 3, 30);
    expect(t.startTime).toBeCloseTo(3);
    expect(t.duration).toBeCloseTo(3);
    expect(t.sourceStart).toBeCloseTo(2);
  });
  it('enforces minimum duration', () => {
    expect(trimClipEdge(mkClip({ duration: 4 }), 'right', -5, 30).duration).toBeGreaterThanOrEqual(0.1);
  });
});

describe('move + overlap', () => {
  it('clamps to zero and quantizes', () => {
    expect(moveClip(mkClip(), -2, 30).startTime).toBe(0);
  });
  it('detects overlap', () => {
    expect(overlaps(0, 2, 1, 2)).toBe(true);
    expect(overlaps(0, 1, 1, 2)).toBe(false);
  });
  it('pushes moved clip past blocker', () => {
    const a = mkClip({ id: 'a', startTime: 0, duration: 2 });
    const moved = mkClip({ id: 'b', startTime: 1, duration: 2 });
    const out = resolveOverlap([a, moved], moved);
    expect(out.find((c) => c.id === 'b')!.startTime).toBe(2);
  });
});

describe('ripple', () => {
  it('closes gaps in order', () => {
    const out = rippleCloseGaps([mkClip({ startTime: 5, duration: 2 }), mkClip({ startTime: 0, duration: 3 })]);
    expect(out[0].startTime).toBe(0);
    expect(out[1].startTime).toBe(3);
  });
});

describe('snapping', () => {  it('snaps to nearby edge within threshold', () => {
    const p = mkProject([mkClip({ startTime: 0, duration: 4 })]);
    const guides = collectSnapTimes(p, 'other');
    const r = snapTime(4.02, guides, 99, 70);
    expect(r.snapped).toBe(true);
    expect(r.time).toBeCloseTo(4);
  });
  it('ignores distant guides', () => {
    const p = mkProject([mkClip({ startTime: 0, duration: 4 })]);
    expect(snapTime(2, collectSnapTimes(p), 99, 70).snapped).toBe(false);
  });
});

describe('silence removal', () => {
  const peaks = [0.9, 0.8, 0.02, 0.01, 0.03, 0.02, 0.01, 0.9, 0.7, 0.8];
  it('finds quiet runs above min length', () => {
    const r = detectSilence(peaks, 10, 0.08, 0.4);
    expect(r.length).toBe(1);
    expect(r[0][0]).toBeCloseTo(2);
    expect(r[0][1]).toBeCloseTo(7);
  });
  it('returns empty when loud throughout', () => {
    expect(detectSilence([0.9, 0.8, 0.7], 3)).toEqual([]);
  });
  it('cuts silent ranges into kept segments', () => {
    const c = mkClip({ startTime: 0, duration: 10, sourceStart: 0 });
    const segs = removeRanges(c, [[2, 7]], 30, (() => { let i = 0; return () => 'n' + (i++); })());
    expect(segs.length).toBe(2);
    expect(segs[0].duration).toBeCloseTo(2);
    expect(segs[1].startTime).toBeCloseTo(7);
    expect(segs[1].sourceStart).toBeCloseTo(7);
  });
  it('returns empty when everything is silent', () => {
    expect(removeRanges(mkClip({ duration: 4 }), [[0, 4]], 30, () => 'x').length).toBe(0);
  });
});
