import { drawCover, filterString, keyframedValue } from './renderer';
import { poolGet } from './pool';
import { keyFrame } from './chroma';
import { applyLut, getClipLut } from './lut';
import type { Asset, Clip, Project } from '../types';

export function activeClips(project: Project, trackId: string, t: number): Clip[] {
  const tr = project.tracks.find((x) => x.id === trackId);
  if (!tr || tr.visible === false) return [];
  return tr.clips.filter((c) => t >= c.startTime && t < c.startTime + c.duration).sort((a, b) => a.startTime - b.startTime);
}

export function drawComposition(project: Project, assets: Asset[], t: number, cv: HTMLCanvasElement) {
  const ctx = cv.getContext('2d')!;
  const W = cv.width, H = cv.height;
  ctx.save(); ctx.filter = 'none'; ctx.globalAlpha = 1;
  ctx.fillStyle = project.settings.background ?? '#000'; ctx.fillRect(0, 0, W, H); ctx.restore();
  const byId = new Map(assets.map((a) => [a.id, a]));
  const vTracks = project.tracks.filter((x) => x.id[0] === 'v');
  const baseTrack = vTracks.find((x) => x.id === 'v1') ?? vTracks[vTracks.length - 1] ?? vTracks[0];
  const overlayTracks = vTracks.filter((x) => x !== baseTrack);
  const paintBase = (c: Clip, a: number) => (c.sub?.length ? paintCompound(ctx, c, byId, t, W, H) : paintClip(ctx, c, byId, t, W, H, a));
  if (baseTrack) {
    const v1 = activeClips(project, baseTrack.id, t);
    if (v1.length === 1) paintBase(v1[0], 1);
    else if (v1.length > 1) {
      const a = v1[v1.length - 2], b = v1[v1.length - 1];
      paintBase(a, 1);
      const ov = a.startTime + a.duration - b.startTime;
      const p = ov > 0 ? Math.min(1, Math.max(0, (t - b.startTime) / ov)) : 1;
      const type = b.transitionIn?.type ?? 'fade';
      if (type === 'fade' || type === 'dissolve') paintBase(b, p);
      else if (type === 'glitch') {
        // RGB-split slices that jitter then settle
        const slices = 6;
        for (let i = 0; i < slices; i++) {
          const y0 = (i / slices) * H;
          const h = H / slices;
          const jitter = (1 - p) * (Math.random() - 0.5) * W * 0.3;
          ctx.save();
          ctx.beginPath(); ctx.rect(0, y0, W, h); ctx.clip();
          ctx.translate(jitter, 0);
          paintBase(b, 1);
          ctx.restore();
        }
        ctx.save(); ctx.globalAlpha = (1 - p) * 0.5; ctx.globalCompositeOperation = 'screen';
        paintBase(b, 1); ctx.restore();
      } else if (type === 'zoom') {
        ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(0.6 + 0.4 * p, 0.6 + 0.4 * p); ctx.translate(-W / 2, -H / 2);
        paintBase(b, 1); ctx.restore();
      } else if (type === 'blur') {
        ctx.save(); ctx.filter = `blur(${(1 - p) * 18}px)`; paintBase(b, 1); ctx.restore();
      } else if (type === 'circle') {
        ctx.save(); ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.max(W, H) * 0.75 * p, 0, Math.PI * 2); ctx.clip(); paintBase(b, 1); ctx.restore();
      } else if (type === 'pixelate') {
        const px = Math.max(1, Math.round((1 - p) * 40));
        const tw = Math.max(1, Math.round(W / px)), th = Math.max(1, Math.round(H / px));
        const tmp = document.createElement('canvas'); tmp.width = tw; tmp.height = th;
        const tg = tmp.getContext('2d')!;
        paintBase(b, 1);
        ctx.save(); ctx.imageSmoothingEnabled = false;
        ctx.drawImage(cv, 0, 0, tw, th);
        ctx.drawImage(tmp, 0, 0, W, H); ctx.restore();
      } else if (type === 'light') {
        paintBase(b, 1);
        ctx.save(); ctx.globalAlpha = (1 - p) * 0.9; ctx.globalCompositeOperation = 'screen';
        const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
        g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
      } else { ctx.save(); if (type === 'wipe') { ctx.beginPath(); ctx.rect(0, 0, W * p, H); ctx.clip(); } else ctx.translate(W * (1 - p), 0); paintBase(b, 1); ctx.restore(); }
    }
  }
  for (const tr of overlayTracks) {
    for (const c of activeClips(project, tr.id, t)) {
      if (c.type === 'shape') paintShape(ctx, c, t, W, H);
      else if (c.type === 'adjustment') { /* applied as grade pass below */ }
      else if (c.sub?.length) paintCompound(ctx, c, byId, t, W, H);
      else paintOverlay(ctx, c, byId, t, W, H);
    }
  }
  for (const tr of project.tracks.filter((x) => x.id[0] === 't')) {
    for (const c of activeClips(project, tr.id, t)) paintText(ctx, c, t, W, H);
  }
  const adj = vTracks.flatMap((tr) => activeClips(project, tr.id, t)).filter((c) => c.type === 'adjustment');
  if (adj.length && adjTmp) {
    adjTmp.width = W; adjTmp.height = H;
    const ag = adjTmp.getContext('2d')!;
    ag.save(); ag.filter = 'none'; ag.globalAlpha = 1; ag.clearRect(0, 0, W, H); ag.drawImage(cv, 0, 0); ag.restore();
    ctx.save(); ctx.filter = 'none'; ctx.globalAlpha = 1;
    ctx.fillStyle = project.settings.background ?? '#000'; ctx.fillRect(0, 0, W, H);
    ctx.filter = adj.map((c) => filterString(c.filters)).filter((f) => f !== 'none').join(' ') || 'none';
    ctx.globalAlpha = Math.max(0, Math.min(1, adj[0].opacity));
    ctx.drawImage(adjTmp, 0, 0);
    ctx.restore();
  }
}

const adjTmp = typeof document !== 'undefined' ? document.createElement('canvas') : null;

function paintCompound(ctx: CanvasRenderingContext2D, c: Clip, byId: Map<string, Asset>, t: number, W: number, H: number) {
  const lt = t - c.startTime;
  const subs = (c.sub ?? []).filter((s) => lt >= s.startTime && lt < s.startTime + s.duration);
  for (const s of subs) {
    paintClip(ctx, { ...s, startTime: c.startTime + s.startTime }, byId, t, W, H, c.opacity);
  }
}

const lutTmp = typeof document !== 'undefined' ? document.createElement('canvas') : null;

function paintClip(ctx: CanvasRenderingContext2D, c: Clip, byId: Map<string, Asset>, t: number, W: number, H: number, alpha: number) {
  const lt = t - c.startTime;
  let fade = 1;
  if ((c.fadeIn ?? 0) > 0) fade *= Math.max(0, Math.min(1, lt / c.fadeIn!));
  if ((c.fadeOut ?? 0) > 0) fade *= Math.max(0, Math.min(1, (c.duration - lt) / c.fadeOut!));
  const op = Math.max(0, Math.min(1, keyframedValue(c, 'opacity', lt, c.opacity) * alpha * fade));
  const lut = getClipLut(c.id);
  const useLut = !!lutTmp && lut && (c.lutIntensity ?? 0) > 0;
  const target = useLut ? lutTmp! : null;
  if (target) { target.width = W; target.height = H; }
  const g = target?.getContext('2d', { willReadFrequently: true }) ?? ctx;
  g.save();
  if (g !== ctx) { g.clearRect(0, 0, W, H); }
  g.globalAlpha = target ? 1 : op; g.filter = filterString(c.filters);
  if (c.mask?.shape === 'circle') { g.beginPath(); g.arc(W / 2, H / 2, Math.min(W, H) * 0.36, 0, Math.PI * 2); g.clip(); }
  try {
    const el = poolGet(c.id);
    const hasCropKf = (c.keyframes ?? []).some((k) => k.prop === 'cropX');
    const cr = {
      x: keyframedValue(c, 'cropX', lt, c.crop?.x ?? 0),
      y: keyframedValue(c, 'cropY', lt, c.crop?.y ?? 0),
      w: keyframedValue(c, 'cropW', lt, c.crop?.w ?? 1),
      h: keyframedValue(c, 'cropH', lt, c.crop?.h ?? 1),
    };
    const useCrop = !!c.crop || hasCropKf;
    const drawEl = (src: CanvasImageSource & { videoWidth?: number; naturalWidth?: number; videoHeight?: number; naturalHeight?: number }) => {
      if (useCrop) {
        const iw = src.videoWidth || src.naturalWidth || W, ih = src.videoHeight || src.naturalHeight || H;
        g.drawImage(src, cr.x * iw, cr.y * ih, Math.max(0.01, cr.w) * iw, Math.max(0.01, cr.h) * ih, 0, 0, W, H);
      } else drawCover(g as CanvasRenderingContext2D, src, W, H);
    };
    if (c.chroma?.enabled && (el instanceof HTMLVideoElement || el instanceof HTMLImageElement)) {
      const ready = el instanceof HTMLImageElement ? el.complete && el.naturalWidth : el.readyState >= 2;
      if (ready) {
        try {
          const keyed = keyFrame(el, 480, 270, { ...c.chroma });
          g.drawImage(keyed, 0, 0, W, H);
        } catch { drawEl(el); }
      }
    } else if (el instanceof HTMLImageElement && el.complete && el.naturalWidth) {
      // CapCut-style blurred BG for vertical canvas (fills bars instead of black)
      if (c.bgBlur) { try { g.save(); g.filter = 'blur(24px) brightness(.7)'; g.drawImage(el, -W * 0.15, -H * 0.15, W * 1.3, H * 1.3); g.restore(); } catch { /* noop */ } }
      drawEl(el);
    }
    else if (el instanceof HTMLVideoElement && el.readyState >= 2) {
      if (c.bgBlur) { try { g.save(); g.filter = 'blur(24px) brightness(.7)'; g.drawImage(el, -W * 0.15, -H * 0.15, W * 1.3, H * 1.3); g.restore(); } catch { /* noop */ } }
      if (c.flipH) { g.translate(W, 0); g.scale(-1, 1); }
      drawEl(el);
    }
  } catch { /* noop */ }
  g.restore();
  if (target && lut) {
    try { applyLut(target.getContext('2d', { willReadFrequently: true })!, W, H, lut, c.lutIntensity ?? 1); } catch { /* noop */ }
    ctx.save(); ctx.globalAlpha = op; ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(target, 0, 0); ctx.restore();
  } else if (!target) ctx.restore();
  if ((c.vignette ?? 0) > 0) {
    const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) / 3, W / 2, H / 2, Math.max(W, H) / 1.2);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${((c.vignette ?? 0) / 100) * 0.8})`);
    ctx.save(); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
}

function paintOverlay(ctx: CanvasRenderingContext2D, c: Clip, byId: Map<string, Asset>, t: number, W: number, H: number) {
  void byId; void t;
  const lt = t - c.startTime;
  let fade = 1;
  if ((c.fadeIn ?? 0) > 0) fade *= Math.max(0, Math.min(1, lt / c.fadeIn!));
  if ((c.fadeOut ?? 0) > 0) fade *= Math.max(0, Math.min(1, (c.duration - lt) / c.fadeOut!));
  const op = keyframedValue(c, 'opacity', lt, c.opacity) * fade;
  ctx.save(); ctx.globalAlpha = op; ctx.filter = filterString(c.filters);
  try { ctx.globalCompositeOperation = c.blend ?? 'source-over'; } catch { /* noop */ }
  const sc = c.scale.x, dw = W * 0.55 * sc, dh = (dw * 9) / 16;
  ctx.translate(W * (0.5 + c.position.x), H * (0.5 + c.position.y)); ctx.rotate((keyframedValue(c, 'rotation', lt, c.rotation) * Math.PI) / 180);
  try {
    const el = poolGet(c.id);
    if (el instanceof HTMLImageElement && el.complete && el.naturalWidth) ctx.drawImage(el, -dw / 2, -dh / 2, dw, dh);
    else if (el instanceof HTMLVideoElement && el.readyState >= 2) ctx.drawImage(el, -dw / 2, -dh / 2, dw, dh);
  } catch { /* noop */ }
  ctx.restore();
}

function paintText(ctx: CanvasRenderingContext2D, c: Clip, t: number, W: number, H: number) {
  const lt = t - c.startTime;
  const IN = 0.45;
  let alpha = 1, scale = 1, dx = 0;
  const anim = c.anim ?? 'none';
  if (anim === 'fade') alpha = Math.max(0, Math.min(1, Math.min(lt / IN, (c.duration - lt) / IN)));
  else if (anim === 'pop') {
    const p = Math.max(0, Math.min(1, lt / 0.3));
    scale = 0.4 + 0.6 * (1 - Math.pow(1 - p, 3)); // ease-out-back-ish
    alpha = Math.max(0, Math.min(1, Math.min(lt / 0.12, (c.duration - lt) / 0.25)));
  } else if (anim === 'bounce') {
    const p = Math.max(0, Math.min(1, lt / 0.5));
    scale = 1 + Math.sin(p * Math.PI * 3) * (1 - p) * 0.25;
    alpha = Math.max(0, Math.min(1, Math.min(lt / 0.1, (c.duration - lt) / 0.2)));
  } else if (anim === 'zoom') {
    const p = Math.max(0, Math.min(1, lt / 0.35));
    scale = 0.3 + 0.7 * (1 - Math.pow(1 - p, 4));
    alpha = Math.max(0, Math.min(1, Math.min(lt / 0.1, (c.duration - lt) / 0.2)));
  } else if (anim === 'blur') {
    alpha = Math.max(0, Math.min(1, Math.min(lt / 0.3, (c.duration - lt) / 0.25)));
  } else if (anim === 'neon') {
    alpha = Math.max(0, Math.min(1, Math.min(lt / 0.15, (c.duration - lt) / 0.2)));
  } else if (anim === 'slide') {
    const p = Math.max(0, Math.min(1, lt / 0.4));
    dx = (1 - (1 - Math.pow(1 - p, 3))) * -W * 0.25;
    alpha = Math.max(0, Math.min(1, Math.min(lt / 0.2, (c.duration - lt) / 0.25)));
  }
  const full = String(c.text ?? '');
  const shown = anim === 'typewriter'
    ? full.slice(0, Math.max(0, Math.min(full.length, Math.floor((lt / Math.max(0.01, c.duration)) * (full.length + 6)))))
    : full;
  const fs = (c.fontSize ?? 52) * (W / 960) * scale;
  ctx.save(); ctx.globalAlpha = alpha; ctx.font = `700 ${fs}px Inter, Arial`;
  ctx.textAlign = c.textAlign ?? 'center'; ctx.textBaseline = 'middle';
  if (c.bgColor) paintTextBg(ctx, c, W, H, fs);
  ctx.fillStyle = c.color ?? '#fff';
  if (anim === 'neon') {
    const flick = 0.75 + 0.25 * Math.sin(lt * 40);
    ctx.globalAlpha = alpha * flick;
    ctx.shadowColor = c.color ?? '#5eead4';
    ctx.shadowBlur = fs * 0.6;
  } else if ((c.shadow ?? 0) > 0) { ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = c.shadow! * (W / 960); ctx.shadowOffsetY = 2; }
  const lines = shown.split('\n');
  const lh = fs * 1.25, y0 = c.position.y * H;
  lines.forEach((l, i) => {
    const y = y0 - ((lines.length - 1) * lh) / 2 + i * lh;
    ctx.fillText(l, c.position.x * W + dx, y);
    if ((c.strokeW ?? 0) > 0) {
      ctx.lineWidth = c.strokeW! * (W / 960); ctx.strokeStyle = c.stroke ?? '#000';
      ctx.strokeText(l, c.position.x * W + dx, y);
    }
  });
  // typewriter caret
  if (anim === 'typewriter' && lt < c.duration - 0.1) {
    ctx.fillRect(c.position.x * W + dx + fs * 0.3, y0 - fs * 0.5, Math.max(2, fs * 0.06), fs);
  }
  ctx.restore();
}

function paintTextBg(ctx: CanvasRenderingContext2D, c: Clip, W: number, H: number, fs: number) {
  const pad = fs * 0.28;
  const lines = String(c.text ?? '').split('\n');
  const lh = fs * 1.25;
  const wMax = Math.max(...lines.map((l) => ctx.measureText(l).width), 1);
  const boxH = lines.length * lh + pad * 1.4;
  const boxW = wMax + pad * 2;
  const x = c.position.x * W - boxW / 2;
  const y = c.position.y * H - boxH / 2;
  ctx.save();
  ctx.fillStyle = c.bgColor ?? 'rgba(0,0,0,0.55)';
  const r = fs * 0.18;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + boxW, y, x + boxW, y + boxH, r);
  ctx.arcTo(x + boxW, y + boxH, x, y + boxH, r);
  ctx.arcTo(x, y + boxH, x, y, r);
  ctx.arcTo(x, y, x + boxW, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function paintShape(ctx: CanvasRenderingContext2D, c: Clip, t: number, W: number, H: number) {
  const lt = t - c.startTime;
  let fade = 1;
  if ((c.fadeIn ?? 0) > 0) fade *= Math.max(0, Math.min(1, lt / c.fadeIn!));
  if ((c.fadeOut ?? 0) > 0) fade *= Math.max(0, Math.min(1, (c.duration - lt) / c.fadeOut!));
  const op = keyframedValue(c, 'opacity', lt, c.opacity) * fade;
  const s = Math.min(W, H) * 0.18 * c.scale.x;
  ctx.save();
  ctx.globalAlpha = op;
  ctx.translate(W * (0.5 + c.position.x), H * (0.5 + c.position.y));
  ctx.rotate((keyframedValue(c, 'rotation', lt, c.rotation) * Math.PI) / 180);
  ctx.fillStyle = c.color ?? '#8b5cf6';
  if ((c.shadow ?? 0) > 0) { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = c.shadow!; }
  ctx.beginPath();
  const kind = c.shape ?? 'rect';
  if (kind === 'circle') ctx.arc(0, 0, s, 0, Math.PI * 2);
  else if (kind === 'triangle') { ctx.moveTo(0, -s); ctx.lineTo(s * 0.9, s * 0.7); ctx.lineTo(-s * 0.9, s * 0.7); ctx.closePath(); }
  else if (kind === 'star') {
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? s : s * 0.45;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
  } else ctx.rect(-s, -s * 0.7, s * 2, s * 1.4);
  ctx.fill();
  ctx.restore();
}

export function exportSize(res: string, aspect: string): { w: number; h: number } {
  const h = res === '4K' ? 2160 : res === '1080p' ? 1080 : res === '480p' ? 480 : 720;
  if (aspect === '9:16') return { w: Math.round((h * 9) / 16), h };
  if (aspect === '1:1') return { w: h, h };
  return { w: Math.round((h * 16) / 9), h };
}

export function estimateBytes(res: string, seconds: number): number {
  const bitrate = res === '4K' ? 20_000_000 : res === '1080p' ? 10_000_000 : res === '480p' ? 2_500_000 : 8_000_000;
  return (bitrate / 8) * Math.max(0, seconds);
}
