const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv', 'avi', '3gp', '3gpp', 'mpg', 'mpeg', 'mp2t', 'ts', 'm2ts'];
const AUDIO_EXT = ['mp3', 'wav', 'wave', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'webm', 'flac', 'aiff', 'aif', 'wma'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif'];
const MAX = 1024 * 1024 * 1024; // 1GB guard

const extOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase();

export function inferKind(f: { type: string; name: string }): 'video' | 'audio' | 'image' | null {
  if (f.type.startsWith('video/')) return 'video';
  if (f.type.startsWith('audio/')) return 'audio';
  if (f.type.startsWith('image/')) return 'image';
  const ext = extOf(f.name);
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (IMAGE_EXT.includes(ext)) return 'image';
  return null;
}

export function validateFile(f: File): { ok: boolean; reason?: string } {
  if (f.size > MAX) return { ok: false, reason: `File too large (${(f.size / 1048576).toFixed(0)}MB > 1024MB)` };
  if (f.size === 0) return { ok: false, reason: 'File is empty (0 bytes) — re-export it and try again' };
  const ext = extOf(f.name);
  // iPhone formats the browser can't decode — fail fast with a fix, not silence
  if (ext === 'heic' || ext === 'heif') return { ok: false, reason: 'HEIC photo not playable in browsers — convert to JPEG first (Photos → Export → JPEG)' };
  if (f.name.match(/\.(srt|vtt|cube)$/i)) return { ok: true };
  // Permissive: any video/*, audio/*, image/* MIME passes (browser will flag bad codecs later)
  if (f.type.startsWith('video/') || f.type.startsWith('audio/') || f.type.startsWith('image/')) return { ok: true };
  // Empty MIME (some OS/browsers) — fall back to extension
  if (!f.type && inferKind(f)) return { ok: true };
  if (inferKind(f)) return { ok: true };
  return { ok: false, reason: 'Unsupported type: ' + (f.type || ext || f.name) + ' — try MP4/WebM video, MP3/WAV/M4A audio, or PNG/JPEG/WebP image' };
}
