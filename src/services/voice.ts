// TTS (real preview via SpeechSynthesis) + STT (real via SpeechRecognition when available).
export function speak(text: string, rate = 1) {
  const u = new SpeechSynthesisUtterance(text); u.rate = rate;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}
export function transcribeAvailable(): boolean {
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
}
export function transcribeOnce(): Promise<string> {
  return new Promise((resolve, reject) => {
    const Ctor = (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
    if (!Ctor) { reject(new Error('Speech recognition missing in this browser — type or import SRT instead.')); return; }
    const r = new Ctor(); r.lang = 'en-US'; r.interimResults = false;
    r.onresult = (e: any) => resolve(e.results[0][0].transcript);
    r.onerror = (e: any) => reject(new Error(String(e.error ?? 'recognition error')));
    r.start();
  });
}
export const FILLERS = ['um', 'uh', 'like', 'you know', 'basically'];
export function findFillers(words: { w: string; t: number; d: number }[]) {
  return words.filter((x) => FILLERS.includes(x.w.toLowerCase())).map((x) => ({ range: [x.t, x.t + x.d] as [number, number], word: x.w }));
}
