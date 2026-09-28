// Web Audio graph: per-element GainNode -> master -> destination + MediaStreamDestination (export mix).
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let mixDest: MediaStreamAudioDestinationNode | null = null;
const wired = new WeakMap<HTMLMediaElement, { g: GainNode; p: StereoPannerNode | null }>();
export function ensureAudio() {
  if (ctx) return { ctx, master: master!, mixDest: mixDest! };
  ctx = new AudioContext();
  master = ctx.createGain(); master.connect(ctx.destination);
  mixDest = ctx.createMediaStreamDestination(); master.connect(mixDest);
  return { ctx, master, mixDest };
}
export function wireElement(el: HTMLMediaElement, volume: number, pan = 0): GainNode | null {
  try {
    const { ctx: c, master: m } = ensureAudio();
    const hit = wired.get(el);
    if (hit) { hit.g.gain.value = volume; if (hit.p) hit.p.pan.value = pan; return hit.g; }
    const src = c.createMediaElementSource(el);
    const g = c.createGain(); g.gain.value = volume;
    let out: AudioNode = g;
    let p: StereoPannerNode | null = null;
    try { p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; } catch { /* mono fallback */ }
    out.connect(m!);
    wired.set(el, { g, p }); return g;
  } catch { return null; }
}
export function mixStream(): MediaStream | null { return mixDest?.stream ?? null; }
export function audioCtx() { return ctx; }
