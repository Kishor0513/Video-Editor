// Waveform worker: decode + peak extraction off the main thread.
// Falls back to main-thread decode when workers are unavailable.
export async function waveformPeaks(file: File, buckets = 120): Promise<number[]> {
  const cached = await peakCacheGet(file.name, file.size).catch(() => null);
  if (cached) return cached;
  try {
    const peaks = await viaWorker(file, buckets);
    void peakCacheSet(file.name, file.size, peaks).catch(() => undefined);
    return peaks;
  } catch {
    return mainThreadPeaks(file, buckets);
  }
}

function viaWorker(file: File, buckets: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    try {
      const w = new Worker(new URL('./waveform.worker.ts', import.meta.url), { type: 'module' });
      const to = window.setTimeout(() => { try { w.terminate(); } catch { /* noop */ } reject(new Error('worker timeout')); }, 30000);
      w.onmessage = (e: MessageEvent) => {
        window.clearTimeout(to);
        try { w.terminate(); } catch { /* noop */ }
        if (e.data?.ok) resolve(e.data.peaks as number[]);
        else reject(new Error(e.data?.error ?? 'worker failed'));
      };
      w.onerror = (err) => { window.clearTimeout(to); reject(err); };
      file.arrayBuffer().then((buf) => w.postMessage({ buf, buckets }, [buf])).catch(reject);
    } catch (e) { reject(e); }
  });
}

async function mainThreadPeaks(file: File, buckets: number): Promise<number[]> {
  try {
    const buf = await file.arrayBuffer();
    const AC = new AudioContext();
    const data = await AC.decodeAudioData(buf);
    void AC.close().catch(() => undefined);
    return peaksOf(data.getChannelData(0), buckets);
  } catch { return []; }
}

export function peaksOf(ch: ArrayLike<number>, buckets: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < buckets; i++) {
    const s = Math.floor((i / buckets) * ch.length), e = Math.floor(((i + 1) / buckets) * ch.length);
    let mx = 0;
    for (let j = s; j < e; j += Math.max(1, Math.floor((e - s) / 200))) mx = Math.max(mx, Math.abs(ch[j]));
    out.push(mx);
  }
  return out;
}

function peakCacheGet(name: string, size: number): Promise<number[] | null> {
  return new Promise((res) => {
    try {
      const r = indexedDB.open('cutforge', 1);
      r.onsuccess = () => {
        const t = r.result.transaction('projects').objectStore('projects').get(`peaks:${name}:${size}`);
        t.onsuccess = () => { try { res(t.result ? JSON.parse(t.result) as number[] : null); } catch { res(null); } };
        t.onerror = () => res(null);
      };
      r.onerror = () => res(null);
    } catch { res(null); }
  });
}

function peakCacheSet(name: string, size: number, peaks: number[]): Promise<void> {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open('cutforge', 1);
      r.onsuccess = () => {
        const t = r.result.transaction('projects', 'readwrite').objectStore('projects').put(JSON.stringify(peaks), `peaks:${name}:${size}`);
        t.onsuccess = () => res(); t.onerror = () => rej(t.error);
      };
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}
