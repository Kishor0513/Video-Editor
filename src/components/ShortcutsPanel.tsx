import { useEffect, useState } from 'react';

const GROUPS: { title: string; items: [string, string][] }[] = [
  { title: 'Playback', items: [['Space', 'Play / Pause'], ['J', 'Shuttle back (tap ×3: 1x→2x→4x)'], ['L', 'Shuttle forward (tap ×3: 1x→2x→4x)'], ['K', 'Stop'], ['← / →', 'Frame step (Shift = 10f)'], ['Home / End', 'Start / end of timeline'], ['↑ / ↓', 'Previous / next edit point']] },
  { title: 'Edit', items: [['S', 'Split at playhead'], ['Shift+S / B', 'Blade all tracks'], ['Q / W', 'Trim clip start / end to playhead'], ['Del', 'Delete selection'], ['Shift+Del', 'Ripple delete (close gap)'], ['Ctrl+D', 'Duplicate'], ['Ctrl+C / V', 'Copy / paste'], ['Ctrl+A', 'Select all'], ['M', 'Marker at playhead']] },
  { title: 'Timeline', items: [['+ / −', 'Zoom in / out'], ['Fit', 'Zoom to fit (timeline header)'], ['🧲 Snap', 'Toggle snapping'], ['Alt (hold)', 'Temporarily disable snap'], ['Shift+click', 'Multi-select'], ['Drag ◣ ◢', 'Fade in / out handles'], ['◆ lane', 'Double-click add keyframe · drag move · Alt-click delete']] },
];

export default function ShortcutsPanel() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === '?' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '')) { e.preventDefault(); setOpen((v) => !v); }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  return (
    <>
      <button onClick={() => setOpen(true)} className="px-2 py-1 bg-[#262a33] rounded text-xs" title="Keyboard shortcuts (?)">⌨ ?</button>
      {open && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" role="dialog" aria-label="Keyboard shortcuts" onClick={() => setOpen(false)}>
          <div className="bg-[#16181d] border border-[#2c313b] rounded-xl p-4 w-[520px] max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold mb-2">⌨ Keyboard shortcuts</h3>
            <div className="grid grid-cols-3 gap-3">
              {GROUPS.map((g) => (
                <div key={g.title}>
                  <h4 className="text-[11px] text-gray-500 font-bold mb-1">{g.title}</h4>
                  {g.items.map(([k, d]) => (
                    <div key={k} className="flex items-center gap-1.5 mb-1 text-[11px]">
                      <kbd className="bg-[#1d2027] border border-[#2c313b] rounded px-1.5 py-0.5 font-mono text-[10px] text-cyan-300 whitespace-nowrap">{k}</kbd>
                      <span className="text-gray-400">{d}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-gray-500 mt-2">Press <kbd className="bg-[#1d2027] rounded px-1">?</kbd> or Esc to close.</p>
          </div>
        </div>
      )}
    </>
  );
}
