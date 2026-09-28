// Runs inside a Web Worker: receives raw audio bytes, decodes via OfflineAudioContext-free
// PCM parse fallback. Note: decodeAudioData is available in workers in modern browsers;
// if unavailable we do a naive 16-bit PCM parse.
self.onmessage = async (e: MessageEvent) => {
  try {
    const { buf, buckets } = e.data as { buf: ArrayBuffer; buckets: number };
    let ch: ArrayLike<number> | null = null;
    try {
      const Ctx = (self as unknown as { OfflineAudioContext: typeof OfflineAudioContext }).OfflineAudioContext;
      const tmp = new Ctx(1, 1, 44100);
      const data = await tmp.decodeAudioData(buf);
      ch = data.getChannelData(0);
    } catch {
      ch = pcm16(buf);
    }
    const out: number[] = [];
    const n = ch!.length;
    for (let i = 0; i < buckets; i++) {
      const s = Math.floor((i / buckets) * n), en = Math.floor(((i + 1) / buckets) * n);
      let mx = 0;
      const step = Math.max(1, Math.floor((en - s) / 200));
      for (let j = s; j < en; j += step) { const v = Math.abs(ch![j]); if (v > mx) mx = v; }
      out.push(mx);
    }
    (self as unknown as { postMessage: (m: unknown) => void }).postMessage({ ok: true, peaks: out });
  } catch (err) {
    (self as unknown as { postMessage: (m: unknown) => void }).postMessage({ ok: false, error: String((err as Error).message ?? err) });
  }
};

function pcm16(buf: ArrayBuffer): Float32Array {
  // Best-effort: skip 44-byte WAV header when present, interpret rest as int16 mono.
  const off = buf.byteLength > 48 ? 44 : 0;
  const v = new DataView(buf, off);
  const n = Math.floor(v.byteLength / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = v.getInt16(i * 2, true) / 32768;
  return out;
}
export {};
