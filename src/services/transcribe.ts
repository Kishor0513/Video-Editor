// Transcribe service: SRT/VTT import + provider hook + local word timing.
// Honest labels: provider when VITE_TRANSCRIBE_URL set, else Web Speech / manual.
export interface Word { w: string; t: number; d: number }

export function wordsFromText(text: string, wps = 2.5, t0 = 0): Word[] {
  const words = text.replace(/\n+/g, ' ').split(/\s+/).map((s) => s.trim()).filter(Boolean);
  const per = 1 / Math.max(0.5, wps);
  return words.map((w, i) => ({ w, t: t0 + i * per, d: per }));
}

function tsToSec(ts: string): number {
  // 00:00:01,000 or 00:00:01.000 or 00:01.000
  const m = ts.trim().match(/(?:(\d+):)?(\d+):(\d+)[,.](\d+)/) ?? ts.trim().match(/(?:(\d+):)?(\d+)[,.](\d+)/);
  if (!m) return 0;
  if (m[4] !== undefined) {
    const h = Number(m[1] ?? 0), min = Number(m[2]), s = Number(m[3]), ms = Number(m[4].padEnd(3, '0').slice(0, 3));
    return h * 3600 + min * 60 + s + ms / 1000;
  }
  const min = Number(m[1] ?? 0), s = Number(m[2]), ms = Number(m[3].padEnd(3, '0').slice(0, 3));
  return min * 60 + s + ms / 1000;
}

export interface CaptionCue { text: string; start: number; duration: number }

export function parseSRT(src: string): CaptionCue[] {
  const blocks = src.replace(/\r/g, '').split(/\n\s*\n/);
  const out: CaptionCue[] = [];
  for (const b of blocks) {
    const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const timeLine = lines.find((l) => l.includes('-->'));
    if (!timeLine) continue;
    const [a, c] = timeLine.split('-->');
    const start = tsToSec(a);
    const end = tsToSec(c);
    const text = lines.slice(lines.indexOf(timeLine) + 1).join('\n');
    if (text && end > start) out.push({ text, start, duration: end - start });
  }
  return out;
}

export function parseVTT(src: string): CaptionCue[] {
  const body = src.replace(/^WEBVTT.*\n/, '');
  return parseSRT(body);
}

export async function transcribeViaProvider(audio: Blob): Promise<{ text: string; words: Word[] }> {
  const url = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_TRANSCRIBE_URL;
  if (!url) throw new Error('No transcribe provider configured (VITE_TRANSCRIBE_URL empty)');
  const fd = new FormData();
  fd.append('audio', audio, 'audio.webm');
  const r = await fetch(url, { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`Transcribe provider ${r.status}`);
  const j = await r.json() as { text?: string; words?: Word[] };
  if (!j.text) throw new Error('Provider returned no text');
  if (j.words?.length) return { text: j.text, words: j.words };
  return { text: j.text, words: wordsFromText(j.text) };
}

export async function transcribeAudioBlob(audio: Blob): Promise<{ text: string; words: Word[]; engine: string }> {
  try {
    const r = await transcribeViaProvider(audio);
    return { ...r, engine: 'provider' };
  } catch {
    // fall through to browser STT hint — caller should use live mic transcribeOnce
    throw new Error('No provider. Use mic Dictate (Web Speech) or import SRT/VTT, or set VITE_TRANSCRIBE_URL.');
  }
}
