import { describe, expect, it } from 'vitest';
import { frameToTime, timeToFrame } from '../types';
import { speedAt } from './speed';
import { keyframedValue } from './renderer';

describe('frame accuracy', () => {
  it.each([24, 25, 30, 50, 60])('round-trips at %ifps', (fps) => {
    expect(frameToTime(timeToFrame(1, fps), fps)).toBeCloseTo(1, 6);
  });
  it('floors partial frames', () => {
    expect(timeToFrame(0.5, 30)).toBe(15);
  });
});

describe('speed presets', () => {
  it('custom returns base rate', () => {
    expect(speedAt('Custom', 1, 4, 2)).toBe(2);
    expect(speedAt(undefined, 1, 4, 2)).toBe(2);
  });
  it('hero peaks mid-clip', () => {
    expect(speedAt('Hero', 2, 4, 1)).toBeGreaterThan(speedAt('Hero', 0.1, 4, 1));
  });
});

describe('keyframe interpolation', () => {
  const clip = {
    id: 'c', type: 'video', trackId: 'v1', startTime: 0, duration: 4,
    position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1,
    keyframes: [
      { id: 'k1', dt: 1, prop: 'opacity', value: 0.5 },
      { id: 'k2', dt: 3, prop: 'opacity', value: 0 },
    ],
  } as Parameters<typeof keyframedValue>[0];
  it('holds base before first keyframe', () => {
    expect(keyframedValue(clip, 'opacity', 0, 1)).toBeCloseTo(1);
  });
  it('interpolates between keyframes', () => {
    expect(keyframedValue(clip, 'opacity', 2, 1)).toBeCloseTo(0.25);
  });
  it('holds last value after final keyframe', () => {
    expect(keyframedValue(clip, 'opacity', 3.5, 1)).toBeCloseTo(0);
  });
});
