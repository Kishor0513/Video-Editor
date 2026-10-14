import { describe, expect, it } from 'vitest';
import { exportSize, estimateBytes, activeClips } from './compositor';
import { pickWebMMime } from './export';
import type { Project } from '../types';

const empty: Project = {
  id: 'p', name: 't',
  settings: { width: 960, height: 540, fps: 30, duration: 0, background: '#000' },
  tracks: [{ id: 'v1', type: 'video', name: 'V1', locked: false, muted: false, visible: true, clips: [] }],
  markers: [], createdAt: '', updatedAt: '',
};

describe('export smoke', () => {
  it('sizes 720p/4K across aspects', () => {
    expect(exportSize('720p', '16:9')).toEqual({ w: 1280, h: 720 });
    expect(exportSize('720p', '9:16').h).toBe(720);
    expect(exportSize('4K', '16:9').h).toBe(2160);
  });
  it('estimateBytes scales with time', () => {
    expect(estimateBytes('720p', 10)).toBeGreaterThan(estimateBytes('480p', 10));
    expect(estimateBytes('720p', 0)).toBe(0);
  });
  it('activeClips empty when no clips', () => {
    expect(activeClips(empty, 'v1', 5)).toEqual([]);
  });
  it('pickWebMMime returns string (no DOM throw)', () => {
    expect(typeof pickWebMMime()).toBe('string');
  });
});
