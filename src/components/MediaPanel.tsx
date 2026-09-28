import { useEffect, useRef, useState } from 'react';
import { useEditor, uid, totalDuration, firstVideoTrack, firstAudioTrack, firstTextTrack } from '../state/projectStore';
import { fileToAsset } from '../services/media';
import { FXPanel, CaptionsPanel, TemplatesPanel, AudioPanel, StickersPanel, TransitionsPanel, FiltersPanel, AdjustPanel } from './ProPanels';
import { DEMO_FILES, fetchDemoFile, buildReel, buildYoutube } from '../services/demo';
import type { Asset, Clip } from '../types';

const LIB_KEY = 'cutforge-library';

type Tab = 'media' | 'demo' | 'text' | 'fx' | 'caps' | 'tpl' | 'audio' | 'stickers' | 'transitions' | 'filters' | 'adjust';

export default function MediaPanel() {
  const assets = useEditor((s) => s.assets);
  const addAsset = useEditor((s) => s.addAsset);
  const commit = useEditor((s) => s.commit);
  const set = useEditor((s) => s.set);
  const [tab, setTab] = useState<Tab>('media');
  const [busy, setBusy] = useState('');
  const [query, setQuery] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [restored, setRestored] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Restore persisted library (IndexedDB blobs -> object URLs, then cloud merge) once
  useEffect(() => {
    if (restored) return;
    setRestored(true);
    (async () => {
      try {
        const raw = localStorage.getItem(LIB_KEY);
        if (raw && !useEditor.getState().assets.length) {
          const meta = JSON.parse(raw) as (Omit<Asset, 'url' | 'thumb'> & { thumb?: string })[];
          if (meta.length) {
            const { getAssetBlob } = await import('../services/storage');
            const out: Asset[] = [];
            for (const m of meta) {
              const blob = await getAssetBlob(m.id);
              if (!blob) continue;
              const url = URL.createObjectURL(blob);
              out.push({ ...m, url, thumb: m.kind === 'image' ? url : (m.thumb || '') } as Asset);
            }
            if (out.length) set({ assets: out });
          }
        }
      } catch { /* noop */ }
    })();
  }, [restored, set]);

  // Persist library index whenever assets change
  useEffect(() => {
    try {
      const meta = assets.map((a) => {
        const { url: _url, ...m } = a;
        void _url;
        return m;
      });
      localStorage.setItem(LIB_KEY, JSON.stringify(meta));
    } catch { /* quota */ }
  }, [assets]);

  const shown = assets.filter((a) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return a.name.toLowerCase().includes(q) || a.kind.includes(q);
  });

  const persistBlob = async (id: string, file: File | Blob) => {
    try {
      const { saveAssetBlob } = await import('../services/storage');
      await saveAssetBlob(id, file instanceof File ? file : new File([file], id));
    } catch { /* noop */ }
  };

  const onFiles = async (files: FileList | File[] | null) => {
    if (!files || [...files].length === 0) return;
    const { validateFile } = await import('../services/security');
    const { track } = await import('../services/analytics');
    setTab('media'); // stay right here on the media tab
    setQuery(''); // clear filter so the new import is visible
    for (const f of [...files] as File[]) {
      const v = validateFile(f);
      if (!v.ok) { alert(v.reason); continue; }
      setBusy(`Importing ${f.name}…`);
      try {
        const a = await fileToAsset(f);
        addAsset(a);
        void persistBlob(a.id, f);
        track('media_uploaded', { kind: f.type });
      } catch { alert('Unsupported file: ' + f.name); }
    }
    setBusy('');
    track('clip_added');
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: 0, behavior: 'smooth' }));
  };

  const removeAsset = async (id: string) => {
    const used = useEditor.getState().project.tracks.some((t) => t.clips.some((c) => c.assetId === id));
    if (used && !confirm('This media is used on the timeline. Remove anyway?')) return;
    set({ assets: useEditor.getState().assets.filter((a) => a.id !== id) });
    try {
      const { deleteAssetBlob } = await import('../services/storage');
      await deleteAssetBlob(id);
    } catch { /* noop */ }
  };

  const addToTimeline = (id: string) => {
    const a = useEditor.getState().assets.find((x) => x.id === id); if (!a) return;
    commit('Add clip', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips] })) };
      const at = useEditor.getState().currentTime; // insert at playhead, not end
      if (a.kind === 'audio') {
        const anchor = firstAudioTrack(p);
        const tr = np.tracks.find((t) => t.id === anchor.id)!;
        if (tr.locked) return p;
        tr.clips.push({ id: uid(), assetId: a.id, type: 'audio', startTime: at, duration: a.duration || 5, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, volume: 0.9, trackId: tr.id });
      } else {
        const anchor = firstVideoTrack(p);
        const tr = np.tracks.find((t) => t.id === anchor.id)!;
        if (tr.locked) return p;
        const c: Clip = { id: uid(), assetId: a.id, type: a.kind, startTime: at, duration: a.kind === 'image' ? 3 : a.duration || 5, sourceStart: 0, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, volume: 1, speed: 1, trackId: tr.id, filters: { br: 100, ct: 100, st: 100, gr: 0, sp: 0, bl: 0 } };
        tr.clips.push(c);
      }
      return np;
    });
  };

  const addTextPreset = (preset: { text: string; fontSize: number; color: string; stroke?: string; strokeW?: number; shadow?: number; anim?: string }) => {
    commit('Add text', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips] })) };
      const anchor = firstTextTrack(p);
      np.tracks.find((t) => t.id === anchor.id)!.clips.push({
        id: uid(), type: 'text', startTime: useEditor.getState().currentTime, duration: 3,
        position: { x: 0.5, y: 0.42 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1,
        textAlign: 'center', trackId: anchor.id, ...preset,
      });
      return np;
    });
  };

  // CapCut-style left rail
  const tabs: { id: Tab; icon: string; label: string }[] = [
    { id: 'media', icon: '🖼', label: `Media` },
    { id: 'audio', icon: '♫', label: 'Audio' },
    { id: 'text', icon: 'T', label: 'Text' },
    { id: 'stickers', icon: '😀', label: 'Stickers' },
    { id: 'transitions', icon: '⇄', label: 'Transit.' },
    { id: 'filters', icon: '🎨', label: 'Filters' },
    { id: 'adjust', icon: '🎚', label: 'Adjust' },
    { id: 'caps', icon: '💬', label: 'Captions' },
    { id: 'tpl', icon: '📐', label: 'Templ.' },
    { id: 'fx', icon: '✨', label: 'FX' },
    { id: 'demo', icon: '🎬', label: 'Demo' },
  ];
  const titles: Record<Tab, string> = { media: `Media${assets.length ? ` (${assets.length})` : ''}`, audio: 'Audio', text: 'Text', stickers: 'Stickers', transitions: 'Transitions', filters: 'Filters', adjust: 'Adjust', caps: 'Captions', fx: 'Effects (all)', tpl: 'Templates', demo: 'Demo' };

  return (
    <div className="w-[320px] bg-[#16181d] border-r border-[#2c313b] flex shrink-0 min-h-0">
      <div className="w-[64px] bg-[#101216] border-r border-[#2c313b] flex flex-col items-center py-2 gap-1 shrink-0 overflow-y-auto">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} title={t.label}
            className={`w-[52px] py-1.5 rounded-lg flex flex-col items-center gap-0.5 ${tab === t.id ? 'bg-[#262a33] text-white' : 'text-gray-400 hover:text-gray-100 hover:bg-[#1a1d23]'}`}>
            <span className="text-base leading-none font-extrabold">{t.icon}</span>
            <span className="text-[9px] font-bold">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 flex flex-col min-w-0">
      <div className="px-2.5 py-2 border-b border-[#2c313b] font-bold text-[13px]">{titles[tab]}</div>
      <div ref={listRef} className="flex-1 overflow-auto p-2 min-h-0">
        {(tab === 'media') && (
          <>
            <label
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); void onFiles(e.dataTransfer.files); }}
              className={`block border border-dashed rounded-lg p-3 text-center cursor-pointer mb-2 transition-colors ${dragOver ? 'border-violet-400 bg-violet-500/10 text-white' : 'border-[#2c313b] text-gray-400 hover:border-violet-500/50'}`}>
              <div className="text-sm">📼 {busy || 'Import video / image / audio'}</div>
              <div className="text-[11px] opacity-70 mt-0.5">click or drop files here · stays in your library</div>
              <input type="file" multiple accept="video/*,image/*,audio/*" className="hidden" onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
            </label>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 Search library…" className="w-full bg-[#1d2027] rounded p-1.5 mb-2 text-xs" aria-label="Search media" />
            {!assets.length && !busy && (
              <p className="text-[11px] text-gray-500 text-center py-4">Library empty — import files above.<br />They persist across reloads.</p>
            )}
            {shown.map((a) => (
              <div key={a.id} className="group flex gap-2 bg-[#1d2027] border border-[#2c313b] hover:border-violet-500/40 rounded-lg p-1.5 mb-2 items-center" draggable
                onDragStart={(e) => e.dataTransfer.setData('text/asset-id', a.id)}>
                {a.thumb ? <img src={a.thumb} className="w-16 h-9 object-cover rounded bg-black shrink-0" alt="" draggable={false} /> : <div className="w-16 h-9 bg-black rounded flex items-center justify-center shrink-0">♫</div>}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs" title={a.name}>{a.name}</div>
                  <div className="mono text-[10px] text-gray-400">{a.kind}{a.duration ? ` · ${a.duration.toFixed(1)}s` : ''}</div>
                </div>
                <div className="flex flex-col gap-1">
                  <button onClick={() => addToTimeline(a.id)} title="Insert at playhead (or drag to timeline)" className="bg-violet-500 hover:bg-violet-400 rounded px-2 py-0.5 text-xs font-bold">+ Add</button>
                  <button onClick={() => void removeAsset(a.id)} title="Remove from library" className="text-gray-500 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100">✕</button>
                </div>
              </div>
            ))}
            {!!assets.length && !shown.length && <p className="text-[11px] text-gray-500 text-center">No match for “{query}”.</p>}
          </>
        )}
        {tab === 'text' && (
          <div className="space-y-2">
            <button onClick={() => addTextPreset({ text: 'Your text', fontSize: 52, color: '#fff' })} className="w-full bg-[#262a33] hover:bg-[#313744] rounded-lg p-2.5 text-sm font-bold">＋ Default text</button>
            <p className="text-[11px] text-gray-500 font-bold">CAPCUT-STYLE PRESETS — tap to add at playhead</p>
            <div className="grid grid-cols-2 gap-1.5">
              {(['Title', 'Subtitle', 'Stroke', 'Neon', 'Bubble', 'Fade in'] as string[]).map((label) => {
                const presets: Record<string, { text: string; fontSize: number; color: string; stroke?: string; strokeW?: number; shadow?: number; anim?: string }> = {
                  Title: { text: 'TITLE', fontSize: 72, color: '#fff', stroke: '#000', strokeW: 6, shadow: 8 },
                  Subtitle: { text: 'Subtitle here', fontSize: 38, color: '#fff', shadow: 6 },
                  Stroke: { text: 'BOLD', fontSize: 84, color: '#fff', stroke: '#000', strokeW: 10 },
                  Neon: { text: 'Neon night', fontSize: 64, color: '#5eead4', shadow: 18 },
                  Bubble: { text: 'Hey! 🔥', fontSize: 60, color: '#1a1a1a', stroke: '#fff', strokeW: 8 },
                  'Fade in': { text: 'Cinematic', fontSize: 56, color: '#ffe45e', anim: 'fade', shadow: 8 },
                };
                const preset = presets[label];
                return (
                <button key={label} onClick={() => addTextPreset({ ...preset })} className="rounded-lg p-2.5 bg-[#1d2027] border border-[#2c313b] hover:border-cyan-400/50"
                  style={{ color: preset.color, textShadow: preset.shadow ? '0 2px 12px rgba(0,0,0,.7)' : undefined, WebkitTextStroke: preset.strokeW ? `2px ${preset.stroke}` : undefined }}>
                  <span className="block font-extrabold text-sm" style={{ fontSize: 15 }}>{label}</span>
                  <span className="block text-[10px] text-gray-400">tap to add</span>
                </button>
                );
              })}
            </div>
          </div>
        )}
        {tab === 'demo' && <DemoBox onImported={() => setTab('media')} />}
        {tab === 'fx' && <FXPanel />}
        {tab === 'caps' && <CaptionsPanel />}
        {tab === 'tpl' && <TemplatesPanel />}
        {tab === 'audio' && <AudioPanel />}
        {tab === 'stickers' && <StickersPanel />}
        {tab === 'transitions' && <TransitionsPanel />}
        {tab === 'filters' && <FiltersPanel />}
        {tab === 'adjust' && <AdjustPanel />}
      </div>
      {tab === 'media' && assets.length > 0 && (
        <div className="px-2 py-1.5 border-t border-[#2c313b] text-[11px] text-gray-400 flex justify-between">
          <span>{assets.length} file{assets.length === 1 ? '' : 's'} · {totalDuration(useEditor.getState().project).toFixed(1)}s timeline</span>
          <span className="text-gray-500">drag → timeline</span>
        </div>
      )}
      </div>
    </div>
  );
}
function DemoBox({ onImported }: { onImported?: () => void }) {
  const assets = useEditor((s) => s.assets);
  const addAsset = useEditor((s) => s.addAsset);
  const commit = useEditor((s) => s.commit);
  const set = useEditor((s) => s.set);
  const [busy, setBusy] = useState('');
  const loadAll = async () => {
    setBusy('Downloading demo assets…');
    const { fileToAsset } = await import('../services/media');
    for (const f of DEMO_FILES) {
      if (useEditor.getState().assets.some((a) => a.name === f.name)) continue;
      try {
        const file = await fetchDemoFile(f.url, f.name);
        addAsset(await fileToAsset(file));
        try {
          const { saveAssetBlob } = await import('../services/storage');
          const st = useEditor.getState();
          const added = st.assets.find((a) => a.name === f.name);
          if (added) await saveAssetBlob(added.id, file);
        } catch { /* noop */ }
      }
      catch { alert('Could not fetch ' + f.name + ' (need `npm run dev` server, not file://)'); break; }
    }
    setBusy('');
    onImported?.();
  };
  const build = async (kind: 'reel' | 'youtube') => {
    await loadAll();
    const st = useEditor.getState();
    const byName = (n: string) => st.assets.find((a) => a.name === n);
    set({ aspect: kind === 'reel' ? '9:16' : '16:9' });
    commit(kind === 'reel' ? 'Reel demo' : 'YouTube demo', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [] })) };
      if (kind === 'reel') buildReel(np, byName);
      else buildYoutube(np, byName);
      return np;
    });
    set({ currentTime: 0 });
  };
  void assets;
  return (
    <div className="text-xs space-y-2">
      <p className="text-gray-400">Free-to-edit pack: CC0/CC-BY clips, Unsplash thumbs, original cards + synth music.</p>
      <button onClick={() => void loadAll()} className="w-full bg-[#262a33] rounded p-2">⬇ Download all assets {busy}</button>
      <button onClick={() => void build('reel')} className="w-full bg-violet-500 rounded p-2 font-bold">📱 Build 9:16 Reel (~10s)</button>
      <button onClick={() => void build('youtube')} className="w-full bg-violet-500 rounded p-2 font-bold">📺 Build 16:9 YouTube (~14s)</button>
    </div>
  );
}
