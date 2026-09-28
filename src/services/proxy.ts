// Proxy workflow: 480p lightweight copies for smooth editing.
// Originals are never modified; export always renders from originals.
import { ensureFFmpeg } from './mp4';
import { fetchFile } from '@ffmpeg/util';
import { useEditor } from '../state/projectStore';

export async function buildProxy(assetId: string, onp?: (p: number) => void): Promise<string> {
  const st = useEditor.getState();
  const a = st.assets.find((x) => x.id === assetId);
  if (!a) throw new Error('asset missing');
  if (a.kind !== 'video') throw new Error('proxies are for video');
  const src: Blob = await (await fetch(a.url)).blob();
  const f = await ensureFFmpeg(onp);
  const inp = `px-in-${a.id}`;
  const out = `px-out-${a.id}.mp4`;
  await f.writeFile(inp, await fetchFile(src));
  await f.exec(['-i', inp, '-vf', 'scale=-2:480', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-an', out]);
  const data = (await f.readFile(out)) as Uint8Array;
  const url = URL.createObjectURL(new Blob([data.buffer as ArrayBuffer], { type: 'video/mp4' }));
  try { await f.deleteFile(inp); await f.deleteFile(out); } catch { /* noop */ }
  st.set({ assets: st.assets.map((x) => (x.id === assetId ? { ...x, proxyUrl: url } : x)) });
  return url;
}
