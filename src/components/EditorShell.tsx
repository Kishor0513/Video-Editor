import { useEffect, useState } from 'react';
import { useEditor, totalDuration, timecode } from '../state/projectStore';
import TopBar from './TopBar';
import MediaPanel from './MediaPanel';
import Preview from './Preview';
import Timeline from './Timeline';
import Inspector from './Inspector';
import { Toolbar } from './ProPanels';
export default function EditorShell() {
  const playing = useEditor((s) => s.playing);
  const currentTime = useEditor((s) => s.currentTime);
  const project = useEditor((s) => s.project);
  const rate = useEditor((s) => s.rate);
  const loop = useEditor((s) => s.loop);
  const set = useEditor((s) => s.set);
  const tot = Math.max(1, totalDuration(project));
  const fps = project.settings.fps;
  const step = (frames: number) => {
    const st = useEditor.getState();
    st.set({ currentTime: Math.max(0, Math.min(totalDuration(st.project), st.currentTime + (frames / st.project.settings.fps))) });
  };
  const [recover, setRecover] = useState<{ updatedAt: string; clips: number } | null>(null);
  const [onboard, setOnboard] = useState(false);
  useEffect(() => {
    let saved: { updatedAt?: string; tracks?: { clips?: unknown[] }[] } | null = null;
    try {
      const raw = localStorage.getItem('cutforge-autosave');
      if (raw) saved = JSON.parse(raw);
    } catch { /* noop */ }
    const clips = saved?.tracks?.reduce((n, t) => n + (t.clips?.length ?? 0), 0) ?? 0;
    if (saved && clips > 0) setRecover({ updatedAt: saved.updatedAt ?? 'unknown', clips });
    else if (!localStorage.getItem('cutforge-onboarded')) setOnboard(true);
    import('../services/collab').then(({ subscribe }) => subscribe((p) => {
      const cur = useEditor.getState().project;
      if (p.updatedAt > cur.updatedAt) set({ project: p, selected: null });
    }));
    const iv = setInterval(() => {
      import('../services/collab').then(({ publish }) => publish(useEditor.getState().project));
      import('../services/storage').then(({ saveVersion }) => saveVersion(useEditor.getState().project).catch(() => undefined));
    }, 5000);
    return () => clearInterval(iv);
  }, [set]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '');
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        const st = useEditor.getState();
        // Space resumes at 1x; K-style stop keeps rate reset
        st.set(st.playing ? { playing: false, rate: 1 } : { playing: true, rate: 1 });
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.shiftKey) {
        const sel = useEditor.getState().selected; if (!sel) return;
        useEditor.getState().commit('Delete', (p) => ({ ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !(t.id === sel.trackId && c.id === sel.clipId)) })) }));
        set({ selected: null });
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [set]);
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TopBar />
      <Toolbar />
      <div className="flex-1 flex min-h-0">
        <MediaPanel />
        <div className="flex-1 flex flex-col min-w-0">
          <Preview />
          <div className="flex items-center gap-1.5 px-3 py-2 bg-[#16181d] border-t border-[#2c313b] text-sm">
            <button onClick={() => set({ currentTime: 0 })} className="bg-[#262a33] hover:bg-[#313744] rounded px-2 py-1" title="Go to start (Home)">⏮</button>
            <button onClick={() => step(-1)} className="bg-[#262a33] hover:bg-[#313744] rounded px-2 py-1" title="Step back 1 frame (←)">‹1f</button>
            <button onClick={() => { const st = useEditor.getState(); st.set(st.playing ? { playing: false, rate: 1 } : { playing: true, rate: 1 }); }} className="bg-violet-500 hover:bg-violet-400 rounded px-3 py-1 font-bold min-w-[86px]" title="Play/Pause (Space · K stops · J/L shuttle)">{playing ? '⏸ Pause' : '▶ Play'}</button>
            <button onClick={() => step(1)} className="bg-[#262a33] hover:bg-[#313744] rounded px-2 py-1" title="Step forward 1 frame (→)">1f›</button>
            <button onClick={() => set({ currentTime: Math.max(0, tot - 0.01) })} className="bg-[#262a33] hover:bg-[#313744] rounded px-2 py-1" title="Go to end (End)">⏭</button>
            <button onClick={() => set({ loop: !loop })} className={`rounded px-2 py-1 font-bold ${loop ? 'bg-emerald-500 text-white' : 'bg-[#262a33] text-gray-400'}`} title="Loop playback">🔁</button>
            {rate !== 1 && playing && <span className="bg-amber-400/15 text-amber-300 border border-amber-400/30 rounded px-2 py-0.5 mono text-xs font-bold">{rate > 0 ? `${rate}x ▸` : `${rate}x ◂`}</span>}
            <input type="range" min={0} max={2000} value={Math.round((currentTime / tot) * 2000)}
              onChange={(e) => set({ currentTime: (Number(e.target.value) / 2000) * tot })} className="flex-1" aria-label="Seek" />
            <span className="mono text-xs bg-black/40 rounded px-2 py-0.5" title="HH:MM:SS:FF">{timecode(currentTime, fps)} / {timecode(tot, fps)}</span>
          </div>
        </div>
        <Inspector />
      </div>
      <Timeline />
      {recover && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" role="dialog" aria-label="Recover project">
          <div className="bg-[#16181d] border border-[#2c313b] rounded-xl p-4 w-[380px]">
            <h3 className="font-bold mb-1">Recover unsaved project?</h3>
            <p className="text-xs text-gray-400 mb-3">Autosave from {recover.updatedAt} · {recover.clips} clips. Your last session may have ended unexpectedly.</p>
            <div className="flex gap-2">
              <button onClick={() => {
                try {
                  const raw = localStorage.getItem('cutforge-autosave');
                  if (raw) set({ project: JSON.parse(raw), selected: null, currentTime: 0 });
                } catch { /* noop */ }
                setRecover(null);
              }} className="bg-violet-500 rounded px-3 py-1 font-bold">Recover</button>
              <button onClick={() => setRecover(null)} className="bg-[#262a33] rounded px-3 py-1">Start fresh</button>
            </div>
          </div>
        </div>
      )}
      {onboard && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" role="dialog" aria-label="Welcome">
          <div className="bg-[#16181d] border border-[#2c313b] rounded-xl p-4 w-[420px]">
            <h3 className="font-bold mb-1">✂ Welcome to CutForge Pro</h3>
            <ol className="text-xs text-gray-300 space-y-1 my-3 list-decimal list-inside">
              <li>Import video, image or audio (Media tab) — or load the demo pack.</li>
              <li>Drag assets onto the timeline; drag clip edges to trim, body to move.</li>
              <li>Press <b>S</b> to split at the playhead, <b>Space</b> to play.</li>
              <li>Add text, captions, effects from the left panel; tune in the Inspector.</li>
              <li>Export → 1080p MP4, rendered locally in your browser.</li>
            </ol>
            <div className="flex gap-2">
              <button onClick={() => { localStorage.setItem('cutforge-onboarded', '1'); setOnboard(false); }} className="bg-violet-500 rounded px-3 py-1 font-bold">Start editing</button>
              <button onClick={() => { localStorage.setItem('cutforge-onboarded', '1'); setOnboard(false); }} className="bg-[#262a33] rounded px-3 py-1">Load demo from Media → Demo</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
