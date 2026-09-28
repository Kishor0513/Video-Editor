import { useEffect, useState } from 'react';
import { useEditor, totalDuration } from '../state/projectStore';
import { pickWebMMime } from '../engine/export';
import { drawComposition, estimateBytes, exportSize } from '../engine/compositor';
import { ensureAudio, audioCtx, mixStream } from '../engine/audio';
import { can } from '../services/auth';
interface Job { id: string; label: string; status: string; progress: number; url?: string; name: string; }
export default function ExportDialog() {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [res, setRes] = useState('720p');
  const [fmt, setFmt] = useState<'webm' | 'mp4'>('webm');
  const [gpu, setGpu] = useState<{ ok: boolean; hardwarePreferred: boolean } | null>(null);
  const [watermark, setWatermark] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const aspect = useEditor((s) => s.aspect);
  useEffect(() => {
    if (!open || fmt !== 'mp4') return;
    let live = true;
    setGpu(null);
    import('../engine/gpuExport').then(({ supportsGpuEncode }) => {
      const { w, h } = exportSize(res, useEditor.getState().aspect);
      supportsGpuEncode(w, h, bitrateFor(res)).then((g) => { if (live) setGpu(g); }).catch(() => { if (live) setGpu({ ok: false, hardwarePreferred: false }); });
    }).catch(() => { if (live) setGpu({ ok: false, hardwarePreferred: false }); });
    return () => { live = false; };
  }, [open, fmt, res, aspect]);
  const project = useEditor((s) => s.project);
  const bitrateFor = (r: string) => (r === '4K' ? 20000000 : r === '1080p' ? 10000000 : r === '480p' ? 2500000 : 8000000);
  const captureWebM = async (tot: number, id: string): Promise<Blob> => {
    ensureAudio(); await audioCtx()?.resume().catch(() => undefined);
    const st0 = useEditor.getState();
    const { w, h } = exportSize(res, st0.aspect);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.style.cssText = 'position:fixed;left:0;bottom:0;width:160px;opacity:0.9;pointer-events:none;z-index:60;border:1px solid #444;';
    cv.title = `Export render ${w}×${h}`;
    document.body.appendChild(cv);
    let raf = 0;
    const paint = () => {
      raf = requestAnimationFrame(paint);
      const st = useEditor.getState();
      try { drawComposition(st.project, st.assets, st.currentTime, cv); } catch { /* noop */ }
      if (watermark) {
        const g = cv.getContext('2d')!;
        g.save();
        g.font = `700 ${Math.round(h * 0.028)}px Inter, Arial`;
        g.textAlign = 'right'; g.textBaseline = 'bottom';
        g.fillStyle = 'rgba(255,255,255,0.75)';
        g.fillText('CutForge', w - h * 0.02, h - h * 0.015);
        g.restore();
      }
    };
    paint();
    const tracks: MediaStreamTrack[] = [...cv.captureStream(30).getVideoTracks()];
    mixStream()?.getAudioTracks().forEach((t) => tracks.push(t));
    const mime = pickWebMMime();
    const rec = new MediaRecorder(new MediaStream(tracks), mime ? { mimeType: mime, videoBitsPerSecond: bitrateFor(res) } : undefined);
    const chunks: Blob[] = []; rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((r) => { rec.onstop = r; });
    useEditor.getState().set({ currentTime: 0, playing: true }); rec.start(250);
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const step = () => {
        const el = (performance.now() - t0) / 1000;
        setJobs((js) => js.map((j) => j.id === id ? { ...j, progress: Math.min(99, (el / tot) * 100) } : j));
        if (el >= tot) resolve(); else requestAnimationFrame(step);
      }; requestAnimationFrame(step);
    });
    try { rec.stop(); } catch { /* noop */ }
    await done;
    cancelAnimationFrame(raf);
    cv.remove();
    useEditor.getState().set({ playing: false, currentTime: 0 });
    return new Blob(chunks, { type: 'video/webm' });
  };
  const autoDownload = (url: string, name: string) => {
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  };
  const start = async () => {
    const tot = totalDuration(project); if (!tot) { alert('Add clips first'); return; }
    const name = `${project.name.replace(/[^\w-]+/g, '_')}.${fmt}`;
    const id = String(Date.now());
    setJobs((j) => [...j, { id, label: `${project.name} ${res} ${fmt.toUpperCase()} (local)`, status: fmt === 'mp4' ? 'Capturing…' : 'Rendering…', progress: 0, name }]);
    // MP4: GPU hardware encode first (direct MP4, no transcode), CPU fallback after.
    if (fmt === 'mp4') {
      try {
        const { supportsGpuEncode, captureMp4Gpu, captureMp4GpuFast } = await import('../engine/gpuExport');
        const { w, h } = exportSize(res, useEditor.getState().aspect);
        const sup = await supportsGpuEncode(w, h, bitrateFor(res));
        if (sup.ok) {
          const fast = speed > 1;
          setJobs((js) => js.map((j) => j.id === id ? { ...j, status: `Capturing (GPU${sup.hardwarePreferred ? ', hardware' : ''}${fast ? ` · ${speed}x fast` : ''})…` } : j));
          const out = fast
            ? await captureMp4GpuFast(tot, w, h, bitrateFor(res), speed as 2 | 4, (p, fps) =>
                setJobs((js) => js.map((j) => j.id === id ? { ...j, progress: p, status: `Capturing (GPU ${speed}x · ${fps.toFixed(0)} fps)…` } : j)), watermark)
            : await captureMp4Gpu(tot, w, h, bitrateFor(res), (p, fps) =>
                setJobs((js) => js.map((j) => j.id === id ? { ...j, progress: p, status: `Capturing (GPU · ${fps.toFixed(0)} fps)…` } : j)), watermark);
          const url = URL.createObjectURL(out.blob);
          setJobs((js) => js.map((j) => j.id === id ? { ...j, status: `Complete · ${(out.blob.size / 1048576).toFixed(1)} MB · ${out.engine} · ${out.encodeFps.toFixed(0)} fps`, progress: 100, url } : j));
          autoDownload(url, name);
          return;
        }
      } catch (e) {
        setJobs((js) => js.map((j) => j.id === id ? { ...j, status: 'GPU unavailable, CPU fallback…' } : j));
        void e;
      }
    }
    // keep dialog open so progress + download link stay visible
    const webm = await captureWebM(tot, id);
    if (fmt === 'webm') {
      const url = URL.createObjectURL(webm);
      setJobs((js) => js.map((j) => j.id === id ? { ...j, status: `Complete · ${(webm.size / 1048576).toFixed(1)} MB`, progress: 100, url } : j));
      autoDownload(url, name);
      return;
    }
    setJobs((js) => js.map((j) => j.id === id ? { ...j, status: 'Transcoding MP4 (ffmpeg.wasm)…', progress: 99 } : j));
    try {
      const { webmToMp4 } = await import('../services/mp4');
      const mp4 = await webmToMp4(webm, (p) => setJobs((js) => js.map((j) => j.id === id ? { ...j, progress: 99 + p } : j)));
      const url = URL.createObjectURL(mp4);
      setJobs((js) => js.map((j) => j.id === id ? { ...j, status: `Complete · ${(mp4.size / 1048576).toFixed(1)} MB`, progress: 100, url } : j));
      autoDownload(url, name);
    } catch (e) {
      const url = URL.createObjectURL(webm);
      setJobs((js) => js.map((j) => j.id === id ? { ...j, status: 'MP4 failed, WebM kept: ' + String((e as Error).message), progress: 100, url } : j));
      autoDownload(url, name);
    }
  };
  return (
    <>
      <button onClick={() => setOpen(true)} className="bg-[#2f7cf6] hover:bg-[#4a90ff] px-5 py-1.5 rounded-lg font-bold text-white" title="Export — like CapCut's top-right button">Export</button>
      {open && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" role="dialog" aria-label="Export">
          <div className="bg-[#16181d] border border-[#2c313b] rounded-xl p-4 w-[380px]">
            <h3 className="font-bold mb-2">Export queue</h3>
            <div className="flex gap-2 mb-2">
              <select value={res} onChange={(e) => setRes(e.target.value)} className="bg-[#1d2027] rounded p-1">
                <option>480p</option><option>720p</option><option>1080p</option><option>4K</option>
              </select>
              <select value={fmt} onChange={(e) => setFmt(e.target.value as 'webm' | 'mp4')} className="bg-[#1d2027] rounded p-1">
                <option value="webm">WebM (real-time capture)</option><option value="mp4">MP4 (GPU encode → CPU fallback)</option>
              </select>
            </div>
            <p className="text-xs text-gray-400 mb-2">True-resolution render ({exportSize(res, useEditor.getState().aspect).w}×{exportSize(res, useEditor.getState().aspect).h}) · real-time capture ({totalDuration(project).toFixed(0)}s timeline ≈ that long) · ≈{(estimateBytes(res, totalDuration(project)) / 1048576).toFixed(1)} MB. MP4 adds a local ffmpeg transcode after. Keep tab visible. File auto-saves to your Downloads + stays in the queue below.</p>
            {fmt === 'mp4' && (
              <p className="text-xs mb-2" title="Probed via WebCodecs isConfigSupported at this resolution">
                GPU: {gpu === null ? 'probing encoder…' : gpu.ok ? (gpu.hardwarePreferred ? '🟢 hardware H.264 available' : '🟡 encoder available (software fallback)') : '🔴 no GPU encoder — CPU fallback'}
              </p>
            )}
            <div className="flex items-center gap-1 mb-2 text-xs text-gray-400" title="Fast plays the timeline at 2x/4x and renders audio offline — much quicker for long videos">
              Speed
              {([1, 2, 4] as const).map((s) => (
                <button key={s} onClick={() => setSpeed(s)} className={`rounded px-2 py-0.5 font-bold ${speed === s ? 'bg-cyan-400 text-black' : 'bg-[#262a33]'}`}>{s}x</button>
              ))}
              <span className="ml-1 text-gray-500">{speed > 1 ? 'fast · audio offline' : 'real-time'}</span>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-400 mb-2">
              <input type="checkbox" checked={watermark} onChange={(e) => setWatermark(e.target.checked)} />
              Watermark “CutForge” bottom-right
            </label>
            <div className="flex gap-2">
              <button onClick={() => void start()} className="bg-violet-500 rounded px-3 py-1 font-bold">Start</button>
              <button onClick={() => setOpen(false)} className="bg-[#262a33] rounded px-3 py-1">Close</button>
            </div>
            <div className="mt-3 space-y-2 max-h-40 overflow-auto">
              {jobs.map((j) => (
                <div key={j.id} className="text-xs bg-[#1d2027] rounded p-2">
                  <div>{j.label} — {j.status} {j.progress.toFixed(0)}%</div>
                  <div className="h-1 bg-[#262a33] rounded mt-1"><i className="block h-full bg-violet-500" style={{ width: Math.min(100, j.progress) + '%' }} /></div>
                  {j.url && <a href={j.url} download={j.name} className="text-violet-300 font-bold">⬇ Download {j.name}</a>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
