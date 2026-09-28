const OK: Record<string, string[]> = {
  video: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'],
  image: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/aac', 'audio/mp4', 'audio/ogg', 'audio/webm'],
};
const MAX = 1024 * 1024 * 1024; // 1GB guard
export function validateFile(f: File): { ok: boolean; reason?: string } {
  if (f.size > MAX) return { ok: false, reason: 'File too large (>1GB)' };
  const all = [...OK.video, ...OK.image, ...OK.audio];
  if (f.type && !all.includes(f.type) && !f.name.match(/\.(srt|vtt|cube)$/i)) return { ok: false, reason: 'Unsupported type: ' + (f.type || f.name) };
  return { ok: true };
}
