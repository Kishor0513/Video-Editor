import { applyFX, flatFX } from './audioFX';
import { speedAt } from './speed';
import { keyframedValue } from './renderer';
import type { Clip } from '../types';
// Per-clip element pool (never in React state; avoids huge blobs in store).
const pool = new Map<string, HTMLVideoElement | HTMLImageElement>();
let proxyMode = false;
export function setProxyMode(on: boolean) {
  if (on === proxyMode) return;
  proxyMode = on;
  for (const k of [...pool.keys()]) dropElement(k);
}
export function getProxyMode() { return proxyMode; }
export function elementFor(clipId: string, kind: string, url: string): HTMLVideoElement | HTMLImageElement {
  const hit = pool.get(clipId); if (hit) return hit;
  if (kind === 'image') { const im = new Image(); im.src = url; pool.set(clipId, im); return im; }
  const v = document.createElement('video') as HTMLVideoElement;
  v.src = url; v.preload = 'auto'; (v as HTMLVideoElement).playsInline = true;
  pool.set(clipId, v); return v;
}
export function dropElement(clipId: string) {
  const el = pool.get(clipId);
  if (el instanceof HTMLVideoElement || el instanceof HTMLAudioElement) { try { el.pause(); } catch { /* noop */ } }
  pool.delete(clipId);
}
export function fadeMul(lt: number, dur: number, fadeIn?: number, fadeOut?: number): number {
  let m = 1;
  if ((fadeIn ?? 0) > 0) m *= Math.max(0, Math.min(1, lt / fadeIn!));
  if ((fadeOut ?? 0) > 0) m *= Math.max(0, Math.min(1, (dur - lt) / fadeOut!));
  return m;
}
function flatten(project: import('../types').Project): { c: Clip; muted: boolean; offset: number }[] {
  const out: { c: Clip; muted: boolean; offset: number }[] = [];
  for (const tr of project.tracks)
    for (const c of tr.clips) {
      if (c.sub?.length) for (const s of c.sub) out.push({ c: s, muted: tr.muted, offset: c.startTime + s.startTime });
      else out.push({ c, muted: tr.muted, offset: c.startTime });
    }
  return out;
}
function seekEl(el: HTMLVideoElement, to: number) {
  try {
    const safe = Math.max(0, to);
    if (Math.abs(el.currentTime - safe) < 0.02) return;
    const fast = (el as HTMLVideoElement & { fastSeek?: (t: number) => void }).fastSeek;
    if (typeof fast === 'function') { try { fast.call(el, safe); return; } catch { /* fallthrough */ } }
    el.currentTime = safe;
  } catch { /* noop */ }
}

export function syncPool(project: import('../types').Project, assets: import('../types').Asset[], t: number, playing: boolean, globalRate = 1) {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const alive = new Set<string>();
  for (const { c, muted, offset } of flatten(project)) {
    if (c.type !== 'video' && c.type !== 'audio' && c.type !== 'image') continue;
    const a = c.assetId ? byId.get(c.assetId) : undefined; if (!a) continue;
    alive.add(c.id);
    const el = elementFor(c.id, a.kind, proxyMode && a.proxyUrl ? a.proxyUrl : a.url);
    if (el instanceof HTMLImageElement) continue;
    const dur = c.duration;
    const active = !muted && t >= offset && t < offset + dur;
    const lt = Math.max(0, t - offset);
    const signed = c.speed ?? 1;
    const rate = speedAt(c.speedCurve, lt, c.duration, Math.abs(signed));
    const rev = signed < 0;
    const kfVol = keyframedValue(c, 'volume', lt, c.volume ?? 1);
    // shuttle (|rate| != 1): mute to avoid chipmunk audio, video driven by seeks
    const shuttle = globalRate !== 1;
    // auto-duck: music clips duck while any voice/text-active clip plays
    let duck = 1;
    if (c.ducking && !muted) {
      const voiceActive = flatten(project).some((o) => o.c.id !== c.id && (o.c.type === 'audio' || o.c.type === 'video') && !o.muted && t >= o.offset && t < o.offset + o.c.duration && (o.c.ducking ?? false) === false && o.c.id !== c.id && isVoiceClip(o.c));
      if (voiceActive) duck = 0.25;
    }
    applyFX(el, rev || (shuttle && playing) ? 0 : kfVol * duck * fadeMul(lt, dur, c.fadeIn, c.fadeOut), c.pan ?? 0, c.audioFX ?? flatFX);
    try { el.playbackRate = Math.max(0.1, Math.min(8, rate * Math.pow(2, (c.pitch ?? 0) / 12) * (shuttle ? 1 : 1))); } catch { /* noop */ }
    const out = (c.sourceStart ?? 0) + c.duration * Math.abs(c.speed ?? 1);
    const exp = rev ? Math.max(0, out - lt * Math.abs(c.speed ?? 1)) : (c.sourceStart ?? 0) + lt * Math.abs(c.speed ?? 1);
    const drift = Math.abs((el.currentTime || 0) - exp);
    if (rev) {
      if (!el.paused) { try { el.pause(); } catch { /* noop */ } }
      // paused reverse: only seek when clearly off to avoid flash loop
      if (active && drift > 0.45 && !el.seeking) seekEl(el, exp);
      continue;
    }
    // shuttle mode: canvas clock drives, keep video paused + seek (works fwd + backward)
    if (playing && active && globalRate !== 1) {
      if (!el.paused) { try { el.pause(); } catch { /* noop */ } }
      if (drift > 0.12 && !el.seeking) seekEl(el, exp);
    } else if (playing && active) {
      if (el.paused) {
        // resume: seek first only if far off, otherwise play from current to avoid black flash
        if (drift > 0.45 && !el.seeking) seekEl(el, exp);
        el.play().catch(() => undefined);
      } else if (drift > 0.6 && !el.seeking) {
        // correct long drift while playing, ignore micro drift (video clock runs itself)
        seekEl(el, exp);
      }
    } else {
      if (!el.paused) { try { el.pause(); } catch { /* noop */ } }
      // paused: seek only on large jumps (scrub / pause flush). No per-frame nudging = no flash.
      if (active && drift > 0.45 && !el.seeking) seekEl(el, exp);
    }
  }
  for (const k of [...pool.keys()]) if (!alive.has(k)) dropElement(k);
}
export function poolGet(id: string) { return pool.get(id); }

/** Voice = audio clip whose asset name suggests speech, or any non-music audio without ducking flag. */
function isVoiceClip(c: Clip): boolean {
  const name = (c.text ?? '').toLowerCase();
  return /voice|speech|narration|dialog|talk|podcast|interview/.test(name) || c.type === 'audio';
}
