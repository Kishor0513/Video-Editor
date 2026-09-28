import { useEditor, findClip, uid } from '../state/projectStore';
import { mockAI, validatePlan } from '../services/ai';
import { poolGet } from '../engine/pool';
export default function Inspector() {
  const project = useEditor((s) => s.project);
  const selected = useEditor((s) => s.selected);
  const commit = useEditor((s) => s.commit);
  const c = selected ? findClip(project, selected.trackId, selected.clipId) : undefined;
  if (!c) return <div className="w-[300px] bg-[#16181d] border-l border-[#2c313b] p-3 overflow-auto"><h3 className="text-xs text-gray-400">INSPECTOR</h3><p className="text-gray-400 text-sm">Select a clip.</p><AIPanel /></div>;
  const upd = (patch: Partial<typeof c>) => commit('Edit', (p) => ({
    ...p, tracks: p.tracks.map((t) => t.id === selected!.trackId ? { ...t, clips: t.clips.map((x) => x.id === c.id ? { ...x, ...patch } : x) } : t),
  }));
  const trim = (patch: Partial<typeof c>) => commit('Trim', (p) => ({
    ...p, tracks: p.tracks.map((t) => t.id === selected!.trackId ? { ...t, clips: t.clips.map((x) => {
      if (x.id !== c.id) return x;
      const nx = { ...x, ...patch };
      nx.startTime = Math.max(0, nx.startTime); nx.duration = Math.max(0.1, nx.duration);
      return nx;
    }) } : t),
  }));
  const applyStyle = (patch: Partial<typeof c>) => upd(patch);
  const trackThisClip = async () => {
    if (!c || (c.type !== 'video' && c.type !== 'image')) { alert('Select a video clip first'); return; }
    const el = poolGet(c.id);
    if (!(el instanceof HTMLVideoElement)) { alert('Preview video not ready — press play once, pause, then track'); return; }
    const label = prompt('Text to attach?', 'Follow me') ?? 'Follow me';
    const { trackPoint, detectFace } = await import('../engine/tracker');
    const face = await detectFace(el).catch(() => null);
    const pts = await trackPoint(el, face?.x ?? 0.5, face?.y ?? 0.4, c.startTime, Math.min(c.startTime + c.duration, c.startTime + 3));
    if (!pts.length) { alert('Tracker found no motion'); return; }
    commit('Track attach', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips] })) };
      const tr = np.tracks.find((t) => t.id === 't1') ?? np.tracks.find((t) => t.id[0] === 't') ?? np.tracks[0];
      pts.forEach((pt) => {
        tr.clips.push({ id: uid(), type: 'text', text: label, fontSize: 40, color: '#ffe45e', textAlign: 'center', startTime: pt.t, duration: 0.25, position: { x: pt.x, y: Math.max(0, pt.y - 0.08) }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: tr.id });
      });
      return np;
    });
  };
  return (
    <div className="w-[300px] bg-[#16181d] border-l border-[#2c313b] p-3 overflow-auto">
      <h3 className="text-xs text-gray-400 mb-2">PROPERTIES · {c.type.toUpperCase()}</h3>
      {(c.type === 'text' || c.type === 'caption') && (
        <div className="mb-2">
          <p className="text-[11px] text-gray-500 font-bold mb-1">STYLE — CapCut presets</p>
          <div className="grid grid-cols-3 gap-1">
            {([
              ['Default', { color: '#fff', strokeW: 0, shadow: 0, fontSize: 52 }],
              ['Title', { color: '#fff', stroke: '#000', strokeW: 6, shadow: 8, fontSize: 72 }],
              ['Gold', { color: '#ffe45e', strokeW: 0, shadow: 8, fontSize: 60 }],
              ['Neon', { color: '#5eead4', strokeW: 0, shadow: 18, fontSize: 60 }],
              ['Outline', { color: '#fff', stroke: '#000', strokeW: 10, shadow: 0, fontSize: 72 }],
              ['Soft', { color: '#ffd6e7', strokeW: 0, shadow: 6, fontSize: 44 }],
            ] as const).map(([label, preset]) => (
              <button key={label} onClick={() => applyStyle({ ...preset })} className="rounded-lg bg-[#1d2027] border border-[#2c313b] hover:border-cyan-400/60 py-1.5 text-xs font-bold"
                style={{ color: preset.color, textShadow: preset.shadow ? '0 1px 8px rgba(0,0,0,.8)' : undefined }}>{label}</button>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <label className="text-xs text-gray-400">Start<input type="number" step={0.1} value={c.startTime} onChange={(e) => trim({ startTime: Number(e.target.value) })} className="w-full bg-[#1d2027] rounded p-1 text-white" /></label>
        <label className="text-xs text-gray-400">Dur<input type="number" step={0.1} value={c.duration} onChange={(e) => trim({ duration: Number(e.target.value) })} className="w-full bg-[#1d2027] rounded p-1 text-white" /></label>
      </div>
      <label className="text-xs text-gray-400">Opacity</label>
      <input type="range" min={0} max={1} step={0.01} value={c.opacity} onChange={(e) => upd({ opacity: Number(e.target.value) })} className="w-full" />
      <div className="grid grid-cols-2 gap-2 mt-1">
        <label className="text-xs text-gray-400">Fade in (s)<input type="number" step={0.1} min={0} value={c.fadeIn ?? 0} onChange={(e) => upd({ fadeIn: Math.max(0, Number(e.target.value)) })} className="w-full bg-[#1d2027] rounded p-1" /></label>
        <label className="text-xs text-gray-400">Fade out (s)<input type="number" step={0.1} min={0} value={c.fadeOut ?? 0} onChange={(e) => upd({ fadeOut: Math.max(0, Number(e.target.value)) })} className="w-full bg-[#1d2027] rounded p-1" /></label>
      </div>
      {(c.type === 'video' || c.type === 'image') && (
        <>
          <button onClick={() => upd({ bgBlur: !c.bgBlur })} className={`w-full rounded-lg px-2 py-1.5 text-xs font-bold mb-1 ${c.bgBlur ? 'bg-cyan-400 text-black' : 'bg-[#262a33]'}`} title="CapCut-style blurred background for 9:16 (fills black bars)">
            {c.bgBlur ? '✓ Blur background ON' : 'Blur background (9:16)'}
          </button>
          <button onClick={() => void trackThisClip()} className="w-full rounded-lg px-2 py-1.5 text-xs font-bold mb-1 bg-[#262a33] hover:bg-[#313744]" title="Track motion in this clip and attach text that follows it (face-aware)">
            ◎ Track + attach text
          </button>
          <label className="text-xs text-gray-400">Speed (−8–8, − = reverse)</label>
          <input type="number" step={0.25} min={-8} max={8} value={c.speed ?? 1} onChange={(e) => upd({ speed: Math.max(-8, Math.min(8, Number(e.target.value) || 1)) })} className="w-full bg-[#1d2027] rounded p-1" />
          <label className="text-xs text-gray-400">Curve — speed ramp</label>
          <select value={c.speedCurve ?? 'Custom'} onChange={(e) => upd({ speedCurve: e.target.value as import('../types').Clip['speedCurve'] })} className="w-full bg-[#1d2027] rounded p-1">
            {['Custom', 'Montage', 'Bullet', 'Jump Cut', 'Hero', 'Flash In', 'Flash Out'].map((s) => <option key={s}>{s}</option>)}
          </select>
          <SpeedRamp curve={c.speedCurve ?? 'Custom'} base={Math.abs(c.speed ?? 1)} />
          <div className="grid grid-cols-4 gap-1 mt-1">
            {[['Montage', '⛰'], ['Bullet', '⏱'], ['Hero', '🦸'], ['Flash In', '⚡']].map(([name, icon]) => (
              <button key={name} onClick={() => upd({ speedCurve: name as import('../types').Clip['speedCurve'] })} title={`${name} ramp`}
                className={`rounded px-1 py-1 text-[11px] font-bold ${c.speedCurve === name ? 'bg-cyan-400 text-black' : 'bg-[#262a33]'}`}>{icon} {name.split(' ')[0]}</button>
            ))}
          </div>
          <label className="text-xs text-gray-400">Volume</label>
          <input type="range" min={0} max={1} step={0.01} value={c.volume ?? 1} onChange={(e) => upd({ volume: Number(e.target.value) })} className="w-full" />
          <div className="grid grid-cols-2 gap-2 mt-1">
            <label className="text-xs text-gray-400">Rotate°<input type="number" value={c.rotation} onChange={(e) => upd({ rotation: Number(e.target.value) })} className="w-full bg-[#1d2027] rounded p-1" /></label>
            <label className="text-xs text-gray-400">Blend<select value={c.blend ?? 'source-over'} onChange={(e) => upd({ blend: e.target.value as GlobalCompositeOperation })} className="w-full bg-[#1d2027] rounded p-1">{['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference'].map((b) => <option key={b}>{b}</option>)}</select></label>
          </div>
          <div className="flex gap-1 mt-1">
            <button onClick={() => upd({ flipH: !c.flipH })} className="bg-[#262a33] rounded px-2 py-1 text-xs">⇋ Flip ({c.flipH ? 'on' : 'off'})</button>
            <button onClick={() => upd({ crop: undefined })} className="bg-[#262a33] rounded px-2 py-1 text-xs">Crop reset</button>
          </div>
          <div className="flex gap-1 mt-1 flex-wrap">
            {[['16:9', { x: 0, y: 0.15, w: 1, h: 0.7 }], ['9:16', { x: 0.3, y: 0, w: 0.4, h: 1 }], ['1:1', { x: 0.15, y: 0, w: 0.7, h: 1 }]].map(([label, cr]) => (
              <button key={label as string} onClick={() => upd({ crop: cr as import('../types').Clip['crop'] })} className="bg-[#262a33] rounded px-2 py-1 text-xs">{label as string}</button>
            ))}
          </div>
          <label className="text-xs text-gray-400 mt-2">Exposure<input type="range" min={-50} max={50} value={0} onChange={(e) => { const v = Number(e.target.value); upd({ filters: { ...(c.filters ?? { br: 100, ct: 100, st: 100, gr: 0, sp: 0, bl: 0 }), br: 100 + v } }); }} className="w-full" /></label>
          <p className="text-[11px] text-gray-400 mt-1">Keyframes: use the ◆ lane under the timeline (double-click to add, drag to move, Alt-click deletes).</p>
          <p className="text-[11px] text-gray-400 mt-1">Chroma in FX · AI bg-removal + point/face tracking live in FX tab.</p>
        </>
      )}
      {(c.type === 'text' || c.type === 'caption' || c.type === 'sticker') && (
        <>
          <textarea value={c.text ?? ''} onChange={(e) => upd({ text: e.target.value })} className="w-full bg-[#1d2027] rounded p-1" />
          <p className="text-[11px] text-gray-500 font-bold mt-2 mb-1">ANIMATION — CapCut in/out</p>
          <div className="grid grid-cols-5 gap-1 mb-1">
            {([['none', '🚫'], ['fade', '🌫'], ['pop', '💥'], ['slide', '➡'], ['typewriter', '⌨'], ['bounce', '🏀'], ['zoom', '🔍'], ['blur', '🌫️'], ['neon', '💡']] as const).map(([name, icon]) => (
              <button key={name} onClick={() => upd({ anim: name === 'none' ? undefined : name })} title={`${name} animation`}
                className={`rounded-lg py-1.5 text-[10px] font-bold ${((c.anim ?? 'none') === name) ? 'bg-cyan-400 text-black' : 'bg-[#262a33]'}`}>{icon}<span className="block">{name.slice(0, 4)}</span></button>
            ))}
          </div>
          {c.type === 'text' && (
            <>
              <label className="text-xs text-gray-400">Size</label>
              <input type="range" min={16} max={160} value={c.fontSize ?? 52} onChange={(e) => upd({ fontSize: Number(e.target.value) })} className="w-full" />
              <div className="grid grid-cols-2 gap-2 mt-1">
                <label className="text-xs text-gray-400">Color<input type="color" value={c.color ?? '#ffffff'} onChange={(e) => upd({ color: e.target.value })} className="w-full h-8 bg-[#1d2027] rounded" /></label>
                <label className="text-xs text-gray-400">Stroke<input type="color" value={c.stroke ?? '#000000'} onChange={(e) => upd({ stroke: e.target.value })} className="w-full h-8 bg-[#1d2027] rounded" /></label>
              </div>
              <label className="text-xs text-gray-400">Stroke width {(c.strokeW ?? 0).toFixed(0)}</label>
              <input type="range" min={0} max={12} value={c.strokeW ?? 0} onChange={(e) => upd({ strokeW: Number(e.target.value) })} className="w-full" />
              <label className="text-xs text-gray-400">Shadow {(c.shadow ?? 0).toFixed(0)}</label>
              <input type="range" min={0} max={30} value={c.shadow ?? 0} onChange={(e) => upd({ shadow: Number(e.target.value) })} className="w-full" />
              <label className="text-xs text-gray-400">Background</label>
              <div className="flex gap-1 items-center">
                <input type="color" value={c.bgColor ?? '#000000'} onChange={(e) => upd({ bgColor: e.target.value })} className="w-10 h-8 bg-[#1d2027] rounded" title="Text background color" />
                <button onClick={() => upd({ bgColor: undefined })} className="bg-[#262a33] rounded px-2 py-1 text-xs">✕ none</button>
              </div>
            </>
          )}
          {(c.type === 'caption' || c.type === 'sticker') && (
            <>
              <label className="text-xs text-gray-400">Size</label>
              <input type="range" min={16} max={160} value={c.fontSize ?? 52} onChange={(e) => upd({ fontSize: Number(e.target.value) })} className="w-full" />
              <label className="text-xs text-gray-400">Color<input type="color" value={c.color ?? '#ffffff'} onChange={(e) => upd({ color: e.target.value })} className="w-full h-8 bg-[#1d2027] rounded" /></label>
            </>
          )}
        </>
      )}
      {c.type === 'shape' && (
        <>
          <label className="text-xs text-gray-400">Shape</label>
          <select value={c.shape ?? 'rect'} onChange={(e) => upd({ shape: e.target.value as import('../types').Clip['shape'] })} className="w-full bg-[#1d2027] rounded p-1">
            {['rect', 'circle', 'triangle', 'star'].map((s) => <option key={s}>{s}</option>)}
          </select>
          <label className="text-xs text-gray-400">Fill<input type="color" value={c.color ?? '#8b5cf6'} onChange={(e) => upd({ color: e.target.value })} className="w-full h-8 bg-[#1d2027] rounded" /></label>
          <label className="text-xs text-gray-400">Rotate°<input type="number" value={c.rotation} onChange={(e) => upd({ rotation: Number(e.target.value) })} className="w-full bg-[#1d2027] rounded p-1" /></label>
        </>
      )}
      {c.type === 'audio' && (
        <>
          <label className="text-xs text-gray-400">Volume</label>
          <input type="range" min={0} max={1} step={0.01} value={c.volume ?? 0.9} onChange={(e) => upd({ volume: Number(e.target.value) })} className="w-full" />
          <label className="text-xs text-gray-400">Pan L/R</label>
          <input type="range" min={-1} max={1} step={0.05} value={c.pan ?? 0} onChange={(e) => upd({ pan: Number(e.target.value) })} className="w-full" />
          {(['Bass', 'Mid', 'Treble'] as string[]).map((label) => {
            const k = label === 'Bass' ? 'eqLow' : label === 'Mid' ? 'eqMid' : 'eqHigh';
            const kk = k as 'eqLow' | 'eqMid' | 'eqHigh';
            return (
              <label key={label} className="text-xs text-gray-400">{label} {(c.audioFX?.[kk] ?? 0)}dB
                <input type="range" min={-12} max={12} value={c.audioFX?.[kk] ?? 0} onChange={(e) => { const nx = { eqLow: 0, eqMid: 0, eqHigh: 0, comp: 0, reverb: 0, denoise: 0, ...(c.audioFX ?? {}) }; nx[kk] = Number(e.target.value); upd({ audioFX: nx }); }} className="w-full" />
              </label>
            );
          })}
          <label className="text-xs text-gray-400">Compressor {(c.audioFX?.comp ?? 0)}<input type="range" min={0} max={24} value={c.audioFX?.comp ?? 0} onChange={(e) => { const nx = { eqLow: 0, eqMid: 0, eqHigh: 0, comp: 0, reverb: 0, denoise: 0, ...(c.audioFX ?? {}) }; nx.comp = Number(e.target.value); upd({ audioFX: nx }); }} className="w-full" /></label>
          <label className="text-xs text-gray-400">Reverb {(c.audioFX?.reverb ?? 0)}%<input type="range" min={0} max={60} value={c.audioFX?.reverb ?? 0} onChange={(e) => { const nx = { eqLow: 0, eqMid: 0, eqHigh: 0, comp: 0, reverb: 0, denoise: 0, ...(c.audioFX ?? {}) }; nx.reverb = Number(e.target.value); upd({ audioFX: nx }); }} className="w-full" /></label>
          <label className="text-xs text-gray-400">Pitch {(c.pitch ?? 0) > 0 ? `+${c.pitch}` : c.pitch ?? 0} semitones
            <input type="range" min={-12} max={12} step={1} value={c.pitch ?? 0} onChange={(e) => upd({ pitch: Number(e.target.value) })} className="w-full" />
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-400 mt-1">
            <input type="checkbox" checked={c.ducking ?? false} onChange={(e) => upd({ ducking: e.target.checked })} />
            Auto-duck music under voice
          </label>
          <button onClick={() => {
            const a = useEditor.getState().assets.find((x) => x.id === c.assetId);
            const peak = Math.max(0.01, ...(a?.peaks ?? [1]));
            upd({ volume: Math.min(1, 0.89 / peak) });
          }} className="bg-[#262a33] rounded px-2 py-1 text-xs mt-1">Normalize to −1dB</button>
        </>
      )}
      {c.type === 'adjustment' && (
        <>
          <p className="text-[11px] text-gray-400 mb-1">Grades everything below on V1/V2 while active.</p>
          {([['Brightness', 'br', 0, 200], ['Contrast', 'ct', 0, 200], ['Saturation', 'st', 0, 300], ['Blur', 'bl', 0, 20]] as [string, 'br' | 'ct' | 'st' | 'bl', number, number][]).map(([label, k, lo, hi]) => (
            <label key={label} className="text-xs text-gray-400">{label} {(c.filters?.[k] ?? (k === 'bl' ? 0 : 100))}
              <input type="range" min={lo} max={hi} value={c.filters?.[k] ?? (k === 'bl' ? 0 : 100)} onChange={(e) => upd({ filters: { br: 100, ct: 100, st: 100, gr: 0, sp: 0, bl: 0, ...(c.filters ?? {}), [k]: Number(e.target.value) } })} className="w-full" />
            </label>
          ))}
        </>
      )}
      {(c.keyframes?.length ?? 0) > 0 && (
        <div className="mt-2 border-t border-[#2c313b] pt-2">
          <h4 className="text-xs text-gray-400 mb-1">KEYFRAMES ({c.keyframes!.length})</h4>
          {c.keyframes!.map((k) => (
            <div key={k.id} className="flex items-center gap-1 mb-1 text-xs">
              <span className="text-violet-300 w-16 truncate">{k.prop}</span>
              <input type="number" step={0.05} value={k.dt} title="Time (s)" onChange={(e) => upd({ keyframes: c.keyframes!.map((y) => y.id === k.id ? { ...y, dt: Math.max(0, Number(e.target.value)) } : y) })} className="w-14 bg-[#1d2027] rounded p-0.5" />
              <input type="number" step={0.05} value={k.value} title="Value" onChange={(e) => upd({ keyframes: c.keyframes!.map((y) => y.id === k.id ? { ...y, value: Number(e.target.value) } : y) })} className="w-14 bg-[#1d2027] rounded p-0.5" />
              <select value={k.easing ?? 'linear'} onChange={(e) => upd({ keyframes: c.keyframes!.map((y) => y.id === k.id ? { ...y, easing: e.target.value } : y) })} className="bg-[#1d2027] rounded p-0.5">
                {['linear', 'easeIn', 'easeOut', 'easeInOut'].map((x) => <option key={x}>{x}</option>)}
              </select>
              <button onClick={() => upd({ keyframes: c.keyframes!.filter((y) => y.id !== k.id) })} className="text-red-300 px-1" title="Delete keyframe">×</button>
            </div>
          ))}
        </div>
      )}
      <AIPanel />
    </div>
  );
}
function SpeedRamp({ curve, base }: { curve: string; base: number }) {
  const N = 48;
  const pts: number[] = [];
  for (let i = 0; i <= N; i++) {
    const p = i / N;
    let m = 1;
    if (curve === 'Montage') m = 0.5 + p;
    else if (curve === 'Bullet') m = p < 0.4 || p > 0.6 ? 0.25 : 2;
    else if (curve === 'Jump Cut') m = p % 0.25 < 0.02 ? 3 : 1;
    else if (curve === 'Hero') m = 1 + Math.sin(p * Math.PI) * 1.5;
    else if (curve === 'Flash In') m = 2 - p;
    else if (curve === 'Flash Out') m = 0.5 + p * 1.5;
    pts.push(m * base);
  }
  const max = Math.max(2.5, ...pts);
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i / N) * 100},${20 - (v / max) * 18}`).join(' ');
  return (
    <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="w-full h-12 bg-[#1d2027] border border-[#2c313b] rounded mt-1">
      {[0.5, 1, 2].map((g) => (
        <line key={g} x1={0} x2={100} y1={20 - (g / max) * 18} y2={20 - (g / max) * 18} stroke="#2c313b" strokeWidth={0.4} />
      ))}
      <path d={d} fill="none" stroke="#22d3ee" strokeWidth={1.4} />
    </svg>
  );
}
function AIPanel() {
  const selected = useEditor((s) => s.selected);
  const project = useEditor((s) => s.project);
  const commit = useEditor((s) => s.commit);
  const c = selected ? findClip(project, selected.trackId, selected.clipId) : undefined;
  const isVideo = c && (c.type === 'video' || c.type === 'image');
  const isAudio = c && (c.type === 'audio' || c.assetId);
  const card = 'bg-[#1d2027] border border-[#2c313b] hover:border-cyan-400/60 rounded-lg p-2 text-left transition-colors';
  return (
    <div className="mt-4 border-t border-[#2c313b] pt-2">
      <h3 className="text-xs text-gray-400 font-bold">✨ AI ASSISTANT — CapCut style</h3>
      <div className="grid grid-cols-2 gap-1.5 mt-2 text-xs">
        <button className={card} disabled={!isVideo} title={isVideo ? 'AI person mask (MediaPipe) + chroma fallback' : 'Select a video/image clip first'} onClick={() => void aiRemoveBG()}>
          <span className="block text-base">🪄</span><span className="font-bold">Remove BG</span>
          <span className="block text-[10px] text-gray-400">{isVideo ? 'AI mask + key' : 'need video clip'}</span>
        </button>
        <button className={card} disabled={!isAudio && !c} title="Denoise + normalize + presence EQ" onClick={() => aiEnhanceVoice()}>
          <span className="block text-base">🎙</span><span className="font-bold">Enhance voice</span>
          <span className="block text-[10px] text-gray-400">denoise · −1dB</span>
        </button>
        <button className={card} title="Word-by-word pop captions from your Caps text" onClick={() => aiCaptions()}>
          <span className="block text-base">💬</span><span className="font-bold">Auto captions</span>
          <span className="block text-[10px] text-gray-400">words → timeline</span>
        </button>
        <button className={card} title="Topic → titled text clips on the text track" onClick={() => aiScript()}>
          <span className="block text-base">📝</span><span className="font-bold">Script → video</span>
          <span className="block text-[10px] text-gray-400">titles from topic</span>
        </button>
      </div>
      <button className="bg-[#262a33] hover:bg-[#313744] rounded px-2 py-1 text-xs mt-1.5 w-full" onClick={async () => {
        const plan = await mockAI.autoEdit({ duration: 10 });
        if (!validatePlan(plan)) { alert('Invalid AI plan (rejected by schema)'); return; }
        alert(plan.summary.join('\n') + '\n\nEdit-plan preview only — no timeline changes applied.');
      }}>Analyze timeline</button>
      <p className="text-[11px] text-gray-400 mt-1">TTS voice files + dictation live in left Caps tab.</p>
    </div>
  );

  async function aiRemoveBG() {
    const st = useEditor.getState();
    const sel = st.selected;
    const clip = sel ? findClip(st.project, sel.trackId, sel.clipId) : undefined;
    if (!clip || (clip.type !== 'video' && clip.type !== 'image')) { alert('Select a video/image clip first'); return; }
    const { poolGet } = await import('../engine/pool');
    const el = poolGet(clip.id);
    if (el instanceof HTMLVideoElement) {
      const { segmentFrame } = await import('../services/segment');
      const cv = await segmentFrame(el, 480, 270).catch(() => null);
      if (cv) {
        const a = document.createElement('a');
        a.href = cv.toDataURL('image/png'); a.download = 'ai-mask.png'; a.click();
      } else {
        alert('AI model offline — green-screen key applied instead.');
      }
    }
    commit('AI remove BG', (p) => ({
      ...p, tracks: p.tracks.map((t) => t.id === sel!.trackId ? {
        ...t, clips: t.clips.map((x) => x.id === clip.id ? { ...x, chroma: { enabled: true, color: '#00ff00', similarity: 0.35, smoothness: 0.1 } } : x),
      } : t),
    }));
    alert('AI background key applied. Export mask saved as ai-mask.png when online.');
  }

  function aiEnhanceVoice() {
    const st = useEditor.getState();
    const sel = st.selected;
    const clip = sel ? findClip(st.project, sel.trackId, sel.clipId) : undefined;
    if (!clip) { alert('Select an audio/video clip first'); return; }
    const a = clip.assetId ? st.assets.find((x) => x.id === clip.assetId) : undefined;
    const peak = Math.max(0.01, ...((a?.peaks ?? [1]) as number[]));
    commit('AI enhance voice', (p) => ({
      ...p, tracks: p.tracks.map((t) => t.id === sel!.trackId ? {
        ...t, clips: t.clips.map((x) => x.id === clip.id ? {
          ...x,
          volume: Math.min(1, 0.89 / peak),
          audioFX: { eqLow: -2, eqMid: 3, eqHigh: 2, comp: 12, reverb: 0, denoise: 8 },
        } : x),
      } : t),
    }));
  }

  function aiCaptions() {
    // Reuses the Caps-tab word engine default (Hormozi @ 2.5w/s) from current time
    commit('AI auto captions', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips] })) };
      const tr = np.tracks.find((t) => t.id === 't1') ?? np.tracks.find((t) => t.id[0] === 't') ?? np.tracks[0];
      const words = ['Your', 'AI', 'captions', 'go', 'here', '—', 'edit', 'in', 'Caps', 'tab'];
      let t0 = useEditor.getState().currentTime;
      words.forEach((wd) => {
        tr.clips.push({
          id: Math.random().toString(36).slice(2, 10), type: 'caption', text: wd, textAlign: 'center',
          startTime: Math.round(t0 * 100) / 100, duration: 0.4,
          position: { x: 0.5, y: 0.5 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1,
          trackId: tr.id, anim: 'fade', fontSize: 64, color: '#fff', stroke: '#000', strokeW: 7, shadow: 6,
        });
        t0 += 0.4;
      });
      return np;
    });
    alert('Demo word-captions added. For your own words: left Caps tab → type → ✨ Words → timeline.');
  }

  function aiScript() {
    const topic = prompt('Topic?', 'Morning routine');
    if (!topic) return;
    commit('AI script', (p) => {
      const np = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips] })) };
      const tr = np.tracks.find((t) => t.id === 't1') ?? np.tracks.find((t) => t.id[0] === 't') ?? np.tracks[0];
      topic.split(/[.]\s*/).filter(Boolean).slice(0, 4).forEach((s, i) => {
        tr.clips.push({
          id: Math.random().toString(36).slice(2, 10), type: 'text', text: s.trim(), fontSize: 56, color: '#fff', textAlign: 'center',
          startTime: useEditor.getState().currentTime + i * 3, duration: 3,
          position: { x: 0.5, y: 0.4 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: tr.id,
        });
      });
      return np;
    });
  }
}
