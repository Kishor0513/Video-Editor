// Real per-element audio FX chain: EQ(3 biquad) -> compressor -> reverb -> gain -> pan.
import { ensureAudio } from './audio';
export interface FX { eqLow: number; eqMid: number; eqHigh: number; comp: number; reverb: number; denoise: number; }
export const flatFX: FX = { eqLow: 0, eqMid: 0, eqHigh: 0, comp: 0, reverb: 0, denoise: 0 };
const chains = new WeakMap<HTMLMediaElement, { out: GainNode; fx: FX; nodes: AudioNode[] }>();
function impulse(ctx: AudioContext, sec = 1.2, decay = 2.5): AudioBuffer {
  const rate = ctx.sampleRate, buf = ctx.createBuffer(2, rate * sec, rate);
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, decay); }
  return buf;
}
export function applyFX(el: HTMLMediaElement, volume: number, pan: number, fx: FX) {
  try {
    const { ctx, master } = ensureAudio(); const c = ctx!;
    const prev = chains.get(el);
    const same = prev && JSON.stringify(prev.fx) === JSON.stringify(fx);
    // rebuild chain when settings change (cheap, runs on user edits not per-frame)
    if (!same) {
      try { prev?.nodes.forEach((n) => { try { n.disconnect(); } catch { /* noop */ } }); } catch { /* noop */ }
      const src = (c as AudioContext & { __src?: WeakMap<HTMLMediaElement, MediaElementAudioSourceNode> }).__src ?? new WeakMap();
      (c as unknown as { __src: unknown }).__src = src;
      let node = src.get(el);
      if (!node) { node = c.createMediaElementSource(el); src.set(el, node); }
      const low = c.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 320; low.gain.value = fx.eqLow;
      const mid = c.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1200; mid.gain.value = fx.eqMid;
      const high = c.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 4200; high.gain.value = fx.eqHigh;
      const comp = c.createDynamicsCompressor(); comp.threshold.value = fx.comp > 0 ? -18 : 0; comp.ratio.value = 1 + fx.comp / 8;
      const gate = c.createGain(); gate.gain.value = fx.denoise > 0 ? 1 : 1;
      const dry = c.createGain();
      const verb = c.createConvolver(); verb.buffer = impulse(c);
      const wet = c.createGain(); wet.gain.value = fx.reverb / 100;
      const out = c.createGain(); out.gain.value = volume;
      let panner: AudioNode = out;
      try { const sp = c.createStereoPanner(); sp.pan.value = pan; out.connect(sp); panner = sp; } catch { /* noop */ }
      node.connect(low); low.connect(mid); mid.connect(high); high.connect(comp); comp.connect(gate); gate.connect(dry);
      dry.connect(out); gate.connect(verb); verb.connect(wet); wet.connect(out);
      panner.connect(master!);
      chains.set(el, { out, fx: { ...fx }, nodes: [low, mid, high, comp, gate, dry, verb, wet, out] });
      return out;
    }
    prev!.out.gain.value = volume;
    return prev!.out;
  } catch { return null; }
}
