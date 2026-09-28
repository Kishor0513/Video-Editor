import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, totalDuration, uid, timecode, editPoints, acceptsDrop, nextTrackId, isAudioTrack } from '../state/projectStore';
import { track } from '../services/analytics';
import { collectSnapTimes, moveClip, resolveOverlap, rippleCloseGaps, snapTime, splitClipAt, trimClipEdge } from '../engine/timelineOps';
import type { Clip, Keyframe } from '../types';

type Sel = { trackId: string; clipId: string };
const sameSel = (a: Sel | null, b: Sel) => !!a && a.trackId === b.trackId && a.clipId === b.clipId;
const KF_PROPS = ['opacity', 'volume', 'rotation', 'cropX'] as const;
const kfBase = (c: Clip, prop: string): number =>
  prop === 'opacity' ? c.opacity : prop === 'volume' ? (c.volume ?? 1) : prop === 'rotation' ? c.rotation : c.crop?.x ?? 0;

export default function Timeline() {
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);
  const currentTime = useEditor((s) => s.currentTime);
  const zoom = useEditor((s) => s.zoom);
  const selected = useEditor((s) => s.selected);
  const snapOn = useEditor((s) => s.snap);
  const set = useEditor((s) => s.set);
  const commit = useEditor((s) => s.commit);
  const [menu, setMenu] = useState<{ x: number; y: number; trackId: string; clipId: string } | null>(null);
  const [multi, setMulti] = useState<Sel[]>([]);
  const [snapX, setSnapX] = useState<number | null>(null);
  const [view, setView] = useState({ left: 0, width: 2000 });
  const [kfProp, setKfProp] = useState<(typeof KF_PROPS)[number]>('opacity');
  const [kfSel, setKfSel] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<null | { mode: 'move' | 'trim-l' | 'trim-r'; before: string; group: { trackId: string; clip: Clip }[]; trackId: string; rows: { id: string; top: number; bottom: number }[] }>(null);
  const tot = Math.max(10, totalDuration(project) + 5);
  const t2x = (t: number) => 92 + t * zoom;
  const x2t = (x: number) => Math.max(0, (x - 92) / zoom);

  const selList: Sel[] = useMemo(() => {
    if (multi.length) return multi;
    return selected ? [selected] : [];
  }, [multi, selected]);

  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setView({ left: el.scrollLeft, width: el.clientWidth }));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName ?? '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      const st = useEditor.getState();
      // blade
      if ((e.key === 's' || e.key === 'S' || e.key === 'b' || e.key === 'B') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (e.shiftKey) bladeAll(); else split();
        return;
      }
      if (e.key === 'm' || e.key === 'M') { st.commit('Marker', (p) => ({ ...p, markers: [...p.markers, { id: uid(), time: st.currentTime, label: 'M' + (p.markers.length + 1) }] })); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); duplicate(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); selectAll(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') { e.preventDefault(); copy(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') { e.preventDefault(); paste(); return; }
      // JKL shuttle — like Premiere: J back / K stop / L fwd, repeat taps faster
      if (e.key === 'j' || e.key === 'J') {
        const seq = [-1, -2, -4];
        const i = seq.indexOf(st.rate);
        st.set({ playing: true, rate: i < 0 ? -1 : seq[Math.min(seq.length - 1, i + 1)] });
        return;
      }
      if (e.key === 'l' || e.key === 'L') {
        const seq = [1, 2, 4];
        const i = seq.indexOf(st.rate);
        st.set({ playing: true, rate: i < 0 ? 1 : seq[Math.min(seq.length - 1, i + 1)] });
        return;
      }
      if (e.key === 'k' || e.key === 'K') { st.set({ playing: false, rate: 1 }); return; }
      // Q/W: trim selected clip start/end to playhead
      if (e.key === 'q' || e.key === 'Q') { trimToPlayhead('start'); return; }
      if (e.key === 'w' || e.key === 'W') { trimToPlayhead('end'); return; }
      // Ripple delete: Shift+Delete/Backspace closes the gap
      if ((e.key === 'Delete' || e.key === 'Backspace') && e.shiftKey) { rippleDelete(); return; }
      // Up/Down: prev/next edit point · Home/End: bounds
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); gotoEdit(e.key === 'ArrowDown' ? 1 : -1); return; }
      if (e.key === 'Home') { e.preventDefault(); st.set({ currentTime: 0 }); return; }
      if (e.key === 'End') { e.preventDefault(); st.set({ currentTime: Math.max(0, totalDuration(st.project) - 0.01) }); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // frame step when paused (no selection needed), nudge when clip selected + playing? keep both:
        const fps = st.project.settings.fps;
        if (!st.selected || !st.playing) {
          e.preventDefault();
          const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 / fps : 1 / fps);
          st.set({ currentTime: Math.max(0, st.currentTime + d) });
          return;
        }
        const sel = st.selected;
        const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.04 : 0.5);
        st.commit('Nudge', (p) => ({ ...p, tracks: p.tracks.map((t) => t.id === sel.trackId ? { ...t, clips: t.clips.map((c) => c.id === sel.clipId ? moveClip(c, c.startTime + d, p.settings.fps) : c) } : t) }));
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const pushHistory = (label: string, before: string) => {
    const st = useEditor.getState();
    const after = JSON.stringify(st.project);
    if (before === after) return;
    st.set({ undoStack: [...st.undoStack.slice(-59), { label, before, after, at: Date.now() }], redoStack: [] });
  };

  const split = () => {
    const targets = selList.length ? selList : selected ? [selected] : [];
    if (!targets.length) return; track('clip_split');
    commit('Split', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c })) })) };
      const t = useEditor.getState().currentTime;
      for (const s of targets) {
        const tr = np.tracks.find((x) => x.id === s.trackId);
        if (!tr || tr.locked) continue;
        const i = tr.clips.findIndex((c) => c.id === s.clipId);
        if (i < 0) continue;
        const pair = splitClipAt(tr.clips[i], t, p.settings.fps, uid);
        if (pair) tr.clips.splice(i, 1, pair[0], pair[1]);
      }
      return np;
    });
  };

  const duplicate = () => {
    const targets = selList.length ? selList : [];
    if (!targets.length) return;
    commit('Duplicate', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips] })) };
      for (const s of targets) {
        const tr = np.tracks.find((t) => t.id === s.trackId);
        if (!tr || tr.locked) continue;
        const c = tr.clips.find((x) => x.id === s.clipId);
        if (c) tr.clips.push({ ...structuredClone(c), id: uid(), startTime: c.startTime + c.duration });
      }
      return np;
    });
  };

  const selectAll = () => {
    const all: Sel[] = [];
    for (const t of project.tracks) for (const c of t.clips) all.push({ trackId: t.id, clipId: c.id });
    setMulti(all);
    if (all[0]) set({ selected: all[0] });
  };

  const copy = () => {
    const sel = useEditor.getState().selected; if (!sel) return;
    const c = useEditor.getState().project.tracks.find((t) => t.id === sel.trackId)?.clips.find((x) => x.id === sel.clipId);
    if (c) useEditor.getState().set({ copyBuf: JSON.stringify(c) });
  };

  const paste = () => {
    const buf = useEditor.getState().copyBuf; if (!buf) return;
    useEditor.getState().commit('Paste', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips] })) };
      const c = JSON.parse(buf) as Clip;
      const tr = np.tracks.find((t) => t.id === c.trackId) ?? np.tracks[1];
      if (tr.locked) return p;
      tr.clips.push({ ...c, id: uid(), startTime: useEditor.getState().currentTime, trackId: tr.id });
      return np;
    });
  };

  // Pro: cut EVERYTHING under playhead (Premiere "blade all")
  const bladeAll = () => {
    track('clip_split');
    commit('Blade all', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c })) })) };
      const t = useEditor.getState().currentTime;
      let n = 0;
      for (const tr of np.tracks) {
        if (tr.locked) continue;
        for (let i = tr.clips.length - 1; i >= 0; i--) {
          const pair = splitClipAt(tr.clips[i], t, p.settings.fps, uid);
          if (pair) { tr.clips.splice(i, 1, pair[0], pair[1]); n++; }
        }
      }
      if (!n) return p;
      return np;
    });
  };

  // Pro: Q/W trim selected clip edge to playhead
  const trimToPlayhead = (which: 'start' | 'end') => {
    const sel = useEditor.getState().selected; if (!sel) return;
    commit(which === 'start' ? 'Trim start (Q)' : 'Trim end (W)', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c })) })) };
      const tr = np.tracks.find((t) => t.id === sel.trackId);
      if (!tr || tr.locked) return p;
      const c = tr.clips.find((x) => x.id === sel.clipId); if (!c) return p;
      const t = useEditor.getState().currentTime;
      const next = trimClipEdge(c, which === 'start' ? 'left' : 'right', t, p.settings.fps);
      if (next.duration < 0.11) return p;
      Object.assign(c, next);
      return np;
    });
  };

  // Pro: Shift+Delete — delete selection and close the gap on those tracks
  const rippleDelete = () => {
    const targets = selList.length ? selList : selected ? [selected] : [];
    if (!targets.length) return;
    commit('Ripple delete', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c })) })) };
      const ids = new Set(targets.map((s) => s.trackId + ':' + s.clipId));
      for (const tr of np.tracks) {
        if (tr.locked) continue;
        const doomed = tr.clips.filter((c) => ids.has(tr.id + ':' + c.id));
        if (!doomed.length) continue;
        const cutStart = Math.min(...doomed.map((c) => c.startTime));
        const cutEnd = Math.max(...doomed.map((c) => c.startTime + c.duration));
        tr.clips = tr.clips.filter((c) => !ids.has(tr.id + ':' + c.id));
        const gap = cutEnd - cutStart;
        for (const c of tr.clips) if (c.startTime >= cutEnd - 1e-6) c.startTime = Math.max(0, c.startTime - gap);
      }
      return np;
    });
    setMulti([]);
    set({ selected: null });
  };

  const gotoEdit = (dir: 1 | -1) => {
    const st = useEditor.getState();
    const pts = editPoints(st.project);
    const t = st.currentTime;
    const next = dir > 0 ? pts.find((x) => x > t + 0.02) : [...pts].reverse().find((x) => x < t - 0.02);
    if (next !== undefined) st.set({ currentTime: next });
  };

  const fitZoom = () => {
    const w = scrollRef.current?.clientWidth ?? 1200;
    const dur = Math.max(5, totalDuration(useEditor.getState().project) + 2);
    set({ zoom: Math.max(15, Math.min(220, (w - 120) / dur)) });
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ left: 0 }));
  };

  const addTrack = (prefix: 'v' | 'a' | 't') => {
    commit(prefix === 'v' ? 'Add video track' : prefix === 'a' ? 'Add audio track' : 'Add text track', (p) => {
      const id = nextTrackId(p, prefix);
      const meta = prefix === 'v'
        ? { type: 'overlay' as const, name: `${id.toUpperCase()} Overlay` }
        : prefix === 'a' ? { type: 'audio' as const, name: `${id.toUpperCase()} Audio` }
        : { type: 'text' as const, name: `${id.toUpperCase()} Text` };
      const clip: import('../types').Track = { id, ...meta, locked: false, muted: false, visible: true, clips: [] };
      const np = { ...p, tracks: [...p.tracks, clip] };
      // keep CapCut order: videos, then texts, then audios
      const rank = (tid: string) => (tid[0] === 'v' ? 0 : tid[0] === 't' ? 1 : 2);
      np.tracks.sort((x, y) => rank(x.id) - rank(y.id) || x.id.localeCompare(y.id));
      return np;
    });
  };

  const deleteTrack = (trackId: string) => {
    const st = useEditor.getState();
    const tr = st.project.tracks.find((t) => t.id === trackId);
    if (!tr) return;
    if (st.project.tracks.length <= 1) { alert('Keep at least one track'); return; }
    if (tr.clips.length && !confirm(`Delete track ${tr.name} with ${tr.clips.length} clip(s)?`)) return;
    commit('Delete track', (p) => ({ ...p, tracks: p.tracks.filter((t) => t.id !== trackId) }));
    if (st.selected?.trackId === trackId) set({ selected: null });
  };

  // CapCut-style audio/video fade handles (drag the ◣ ◢ corners)
  const onFadeDown = (e: React.MouseEvent, trId: string, clipId: string, which: 'in' | 'out') => {
    e.stopPropagation();
    e.preventDefault();
    const st = useEditor.getState();
    const before = JSON.stringify(st.project);
    const startX = e.clientX;
    const src = st.project.tracks.find((t) => t.id === trId)?.clips.find((x) => x.id === clipId);
    const startFade = which === 'in' ? (src?.fadeIn ?? 0) : (src?.fadeOut ?? 0);
    const dur = src?.duration ?? 1;
    let raf = 0;
    let lastX = startX;
    document.body.style.cursor = 'ew-resize';
    const mv = (ev: MouseEvent) => {
      lastX = ev.clientX;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const s2 = useEditor.getState();
        const dx = (lastX - startX) / s2.zoom; // seconds
        const v = Math.max(0, Math.min(dur / 2, startFade + (which === 'in' ? dx : -dx)));
        s2.set({
          project: {
            ...s2.project,
            tracks: s2.project.tracks.map((t) => t.id === trId ? {
              ...t, clips: t.clips.map((x) => x.id === clipId ? { ...x, [which === 'in' ? 'fadeIn' : 'fadeOut']: Math.round(v * 100) / 100 } : x),
            } : t),
          },
        });
      });
    };
    const up = () => {
      document.removeEventListener('mousemove', mv);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      if (raf) cancelAnimationFrame(raf);
      pushHistory(which === 'in' ? 'Fade in' : 'Fade out', before);
    };
    document.addEventListener('mousemove', mv, { passive: true });
    document.addEventListener('mouseup', up);
  };

  const ripple = (trackId: string) => {
    commit('Ripple', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c })) })) };
      const tr = np.tracks.find((t) => t.id === trackId);
      if (!tr || tr.locked) return p;
      tr.clips = rippleCloseGaps(tr.clips);
      return np;
    });
  };

  const onClipDown = (e: React.MouseEvent, trId: string, c: Clip) => {
    if (e.button === 2) return;
    e.stopPropagation();
    e.preventDefault();
    const st = useEditor.getState();
    if (e.shiftKey) {
      setMulti((m) => (m.some((s) => sameSel(s, { trackId: trId, clipId: c.id })) ? m : [...m, { trackId: trId, clipId: c.id }]));
      st.set({ selected: { trackId: trId, clipId: c.id } });
      return;
    }
    setMulti([]);
    st.set({ selected: { trackId: trId, clipId: c.id } });
    const tr = st.project.tracks.find((t) => t.id === trId);
    if (tr?.locked) return;
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const edge: 'trim-l' | 'trim-r' | 'move' = e.clientX - rect.left < 10 ? 'trim-l' : rect.right - e.clientX < 10 ? 'trim-r' : 'move';
    const rows = [...document.querySelectorAll<HTMLElement>('#tlinner [data-track]')].map((r) => {
      const b = r.getBoundingClientRect();
      return { id: r.dataset.track!, top: b.top, bottom: b.bottom };
    });
    dragRef.current = {
      mode: edge, before: JSON.stringify(st.project), trackId: trId,
      group: edge === 'move' && multi.length
        ? multi.map((s) => {
            const t = st.project.tracks.find((x) => x.id === s.trackId)!;
            const found = t?.clips.find((x) => x.id === s.clipId);
            return found ? { trackId: s.trackId, clip: structuredClone(found) } : null;
          }).filter((g): g is { trackId: string; clip: Clip } => !!g?.clip)
        : [{ trackId: trId, clip: structuredClone(c) }],
      rows,
    };
    if (!dragRef.current.group.length) dragRef.current.group = [{ trackId: trId, clip: structuredClone(c) }];
    const primary = dragRef.current.group.find((g) => g.clip.id === c.id) ?? dragRef.current.group[0];
    const startX = e.clientX;
    const startT = primary.clip.startTime;
    document.body.style.cursor = edge === 'move' ? 'grabbing' : 'ew-resize';
    document.body.style.userSelect = 'none';
    let raf = 0;
    let pending: MouseEvent | null = null;
    let altSnapOff = false;
    const autoScroll = (ev: MouseEvent) => {
      const sc = scrollRef.current; if (!sc) return;
      const r = sc.getBoundingClientRect();
      if (ev.clientX > r.right - 40) sc.scrollLeft += 14;
      else if (ev.clientX < r.left + 40) sc.scrollLeft = Math.max(0, sc.scrollLeft - 14);
    };
    const apply = () => {
      raf = 0;
      const ev = pending; pending = null;
      const d = dragRef.current; if (!ev || !d) return;
      autoScroll(ev);
      const s2 = useEditor.getState();
      const fps = s2.project.settings.fps;
      // snap toggle (toolbar) XOR Alt-hold = pro magnet behavior
      const snapActive = (s2.snap !== false) !== altSnapOff;
      // refresh row rects cheaply every frame is jittery — reuse cached, they rarely move vertically
      const dt = (ev.clientX - startX) / s2.zoom;
      const guides = snapActive ? collectSnapTimes(s2.project, ...d.group.map((g) => g.clip.id)) : [];
      let targetTrack = d.trackId;
      if (d.mode === 'move') {
        const row = d.rows.find((r) => ev.clientY >= r.top && ev.clientY <= r.bottom);
        if (row && row.id !== d.trackId && acceptsDrop(primary.clip.type, row.id)) targetTrack = row.id;
      }
      if (d.mode === 'move') {
        const raw = Math.max(0, startT + dt);
        const { time, snapped } = !snapActive
          ? { time: raw, snapped: false }
          : snapTime(raw, guides, s2.currentTime, s2.zoom);
        setSnapX(snapped && snapActive ? 92 + time * s2.zoom - (scrollRef.current?.scrollLeft ?? 0) : null);
        const delta = time - startT;
        const moved = d.group.map((g) => ({ trackId: g.trackId, clip: moveClip(g.clip, g.clip.startTime + delta, fps) }));
        const byTrack = new Map<string, Clip[]>();
        for (const m of moved) {
          const tid = m.clip.id === primary.clip.id ? targetTrack : m.trackId;
          if (!byTrack.has(tid)) byTrack.set(tid, []);
          byTrack.get(tid)!.push({ ...m.clip, trackId: tid });
        }
        const movingIds = new Set(moved.map((m) => m.clip.id));
        // NOTE: no resolveOverlap during drag — free glide, resolve once on drop for smoothness
        s2.set({
          project: {
            ...s2.project,
            tracks: s2.project.tracks.map((t) => {
              const incoming = byTrack.get(t.id);
              if (!incoming) {
                if (byTrack.size && d.group.some((g) => g.trackId === t.id)) {
                  const filtered = t.clips.filter((x) => !movingIds.has(x.id));
                  if (filtered.length === t.clips.length) return t;
                  return { ...t, clips: filtered };
                }
                return t;
              }
              const others = t.clips.filter((x) => !movingIds.has(x.id));
              return { ...t, clips: [...others, ...incoming] };
            }),
          },
          selected: { trackId: targetTrack, clipId: primary.clip.id },
        });
      } else {
        const inner = document.getElementById('tlinner')?.getBoundingClientRect();
        const curZoom = useEditor.getState().zoom;
        const absT = inner ? Math.max(0, (ev.clientX - inner.left - 92) / curZoom) : startT;
        const { time } = !snapActive ? { time: absT } : snapTime(absT, guides, s2.currentTime, curZoom);
        const trimmed = trimClipEdge({ ...primary.clip }, d.mode === 'trim-l' ? 'left' : 'right', time, fps);
        s2.set({
          project: {
            ...s2.project,
            tracks: s2.project.tracks.map((t) => (t.id === d.trackId ? { ...t, clips: t.clips.map((x) => (x.id === primary.clip.id ? { ...trimmed, trackId: t.id } : x)) } : t)),
          },
        });
        setSnapX(null);
      }
    };
    const onMove = (ev: MouseEvent) => {
      pending = ev;
      altSnapOff = ev.altKey;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKey);
      if (raf) cancelAnimationFrame(raf);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setSnapX(null);
      const d = dragRef.current; dragRef.current = null;
      if (!d) return;
      // resolve overlaps once on drop so clips don't stack
      if (d.mode === 'move' && !ev.altKey) {
        const s2 = useEditor.getState();
        const movingIds = new Set(d.group.map((g) => g.clip.id));
        let changed = false;
        const resolved = s2.project.tracks.map((t) => {
          const moving = t.clips.filter((x) => movingIds.has(x.id));
          if (!moving.length) return t;
          const others = t.clips.filter((x) => !movingIds.has(x.id));
          let placed = [...others, ...moving];
          for (const m of moving) {
            const next = resolveOverlap(placed, m);
            if (next !== placed) { placed = next; changed = true; }
          }
          // only rewrite if something actually overlapped
          const overlap = moving.some((m) => others.some((o) => m.startTime < o.startTime + o.duration && o.startTime < m.startTime + m.duration));
          if (!overlap) return t;
          return { ...t, clips: placed };
        });
        if (changed) s2.set({ project: { ...s2.project, tracks: resolved } });
      }
      pushHistory(d.mode === 'move' ? 'Move' : 'Trim', d.before);
    };
    const onKey = (ev: KeyboardEvent) => { altSnapOff = ev.altKey; };
    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKey);
  };

  const seekEvt = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.clip')) return;
    e.preventDefault();
    const doSeek = (clientX: number) => {
      const rect = document.getElementById('tlinner')!.getBoundingClientRect();
      const z = useEditor.getState().zoom;
      set({ currentTime: Math.max(0, Math.min(tot, (clientX - rect.left - 92) / z)) });
    };
    doSeek(e.clientX);
    let raf = 0;
    let lastX = e.clientX;
    const mv = (ev: MouseEvent) => {
      lastX = ev.clientX;
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; doSeek(lastX); });
    };
    const up = () => {
      document.removeEventListener('mousemove', mv);
      document.removeEventListener('mouseup', up);
      if (raf) cancelAnimationFrame(raf);
    };
    document.addEventListener('mousemove', mv, { passive: true });
    document.addEventListener('mouseup', up);
  };

  const visLeft = x2t(view.left - 200);
  const visRight = x2t(view.left + view.width + 400);

  const assetById = new Map(assets.map((a) => [a.id, a]));
  return (
    <div className="h-[300px] bg-[#16181d] border-t border-[#2c313b] flex flex-col" onClick={() => setMenu(null)}>
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[#2c313b] text-xs overflow-x-auto">
        <strong className="shrink-0">Timeline</strong>
        <button aria-label="Zoom in" onClick={() => set({ zoom: Math.min(220, zoom * 1.25) })} className="bg-[#262a33] hover:bg-[#313744] rounded px-2 shrink-0">+</button>
        <button aria-label="Zoom out" onClick={() => set({ zoom: Math.max(15, zoom / 1.25) })} className="bg-[#262a33] hover:bg-[#313744] rounded px-2 shrink-0">−</button>
        <button onClick={fitZoom} className="bg-[#262a33] hover:bg-[#313744] rounded px-2 shrink-0" title="Zoom to fit whole timeline">Fit</button>
        <button onClick={() => set({ snap: !snapOn })} className={`rounded px-2 shrink-0 font-bold ${snapOn ? 'bg-violet-500 text-white' : 'bg-[#262a33] text-gray-400'}`} title="Snapping on/off (Alt temporarily inverts while dragging)">🧲 {snapOn ? 'Snap' : 'Off'}</button>
        <span className="mono bg-black/40 rounded px-2 py-0.5 shrink-0" title="Playhead timecode HH:MM:SS:FF">{timecode(currentTime, project.settings.fps)}</span>
        <span className="mono text-gray-400 shrink-0">/ {timecode(Math.max(0, totalDuration(project)), project.settings.fps)} · {project.settings.fps}fps</span>
        <span className="flex-1" />
        <button onClick={split} className="bg-[#262a33] hover:bg-[#313744] rounded px-2 shrink-0" title="Split selected at playhead (S)">✂ Split</button>
        <button onClick={bladeAll} className="bg-[#262a33] hover:bg-[#313744] rounded px-2 shrink-0" title="Cut everything under playhead (Shift+S / B)">🔪 All</button>
        <button onClick={() => trimToPlayhead('start')} className="bg-[#262a33] hover:bg-[#313744] rounded px-1.5 shrink-0" title="Trim clip start to playhead (Q)">Q◀</button>
        <button onClick={() => trimToPlayhead('end')} className="bg-[#262a33] hover:bg-[#313744] rounded px-1.5 shrink-0" title="Trim clip end to playhead (W)">▶W</button>
        <button onClick={duplicate} className="bg-[#262a33] hover:bg-[#313744] rounded px-2 shrink-0" title="Duplicate (Ctrl+D)">⧉ Dup</button>
        <button onClick={() => { commit('Delete', (p) => {
          const ids = new Set(selList.map((s) => s.trackId + ':' + s.clipId));
          return { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !ids.has(t.id + ':' + c.id)) })) };
        }); setMulti([]); }} className="bg-[#262a33] hover:bg-[#313744] rounded px-2 shrink-0" title="Delete (Shift+Del = ripple delete)">🗑 Del</button>
        <button onClick={rippleDelete} className="bg-[#262a33] hover:bg-[#313744] rounded px-2 shrink-0" title="Ripple delete: remove + close gap (Shift+Del)">⇤Rpl</button>
        <span className="w-px h-4 bg-[#2c313b] shrink-0 mx-0.5" />
        <button onClick={() => addTrack('v')} className="bg-[#262a33] hover:bg-[#313744] rounded px-2 shrink-0 font-bold" title="Add video track (unlimited overlays)">+V</button>
        <button onClick={() => addTrack('a')} className="bg-[#262a33] hover:bg-[#313744] rounded px-2 shrink-0 font-bold" title="Add audio track">+A</button>
        <button onClick={() => addTrack('t')} className="bg-[#262a33] hover:bg-[#313744] rounded px-2 shrink-0 font-bold" title="Add text track">+T</button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto relative" onMouseDown={seekEvt}>
        <div id="tlinner" style={{ width: t2x(tot) + 200 }} className="relative min-h-full">
          <div className="sticky top-0 h-[26px] bg-[#1d2027] border-b border-[#2c313b] z-10">
            {Array.from({ length: Math.floor(tot) + 1 }, (_, t) => (
              <div key={t} className="absolute top-0 bottom-0 border-l border-[#2c313b] mono text-[9px] text-gray-400 pl-1 pt-1 whitespace-nowrap" style={{ left: t2x(t) }} title={timecode(t, project.settings.fps)}>
                {zoom > 90 ? timecode(t, project.settings.fps).slice(3) : `${t}s`}
              </div>
            ))}
            {project.markers.map((m) => (
              <div key={m.id} title={`${m.label} · ${timecode(m.time, project.settings.fps)}`} className="absolute top-0 text-amber-300 text-xs cursor-pointer" style={{ left: t2x(m.time) }}
                onMouseDown={(e) => { e.stopPropagation(); set({ currentTime: m.time }); }}>◆</div>
            ))}
          </div>
          {project.tracks.map((tr) => (
            <div key={tr.id} data-track={tr.id} className="relative border-b border-[#2c313b] min-h-[52px]" style={{ opacity: tr.visible === false ? 0.45 : 1 }}>
              <span className="sticky left-0 z-10 inline-flex gap-1 items-center bg-[#1d2027] text-[10px] font-bold text-gray-400 px-2 py-1 my-1 rounded-r-md">
                {tr.name}
                <button title="Lock" onClick={(e) => { e.stopPropagation(); commit('Track', (p) => ({ ...p, tracks: p.tracks.map((t) => t.id === tr.id ? { ...t, locked: !t.locked } : t) })); }}>{tr.locked ? '🔒' : '🔓'}</button>
                <button title="Visible" onClick={(e) => { e.stopPropagation(); commit('Track', (p) => ({ ...p, tracks: p.tracks.map((t) => t.id === tr.id ? { ...t, visible: !t.visible } : t) })); }}>{tr.visible === false ? '👁‍🗨' : '👁'}</button>
                <button title="Mute" onClick={(e) => { e.stopPropagation(); commit('Track', (p) => ({ ...p, tracks: p.tracks.map((t) => t.id === tr.id ? { ...t, muted: !t.muted } : t) })); }}>{tr.muted ? '🔇' : '🔊'}</button>
                <button title="Ripple close gaps" onClick={(e) => { e.stopPropagation(); ripple(tr.id); }}>⇤</button>
                <button title={`Delete track ${tr.id}`} onClick={(e) => { e.stopPropagation(); deleteTrack(tr.id); }} className="hover:text-red-400">✕</button>
              </span>
              <div className="relative h-[44px] ml-[92px]" onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData('text/asset-id'); if (!id) return;
                  const rect = document.getElementById('tlinner')!.getBoundingClientRect();
                  const at = Math.max(0, (e.clientX - rect.left - 92) / zoom);
                  const a = useEditor.getState().assets.find((x) => x.id === id); if (!a) return;
                  commit('Add clip', (p) => {
                    const st = useEditor.getState();
                    const { time } = st.snap === false ? { time: at } : snapTime(at, collectSnapTimes(p), st.currentTime, zoom);
                    const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips] })) };
                    // drop on a compatible track: audio→this/first a*, else this track if it accepts, else first v*
                    let target = tr;
                    if (a.kind === 'audio' && !isAudioTrack(tr.id)) target = np.tracks.find((t) => isAudioTrack(t.id)) ?? tr;
                    if (a.kind !== 'audio' && !acceptsDrop(a.kind, tr.id)) target = np.tracks.find((t) => acceptsDrop(a.kind, t.id)) ?? tr;
                    const ok = np.tracks.find((t) => t.id === target.id)!;
                    if (!acceptsDrop(a.kind, ok.id) || ok.locked) return p;
                    ok.clips.push({ id: uid(), assetId: a.id, type: a.kind, startTime: time, duration: a.kind === 'image' ? 3 : a.duration || 5, sourceStart: 0, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, volume: 1, speed: 1, trackId: ok.id, filters: { br: 100, ct: 100, st: 100, gr: 0, sp: 0, bl: 0 } });
                    return np;
                  });
                }}>
                {tr.clips.filter((c) => c.startTime + c.duration >= visLeft && c.startTime <= visRight).map((c) => {
                  const isSel = selList.some((s) => sameSel(s, { trackId: tr.id, clipId: c.id }));
                  const a = c.assetId ? assetById.get(c.assetId) : undefined;
                  const peaks = a?.peaks;
                  const w = Math.max(14, c.duration * zoom);
                  const fiW = Math.min(w / 2, (c.fadeIn ?? 0) * zoom);
                  const foW = Math.min(w / 2, (c.fadeOut ?? 0) * zoom);
                  return (
                    <div key={c.id} onMouseDown={(e) => onClipDown(e, tr.id, c)}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, trackId: tr.id, clipId: c.id }); }}
                      className={`clip absolute top-[3px] h-[38px] rounded-md border text-[11px] overflow-hidden cursor-grab ${isSel ? 'border-violet-500 shadow-[0_0_0_1px_#8b5cf6]' : 'border-[#3d4560]'} ${c.type === 'audio' ? 'bg-[#1d2b23]' : 'bg-[#253050]'}`}
                      style={{ left: c.startTime * zoom, width: w }} title="Drag to move · edges to trim · Shift-click multi-select · Alt disables snap · drag ◣◢ corners for fades">
                      {a?.thumb && (c.type === 'video' || c.type === 'image') && w > 60 && (
                        <img src={a.thumb} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover opacity-30 pointer-events-none" />
                      )}
                      {peaks && peaks.length > 4 && (c.type === 'audio' || isAudioTrack(tr.id)) && (
                        <svg className="absolute inset-x-0 bottom-0 w-full h-[20px] opacity-70 pointer-events-none" preserveAspectRatio="none" viewBox={`0 0 100 20`}>
                          {peaks.filter((_, i) => i % Math.max(1, Math.floor(peaks.length / 60)) === 0).slice(0, 60).map((p, i, arr) => (
                            <rect key={i} x={(i / arr.length) * 100} y={10 - Math.min(9, p * 18)} width={100 / arr.length - 0.3} height={Math.max(1, Math.min(18, p * 36))} fill="#5eead4" opacity={0.85} />
                          ))}
                        </svg>
                      )}
                      <div className="absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize bg-white/10 hover:bg-violet-400/60 z-10" />
                      <div className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize bg-white/10 hover:bg-violet-400/60 z-10" />
                      {(fiW > 2 || foW > 2) && (
                        <svg className="absolute inset-0 w-full h-full pointer-events-none z-[5]" preserveAspectRatio="none" viewBox={`0 0 ${w} 38`}>
                          {fiW > 2 && <polygon points={`0,38 ${fiW},38 0,0`} fill="rgba(255,255,255,.22)" />}
                          {foW > 2 && <polygon points={`${w},38 ${w - foW},38 ${w},0`} fill="rgba(255,255,255,.22)" />}
                          {fiW > 2 && <line x1={fiW} y1={38} x2={0} y2={0} stroke="rgba(255,255,255,.7)" strokeWidth={1} />}
                          {foW > 2 && <line x1={w - foW} y1={38} x2={w} y2={0} stroke="rgba(255,255,255,.7)" strokeWidth={1} />}
                        </svg>
                      )}
                      {w > 56 && (
                        <>
                          <span onMouseDown={(e) => onFadeDown(e, tr.id, c.id, 'in')} title={`Fade in ${c.fadeIn ?? 0}s — drag`} className="absolute left-0.5 top-0.5 z-20 text-[10px] cursor-ew-resize opacity-70 hover:opacity-100 px-0.5">◣</span>
                          <span onMouseDown={(e) => onFadeDown(e, tr.id, c.id, 'out')} title={`Fade out ${c.fadeOut ?? 0}s — drag`} className="absolute right-0.5 top-0.5 z-20 text-[10px] cursor-ew-resize opacity-70 hover:opacity-100 px-0.5">◢</span>
                        </>
                      )}
                      <div className="relative px-3 truncate leading-tight mt-0.5">{c.text ?? a?.name ?? c.type}</div>
                      <div className="relative mono text-[9px] text-gray-400 px-3">{timecode(c.startTime, project.settings.fps).slice(3)} · {c.duration.toFixed(1)}s</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="absolute top-0 bottom-0 w-[2px] bg-violet-500 z-20 pointer-events-none" style={{ left: t2x(currentTime) }} />
          {snapX !== null && <div className="absolute top-0 bottom-0 w-[1px] bg-amber-300 z-20 pointer-events-none" style={{ left: snapX + (scrollRef.current?.scrollLeft ?? 0) }} />}
        </div>
      </div>
      <KeyframeLane
        project={project} selected={selected} prop={kfProp} setProp={setKfProp}
        kfSel={kfSel} setKfSel={setKfSel} t2x={t2x} currentTime={currentTime}
      />
      {menu && (
        <div className="fixed bg-[#1d2027] border border-[#2c313b] rounded-lg p-1 z-50 text-xs" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {([['Split at playhead', split], ['Duplicate', duplicate], ['Copy', copy], ['Delete', () => useEditor.getState().commit('Delete', (p) => ({ ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== menu.clipId) })) }))]] as [string, () => void][]).map(([label, fn]) => <button key={label} className="block w-full text-left px-3 py-1 hover:bg-[#262a33] rounded" onClick={() => { fn(); setMenu(null); }}>{label}</button>)}
        </div>
      )}
    </div>
  );
}

function KeyframeLane({ project, selected, prop, setProp, kfSel, setKfSel, t2x, currentTime }: {
  project: import('../types').Project; selected: Sel | null; prop: (typeof KF_PROPS)[number];
  setProp: (p: (typeof KF_PROPS)[number]) => void; kfSel: string | null;
  setKfSel: (id: string | null) => void; t2x: (t: number) => number; currentTime: number;
}) {
  const clip = selected ? project.tracks.find((t) => t.id === selected.trackId)?.clips.find((c) => c.id === selected.clipId) : undefined;
  if (!clip) return null;
  const kfs = (clip.keyframes ?? []).filter((k) => k.prop === prop).sort((a, b) => a.dt - b.dt);
  const addAt = (dt: number) => {
    useEditor.getState().commit('Add keyframe', (p) => ({
      ...p,
      tracks: p.tracks.map((t) => t.id === selected!.trackId ? {
        ...t, clips: t.clips.map((x) => x.id === clip.id ? {
          ...x, keyframes: [...(x.keyframes ?? []), { id: uid(), dt: Math.max(0, Math.min(x.duration, dt)), prop, value: kfBase(x, prop), easing: 'linear' } as Keyframe ],
        } : x),
      } : t),
    }));
  };
  const patchKf = (id: string, patch: Partial<Keyframe>, label = 'Keyframe') => {
    useEditor.getState().commit(label, (p) => ({
      ...p,
      tracks: p.tracks.map((t) => t.id === selected!.trackId ? {
        ...t, clips: t.clips.map((x) => x.id === clip.id ? {
          ...x, keyframes: (x.keyframes ?? []).map((k) => (k.id === id ? { ...k, ...patch } : k)),
        } : x),
      } : t),
    }));
  };
  const delKf = (id: string) => {
    setKfSel(null);
    useEditor.getState().commit('Delete keyframe', (p) => ({
      ...p,
      tracks: p.tracks.map((t) => t.id === selected!.trackId ? {
        ...t, clips: t.clips.map((x) => x.id === clip.id ? { ...x, keyframes: (x.keyframes ?? []).filter((k) => k.id !== id) } : x),
      } : t),
    }));
  };
  return (
    <div className="border-t border-[#2c313b] bg-[#14161a] px-2 py-1 flex items-center gap-2 text-xs">
      <span className="text-gray-400 font-bold">◆ KEYS</span>
      <select value={prop} onChange={(e) => { setProp(e.target.value as (typeof KF_PROPS)[number]); setKfSel(null); }} className="bg-[#1d2027] rounded p-0.5" aria-label="Keyframe property">
        {KF_PROPS.map((p) => <option key={p}>{p}</option>)}
      </select>
      <button
        className="relative flex-1 h-6 bg-[#1d2027] rounded overflow-hidden"
        title="Double-click to add keyframe at playhead"
        onDoubleClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const at = Math.max(0, Math.min(clip.duration, currentTime - clip.startTime));
          void r; addAt(at);
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-x-0 top-1/2 h-px bg-[#2c313b]" />
        <div className="absolute top-0 bottom-0 w-px bg-violet-500/60" style={{ left: `${Math.max(0, Math.min(1, (currentTime - clip.startTime) / Math.max(0.01, clip.duration))) * 100}%` }} />
        {kfs.map((k) => (
          <span
            key={k.id} title={`${prop} = ${k.value} @ ${k.dt.toFixed(2)}s (drag to move · Alt-click deletes)`}
            onMouseDown={(e) => {
              e.stopPropagation();
              if (e.altKey) { delKf(k.id); return; }
              setKfSel(k.id);
              const before = JSON.stringify(useEditor.getState().project);
              const lane = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
              const mv = (ev: MouseEvent) => {
                const frac = Math.max(0, Math.min(1, (ev.clientX - lane.left) / lane.width));
                const dt = frac * clip.duration;
                useEditor.getState().set({
                  project: {
                    ...useEditor.getState().project,
                    tracks: useEditor.getState().project.tracks.map((t) => t.id === selected!.trackId ? {
                      ...t, clips: t.clips.map((x) => x.id === clip.id ? {
                        ...x, keyframes: (x.keyframes ?? []).map((y) => (y.id === k.id ? { ...y, dt } : y)),
                      } : x),
                    } : t),
                  },
                });
              };
              const up = () => {
                document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
                const st = useEditor.getState();
                st.set({ undoStack: [...st.undoStack.slice(-59), { label: 'Keyframe', before, after: JSON.stringify(st.project), at: Date.now() }], redoStack: [] });
              };
              document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
            }}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45 w-3 h-3 border cursor-ew-resize ${kfSel === k.id ? 'bg-amber-300 border-amber-100' : 'bg-violet-400 border-violet-200'}`}
            style={{ left: `${(k.dt / Math.max(0.01, clip.duration)) * 100}%` }}
          />
        ))}
      </button>
      <button onClick={() => addAt(Math.max(0, Math.min(clip.duration, currentTime - clip.startTime)))} className="bg-[#262a33] rounded px-2" title="Add keyframe at playhead">+ Key</button>
      {kfSel && <button onClick={() => delKf(kfSel)} className="bg-[#262a33] rounded px-2">Delete ◆</button>}
    </div>
  );
}
