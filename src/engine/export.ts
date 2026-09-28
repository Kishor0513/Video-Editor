export function pickWebMMime(): string {
  for (const m of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* noop */ }
  }
  return '';
}
// NOTE: MP4 / faster-than-realtime requires ffmpeg.wasm (WebCodecs muxing) —
// MP4 path uses local ffmpeg.wasm transcode (see services/mp4).
export const exportAdapters = {
  webmRealtime: true,
  mp4Wasm: true, // local ffmpeg.wasm H.264/AAC transcode
};
