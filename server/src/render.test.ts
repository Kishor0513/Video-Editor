import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFfmpegArgs, exportSize, totalDuration } from './render.js';

const tl = {
  tracks: [
    { id: 'v1', clips: [
      { id: 'c1', type: 'video', assetId: 'a-vid', startTime: 0, duration: 4, sourceStart: 1, volume: 0.8, trackId: 'v1', transitionIn: { type: 'fade', duration: 0.5 } },
      { id: 'c2', type: 'video', assetId: 'a-vid', startTime: 4, duration: 4, trackId: 'v1', transitionIn: { type: 'fade', duration: 0.5 } },
    ] },
    { id: 't1', clips: [{ id: 't1', type: 'caption', text: "Hello", fontSize: 56, color: '#fff', textAlign: 'center', startTime: 1, duration: 2, position: { x: 0.5, y: 0.85 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, trackId: 't1' }] },
    { id: 'a1', clips: [{ id: 'm1', type: 'audio', assetId: 'a-mus', startTime: 0, duration: 8, volume: 0.5, fadeIn: 1, trackId: 'a1', position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1 }] },
  ],
  settings: { fps: 30 },
};
const assets = [
  { id: 'a-vid', url: 'https://cdn.example.com/v.mp4', kind: 'video', duration: 10 },
  { id: 'a-mus', url: 'https://cdn.example.com/m.wav', kind: 'audio', duration: 8 },
];

describe('render builder', () => {
  it('sizes 9:16 1080p', () => assert.deepEqual(exportSize('1080p', '9:16'), { w: 608, h: 1080 }));
  it('measures duration across tracks', () => assert.equal(totalDuration(tl as never), 8));
  it('builds xfade + drawtext + amix graph', () => {
    const b = buildFfmpegArgs(tl as never, assets, { res: '720p', fmt: 'mp4', aspect: '16:9' });
    const fc = b.args[b.args.indexOf('-filter_complex') + 1];
    assert.match(fc, /xfade=transition=fade/);
    assert.match(fc, /drawtext=/);
    assert.match(fc, /Hello/);
    assert.match(fc, /amix=inputs=3/);
    assert.match(fc, /\[vout\]/);
    assert.ok(b.args.includes('-c:v') && b.args.includes('libx264'));
    assert.equal(b.warnings.length, 0);
  });
  it('uses nvenc on GPU workers, x264 on CPU', () => {
    const hw = buildFfmpegArgs(tl as never, assets, { res: '1080p', fmt: 'mp4', aspect: '16:9', hw: true });
    assert.ok(hw.args.includes('h264_nvenc'));
    const cpu = buildFfmpegArgs(tl as never, assets, { res: '1080p', fmt: 'mp4', aspect: '16:9' });
    assert.ok(cpu.args.includes('libx264'));
    const webm = buildFfmpegArgs(tl as never, assets, { res: '720p', fmt: 'webm', aspect: '16:9', hw: true });
    assert.ok(webm.args.includes('libvpx-vp9')); // WebM stays CPU
  });
  it('skips blob: assets with warnings', () => {
    const b = buildFfmpegArgs(tl as never, [{ id: 'a-vid', url: 'blob:http://x', kind: 'video' }], { res: '720p', fmt: 'webm', aspect: '16:9' });
    assert.ok(b.warnings.length > 0);
    assert.ok(b.args.includes('libvpx-vp9'));
  });
});
