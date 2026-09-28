import { useEditor } from '../state/projectStore';
import ExportDialog from './ExportDialog';
import ShortcutsPanel from './ShortcutsPanel';
export default function TopBar() {
  const project = useEditor((s) => s.project);
  const set = useEditor((s) => s.set);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const aspect = useEditor((s) => s.aspect);
  return (
    <div className="h-[50px] flex items-center gap-2 px-3 bg-[#0f1114] border-b border-[#2c313b]">
      <div className="font-extrabold text-[15px]">◈ <span className="text-white">CutForge</span> <span className="text-[10px] align-middle bg-cyan-400 text-black rounded px-1 ml-1">PRO</span></div>
      <input className="bg-transparent border border-transparent hover:border-[#2c313b] rounded px-2 py-1 w-44 text-sm" value={project.name}
        onChange={(e) => useEditor.getState().commit('Rename', (p) => ({ ...p, name: e.target.value }))} />
      <div className="flex bg-[#1d2027] border border-[#2c313b] rounded-lg overflow-hidden" title="Canvas ratio — like CapCut's Ratio button">
        {([['16:9', '🖥'], ['9:16', '📱'], ['1:1', '⬛']] as const).map(([a, icon]) => (
          <button key={a} aria-label={'Aspect ' + a} onClick={() => set({ aspect: a })} className={`px-2.5 py-1 text-xs font-bold ${aspect === a ? 'bg-white text-black' : 'text-gray-400 hover:text-white'}`}>{icon} {a}</button>
        ))}
      </div>
      <select aria-label="FPS" value={project.settings.fps} onChange={(e) => useEditor.getState().commit('FPS', (p) => ({ ...p, settings: { ...p.settings, fps: Number(e.target.value) } }))} className="bg-[#1d2027] rounded text-xs p-1">
        {[24, 25, 30, 50, 60].map((f) => <option key={f} value={f}>{f}fps</option>)}
      </select>
      <select aria-label="Preview quality" value={useEditor((s) => s.previewQuality)} onChange={(e) => set({ previewQuality: e.target.value as 'Full' | 'Half' | 'Quarter' })} className="bg-[#1d2027] rounded text-xs p-1">
        {['Full', 'Half', 'Quarter'].map((q) => <option key={q}>{q}</option>)}
      </select>
      <button aria-label="Versions" onClick={async () => {
        const { listVersions } = await import('../services/storage');
        const vs = await listVersions(project.id);
        if (!vs.length) { alert('No versions yet (autosaves on edit).'); return; }
        if (confirm(`Restore version from ${vs[0].updatedAt}?`)) set({ project: vs[0], selected: null });
      }} className="px-2 py-1 bg-[#262a33] rounded text-xs">🕘 Versions</button>
      <button onClick={undo} className="px-2 py-1 bg-[#262a33] rounded">↩</button>
      <button onClick={redo} className="px-2 py-1 bg-[#262a33] rounded">↪</button>
      <button onClick={() => {
        const p = useEditor.getState().project;
        try { localStorage.setItem('cutforge-autosave', JSON.stringify(p)); } catch { /* noop */ }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(p)], { type: 'application/json' }));
        a.download = p.name.replace(/[^\w-]+/g, '_') + '.editor.json'; a.click();
      }} className="px-2 py-1 bg-[#262a33] rounded text-xs">💾 Save</button>
      <label className="px-2 py-1 bg-[#262a33] rounded text-xs cursor-pointer">📂 Open
        <input type="file" accept=".json" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0]; if (!f) return;
          const r = new FileReader();
          r.onload = () => { try { set({ project: JSON.parse(String(r.result)), selected: null, currentTime: 0 }); } catch { alert('Bad project file'); } };
          r.readAsText(f);
        }} />
      </label>
      <div className="ml-auto flex items-center gap-2">
        <span id="dl" className="text-sm" />
        <ShortcutsPanel />
        <ExportDialog />
      </div>
    </div>
  );
}
