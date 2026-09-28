import { create } from 'zustand';
import type { Asset, Clip, Project, Track } from '../types';
export const uid = () => Math.random().toString(36).slice(2, 10);
export function defaultProject(): Project {
  return {
    id: uid(), name: 'Untitled Project',
    settings: { width: 960, height: 540, fps: 30, duration: 0, background: '#000' },
    tracks: [
      { id: 'v2', type: 'overlay', name: 'V2 Overlay', locked: false, muted: false, visible: true, clips: [] },
      { id: 'v1', type: 'video', name: 'V1 Base', locked: false, muted: false, visible: true, clips: [] },
      { id: 't1', type: 'text', name: 'Text', locked: false, muted: false, visible: true, clips: [] },
      { id: 'a1', type: 'audio', name: 'Music', locked: false, muted: false, visible: true, clips: [] },
    ],
    markers: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}
interface Cmd { label: string; before: string; after: string; at: number; }
interface EditorState {
  project: Project; assets: Asset[];
  selected: { trackId: string; clipId: string } | null;
  currentTime: number; playing: boolean; zoom: number; aspect: '16:9' | '9:16' | '1:1';
  previewQuality: 'Full' | 'Half' | 'Quarter'; copyBuf: string | null;
  rate: number; loop: boolean; snap: boolean;
  undoStack: Cmd[]; redoStack: Cmd[];
  set: (p: Partial<EditorState>) => void;
  commit: (label: string, fn: (p: Project) => Project) => void;
  undo: () => void; redo: () => void;
  addAsset: (a: Asset) => void;
}
const stripForHistory = (p: Project) => JSON.stringify(p);
export const useEditor = create<EditorState>((set, get) => ({
  project: defaultProject(), assets: [], selected: null,
  currentTime: 0, playing: false, zoom: 70, aspect: '16:9',
  previewQuality: 'Full', copyBuf: null,
  rate: 1, loop: false, snap: true,
  undoStack: [], redoStack: [],
  set: (p) => set(p),
  commit: (label, fn) => {
    const { project, undoStack } = get();
    const before = stripForHistory(project);
    const after = stripForHistory(fn(structuredClone(project)));
    if (before === after) return;
    const now = Date.now();
    const last = undoStack[undoStack.length - 1];
    const next = JSON.parse(after) as Project;
    next.updatedAt = new Date().toISOString();
    if (last && last.label === label && now - last.at < 1500) {
      set({ undoStack: [...undoStack.slice(0, -1), { ...last, after }], redoStack: [] });
    } else {
      set({ undoStack: [...undoStack.slice(-59), { label, before, after, at: now }], redoStack: [] });
    }
    set({ project: next });
    queueAutosave(next);
  },
  undo: () => {
    const { undoStack, redoStack, project } = get();
    const c = undoStack[undoStack.length - 1]; if (!c) return;
    set({ undoStack: undoStack.slice(0, -1), redoStack: [...redoStack, { ...c, before: stripForHistory(project), after: stripForHistory(project) }], project: JSON.parse(c.before), selected: null });
  },
  redo: () => {
    const { redoStack, undoStack } = get();
    const c = redoStack[redoStack.length - 1]; if (!c) return;
    set({ redoStack: redoStack.slice(0, -1), undoStack: [...undoStack, c], project: JSON.parse(c.after) });
  },
  addAsset: (a) => set({ assets: [...get().assets, a] }),
}));
let saveT: number | undefined;
export function queueAutosave(p: Project) {
  window.clearTimeout(saveT);
  saveT = window.setTimeout(() => {
    try { localStorage.setItem('cutforge-autosave', JSON.stringify(p)); } catch { /* quota */ }
  }, 800);
}
/** Unlimited tracks: ids are prefix-based — v* video, a* audio, t* text. */
export const isVideoTrack = (id: string) => id[0] === 'v';
export const isAudioTrack = (id: string) => id[0] === 'a';
export const isTextTrack = (id: string) => id[0] === 't';
export const videoTracks = (p: Project) => p.tracks.filter((t) => isVideoTrack(t.id));
export const audioTracks = (p: Project) => p.tracks.filter((t) => isAudioTrack(t.id));
export const textTracks = (p: Project) => p.tracks.filter((t) => isTextTrack(t.id));
export const firstVideoTrack = (p: Project) =>
  p.tracks.find((t) => t.id === 'v1') ?? videoTracks(p)[0] ?? p.tracks[0];
export const firstAudioTrack = (p: Project) =>
  p.tracks.find((t) => t.id === 'a1') ?? audioTracks(p)[0] ?? p.tracks[0];
export const firstTextTrack = (p: Project) =>
  p.tracks.find((t) => t.id === 't1') ?? textTracks(p)[0] ?? p.tracks[0];
export function nextTrackId(p: Project, prefix: 'v' | 'a' | 't'): string {
  let n = 1;
  const taken = new Set(p.tracks.map((t) => t.id));
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
/** CapCut-style: any v* takes video, any a* takes audio, any t* takes text. Overlays/stickers flexible. */
export function acceptsDrop(clipType: string, trackId: string): boolean {
  if (isVideoTrack(trackId)) return ['video', 'image', 'compound', 'adjustment', 'shape', 'sticker'].includes(clipType);
  if (isAudioTrack(trackId)) return clipType === 'audio';
  if (isTextTrack(trackId)) return ['text', 'caption', 'sticker', 'shape'].includes(clipType);
  return true;
}
export const totalDuration = (p: Project) =>
  p.tracks.reduce((m, t) => t.clips.reduce((m2, c) => Math.max(m2, c.startTime + c.duration), m), 0);
export const findClip = (p: Project, trackId: string, clipId: string): Clip | undefined =>
  p.tracks.find((t) => t.id === trackId)?.clips.find((c) => c.id === clipId);

/** Pro timecode HH:MM:SS:FF at project fps */
export function timecode(t: number, fps: number): string {
  const totalF = Math.max(0, Math.round(t * fps));
  const f = totalF % fps;
  const s = Math.floor(totalF / fps) % 60;
  const m = Math.floor(totalF / (fps * 60)) % 60;
  const h = Math.floor(totalF / (fps * 3600));
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(m)}:${p2(s)}:${p2(f)}`;
}
/** All edit points (clip edges + markers) sorted — for Up/Down navigation */
export function editPoints(p: Project): number[] {
  const pts = new Set<number>([0]);
  for (const t of p.tracks) for (const c of t.clips) { pts.add(c.startTime); pts.add(c.startTime + c.duration); }
  for (const m of p.markers) pts.add(m.time);
  return [...pts].sort((a, b) => a - b);
}
export type { Track };
