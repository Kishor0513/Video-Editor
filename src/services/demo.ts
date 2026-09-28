import { uid } from '../state/projectStore';
import type { Asset, Project } from '../types';
// All bundled assets are license-clean for editing:
// - flower.* (CC0, MDN), bunny.mp4 (Blender CC-BY test clip)
// - thumbs (Unsplash via picsum), cards (original SVG), music/SFX (original synth)
export const DEMO_FILES = [
  { url: '/assets/flower.mp4', name: 'flower.mp4' },
  { url: '/assets/bunny.mp4', name: 'bunny.mp4' },
  { url: '/assets/flower.webm', name: 'flower.webm' },
  { url: '/assets/thumb-mountain.jpg', name: 'thumb-mountain.jpg' },
  { url: '/assets/thumb-city.jpg', name: 'thumb-city.jpg' },
  { url: '/assets/card-subscribe.svg', name: 'card-subscribe.svg' },
  { url: '/assets/card-hook.svg', name: 'card-hook.svg' },
  { url: '/assets/music-upbeat.wav', name: 'music-upbeat.wav' },
  { url: '/assets/music-chill.wav', name: 'music-chill.wav' },
  { url: '/assets/sfx-whoosh.wav', name: 'sfx-whoosh.wav' },
  { url: '/assets/sfx-pop.wav', name: 'sfx-pop.wav' },
];
export async function fetchDemoFile(url: string, name: string): Promise<File> {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Missing asset ' + name);
  return new File([await r.blob()], name);
}
function clip(base: Partial<import('../types').Clip> & { trackId: string }) {
  return {
    id: uid(), position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, ...base,
  } as import('../types').Clip;
}
const pickV = (p: Project, prefer?: string) =>
  p.tracks.find((t) => t.id === prefer) ?? p.tracks.find((t) => t.id[0] === 'v') ?? p.tracks[0];
const pickT = (p: Project) => p.tracks.find((t) => t.id[0] === 't') ?? p.tracks[0];
const pickA = (p: Project) => p.tracks.find((t) => t.id[0] === 'a') ?? p.tracks[0];
export function buildReel(p: Project, byName: (n: string) => Asset | undefined) {
  const v1 = pickV(p, 'v1');
  const t1 = pickT(p);
  const a1 = pickA(p);
  const hook = byName('card-hook.svg'), fl = byName('flower.mp4'), bn = byName('bunny.mp4');
  const up = byName('music-upbeat.wav'), pop = byName('sfx-pop.wav');
  if (hook) v1.clips.push(clip({ assetId: hook.id, type: 'image', startTime: 0, duration: 1.5, trackId: v1.id }));
  if (fl) v1.clips.push(clip({ assetId: fl.id, type: 'video', startTime: 1.5, duration: 4, sourceStart: 0, volume: 0.6, speed: 1, trackId: v1.id, transitionIn: { type: 'wipe', duration: 0.4 }, filters: { br: 105, ct: 112, st: 130, gr: 0, sp: 0, bl: 0 } }));
  if (bn) v1.clips.push(clip({ assetId: bn.id, type: 'video', startTime: 5.5, duration: 4, sourceStart: 1, volume: 0.6, speed: 1.25, trackId: v1.id, transitionIn: { type: 'fade', duration: 0.4 } }));
  t1.clips.push(clip({ type: 'text', text: 'WAIT FOR IT 👀', fontSize: 72, color: '#fff', textAlign: 'center', startTime: 0.2, duration: 1.3, position: { x: 0.5, y: 0.3 }, trackId: t1.id }));
  t1.clips.push(clip({ type: 'caption', text: 'POV: perfect loop', fontSize: 44, color: '#ffe45e', textAlign: 'center', startTime: 2, duration: 2.5, position: { x: 0.5, y: 0.85 }, trackId: t1.id }));
  if (up) a1.clips.push(clip({ assetId: up.id, type: 'audio', startTime: 0, duration: 9.5, volume: 0.5, trackId: a1.id }));
  if (pop) a1.clips.push(clip({ assetId: pop.id, type: 'audio', startTime: 5.5, duration: 0.3, volume: 0.9, trackId: a1.id }));
}
export function buildYoutube(p: Project, byName: (n: string) => Asset | undefined) {
  const vids = p.tracks.filter((t) => t.id[0] === 'v');
  const v1 = pickV(p, 'v1');
  const v2 = vids.find((t) => t.id !== v1.id) ?? v1;
  const t1 = pickT(p);
  const a1 = pickA(p);
  const fl = byName('flower.webm'), bn = byName('bunny.mp4'), th = byName('thumb-mountain.jpg');
  const sub = byName('card-subscribe.svg'), ch = byName('music-chill.wav');
  if (fl) v1.clips.push(clip({ assetId: fl.id, type: 'video', startTime: 0, duration: 5, sourceStart: 0, volume: 1, speed: 1, trackId: v1.id, filters: { br: 100, ct: 100, st: 100, gr: 0, sp: 0, bl: 0 } }));
  if (bn) v1.clips.push(clip({ assetId: bn.id, type: 'video', startTime: 5, duration: 6, sourceStart: 0, volume: 1, speed: 1, trackId: v1.id, transitionIn: { type: 'fade', duration: 0.6 } }));
  if (th) v2.clips.push(clip({ assetId: th.id, type: 'image', startTime: 2, duration: 4, position: { x: 0.25, y: 0.2 }, scale: { x: 0.8, y: 0.8 }, trackId: v2.id }));
  if (sub) v1.clips.push(clip({ assetId: sub.id, type: 'image', startTime: 11, duration: 3, trackId: v1.id, transitionIn: { type: 'slide', duration: 0.5 } }));
  t1.clips.push(clip({ type: 'text', text: 'My Video Title', fontSize: 88, color: '#fff', textAlign: 'center', startTime: 0.3, duration: 2.5, position: { x: 0.5, y: 0.25 }, trackId: t1.id }));
  t1.clips.push(clip({ type: 'caption', text: 'Welcome back to the channel', fontSize: 40, color: '#fff', textAlign: 'center', startTime: 1, duration: 3, position: { x: 0.5, y: 0.88 }, trackId: t1.id }));
  if (ch) a1.clips.push(clip({ assetId: ch.id, type: 'audio', startTime: 0, duration: 14, volume: 0.35, trackId: a1.id }));
}
