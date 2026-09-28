// Recording: screen / camera / voice -> media assets. Real via browser APIs.
import { uid } from '../state/projectStore';
import type { Asset } from '../types';
async function streamToAsset(stream: MediaStream, name: string, kind: Asset['kind']): Promise<Asset> {
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<Blob>((r) => { rec.onstop = () => r(new Blob(chunks, { type: kind === 'audio' ? 'audio/webm' : 'video/webm' })); });
  rec.start(); await new Promise((r) => setTimeout(r, 5000)); rec.stop();
  stream.getTracks().forEach((t) => t.stop());
  const blob = await done; const url = URL.createObjectURL(blob);
  return { id: uid(), kind, name, url, duration: 5, width: 0, height: 0, thumb: '' };
}
export async function recordScreen() {
  const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  return streamToAsset(s, 'Screen recording.webm', 'video');
}
export async function recordCamera() {
  const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  return streamToAsset(s, 'Camera recording.webm', 'video');
}
export async function recordVoice() {
  const s = await navigator.mediaDevices.getUserMedia({ audio: true });
  return streamToAsset(s, 'Voice note.webm', 'audio');
}
