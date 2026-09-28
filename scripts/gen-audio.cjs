// Generates license-clean demo audio (original synth, no samples) as 16-bit WAVs.
const fs = require('fs');
const path = require('path');
const SR = 44100;
const out = (name, secs, fn) => {
  const n = Math.floor(SR * secs);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const v = Math.max(-1, Math.min(1, fn(t, i)));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(path.join(__dirname, '..', 'public', 'assets', name), buf);
  console.log(name, (buf.length / 1024).toFixed(0) + 'KB');
};
const N = (f, t) => Math.sin(2 * Math.PI * f * t);
const chord = (t, root, bpm, beatFn) => {
  const scale = [0, 4, 7, 12, 16, 19];
  let v = 0;
  scale.forEach((s, i) => { v += 0.09 * N(root * Math.pow(2, s / 12), t) * (0.6 + 0.4 * Math.sin(t * 0.7 + i)); });
  const beat = (t * bpm / 60) % 1;
  const kick = Math.exp(-beat * 22) * N(55, t) * 0.9;
  const hat = (beat > 0.5 && beat < 0.56) ? (Math.random() * 2 - 1) * 0.12 : 0;
  return (v + kick + hat) * 0.7 + (beatFn ? beatFn(t) : 0);
};
// Upbeat vlog loop 130 BPM, A major-ish
out('music-upbeat.wav', 16, (t) => chord(t, 110, 130, (tt) => 0.1 * N(440 * (1 + 0.02 * Math.sin(tt * 3)), tt)));
// Chill loop 90 BPM, F-ish + vinyl crackle
out('music-chill.wav', 16, (t) => chord(t, 87.3, 90, () => (Math.random() * 2 - 1) * 0.015));
// Whoosh SFX 1.2s
out('sfx-whoosh.wav', 1.2, (t) => {
  const p = t / 1.2;
  return (Math.random() * 2 - 1) * 0.5 * Math.sin(Math.PI * p) * (0.4 + 0.6 * p) * Math.sin(2 * Math.PI * (300 + 1800 * p) * t) * 2;
});
// Pop/click SFX 0.3s
out('sfx-pop.wav', 0.3, (t) => Math.exp(-t * 30) * N(660, t) * 0.8 + Math.exp(-t * 60) * N(1320, t) * 0.4);
