import { describe, expect, it } from 'vitest';
import { inferKind, validateFile } from './security';

const f = (name: string, type: string, size = 1000) => ({ name, type, size }) as unknown as File;

describe('upload validation', () => {
  it('accepts common video MIME', () => {
    expect(validateFile(f('a.mp4', 'video/mp4')).ok).toBe(true);
    expect(validateFile(f('a.mov', 'video/quicktime')).ok).toBe(true);
  });
  it('accepts empty MIME via extension fallback (m4a/mkv)', () => {
    expect(validateFile(f('voice.m4a', '')).ok).toBe(true);
    expect(validateFile(f('clip.mkv', '')).ok).toBe(true);
    expect(inferKind(f('clip.mkv', ''))).toBe('video');
    expect(inferKind(f('voice.m4a', ''))).toBe('audio');
  });
  it('rejects HEIC with guidance', () => {
    const r = validateFile(f('photo.heic', 'image/heic'));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/JPEG/i);
  });
  it('rejects empty + truly unknown', () => {
    expect(validateFile(f('x.exe', 'application/x-msdownload')).ok).toBe(false);
    expect(validateFile(f('empty.mp4', 'video/mp4', 0)).ok).toBe(false);
  });
});
