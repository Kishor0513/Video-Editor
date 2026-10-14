// Script-to-video: local structured generator (no vendor lock).
// Topic -> hook + beats + CTA, mapped to timeline text/caption clips.
// Optional provider hook via VITE_TTS_URL / VITE_TRANSCRIBE_URL left to caller.
export interface ScriptBeat { title: string; lines: string[]; duration: number }

export function generateScript(topic: string): { title: string; beats: ScriptBeat[] } {
  const clean = topic.trim().replace(/\s+/g, ' ').slice(0, 80) || 'My story';
  const cap = clean.charAt(0).toUpperCase() + clean.slice(1);
  return {
    title: cap,
    beats: [
      { title: 'Hook (0-3s)', lines: [`WAIT — ${cap}?`, 'Watch this'], duration: 3 },
      { title: 'Setup', lines: [`Here's the truth about ${cap.toLowerCase()}`, 'Nobody tells you this'], duration: 4 },
      { title: 'Payoff', lines: ['Step 1: start simple', 'Step 2: stay consistent', 'Step 3: repeat'], duration: 6 },
      { title: 'CTA', lines: ['Follow for part 2 🔥', 'Comment YOUR take'], duration: 3 },
    ],
  };
}

export function scriptToWords(topic: string, wps = 2.5): { w: string; t: number; d: number }[] {
  const s = generateScript(topic);
  const text = [s.title, ...s.beats.flatMap((b) => b.lines)].join(' ');
  const per = 1 / Math.max(0.5, wps);
  return text.split(/\s+/).filter(Boolean).map((w, i) => ({ w, t: i * per, d: per }));
}
