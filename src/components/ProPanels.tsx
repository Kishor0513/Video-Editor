import { useState } from 'react';
import { useEditor, uid, firstVideoTrack, firstAudioTrack, firstTextTrack, videoTracks } from '../state/projectStore';
import { detectBeats } from '../engine/beats';
import { detectScenes } from '../engine/scenes';
import { poolGet } from '../engine/pool';
import { speak, transcribeOnce, transcribeAvailable, findFillers } from '../services/voice';
import { templates } from '../services/templates';
import { recordScreen, recordCamera, recordVoice } from '../services/recording';
import { can } from '../services/auth';
export function Toolbar() {
  const commit = useEditor((s) => s.commit);
  const addAsset = useEditor((s) => s.addAsset);
  const [recOpen, setRecOpen] = useState(false);
  const btn = 'bg-[#262a33] hover:bg-[#313744] rounded-md px-2 py-1 whitespace-nowrap transition-colors';
  const Group = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-center gap-1 shrink-0">
      <span className="text-[10px] uppercase tracking-wide text-gray-500 font-bold mr-0.5">{label}</span>
      {children}
    </div>
  );
  return (
    <div className="flex items-center gap-3 px-2 py-1.5 bg-[#16181d] border-b border-[#2c313b] text-xs overflow-x-auto">
      <Group label="Edit">
        <button title="Freeze frame at playhead" onClick={() => freezeFrame()} className={btn}>❄ Freeze</button>
        <button title="True-reverse clip (local ffmpeg)" onClick={() => void reverseClip()} className={btn}>⏪ Reverse</button>
        <button title="Detach audio to A1" onClick={() => detachAudio()} className={btn}>🎞 Detach audio</button>
        <button title="Duplicate (Ctrl+D)" onClick={() => duplicate()} className={btn}>⧉ Duplicate</button>
      </Group>
      <div className="w-px h-5 bg-[#2c313b] shrink-0" />
      <Group label="Timeline">
        <button title="Add marker (M)" onClick={() => addMarker()} className={btn}>📍 Marker</button>
        <button title="Remove silence from selected audio" onClick={() => void removeSilence()} className={btn}>✂ Silence</button>
        <button title="Group Shift-selected clips" onClick={() => makeCompound()} className={btn}>📦 Compound</button>
        <button title="Ungroup compound" onClick={() => decompose()} className={btn}>📂 Decompose</button>
        <button title="Toggle 480p proxy editing" onClick={() => void toggleProxy()} className={btn}>⚡ Proxy</button>
      </Group>
      <div className="w-px h-5 bg-[#2c313b] shrink-0" />
      <Group label="Capture">
        <div className="relative">
          <button title="Record screen / camera / voice" onClick={() => setRecOpen((v) => !v)} className={`${btn} ${recOpen ? 'bg-violet-600' : ''}`}>● Record ▾</button>
          {recOpen && (
            <div className="absolute top-full mt-1 left-0 bg-[#1d2027] border border-[#2c313b] rounded-lg p-1 z-40 w-40 shadow-xl">
              {([['🖥 Screen', '1'], ['📷 Camera', '2'], ['🎙 Voice', '3']] as const).map(([label, pick]) => (
                <button key={pick} className="block w-full text-left px-2 py-1.5 hover:bg-[#262a33] rounded" onClick={() => { setRecOpen(false); void doRecord(addAsset, pick); }}>{label}</button>
              ))}
            </div>
          )}
        </div>
      </Group>
      <span className="ml-auto shrink-0 bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded-full px-2.5 py-0.5 font-bold" title="Owner build — every feature unlocked">✓ Full access · Owner</span>
    </div>
  );
  async function reverseClip() {
    const st = useEditor.getState(); const sel = st.selected; if (!sel) { alert('Select a clip'); return; }
    const c = st.project.tracks.flatMap((t) => t.clips).find((x) => x.id === sel.clipId);
    const a = c?.assetId ? st.assets.find((x) => x.id === c.assetId) : undefined;
    if (!c || !a || a.kind === 'image') { alert('Select a video or audio clip'); return; }
    if (!confirm(`True-reverse "${a.name}" with a local ffmpeg re-encode? The reversed copy becomes a new asset.`)) return;
    try {
      const { reverseVideoBytes } = await import('../services/mp4');
      const src = await (await fetch(a.url)).blob();
      const out = await reverseVideoBytes(src, a.name);
      const url = URL.createObjectURL(out);
      const { fileToAsset } = await import('../services/media');
      const na = await fileToAsset(new File([out], a.name.replace(/(\.\w+)?$/, '-reversed.mp4')));
      na.url = url;
      st.addAsset(na);
      commit('Reverse', (p) => ({
        ...p, tracks: p.tracks.map((t) => t.id === sel.trackId
          ? { ...t, clips: t.clips.map((x) => x.id === sel.clipId ? { ...x, assetId: na.id, sourceStart: 0, speed: Math.abs(x.speed ?? 1) } : x) }
          : t),
      }));
    } catch (e) {
      commit('Reverse (preview flag)', (p) => ({
        ...p, tracks: p.tracks.map((t) => t.id === sel.trackId ? { ...t, clips: t.clips.map((x) => x.id === sel.clipId ? { ...x, speed: -1 * Math.abs(x.speed ?? 1) } : x) } : t),
      }));
      alert('Re-encode failed (' + String((e as Error).message) + ') — applied preview-direction flag instead.');
    }
  }
  function freezeFrame() {
    const st = useEditor.getState(); const t = st.currentTime;
    commit('Freeze frame', (p) => {
      const np = { ...p, tracks: p.tracks.map((x) => ({ ...x, clips: [...x.clips] })) };
      const anchor = firstVideoTrack(p);
      const v1 = np.tracks.find((x) => x.id === anchor.id)!;
      const src = v1.clips.find((c) => t >= c.startTime && t < c.startTime + c.duration)
        ?? np.tracks.filter((x) => x.id[0] === 'v').flatMap((x) => x.clips).find((c) => t >= c.startTime && t < c.startTime + c.duration);
      if (!src) { alert('Park playhead over a video clip'); return p; }
      const owner = np.tracks.find((x) => x.clips.some((c) => c.id === src.id)) ?? v1;
      owner.clips.push({ ...src, id: uid(), startTime: src.startTime + src.duration, duration: 1, speed: 0.01, trackId: owner.id });
      return np;
    });
  }
  function detachAudio() {
    const st = useEditor.getState(); const sel = st.selected; if (!sel) { alert('Select a video clip'); return; }
    commit('Detach audio', (p) => {
      const np = { ...p, tracks: p.tracks.map((x) => ({ ...x, clips: [...x.clips] })) };
      const v = np.tracks.flatMap((t) => t.clips).find((c) => c.id === sel.clipId);
      if (!v?.assetId) return p;
      const at = firstAudioTrack(np);
      np.tracks.find((t) => t.id === at.id)!.clips.push({ id: uid(), assetId: v.assetId, type: 'audio', startTime: v.startTime, duration: v.duration, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, volume: 0.9, trackId: at.id });
      return np;
    });
  }
  function duplicate() {
    const st = useEditor.getState(); const sel = st.selected; if (!sel) return;
    commit('Duplicate', (p) => {
      const np = { ...p, tracks: p.tracks.map((x) => ({ ...x, clips: [...x.clips] })) };
      const tr = np.tracks.find((t) => t.id === sel.trackId)!;
      const c = tr.clips.find((x) => x.id === sel.clipId)!;
      tr.clips.push({ ...c, id: uid(), startTime: c.startTime + c.duration });
      return np;
    });
  }
  function addMarker() {
    commit('Marker', (p) => ({ ...p, markers: [...p.markers, { id: uid(), time: useEditor.getState().currentTime, label: 'M' + (p.markers.length + 1) }] }));
  }
  function makeCompound() {
    const st = useEditor.getState();
    const sels = (st as unknown as { multi?: { trackId: string; clipId: string }[] }).multi;
    const sel = st.selected;
    if (!sel) { alert('Select clips (Shift-click several on V1) first'); return; }
    commit('Compound', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c })) })) };
      const tr = np.tracks.find((t) => t.id === sel.trackId)!;
      if (tr.locked || tr.id[0] !== 'v') { alert('Compound works on video track clips'); return p; }
      const ids = new Set(((sels ?? []).filter((s) => s.trackId === sel.trackId).map((s) => s.clipId)).concat([sel.clipId]));
      const parts = tr.clips.filter((c) => ids.has(c.id) && (c.type === 'video' || c.type === 'image')).sort((a, b) => a.startTime - b.startTime);
      if (parts.length < 2) { alert('Shift-click 2+ video/image clips on the same track'); return p; }
      const t0 = parts[0].startTime;
      const subs = parts.map((c) => ({ ...structuredClone(c), startTime: c.startTime - t0 }));
      const end = Math.max(...parts.map((c) => c.startTime + c.duration));
      tr.clips = tr.clips.filter((c) => !ids.has(c.id));
      tr.clips.push({ id: uid(), type: 'compound', sub: subs, startTime: t0, duration: end - t0, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: tr.id });
      return np;
    });
  }
  function decompose() {
    const st = useEditor.getState(); const sel = st.selected;
    if (!sel) return;
    commit('Decompose', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c })) })) };
      const tr = np.tracks.find((t) => t.id === sel.trackId)!;
      if (tr.locked) return p;
      const i = tr.clips.findIndex((c) => c.id === sel.clipId);
      const c = tr.clips[i];
      if (!c?.sub?.length) { alert('Selected clip is not a compound'); return p; }
      const restored = c.sub.map((s) => ({ ...structuredClone(s), startTime: c.startTime + s.startTime }));
      tr.clips.splice(i, 1, ...restored);
      return np;
    });
  }
  async function removeSilence() {
    const st = useEditor.getState(); const sel = st.selected;
    const c = sel ? st.project.tracks.flatMap((t) => t.clips.map((x) => ({ t: t.id, x }))).find(({ x }) => x.id === sel.clipId) : undefined;
    const a = c?.x.assetId ? st.assets.find((x) => x.id === c.x.assetId) : undefined;
    if (!c || !a?.peaks?.length) { alert('Select an audio clip with a waveform first'); return; }
    const { detectSilence, removeRanges } = await import('../engine/timelineOps');
    const ranges = detectSilence(a.peaks, c.x.duration).map(([s, e]) => [c.x.startTime + s, c.x.startTime + e] as [number, number]);
    if (!ranges.length) { alert('No silence ≥0.4s found'); return; }
    const list = ranges.map(([s, e]) => `${s.toFixed(1)}s–${e.toFixed(1)}s`).join('\n');
    if (!confirm(`Remove ${ranges.length} silent section(s)?\n${list}\n\nGaps close automatically (ripple).`)) return;
    commit('Remove silence', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((x) => ({ ...x })) })) };
      const tr = np.tracks.find((t) => t.id === c.t);
      if (!tr || tr.locked) return p;
      const i = tr.clips.findIndex((x) => x.id === c.x.id);
      if (i < 0) return p;
      const kept = removeRanges(tr.clips[i], ranges, p.settings.fps, uid);
      tr.clips.splice(i, 1, ...kept);
      const cutEnd = Math.max(...ranges.map(([, e]) => e));
      const shift = ranges.reduce((n, [s, e]) => n + (e - s), 0);
      for (const x of tr.clips) if (x.startTime >= cutEnd - 1e-6 && !kept.includes(x)) x.startTime = Math.max(0, x.startTime - shift);
      return np;
    });
  }
  async function toggleProxy() {
    const { getProxyMode, setProxyMode } = await import('../engine/pool');
    if (getProxyMode()) { setProxyMode(false); alert('Proxy mode off — editing with originals.'); return; }
    const st = useEditor.getState();
    const vids = st.assets.filter((a) => a.kind === 'video' && !a.proxyUrl);
    if (!vids.length) { setProxyMode(true); alert('Proxy mode on.'); return; }
    if (!confirm(`Build 480p proxies for ${vids.length} video(s)? Fast local transcode; editing stays on proxies, export uses originals.`)) return;
    try {
      const { buildProxy } = await import('../services/proxy');
      let i = 0;
      for (const v of vids) {
        i++;
        try { await buildProxy(v.id); } catch (e) { alert('Proxy failed for ' + v.name + ': ' + String((e as Error).message)); break; }
      }
      void i;
      const { setProxyMode: spm } = await import('../engine/pool');
      spm(false); spm(true);
      alert('Proxy mode on — smoother preview, originals untouched.');
    } catch (e) { alert('Proxy failed: ' + String((e as Error).message)); }
  }
  async function doRecord(add: (a: Parameters<typeof addAsset>[0]) => void, pick: string = '3') {
    try {
      const a = pick === '1' ? await recordScreen() : pick === '2' ? await recordCamera() : await recordVoice();
      add(a);
    } catch (e) { alert('Recording failed: ' + String((e as Error).message)); }
  }
}
export function FiltersPanel() {
  const selected = useEditor((s) => s.selected);
  const commit = useEditor((s) => s.commit);
  const presets: Record<string, { br: number; ct: number; st: number; gr: number; sp: number; bl: number; sw: string }> = {
    Vivid: { br: 105, ct: 120, st: 150, gr: 0, sp: 10, bl: 0, sw: 'linear-gradient(135deg,#f472b6,#22d3ee)' },
    Noir: { br: 95, ct: 140, st: 0, gr: 20, sp: 0, bl: 0, sw: 'linear-gradient(135deg,#000,#888)' },
    Warm: { br: 108, ct: 105, st: 120, gr: 0, sp: 25, bl: 0, sw: 'linear-gradient(135deg,#fbbf24,#ef4444)' },
    Cool: { br: 102, ct: 110, st: 110, gr: 0, sp: -20, bl: 0, sw: 'linear-gradient(135deg,#60a5fa,#1e3a8a)' },
    Vintage: { br: 100, ct: 90, st: 70, gr: 15, sp: 20, bl: 0, sw: 'linear-gradient(135deg,#b45309,#fef3c7)' },
    Cinematic: { br: 96, ct: 125, st: 115, gr: 5, sp: 5, bl: 0, sw: 'linear-gradient(135deg,#111,#4c1d95)' },
  };
  return (
    <div className="p-2 text-xs">
      <h4 className="text-gray-400 mb-1">FILTERS — select a video/image clip</h4>
      <div className="grid grid-cols-4 gap-1.5">
        {Object.entries(presets).map(([name, v]) => (
          <button key={name} onClick={() => {
            if (!selected) { alert('Select a video/image clip first'); return; }
            commit('Filter', (p) => ({ ...p, tracks: p.tracks.map((t) => t.id === selected.trackId ? { ...t, clips: t.clips.map((c) => c.id === selected.clipId ? { ...c, filters: { br: v.br, ct: v.ct, st: v.st, gr: v.gr, sp: v.sp, bl: v.bl } } : c) } : t) }));
          }} className="rounded-lg overflow-hidden bg-[#1d2027] border border-[#2c313b] hover:border-cyan-400/60" title={`Apply ${name}`}>
            <span className="block h-8" style={{ background: v.sw }} />
            <span className="block py-0.5 text-[10px] font-bold">{name}</span>
          </button>
        ))}
      </div>
      <button onClick={() => {
        if (!selected) { alert('Select a clip first'); return; }
        commit('Filter reset', (p) => ({ ...p, tracks: p.tracks.map((t) => t.id === selected.trackId ? { ...t, clips: t.clips.map((c) => c.id === selected.clipId ? { ...c, filters: { br: 100, ct: 100, st: 100, gr: 0, sp: 0, bl: 0 } } : c) } : t) }));
      }} className="w-full mt-1.5 rounded-lg bg-[#262a33] py-1 text-xs font-bold">✕ Clear filter</button>
    </div>
  );
}
export function TransitionsPanel() {
  const selected = useEditor((s) => s.selected);
  const commit = useEditor((s) => s.commit);
  return (
    <div className="p-2 text-xs">
      <h4 className="text-gray-400 mb-1">TRANSITIONS — select a video clip</h4>
      <TransitionsGrid applyTrans={(t, dur = 0.5) => {
        if (!selected) { alert('Select a video clip first'); return; }
        commit('Transition', (p) => ({ ...p, tracks: p.tracks.map((tr) => tr.id === selected.trackId ? { ...tr, clips: tr.clips.map((c) => c.id === selected.clipId ? { ...c, transitionIn: { type: t, duration: dur } } : c) } : tr) }));
      }} />
    </div>
  );
}
const TRANSITIONS: { id: 'fade' | 'dissolve' | 'wipe' | 'slide' | 'glitch' | 'zoom' | 'blur' | 'circle' | 'pixelate' | 'light'; label: string; sw: string }[] = [
  { id: 'fade', label: 'Fade', sw: 'linear-gradient(90deg,#000 0%,#888 100%)' },
  { id: 'dissolve', label: 'Dissolve', sw: 'linear-gradient(90deg,#333 0%,#bbb 50%,#333 100%)' },
  { id: 'wipe', label: 'Wipe', sw: 'linear-gradient(90deg,#22d3ee 0%,#22d3ee 60%,#111 60%)' },
  { id: 'slide', label: 'Slide', sw: 'linear-gradient(90deg,#111 0%,#a78bfa 70%,#a78bfa 100%)' },
  { id: 'glitch', label: 'Glitch', sw: 'repeating-linear-gradient(90deg,#f0f 0 20%,#0ff 20% 40%,#ff0 40% 60%,#f0f 60%)' },
  { id: 'zoom', label: 'Zoom', sw: 'radial-gradient(circle,#fff 0%,#8b5cf6 60%,#111 100%)' },
  { id: 'blur', label: 'Blur', sw: 'linear-gradient(90deg,#666,#ccc,#666)' },
  { id: 'circle', label: 'Circle', sw: 'radial-gradient(circle,#22d3ee 0 30%,#111 32%)' },
  { id: 'pixelate', label: 'Pixel', sw: 'repeating-conic-gradient(#f472b6 0 25%,#34d399 0 50%) 0 0/8px 8px' },
  { id: 'light', label: 'Light', sw: 'radial-gradient(circle,#fff 0%,transparent 70%)' },
];
export function StickersPanel() {
  const commit = useEditor((s) => s.commit);
  const addSticker = (emoji: string) => {
    commit('Sticker', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips] })) };
      const anchor = np.tracks.find((t) => t.id === 't1') ?? np.tracks.find((t) => t.id[0] === 't') ?? np.tracks[0];
      anchor.clips.push({ id: uid(), type: 'text', text: emoji, fontSize: 96, color: '#fff', textAlign: 'center', startTime: useEditor.getState().currentTime, duration: 2, position: { x: 0.5, y: 0.4 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: anchor.id });
      return np;
    });
  };
  const addShape = (shape: 'rect' | 'circle' | 'triangle' | 'star') => {
    commit('Shape', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips] })) };
      const anchor = np.tracks.filter((t) => t.id[0] === 'v').find((t) => t.id !== 'v1') ?? np.tracks.find((t) => t.id[0] === 'v') ?? np.tracks[0];
      anchor.clips.push({ id: uid(), type: 'shape', shape, color: '#8b5cf6', startTime: useEditor.getState().currentTime, duration: 3, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: anchor.id });
      return np;
    });
  };
  return (
    <div className="p-2 text-xs">
      <h4 className="text-gray-400 mb-1">STICKERS — tap to add at playhead</h4>
      <div className="grid grid-cols-6 gap-1 text-xl">
        {['😀', '😎', '🔥', '⭐', '❤', '👏', '🎉', '💯', '⬅', '➡', '⬆', '💥', '✨', '🎵', '💡', '🌈', '⚡', '🍕', '🚀'].map((s) => <button key={s} className="bg-[#1d2027] border border-[#2c313b] hover:border-cyan-400/60 rounded-lg py-1.5" onClick={() => addSticker(s)}>{s}</button>)}
      </div>
      <h4 className="text-gray-400 mt-2 mb-1">ANIMATED — CSS motion</h4>
      <div className="grid grid-cols-4 gap-1 text-xl">
        {([['💓', 'animate-pulse'], ['🌀', 'animate-spin'], ['🎈', 'animate-bounce'], ['💫', 'animate-ping']] as const).map(([s, cls]) => (
          <button key={s} className={`bg-[#1d2027] border border-[#2c313b] hover:border-cyan-400/60 rounded-lg py-1.5 ${cls}`} onClick={() => addSticker(s)}>{s}</button>
        ))}
      </div>
      <h4 className="text-gray-400 mt-3 mb-1">SHAPES</h4>
      <div className="grid grid-cols-4 gap-1">
        {(['rect', 'circle', 'triangle', 'star'] as const).map((s) => <button key={s} className="bg-[#262a33] hover:bg-[#313744] rounded-lg px-2 py-1.5 capitalize font-bold" onClick={() => addShape(s)}>{s}</button>)}
      </div>
    </div>
  );
}
export function AudioPanel() {
  const assets = useEditor((s) => s.assets);
  const addAsset = useEditor((s) => s.addAsset);
  const commit = useEditor((s) => s.commit);
  const tracks = assets.filter((a) => a.kind === 'audio');
  const addAtPlayhead = (id: string) => {
    commit('Add audio', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips] })) };
      const a = assets.find((x) => x.id === id); if (!a) return p;
      const anchor = np.tracks.find((t) => t.id === 'a1') ?? np.tracks.find((t) => t.id[0] === 'a') ?? np.tracks[0];
      const tr = np.tracks.find((t) => t.id === anchor.id)!;
      if (tr.locked) return p;
      tr.clips.push({ id: uid(), assetId: a.id, type: 'audio', startTime: useEditor.getState().currentTime, duration: a.duration || 5, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, volume: 0.9, trackId: tr.id });
      return np;
    });
  };
  return (
    <div className="p-2 text-xs space-y-2">
      <h4 className="text-gray-400">AUDIO — music & voice</h4>
      {!tracks.length && <p className="text-gray-500">No audio yet — import files in Media, record, or fetch demo music.</p>}
      {tracks.map((a) => (
        <div key={a.id} className="flex items-center gap-2 bg-[#1d2027] border border-[#2c313b] rounded-lg p-1.5">
          <span className="text-base">♫</span>
          <div className="min-w-0 flex-1"><div className="truncate">{a.name}</div><div className="mono text-[10px] text-gray-400">{a.duration ? `${a.duration.toFixed(1)}s` : ''}</div></div>
          <button onClick={() => addAtPlayhead(a.id)} className="bg-cyan-400 text-black font-bold rounded px-2 py-0.5">+ Add</button>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-1">
        <button className="bg-[#262a33] hover:bg-[#313744] rounded-lg px-2 py-1.5 font-bold" onClick={() => {
          commit('Detach audio', (p) => {
            const np = { ...p, tracks: p.tracks.map((x) => ({ ...x, clips: [...x.clips] })) };
            const sel = useEditor.getState().selected; if (!sel) { alert('Select a video clip first'); return p; }
            const v = np.tracks.flatMap((t) => t.clips).find((cc) => cc.id === sel.clipId);
            if (!v?.assetId) return p;
            const at = np.tracks.find((t) => t.id === 'a1') ?? np.tracks.find((t) => t.id[0] === 'a') ?? np.tracks[0];
            at.clips.push({ id: uid(), assetId: v.assetId, type: 'audio', startTime: v.startTime, duration: v.duration, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, volume: 0.9, trackId: at.id });
            return np;
          });
        }}>🎞 Detach audio</button>
        <button className="bg-[#262a33] hover:bg-[#313744] rounded-lg px-2 py-1.5 font-bold" onClick={() => {
          import('../services/recording').then(({ recordVoice }) => recordVoice().then(addAsset).catch((e) => alert('Recording failed: ' + String((e as Error).message))));
        }}>🎙 Record voice</button>
      </div>
    </div>
  );
}
export function AdjustPanel() {
  const commit = useEditor((s) => s.commit);
  const selected = useEditor((s) => s.selected);
  const grades: { name: string; f: { br: number; ct: number; st: number; gr: number; sp: number; bl: number } }[] = [
    { name: 'Cinematic', f: { br: 96, ct: 125, st: 115, gr: 5, sp: 5, bl: 0 } },
    { name: 'Warm film', f: { br: 105, ct: 110, st: 125, gr: 0, sp: 20, bl: 0 } },
    { name: 'Cool clean', f: { br: 103, ct: 112, st: 108, gr: 0, sp: -15, bl: 0 } },
    { name: 'B&W', f: { br: 100, ct: 135, st: 0, gr: 25, sp: 0, bl: 0 } },
  ];
  const addLayer = (f = { br: 105, ct: 115, st: 130, gr: 0, sp: 0, bl: 0 }, label = 'Adjustment layer') => {
    commit(label, (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips] })) };
      const anchor = np.tracks.filter((t) => t.id[0] === 'v').find((t) => t.id !== 'v1') ?? np.tracks.find((t) => t.id[0] === 'v') ?? np.tracks[0];
      anchor.clips.push({ id: uid(), type: 'adjustment', startTime: useEditor.getState().currentTime, duration: 3, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: anchor.id, filters: f });
      return np;
    });
  };
  return (
    <div className="p-2 text-xs space-y-2">
      <h4 className="text-gray-400">ADJUST — grade everything below</h4>
      <div className="grid grid-cols-2 gap-1.5">
        {grades.map((g) => <button key={g.name} onClick={() => addLayer(g.f, `Adjust ${g.name}`)} className="bg-[#1d2027] border border-[#2c313b] hover:border-cyan-400/60 rounded-lg p-2 font-bold">{g.name}</button>)}
      </div>
      <button onClick={() => addLayer()} className="w-full bg-[#262a33] hover:bg-[#313744] rounded-lg p-2 font-bold">＋ Blank adjustment layer</button>
      <button onClick={() => {
        if (!selected) { alert('Select a video/image clip to grade it directly'); return; }
        commit('Grade clip', (p) => ({ ...p, tracks: p.tracks.map((t) => t.id === selected.trackId ? { ...t, clips: t.clips.map((c) => c.id === selected.clipId ? { ...c, filters: { br: 105, ct: 115, st: 130, gr: 0, sp: 0, bl: 0 } } : c) } : t) }));
      }} className="w-full bg-[#1d2027] border border-[#2c313b] rounded-lg p-2">Apply Cinematic to selected clip</button>
    </div>
  );
}
export function FXPanel() {
  const commit = useEditor((s) => s.commit);
  const project = useEditor((s) => s.project);
  const selected = useEditor((s) => s.selected);
  const presets = ['Vivid', 'Noir', 'Warm', 'Cool', 'Vintage'];
  return (
    <div className="p-2 text-xs">
      <h4 className="text-gray-400 mb-1">FILTERS / COLOR</h4>
      <div className="grid grid-cols-2 gap-1">
        {presets.map((p) => <button key={p} className="bg-[#1d2027] border border-[#2c313b] rounded p-2" onClick={() => applyFilter(p)}>{p}</button>)}
      </div>
      <h4 className="text-gray-400 mt-3 mb-1">TRANSITIONS — select V1 clip, tap to preview-apply</h4>
      <TransitionsGrid applyTrans={applyTrans} />
      <h4 className="text-gray-400 mt-3 mb-1">CHROMA / MASK / SPEED</h4>
      <button className="bg-[#262a33] rounded px-2 py-1 mr-1" onClick={() => patch({ chroma: { enabled: true, color: '#00ff00', similarity: 0.35, smoothness: 0.1 } })}>Green screen</button>
      <button className="bg-[#262a33] rounded px-2 py-1 mr-1" onClick={() => patch({ mask: { shape: 'circle', feather: 20, opacity: 1 } })}>Circle mask</button>
      <button className="bg-[#262a33] rounded px-2 py-1 mr-1" onClick={() => patch({ speedCurve: 'Hero' })}>Hero curve</button>
      <button className="bg-[#262a33] rounded px-2 py-1" onClick={() => commit('Adjustment layer', (p) => {
        const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips] })) };
        const anchor = videoTracks(p).find((t) => t.id !== 'v1') ?? firstVideoTrack(p);
        np.tracks.find((t) => t.id === anchor.id)!.clips.push({ id: uid(), type: 'adjustment', startTime: useEditor.getState().currentTime, duration: 3, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: anchor.id, filters: { br: 105, ct: 115, st: 130, gr: 0, sp: 0, bl: 0 } });
        return np;
      })}>Adjustment layer</button>
      <h4 className="text-gray-400 mt-3 mb-1">STICKERS / SHAPES</h4>
      <div className="flex gap-1 text-lg">
        {['😀', '🔥', '⬅', '⭐', '❤'].map((s) => <button key={s} className="bg-[#1d2027] rounded px-2" onClick={() => addSticker(s)}>{s}</button>)}
      </div>
      <div className="flex gap-1 mt-1">
        {(['rect', 'circle', 'triangle', 'star'] as const).map((s) => <button key={s} className="bg-[#262a33] rounded px-2 py-1 capitalize" onClick={() => addShape(s)}>{s}</button>)}
      </div>
      <h4 className="text-gray-400 mt-3 mb-1">LUT (.cube, real)</h4>
      <label className="bg-[#262a33] rounded px-2 py-1 cursor-pointer inline-block">Import + apply LUT
        <input type="file" accept=".cube" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0]; if (!f) return;
          const r = new FileReader();
          r.onload = async () => {
            try {
              const { parseCube, setClipLut } = await import('../engine/lut');
              const lut = parseCube(String(r.result));
              const sel = useEditor.getState().selected; if (!sel) { alert('Select a clip first'); return; }
              setClipLut(sel.clipId, lut);
              commit('LUT', (p) => ({ ...p, tracks: p.tracks.map((t) => t.id === sel.trackId ? { ...t, clips: t.clips.map((c) => c.id === sel.clipId ? { ...c, lutIntensity: 1 } : c) } : t) }));
            } catch (err) { alert('Bad .cube: ' + String((err as Error).message)); }
          };
          r.readAsText(f);
        }} />
      </label>
      <h4 className="text-gray-400 mt-3 mb-1">TRACK + REMOVE BG (real)</h4>
      <div className="flex gap-1 flex-wrap">
        <button className="bg-[#262a33] rounded px-2 py-1" onClick={() => void trackAttach()}>Track point → text follows</button>
        <button className="bg-[#262a33] rounded px-2 py-1" onClick={() => void removeBG()}>Remove background</button>
        <button className="bg-[#262a33] rounded px-2 py-1" onClick={() => multicam(1)}>Cam 1</button>
        <button className="bg-[#262a33] rounded px-2 py-1" onClick={() => multicam(2)}>Cam 2</button>
      </div>
      <h4 className="text-gray-400 mt-3 mb-1">SCRIPT → VIDEO</h4>
      <button className="bg-[#262a33] rounded px-2 py-1" onClick={() => {
        const topic = prompt('Topic?', 'Morning routine');
        if (!topic) return;
        commit('Script', (p) => {
          const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips] })) };
          const tr = np.tracks.find((t) => t.id === firstTextTrack(p).id)!;
          topic.split(/[.]\s*/).filter(Boolean).slice(0, 4).forEach((s, i) => {
            tr.clips.push({ id: uid(), type: 'text', text: s.trim(), fontSize: 56, color: '#fff', textAlign: 'center', startTime: i * 3, duration: 3, position: { x: 0.5, y: 0.4 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: tr.id });
          });
          return np;
        });
      }}>✨ Draft from topic</button>
      <p className="text-gray-400 mt-2">Multicam: keys 1/2 solo angles · Collab: open this app in 2 tabs, edits sync live.</p>
    </div>
  );
  function patch(patch: Partial<import('../types').Clip>) {
    if (!selected) { alert('Select a clip'); return; }
    commit('FX', (p) => ({ ...p, tracks: p.tracks.map((t) => t.id === selected.trackId ? { ...t, clips: t.clips.map((c) => c.id === selected.clipId ? { ...c, ...patch } : c) } : t) }));
  }
  const FILTER_VALUES: Record<string, { br: number; ct: number; st: number; gr: number; sp: number; bl: number; sw: string }> = {
    Vivid: { br: 105, ct: 120, st: 150, gr: 0, sp: 10, bl: 0, sw: 'linear-gradient(135deg,#f472b6,#22d3ee)' },
    Noir: { br: 95, ct: 140, st: 0, gr: 20, sp: 0, bl: 0, sw: 'linear-gradient(135deg,#000,#888)' },
    Warm: { br: 108, ct: 105, st: 120, gr: 0, sp: 25, bl: 0, sw: 'linear-gradient(135deg,#fbbf24,#ef4444)' },
    Cool: { br: 102, ct: 110, st: 110, gr: 0, sp: -20, bl: 0, sw: 'linear-gradient(135deg,#60a5fa,#1e3a8a)' },
    Vintage: { br: 100, ct: 90, st: 70, gr: 15, sp: 20, bl: 0, sw: 'linear-gradient(135deg,#b45309,#fef3c7)' },
    Cinematic: { br: 96, ct: 125, st: 115, gr: 5, sp: 5, bl: 0, sw: 'linear-gradient(135deg,#111,#4c1d95)' },
    Film: { br: 102, ct: 112, st: 105, gr: 8, sp: 12, bl: 0, sw: 'linear-gradient(135deg,#d4a373,#6b4f2a)' },
    Golden: { br: 110, ct: 108, st: 135, gr: 0, sp: 35, bl: 0, sw: 'linear-gradient(135deg,#fde68a,#f59e0b)' },
    TealOrange: { br: 100, ct: 130, st: 140, gr: 0, sp: 0, bl: 0, sw: 'linear-gradient(135deg,#14b8a6,#f97316)' },
    Dreamy: { br: 106, ct: 95, st: 120, gr: 0, sp: 30, bl: 4, sw: 'linear-gradient(135deg,#f9a8d4,#c4b5fd)' },
    Matte: { br: 98, ct: 105, st: 90, gr: 10, sp: 0, bl: 0, sw: 'linear-gradient(135deg,#9ca3af,#4b5563)' },
  };
  function applyFilter(name: string) {
    void can;
    patch({ filters: FILTER_VALUES[name] ?? FILTER_VALUES.Vivid });
  }
  function applyTrans(t: 'fade' | 'wipe' | 'slide' | 'dissolve' | 'glitch' | 'zoom' | 'blur' | 'circle' | 'pixelate' | 'light', dur = 0.5) { patch({ transitionIn: { type: t, duration: dur } }); }
  function addSticker(s: string) {
    commit('Sticker', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips] })) };
      { const tt = firstTextTrack(useEditor.getState().project); np.tracks.find((t) => t.id === tt.id)!.clips.push({ id: uid(), type: 'text', text: s, fontSize: 96, color: '#fff', textAlign: 'center', startTime: useEditor.getState().currentTime, duration: 2, position: { x: 0.5, y: 0.4 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: tt.id }); }
      return np;
    });
    void project;
  }
  function addShape(shape: 'rect' | 'circle' | 'triangle' | 'star') {
    commit('Shape', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips] })) };
      { const vt = videoTracks(useEditor.getState().project).find((t) => t.id !== 'v1') ?? firstVideoTrack(useEditor.getState().project); np.tracks.find((t) => t.id === vt.id)!.clips.push({ id: uid(), type: 'shape', shape, color: '#8b5cf6', startTime: useEditor.getState().currentTime, duration: 3, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: vt.id }); }
      return np;
    });
  }
  async function trackAttach() {
    const st = useEditor.getState(); const sel = st.selected;
    const c = sel ? st.project.tracks.flatMap((t) => t.clips).find((x) => x.id === sel.clipId) : undefined;
    const el = c ? poolGet(c.id) : undefined;
    if (!c || !(el instanceof HTMLVideoElement)) { alert('Select a video clip first'); return; }
    const label = prompt('Text to attach?', 'Follow me') ?? 'Follow me';
    const { trackPoint, detectFace } = await import('../engine/tracker');
    const face = await detectFace(el).catch(() => null);
    const pts = await trackPoint(el, face?.x ?? 0.5, face?.y ?? 0.4, c.startTime, Math.min(c.startTime + c.duration, c.startTime + 3));
    if (!pts.length) { alert('Tracker found no motion'); return; }
    commit('Track attach', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips] })) };
      const tr = np.tracks.find((t) => t.id === firstTextTrack(p).id)!;
      pts.forEach((pt, i) => {
        tr.clips.push({ id: uid(), type: 'text', text: label, fontSize: 40, color: '#ffe45e', textAlign: 'center', startTime: pt.t, duration: 0.25, position: { x: pt.x, y: Math.max(0, pt.y - 0.08) }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: tr.id });
        void i;
      });
      return np;
    });
  }
  async function removeBG() {
    const st = useEditor.getState(); const sel = st.selected;
    const c = sel ? st.project.tracks.flatMap((t) => t.clips).find((x) => x.id === sel.clipId) : undefined;
    const el = c ? poolGet(c.id) : undefined;
    if (!c || !el) { alert('Select a video/image clip'); return; }
    const { segmentFrame } = await import('../services/segment');
    if (el instanceof HTMLImageElement) {
      const v = document.createElement('video');
      alert('Image BG removal needs a video frame source — select a video clip, or use Green screen on images.');
      void v; return;
    }
    const cv = await segmentFrame(el, 480, 270);
    if (!cv) { alert('Segmentation model unreachable offline — Green-screen keyer applied instead.'); patch({ chroma: { enabled: true, color: '#00ff00', similarity: 0.35, smoothness: 0.1 } }); return; }
    const url = cv.toDataURL('image/png');
    const a = document.createElement('a'); a.href = url; a.download = 'mask.png'; a.click();
    patch({ chroma: { enabled: true, color: '#00ff00', similarity: 0.35, smoothness: 0.1 } });
    alert('AI mask exported as mask.png; live chroma key applied to clip.');
  }
  function multicam(n: 1 | 2) {
    commit('Multicam', (p) => {
      const vids = videoTracks(p);
      const t1 = vids[vids.length - 1]?.id; // base = last (v1)
      const t2 = vids.find((t) => t.id !== t1)?.id;
      return {
        ...p, tracks: p.tracks.map((t) => {
          if (t.id === t1) return { ...t, visible: n === 1 };
          if (t.id === t2) return { ...t, visible: n === 2 };
          return t;
        }),
      };
    });
  }
}
export function CaptionsPanel() {
  const assets = useEditor((s) => s.assets);
  const commit = useEditor((s) => s.commit);
  const [text, setText] = useState('Hello world.\nWelcome to the demo.');
  const [wordStyle, setWordStyle] = useState<'hormozi' | 'karaoke' | 'stroke'>('hormozi');
  const [wps, setWps] = useState(2.5);
  return (
    <div className="p-2 text-xs space-y-2">
      <h4 className="text-gray-400">CAPTIONS — CapCut style</h4>
      <textarea value={text} onChange={(e) => setText(e.target.value)} className="w-full bg-[#1d2027] rounded p-1 h-20" />
      <div className="bg-[#1d2027] border border-[#2c313b] rounded-lg p-2">
        <p className="font-bold mb-1">WORD-BY-WORD (one pop per word)</p>
        <div className="grid grid-cols-3 gap-1 mb-1.5">
          {((['hormozi', 'karaoke', 'stroke'] as const).map((s) => (
            <button key={s} onClick={() => setWordStyle(s)} className={`rounded px-1 py-1.5 font-bold capitalize ${wordStyle === s ? 'bg-cyan-400 text-black' : 'bg-[#262a33]'}`}>{s}</button>
          )))}
        </div>
        <label className="flex items-center gap-2 text-gray-400">Speed
          <input type="range" min={1} max={5} step={0.5} value={wps} onChange={(e) => setWps(Number(e.target.value))} className="flex-1" />
          <span className="mono">{wps.toFixed(1)} w/s</span>
        </label>
        <button onClick={() => autoWords(wordStyle, wps)} className="w-full mt-1.5 bg-cyan-400 hover:bg-cyan-300 text-black font-bold rounded px-2 py-1.5">✨ Words → timeline</button>
      </div>
      <div className="flex gap-1 flex-wrap">
        <button className="bg-[#262a33] rounded px-2 py-1" onClick={autoCaptions}>Lines → captions</button>
        <button className="bg-[#262a33] rounded px-2 py-1" onClick={exportSRT}>SRT</button>
        <button className="bg-[#262a33] rounded px-2 py-1" onClick={exportVTT}>VTT</button>
        <button className="bg-[#262a33] rounded px-2 py-1" onClick={speakAll}>TTS preview</button>
        <button className="bg-[#262a33] rounded px-2 py-1" onClick={dictate} title="Web Speech API">🎤 Dictate</button>
        <button className="bg-[#262a33] rounded px-2 py-1" onClick={() => void ttsFile()}>Voice file → timeline</button>
        <button className="bg-[#262a33] rounded px-2 py-1" onClick={scanFillers}>Find fillers</button>
      </div>
      <button className="bg-[#262a33] rounded px-2 py-1" onClick={analyzeBeats}>🎵 Detect beats (selected music)</button>
      <button className="bg-[#262a33] rounded px-2 py-1" onClick={() => void beatSplit()}>✂ Split V1 at beats</button>
      <button className="bg-[#262a33] rounded px-2 py-1" onClick={analyzeScenes}>🎬 Detect scenes (selected video)</button>
      <button className="bg-[#262a33] rounded px-2 py-1" onClick={() => void sceneSplit()}>✂ Split at all scenes</button>
      <button className="bg-[#262a33] rounded px-2 py-1" onClick={() => void autoReframe()}>📱 Reframe → 9:16 (face-tracked)</button>
    </div>
  );
  function autoCaptions() {
    const parts = text.split(/\n+/).filter(Boolean);
    commit('Captions', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips] })) };
      const tr = np.tracks.find((t) => t.id === firstTextTrack(p).id)!;
      let t0 = useEditor.getState().currentTime;
      parts.forEach((s) => { tr.clips.push({ id: uid(), type: 'caption', text: s, fontSize: 38, color: '#fff', textAlign: 'center', startTime: t0, duration: 2, position: { x: 0.5, y: 0.88 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: tr.id }); t0 += 2; });
      return np;
    });
  }
  function autoWords(style: 'hormozi' | 'karaoke' | 'stroke', wordsPerSec: number) {
    const words = text.replace(/\n+/g, ' ').split(/\s+/).map((s) => s.trim()).filter(Boolean);
    if (!words.length) return;
    const per = 1 / Math.max(0.5, wordsPerSec);
    const look: Record<string, { fontSize: number; color: string; stroke?: string; strokeW?: number; shadow?: number }> = {
      hormozi: { fontSize: 64, color: '#fff', stroke: '#000', strokeW: 7, shadow: 6 },
      karaoke: { fontSize: 56, color: '#ffe45e', stroke: '#000', strokeW: 5, shadow: 8 },
      stroke: { fontSize: 72, color: '#fff', stroke: '#000', strokeW: 10 },
    };
    const st = look[style];
    commit('Word captions', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips] })) };
      const tr = np.tracks.find((t) => t.id === firstTextTrack(p).id)!;
      let t0 = useEditor.getState().currentTime;
      const trId = tr.id;
      words.forEach((wd) => {
        tr.clips.push({
          id: uid(), type: 'caption', text: wd, textAlign: 'center',
          startTime: Math.round(t0 * 100) / 100, duration: Math.round(per * 100) / 100,
          position: { x: 0.5, y: 0.5 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1,
          trackId: trId, anim: 'fade', ...st,
        });
        t0 += per;
      });
      return np;
    });
  }
  function exportSRT() {
    const p = useEditor.getState().project;
    const caps = p.tracks.filter((t) => t.id[0] === 't').flatMap((t) => t.clips).filter((c) => c.type === 'caption' || c.type === 'text');
    const srt = caps.map((c, i) => `${i + 1}\n${ts(c.startTime)} --> ${ts(c.startTime + c.duration)}\n${c.text}\n`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([srt], { type: 'text/plain' })); a.download = 'captions.srt'; a.click();
  }
  function ts(t: number) {
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.floor((t % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }
  function speakAll() { speak(text.split('\n')[0] ?? text); }
  async function dictate() {
    if (!transcribeAvailable()) { alert('SpeechRecognition missing in this browser — type or import SRT instead.'); return; }
    try { setText(await transcribeOnce()); } catch (e) { alert(String((e as Error).message)); }
  }
  function exportVTT() {
    const p = useEditor.getState().project;
    const caps = p.tracks.filter((t) => t.id[0] === 't').flatMap((t) => t.clips).filter((c) => c.type === 'caption' || c.type === 'text');
    const vtt = 'WEBVTT\n\n' + caps.map((c) => `${vts(c.startTime)} --> ${vts(c.startTime + c.duration)}\n${c.text}\n`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' })); a.download = 'captions.vtt'; a.click();
  }
  function vts(t: number) {
    const m = Math.floor(t / 60), s = (t % 60).toFixed(3).padStart(6, '0');
    return `${String(m).padStart(2, '0')}:${s}`;
  }
  async function ttsFile() {
    const provider = prompt('Provider: 1=ElevenLabs 2=OpenAI (paste key next)', '1');
    const key = prompt('API key (browser-direct, never stored)?');
    if (!key) return;
    try {
      const mod = await import('../services/ttsKey');
      const blob = provider === '2' ? await mod.ttsOpenAI(text.slice(0, 500), key) : await mod.ttsElevenLabs(text.slice(0, 500), key);
      const url = URL.createObjectURL(blob);
      const a: import('../types').Asset = { id: uid(), kind: 'audio', name: 'AI voiceover', url, duration: 0, width: 0, height: 0, thumb: '' };
      const el = document.createElement('audio'); el.src = url;
      await new Promise((r) => { el.onloadedmetadata = () => r(null); setTimeout(() => r(null), 3000); });
      a.duration = isFinite(el.duration) ? el.duration : 5;
      useEditor.getState().addAsset(a);
      commit('Voiceover', (p) => {
        const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips] })) };
        const at = firstAudioTrack(p);
        np.tracks.find((t) => t.id === at.id)!.clips.push({ id: uid(), assetId: a.id, type: 'audio', startTime: useEditor.getState().currentTime, duration: a.duration, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, volume: 0.9, trackId: at.id });
        return np;
      });
    } catch (e) { alert('TTS failed: ' + String((e as Error).message)); }
  }
  function scanFillers() {
    const words = text.split(/\s+/).map((w, i) => ({ w: w.replace(/[.,!?]/g, ''), t: i * 0.4, d: 0.4 }));
    const hits = findFillers(words);
    alert(hits.length ? `Filler words: ${hits.map((h) => h.word).join(', ')}` : 'No filler words found.');
  }
  function analyzeBeats() {
    const st = useEditor.getState(); const sel = st.selected;
    const c = sel ? st.project.tracks.flatMap((t) => t.clips).find((x) => x.id === sel.clipId) : undefined;
    const a = c?.assetId ? st.assets.find((x) => x.id === c.assetId) : undefined;
    if (!a?.peaks) { alert('Select a music clip with waveform'); return; }
    import('../engine/beats').then(({ detectBeats }) => {
      const { bpm, beats } = detectBeats(a.peaks!, c!.duration);
      commit('Beats', (p) => ({ ...p, markers: [...p.markers, ...beats.slice(0, 20).map((b, i) => ({ id: uid(), time: c!.startTime + b, label: i === 0 ? `♩${bpm}` : '♩' }))] }));
    });
    void assets;
  }
  async function analyzeScenes() {    const st = useEditor.getState(); const sel = st.selected;
    const c = sel ? st.project.tracks.flatMap((t) => t.clips).find((x) => x.id === sel.clipId) : undefined;
    const el = c ? poolGet(c.id) : undefined;
    if (!(el instanceof HTMLVideoElement)) { alert('Select a video clip'); return; }
    const scenes = await detectScenes(el, c!.duration);
    commit('Scenes', (p) => ({ ...p, markers: [...p.markers, ...scenes.map((s, i) => ({ id: uid(), time: c!.startTime + s, label: '🎬' + (i + 1) }))] }));
    alert(`Found ${scenes.length} scenes → markers. Right-click timeline clip to split at each (use S).`);
  }
  async function beatSplit() {
    const st = useEditor.getState(); const sel = st.selected;
    const c = sel ? st.project.tracks.flatMap((t) => t.clips).find((x) => x.id === sel.clipId) : undefined;
    const a = c?.assetId ? st.assets.find((x) => x.id === c.assetId) : undefined;
    if (!a?.peaks) { alert('Select a music clip with waveform'); return; }
    const { detectBeats } = await import('../engine/beats');
    const { splitClipAt } = await import('../engine/timelineOps');
    const { beats } = detectBeats(a.peaks, c!.duration);
    const cuts = beats.map((b) => c!.startTime + b).sort((x, y) => x - y);
    if (!cuts.length) { alert('No beats found'); return; }
    commit('Beat split', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((x) => ({ ...x })) })) };
      const v1 = np.tracks.find((t) => t.id === firstVideoTrack(p).id)!;
      if (v1.locked) return p;
      let n = 0;
      for (const cut of cuts) {
        const i = v1.clips.findIndex((x) => cut > x.startTime + 0.05 && cut < x.startTime + x.duration - 0.05);
        if (i < 0) continue;
        const pair = splitClipAt(v1.clips[i], cut, p.settings.fps, uid);
        if (pair) { v1.clips.splice(i, 1, pair[0], pair[1]); n++; }
      }
      if (!n) return p;
      return np;
    });
    alert(`Split video at ${cuts.length} beat position(s).`);
  }
  async function sceneSplit() {
    const st = useEditor.getState(); const sel = st.selected;
    const c = sel ? st.project.tracks.flatMap((t) => t.clips).find((x) => x.id === sel.clipId) : undefined;
    const el = c ? poolGet(c.id) : undefined;
    if (!c || !(el instanceof HTMLVideoElement)) { alert('Select a video clip'); return; }
    const scenes = await detectScenes(el, c.duration);
    if (!scenes.length) { alert('No scene changes found'); return; }
    const { splitClipAt } = await import('../engine/timelineOps');
    const myId = c.id, myTrack = sel!.trackId;
    commit('Scene split', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((x) => ({ ...x })) })) };
      const tr = np.tracks.find((t) => t.id === myTrack)!;
      if (tr.locked) return p;
      for (const s of [...scenes].sort((x, y) => x - y)) {
        const cut = c.startTime + s;
        const i = tr.clips.findIndex((x) => cut > x.startTime + 0.05 && cut < x.startTime + x.duration - 0.05);
        if (i < 0) continue;
        const pair = splitClipAt(tr.clips[i], cut, p.settings.fps, uid);
        if (pair) tr.clips.splice(i, 1, pair[0], pair[1]);
      }
      return np;
    });
    void myId;
  }
  async function autoReframe() {
    const st = useEditor.getState(); const sel = st.selected;
    const c = sel ? st.project.tracks.flatMap((t) => t.clips).find((x) => x.id === sel.clipId) : undefined;
    const el = c ? poolGet(c.id) : undefined;
    if (!c || !(el instanceof HTMLVideoElement)) { alert('Select a video clip to reframe'); return; }
    if (!confirm('Reframe this clip to 9:16 with face-tracked pan-scan? Adds animated crop keyframes.')) return;
    const { detectFace } = await import('../engine/tracker');
    const vw = el.videoWidth || 16, vh = el.videoHeight || 9;
    const cropW = Math.min(1, (9 / 16) / (vw / vh));
    const seek = (t: number) => new Promise<void>((res) => {
      const h = () => { el.removeEventListener('seeked', h); res(); };
      el.addEventListener('seeked', h);
      try { el.currentTime = Math.min(Math.max(0, t), (el.duration || 1) - 0.05); } catch { res(); }
      setTimeout(res, 900);
    });
    const samples: { dt: number; x: number }[] = [];
    const n = Math.max(3, Math.min(12, Math.round(c.duration / 1)));
    for (let i = 0; i <= n; i++) {
      const dt = (i / n) * (c.duration - 0.05);
      await seek((c.sourceStart ?? 0) + dt);
      const f = await detectFace(el).catch(() => null);
      const fx = f ? f.x : 0.5;
      samples.push({ dt, x: Math.max(0, Math.min(1 - cropW, fx - cropW / 2)) });
      await new Promise((r) => setTimeout(r, 30));
    }
    st.set({ aspect: '9:16' });
    commit('Auto reframe', (p) => ({
      ...p,
      tracks: p.tracks.map((t) => t.id === sel!.trackId ? {
        ...t,
        clips: t.clips.map((x) => x.id === sel!.clipId ? {
          ...x,
          crop: { x: samples[0].x, y: 0, w: cropW, h: 1 },
          keyframes: [
            ...(x.keyframes ?? []).filter((k) => k.prop !== 'cropX'),
            ...samples.map((s, i) => ({ id: uid() + i, dt: s.dt, prop: 'cropX', value: s.x })),
          ],
        } : x),
      } : t),
    }));
    alert(`Reframed to 9:16 with ${samples.length} tracking keyframes.`);
  }
}
export function TransitionsGrid({ applyTrans }: { applyTrans: (t: 'fade' | 'wipe' | 'slide' | 'dissolve' | 'glitch' | 'zoom' | 'blur' | 'circle' | 'pixelate' | 'light', dur?: number) => void }) {
  const [dur, setDur] = useState(0.5);
  return (
    <div>
      <div className="grid grid-cols-5 gap-1.5">
        {TRANSITIONS.map((it) => (
          <button key={it.id} onClick={() => applyTrans(it.id, dur)}
            className="rounded-lg overflow-hidden bg-[#1d2027] border border-[#2c313b] hover:border-cyan-400/60" title={`${it.label} ${dur}s — click to apply to selected clip`}>
            <span className="block h-9" style={{ background: it.sw }} />
            <span className="block py-1 text-[10px] font-bold">{it.label}</span>
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 mt-1.5 text-[11px] text-gray-400">Duration
        <input type="range" min={0.1} max={2} step={0.1} value={dur} onChange={(e) => setDur(Number(e.target.value))} className="flex-1" />
        <span className="mono">{dur.toFixed(1)}s</span>
      </label>
    </div>
  );
}
export function TemplatesPanel() {
  const commit = useEditor((s) => s.commit);
  const assets = useEditor((s) => s.assets);
  return (
    <div className="p-2 text-xs space-y-2">
      <h4 className="text-gray-400">TEMPLATES</h4>
      {templates.map((t) => (
        <button key={t.name} className="w-full bg-[#1d2027] border border-[#2c313b] rounded p-2 text-left" onClick={() => {
          const vids = assets.filter((a) => a.kind === 'video').map((a) => a.id);
          if (!vids.length) { alert('Import videos first'); return; }
          commit('Template', (p) => { const np = { ...p, tracks: p.tracks.map((x) => ({ ...x, clips: [...x.clips] })) }; t.build(np, vids); return np; });
        }}>{t.name}</button>
      ))}
      <p className="text-gray-400">Filler scan lives in Caps tab (works on caption text).</p>
    </div>
  );
}
