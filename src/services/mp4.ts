// Real MP4: transcode the realtime WebM capture with ffmpeg.wasm (local, no server).
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
let ff: FFmpeg | null = null;
async function loaded(onp?: (p: number) => void): Promise<FFmpeg> {
  if (!ff) {
    ff = new FFmpeg();
    if (onp) ff.on('progress', ({ progress }) => onp(progress));
    await ff.load();
  } else if (onp) ff.on('progress', ({ progress }) => onp(progress));
  return ff;
}
export async function ensureFFmpeg(onp?: (p: number) => void): Promise<FFmpeg> {
  return loaded(onp);
}
export async function webmToMp4(webm: Blob, onp: (p: number) => void): Promise<Blob> {
  const f = await loaded(onp);
  await f.writeFile('in.webm', await fetchFile(webm));
  await f.exec(['-i', 'in.webm', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', 'out.mp4']);
  const data = (await f.readFile('out.mp4')) as Uint8Array;
  const out = new Blob([data.buffer as ArrayBuffer], { type: 'video/mp4' });
  try { await f.deleteFile('in.webm'); await f.deleteFile('out.mp4'); } catch { /* noop */ }
  return out;
}
// True sample-reverse: re-encode the source bytes backwards, return playable bytes.
export async function reverseVideoBytes(src: Blob, name: string, onp?: (p: number) => void): Promise<Blob> {
  const f = await loaded(onp);
  const ext = (name.split('.').pop() ?? 'mp4').toLowerCase();
  const inp = `rev-in.${ext}`;
  await f.writeFile(inp, await fetchFile(src));
  await f.exec(['-i', inp, '-vf', 'reverse', '-af', 'areverse', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', 'rev-out.mp4']);
  const data = (await f.readFile('rev-out.mp4')) as Uint8Array;
  const out = new Blob([data.buffer as ArrayBuffer], { type: 'video/mp4' });
  try { await f.deleteFile(inp); await f.deleteFile('rev-out.mp4'); } catch { /* noop */ }
  return out;
}
