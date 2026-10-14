// Templates: data-driven placeholders -> timeline generation. Real.
import type { Project } from '../types';
import { uid } from '../state/projectStore';

export interface Template { name: string; aspect: '16:9' | '9:16' | '1:1'; slots: string[]; build: (p: Project, assetIds: string[]) => void; }

function v1of(p: Project) {
  return p.tracks.find((t) => t.id === 'v1') ?? p.tracks.find((t) => t.id[0] === 'v') ?? p.tracks[0];
}
function t1of(p: Project) {
  return p.tracks.find((t) => t.id === 't1') ?? p.tracks.find((t) => t.id[0] === 't') ?? p.tracks[0];
}
function a1of(p: Project) {
  return p.tracks.find((t) => t.id === 'a1') ?? p.tracks.find((t) => t.id[0] === 'a') ?? p.tracks[0];
}
const base = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1 } as const;

export const templates: Template[] = [
  {
    name: 'Travel Reel (9:16)', aspect: '9:16', slots: ['video_1', 'video_2', 'title'],
    build(p, [v1, v2]) {
      const t1 = v1of(p);
      t1.clips.push({ id: uid(), assetId: v1, type: 'video', startTime: 0, duration: 5, sourceStart: 0, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, volume: 1, speed: 1, trackId: t1.id, transitionIn: { type: 'fade', duration: 0.5 } });
      if (v2) t1.clips.push({ id: uid(), assetId: v2, type: 'video', startTime: 5, duration: 5, sourceStart: 0, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, volume: 1, speed: 1, trackId: t1.id, transitionIn: { type: 'wipe', duration: 0.5 } });
    },
  },
  {
    name: 'Velocity Beat Cut (9:16)', aspect: '9:16', slots: ['video_1', 'video_2', 'music'],
    build(p, [v1, v2]) {
      const vt = v1of(p); const tt = t1of(p);
      const cuts = [0, 1.2, 2.1, 3.4, 4.6, 6.0, 7.5];
      cuts.forEach((s, i) => {
        const id = i % 2 === 0 ? v1 : (v2 ?? v1);
        if (!id) return;
        vt.clips.push({ id: uid(), assetId: id, type: 'video', startTime: s, duration: (cuts[i + 1] ?? s + 1.5) - s, sourceStart: i * 0.8, ...base, volume: 1, speed: i % 3 === 1 ? 1.5 : 1, trackId: vt.id, transitionIn: { type: i % 2 ? 'zoom' : 'glitch', duration: 0.3 } });
      });
      tt.clips.push({ id: uid(), type: 'text', text: 'BEAT DROP 🔥', fontSize: 84, color: '#fff', stroke: '#000', strokeW: 8, shadow: 8, textAlign: 'center', startTime: 3.4, duration: 1.2, position: { x: 0.5, y: 0.35 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: tt.id, anim: 'pop' });
    },
  },
  {
    name: 'Talking Head + Captions (16:9)', aspect: '16:9', slots: ['video_1', 'title'],
    build(p, [v1]) {
      const vt = v1of(p); const tt = t1of(p);
      if (v1) vt.clips.push({ id: uid(), assetId: v1, type: 'video', startTime: 0, duration: 12, sourceStart: 0, ...base, volume: 1, speed: 1, trackId: vt.id });
      const words = ['Hook', 'in', '3', 'seconds', '—', 'watch', 'this'];
      words.forEach((w, i) => {
        tt.clips.push({ id: uid(), type: 'caption', text: w, fontSize: 64, color: '#fff', stroke: '#000', strokeW: 7, shadow: 6, textAlign: 'center', startTime: i * 0.4, duration: 0.4, position: { x: 0.5, y: 0.78 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: tt.id, anim: 'pop' });
      });
      tt.clips.push({ id: uid(), type: 'text', text: 'SUBSCRIBE', fontSize: 44, color: '#ffe45e', textAlign: 'center', startTime: 10, duration: 2, position: { x: 0.5, y: 0.15 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: tt.id, anim: 'fade' });
    },
  },
  {
    name: 'Product Showcase (1:1)', aspect: '1:1', slots: ['video_1', 'image_1'],
    build(p, [v1, v2]) {
      const vt = v1of(p); const tt = t1of(p);
      if (v1) vt.clips.push({ id: uid(), assetId: v1, type: 'video', startTime: 0, duration: 4, sourceStart: 0, ...base, volume: 0.8, speed: 0.75, trackId: vt.id, transitionIn: { type: 'crosszoom', duration: 0.5 }, filters: { br: 105, ct: 115, st: 130, gr: 0, sp: 0, bl: 0 } });
      if (v2) vt.clips.push({ id: uid(), assetId: v2, type: 'image', startTime: 4, duration: 3, ...base, trackId: vt.id, transitionIn: { type: 'swipe', duration: 0.4 } });
      tt.clips.push({ id: uid(), type: 'text', text: 'NEW DROP ✨', fontSize: 72, color: '#fff', stroke: '#000', strokeW: 6, shadow: 8, textAlign: 'center', startTime: 0.5, duration: 2, position: { x: 0.5, y: 0.25 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: tt.id, anim: 'slide' });
      tt.clips.push({ id: uid(), type: 'text', text: 'Shop now →', fontSize: 48, color: '#5eead4', textAlign: 'center', startTime: 4.2, duration: 2.5, position: { x: 0.5, y: 0.8 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: tt.id, anim: 'fade' });
    },
  },
  {
    name: 'Cinematic Travel (16:9)', aspect: '16:9', slots: ['video_1', 'video_2', 'video_3'],
    build(p, [v1, v2, v3]) {
      const vt = v1of(p); const tt = t1of(p);
      [v1, v2, v3].forEach((id, i) => {
        if (!id) return;
        vt.clips.push({ id: uid(), assetId: id, type: 'video', startTime: i * 4, duration: 4, sourceStart: 0, ...base, volume: 0.7, speed: 0.9, trackId: vt.id, transitionIn: { type: i === 0 ? 'fade' : 'dissolve', duration: 0.8 }, filters: { br: 96, ct: 125, st: 115, gr: 5, sp: 5, bl: 0 } });
      });
      tt.clips.push({ id: uid(), type: 'text', text: 'Wanderlust', fontSize: 88, color: '#fff', stroke: '#000', strokeW: 4, shadow: 10, textAlign: 'center', startTime: 1, duration: 3, position: { x: 0.5, y: 0.5 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: tt.id, anim: 'fade' });
    },
  },
  {
    name: 'Fitness Transformation (9:16)', aspect: '9:16', slots: ['video_before', 'video_after'],
    build(p, [v1, v2]) {
      const vt = v1of(p); const tt = t1of(p);
      if (v1) vt.clips.push({ id: uid(), assetId: v1, type: 'video', startTime: 0, duration: 3, sourceStart: 0, ...base, volume: 1, speed: 1, trackId: vt.id, filters: { br: 95, ct: 110, st: 90, gr: 10, sp: 0, bl: 0 } });
      if (v2) vt.clips.push({ id: uid(), assetId: v2, type: 'video', startTime: 3, duration: 4, sourceStart: 0, ...base, volume: 1, speed: 1, trackId: vt.id, transitionIn: { type: 'flash', duration: 0.3 }, filters: { br: 105, ct: 120, st: 140, gr: 0, sp: 0, bl: 0 } });
      tt.clips.push({ id: uid(), type: 'text', text: 'DAY 1', fontSize: 60, color: '#fff', textAlign: 'center', startTime: 0.5, duration: 2, position: { x: 0.5, y: 0.2 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: tt.id, anim: 'fade' });
      tt.clips.push({ id: uid(), type: 'text', text: 'DAY 90 💪', fontSize: 72, color: '#ffe45e', stroke: '#000', strokeW: 6, shadow: 8, textAlign: 'center', startTime: 3.5, duration: 2.5, position: { x: 0.5, y: 0.2 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: tt.id, anim: 'pop' });
    },
  },
  {
    name: 'Podcast Clip (1:1)', aspect: '1:1', slots: ['video_1'],
    build(p, [v1]) {
      const vt = v1of(p); const tt = t1of(p); const au = a1of(p);
      if (v1) {
        vt.clips.push({ id: uid(), assetId: v1, type: 'video', startTime: 0, duration: 15, sourceStart: 0, ...base, volume: 1, speed: 1, trackId: vt.id, crop: { x: 0.15, y: 0, w: 0.7, h: 1 } });
        au.clips.push({ id: uid(), assetId: v1, type: 'audio', startTime: 0, duration: 15, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, volume: 0.9, trackId: au.id, audioFX: { eqLow: -2, eqMid: 3, eqHigh: 2, comp: 12, reverb: 0, denoise: 8 } });
      }
      tt.clips.push({ id: uid(), type: 'caption', text: 'Best moment 👇', fontSize: 52, color: '#5eead4', textAlign: 'center', startTime: 0.5, duration: 3, position: { x: 0.5, y: 0.12 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: tt.id, anim: 'fade' });
    },
  },
  {
    name: 'Unboxing (16:9)', aspect: '16:9', slots: ['video_1', 'video_2'],
    build(p, [v1, v2]) {
      const vt = v1of(p); const tt = t1of(p);
      if (v1) vt.clips.push({ id: uid(), assetId: v1, type: 'video', startTime: 0, duration: 6, sourceStart: 0, ...base, volume: 1, speed: 1, trackId: vt.id, transitionIn: { type: 'fade', duration: 0.4 } });
      if (v2) vt.clips.push({ id: uid(), assetId: v2, type: 'video', startTime: 6, duration: 5, sourceStart: 0, ...base, volume: 1, speed: 1.1, trackId: vt.id, transitionIn: { type: 'spin', duration: 0.5 } });
      tt.clips.push({ id: uid(), type: 'text', text: 'UNBOXING 📦', fontSize: 76, color: '#fff', stroke: '#000', strokeW: 7, shadow: 8, textAlign: 'center', startTime: 0.5, duration: 2, position: { x: 0.5, y: 0.2 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: tt.id, anim: 'bounce' });
    },
  },
  {
    name: 'Lyric / Karaoke (9:16)', aspect: '9:16', slots: ['music'],
    build(p, _ids) {
      void _ids;
      const tt = t1of(p);
      const lines = ['Midnight', 'city', 'lights', 'never', 'sleep'];
      lines.forEach((w, i) => {
        tt.clips.push({ id: uid(), type: 'caption', text: w, fontSize: 72, color: '#ffe45e', stroke: '#000', strokeW: 8, shadow: 10, textAlign: 'center', startTime: i * 0.8, duration: 0.8, position: { x: 0.5, y: 0.5 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: tt.id, anim: 'pop' });
      });
    },
  },
  {
    name: 'Tutorial Intro (16:9)', aspect: '16:9', slots: ['video_1', 'title'],
    build(p, [v1]) {
      const vt = v1of(p); const tt = t1of(p);
      if (v1) vt.clips.push({ id: uid(), assetId: v1, type: 'video', startTime: 2, duration: 10, sourceStart: 0, ...base, volume: 1, speed: 1, trackId: vt.id, transitionIn: { type: 'swipe', duration: 0.5 } });
      tt.clips.push({ id: uid(), type: 'text', text: 'HOW TO ... in 60s', fontSize: 68, color: '#fff', stroke: '#000', strokeW: 6, shadow: 8, textAlign: 'center', startTime: 0, duration: 2, position: { x: 0.5, y: 0.4 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: tt.id, anim: 'typewriter' });
      tt.clips.push({ id: uid(), type: 'text', text: 'Step 1 • Step 2 • Step 3', fontSize: 40, color: '#5eead4', textAlign: 'center', startTime: 2.2, duration: 3, position: { x: 0.5, y: 0.85 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: tt.id, anim: 'slide' });
    },
  },
];
