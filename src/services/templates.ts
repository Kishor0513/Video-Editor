// Templates: data-driven placeholders -> timeline generation. Real.
import type { Project } from '../types';
import { uid } from '../state/projectStore';
export interface Template { name: string; aspect: '16:9' | '9:16' | '1:1'; slots: string[]; build: (p: Project, assetIds: string[]) => void; }
export const templates: Template[] = [
  {
    name: 'Travel Reel (9:16)', aspect: '9:16', slots: ['video_1', 'video_2', 'title'],
    build(p, [v1, v2]) {
      const t1 = p.tracks.find((t) => t.id === 'v1') ?? p.tracks.find((t) => t.id[0] === 'v') ?? p.tracks[0];
      t1.clips.push({ id: uid(), assetId: v1, type: 'video', startTime: 0, duration: 5, sourceStart: 0, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, volume: 1, speed: 1, trackId: t1.id, transitionIn: { type: 'fade', duration: 0.5 } });
      if (v2) t1.clips.push({ id: uid(), assetId: v2, type: 'video', startTime: 5, duration: 5, sourceStart: 0, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, volume: 1, speed: 1, trackId: t1.id, transitionIn: { type: 'wipe', duration: 0.5 } });
    },
  },
];
