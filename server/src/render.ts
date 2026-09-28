// Timeline JSON -> ffmpeg filter graph. Pure builder (no ffmpeg execution),
// so it is unit-testable without binaries. Mirrors client compositor semantics.
export interface RenderClip {
  id: string;
  assetId?: string;
  type: string;
  startTime: number;
  duration: number;
  sourceStart?: number;
  position?: { x: number; y: number };
  scale?: { x: number; y: number };
  rotation?: number;
  opacity?: number;
  volume?: number;
  speed?: number;
  filters?: { br: number; ct: number; st: number; gr: number; sp: number; bl: number };
  text?: string;
  fontSize?: number;
  color?: string;
  textAlign?: string;
  stroke?: string;
  strokeW?: number;
  shadow?: number;
  anim?: string;
  fadeIn?: number;
  fadeOut?: number;
  transitionIn?: { type: string; duration: number };
  trackId: string;
}
export interface RenderTrack { id: string; clips: RenderClip[]; muted?: boolean; visible?: boolean }
export interface RenderTimeline { tracks: RenderTrack[]; settings?: { fps?: number } }
export interface RenderAsset { id: string; url: string; kind: string; duration?: number }
export interface RenderOpts { res: '480p' | '720p' | '1080p' | '4K'; fmt: 'webm' | 'mp4'; aspect: '16:9' | '9:16' | '1:1'; fps?: number; hw?: boolean }

export function exportSize(res: string, aspect: string): { w: number; h: number } {
  const h = res === '4K' ? 2160 : res === '1080p' ? 1080 : res === '480p' ? 480 : 720;
  if (aspect === '9:16') return { w: Math.round((h * 9) / 16), h };
  if (aspect === '1:1') return { w: h, h };
  return { w: Math.round((h * 16) / 9), h };
}

export const totalDuration = (t: RenderTimeline): number =>
  t.tracks.reduce((m, tr) => tr.clips.reduce((m2, c) => Math.max(m2, c.startTime + c.duration), m), 0);

const escDraw = (s: string): string =>
  String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/\n/g, ' ');

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

function eqFilter(f?: RenderClip['filters']): string {
  if (!f) return '';
  const parts: string[] = [];
  if (f.br !== 100) parts.push(`eq=brightness=${((f.br - 100) / 100).toFixed(3)}`);
  if (f.ct !== 100) parts.push(`eq=contrast=${(f.ct / 100).toFixed(3)}`);
  if (f.st !== 100) parts.push(`eq=saturation=${(f.st / 100).toFixed(3)}`);
  if (f.bl > 0) parts.push(`gblur=sigma=${Math.min(20, f.bl).toFixed(1)}`);
  return parts.join(',');
}

export interface BuiltRender {
  args: string[];
  inputs: { url: string; kind: string; image: boolean }[];
  duration: number;
  warnings: string[];
  width: number;
  height: number;
}

export function buildFfmpegArgs(timeline: RenderTimeline, assets: RenderAsset[], opts: RenderOpts): BuiltRender {
  const { w: W, h: H } = exportSize(opts.res, opts.aspect);
  const fps = opts.fps ?? timeline.settings?.fps ?? 30;
  const byId = new Map(assets.map((a) => [a.id, a]));
  const warnings: string[] = [];
  const inputs: BuiltRender['inputs'] = [];
  const inputIndex = new Map<string, number>(); // assetId -> input idx
  const vFilters: string[] = [];
  const aFilters: string[] = [];
  const duration = totalDuration(timeline);

  const ensureInput = (assetId: string, isImage: boolean): number | null => {
    const a = byId.get(assetId);
    if (!a || !a.url || a.url.startsWith('blob:')) {
      warnings.push(`asset ${assetId} has no downloadable URL — clip skipped`);
      return null;
    }
    if (inputIndex.has(assetId)) return inputIndex.get(assetId)!;
    const idx = inputs.length;
    inputs.push({ url: a.url, kind: a.kind, image: isImage });
    inputIndex.set(assetId, idx);
    return idx;
  };

  const vTracks = timeline.tracks.filter((t) => t.id[0] === 'v' && t.visible !== false);
  const baseTrack = vTracks.find((t) => t.id === 'v1') ?? vTracks[vTracks.length - 1] ?? vTracks[0];
  const overlayTracks = vTracks.filter((t) => t !== baseTrack);
  const textTracks = timeline.tracks.filter((t) => t.id[0] === 't' && t.visible !== false);

  // Canvas base: black background for full duration
  vFilters.push(`color=c=black:s=${W}x${H}:d=${duration.toFixed(3)}:r=${fps}[base]`);

  // ---- Base video chain with xfade transitions ----
  let baseLabel = '[base]';
  if (baseTrack) {
    const clips = [...baseTrack.clips].sort((a, b) => a.startTime - b.startTime);
    const XF = (t: string) => (t === 'wipe' ? 'wipeleft' : t === 'slide' ? 'slideleft' : t === 'dissolve' ? 'dissolve' : 'fade');
    let chainLabel = '[base]';
    let chained = 0;
    let cursor = 0;
    clips.forEach((c, i) => {
      if (c.type !== 'video' && c.type !== 'image') return;
      const idx = c.assetId ? ensureInput(c.assetId, c.type === 'image') : null;
      if (c.assetId && idx === null) return;
      const ss = Math.max(0, c.sourceStart ?? 0);
      const rate = Math.abs(c.speed ?? 1) || 1;
      const effDur = c.duration / 1; // timeline duration stays; speed changes source mapping
      const srcDur = effDur * rate;
      void srcDur;
      const eq = eqFilter(c.filters);
      const vpre = idx === null
        ? `color=c=black:s=${W}x${H}:d=${c.duration.toFixed(3)}:r=${fps}`
        : `trim=start=${ss.toFixed(3)}:end=${(ss + c.duration * rate).toFixed(3)},setpts=PTS-STARTPTS${rate !== 1 ? `,setpts=${(1 / rate).toFixed(4)}*PTS` : ''}`;
      const scale = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${fps},format=yuv420p`;
      const label = `[vsrc${i}]`;
      if (idx === null) vFilters.push(`${vpre},${scale}${eq ? ',' + eq : ''}${label}`);
      else vFilters.push(`[${idx}:v]${vpre},${scale}${eq ? ',' + eq : ''}${label}`);
      // fade alpha on base clips
      let lv = label;
      if ((c.fadeIn ?? 0) > 0 || (c.fadeOut ?? 0) > 0) {
        const fl = `[vfade${i}]`;
        const fparts: string[] = [];
        if ((c.fadeIn ?? 0) > 0) fparts.push(`fade=t=in:st=0:d=${c.fadeIn}`);
        if ((c.fadeOut ?? 0) > 0) fparts.push(`fade=t=out:st=${Math.max(0, c.duration - (c.fadeOut ?? 0)).toFixed(3)}:d=${c.fadeOut}`);
        vFilters.push(`${lv}${fparts.join(',')}${fl}`);
        lv = fl;
      }
      if (chained === 0) {
        // first clip delayed to its startTime over base
        const ol = `[ch${i}]`;
        vFilters.push(`${chainLabel}${lv}overlay=0:0:enable='between(t,${c.startTime.toFixed(3)},${(c.startTime + c.duration).toFixed(3)})'${ol}`);
        chainLabel = ol;
      } else {
        const prev = clips[i - 1];
        const overlap = Math.min(c.transitionIn?.duration ?? 0, c.duration / 2, prev.duration / 2);
        if (overlap > 0.05) {
          const off = Math.max(0, c.startTime - overlap);
          const ol = `[ch${i}]`;
          vFilters.push(`${chainLabel}${lv}xfade=transition=${XF(c.transitionIn?.type ?? 'fade')}:duration=${overlap.toFixed(3)}:offset=${off.toFixed(3)}${ol}`);
          chainLabel = ol;
        } else {
          const ol = `[ch${i}]`;
          vFilters.push(`${chainLabel}${lv}overlay=0:0:enable='between(t,${c.startTime.toFixed(3)},${(c.startTime + c.duration).toFixed(3)})'${ol}`);
          chainLabel = ol;
        }
      }
      chained++;
      cursor = c.startTime + c.duration;
    });
    void cursor;
    baseLabel = chained ? chainLabel : '[base]';
  }

  // ---- Overlays (PiP) ----
  let ovLabel = baseLabel;
  let ovN = 0;
  for (const tr of overlayTracks) {
    for (const c of tr.clips) {
      if (c.type === 'shape' || c.type === 'adjustment') continue; // shapes/text handled below; adjustment = grade pass (client-side only for now)
      if (!c.assetId) continue;
      const idx = ensureInput(c.assetId, c.type === 'image');
      if (idx === null) continue;
      const ss = Math.max(0, c.sourceStart ?? 0);
      const sc = c.scale?.x ?? 1;
      const dw = Math.round(W * 0.55 * sc);
      const dh = Math.round((dw * 9) / 16);
      const ox = Math.round(W * (0.5 + (c.position?.x ?? 0)) - dw / 2);
      const oy = Math.round(H * (0.5 + (c.position?.y ?? 0)) - dh / 2);
      const a = Math.max(0, Math.min(1, c.opacity ?? 1));
      const nl = `[ov${ovN++}]`;
      const eq = eqFilter(c.filters);
      vFilters.push(
        `[${idx}:v]trim=start=${ss.toFixed(3)}:end=${(ss + c.duration).toFixed(3)},setpts=PTS-STARTPTS,scale=${dw}:${dh},format=rgba${a < 1 ? `,colorchannelmixer=aa=${a.toFixed(3)}` : ''}${eq ? ',' + eq : ''}[ovs${ovN}]`,
      );
      vFilters.push(
        `${ovLabel}[ovs${ovN}]overlay=x=${ox}:y=${oy}:enable='between(t,${c.startTime.toFixed(3)},${(c.startTime + c.duration).toFixed(3)})'${nl}`,
      );
      ovLabel = nl;
    }
  }

  // ---- Text / captions via drawtext ----
  let txLabel = ovLabel;
  let txN = 0;
  const allText = [...textTracks.flatMap((t) => t.clips)];
  for (const c of allText) {
    if (!c.text) continue;
    const fs = Math.round((c.fontSize ?? 52) * (W / 960));
    const y = Math.round((c.position?.y ?? 0.5) * H);
    const align = c.textAlign ?? 'center';
    const xExpr = align === 'center' ? `(w-text_w)/2` : align === 'right' ? `w-text_w-${Math.round((1 - (c.position?.x ?? 0.5)) * W)}` : `${Math.round((c.position?.x ?? 0) * W)}`;
    // typewriter: reveal via drawtext textfile trick is overkill — approximate with fade in
    const fade = c.anim === 'fade' || c.anim === 'pop' || c.anim === 'slide'
      ? `:alpha='if(lt(t\\,${c.startTime.toFixed(3)})\\,0\\,if(lt(t\\,${(c.startTime + 0.4).toFixed(3)})\\,(t-${c.startTime.toFixed(3)})/0.4\\,if(gt(t\\,${(c.startTime + c.duration - 0.3).toFixed(3)})\\,max(0\\,(${((c.startTime + c.duration)).toFixed(3)}-t)/0.3)\\,1)))'`
      : '';
    const nl = `[tx${txN++}]`;
    vFilters.push(
      `${txLabel}drawtext=fontfile=${FONT}:text='${escDraw(c.text)}':fontsize=${fs}:fontcolor=${c.color ?? 'white'}${c.strokeW ? `:borderw=${Math.max(1, Math.round(c.strokeW * (W / 960)))}:bordercolor=${c.stroke ?? 'black'}` : ''}${c.shadow ? `:shadowx=2:shadowy=2` : ''}:x=${xExpr}:y=${y}-text_h/2:enable='between(t,${c.startTime.toFixed(3)},${(c.startTime + c.duration).toFixed(3)})'${fade}${nl}`,
    );
    txLabel = nl;
  }
  vFilters.push(`${txLabel}format=yuv420p[vout]`);

  // ---- Audio: trim/volume/fade/delay + mix ----
  const aTracks = timeline.tracks.filter((t) => t.id[0] === 'a' && t.muted !== false);
  const audioClips = aTracks.flatMap((t) => t.clips.map((c) => ({ t, c }))).filter(({ c }) => c.assetId || c.type === 'audio');
  // also video-clip audio (base track videos carry sound)
  if (baseTrack) {
    for (const c of baseTrack.clips) {
      if ((c.type === 'video' || c.type === 'audio') && c.assetId && (c.volume ?? 1) > 0) {
        const idx = inputIndex.get(c.assetId);
        if (idx === undefined) continue;
        audioClips.push({ t: { id: baseTrack.id } as never, c });
      }
    }
  }
  let aN = 0;
  const mixInputs: string[] = [];
  for (const { c } of audioClips) {
    if (!c.assetId) continue;
    let idx = inputIndex.get(c.assetId);
    if (idx === undefined) {
      // audio-only assets never entered an input via the video chains
      const fresh = ensureInput(c.assetId, false);
      if (fresh === null) continue;
      idx = fresh;
    }
    const ss = Math.max(0, c.sourceStart ?? 0);
    const vol = Math.max(0, c.volume ?? 1);
    const fparts = [`volume=${vol.toFixed(3)}`];
    if ((c.fadeIn ?? 0) > 0) fparts.push(`afade=t=in:st=0:d=${c.fadeIn}`);
    if ((c.fadeOut ?? 0) > 0) fparts.push(`afade=t=out:st=${Math.max(0, c.duration - (c.fadeOut ?? 0)).toFixed(3)}:d=${c.fadeOut}`);
    const nl = `[a${aN++}]`;
    aFilters.push(`[${idx}:a]atrim=start=${ss.toFixed(3)}:end=${(ss + c.duration).toFixed(3)},asetpts=PTS-STARTPTS,${fparts.join(',')},adelay=${Math.round(c.startTime * 1000)}|${Math.round(c.startTime * 1000)}${nl}`);
    mixInputs.push(nl);
  }
  if (mixInputs.length === 0) {
    aFilters.push(`anullsrc=r=48000:cl=stereo:d=${duration.toFixed(3)}[aout]`);
  } else if (mixInputs.length === 1) {
    aFilters.push(`${mixInputs[0]}apad,atrim=0:${duration.toFixed(3)}[aout]`);
  } else {
    aFilters.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:dropout_transition=0:normalize=0,atrim=0:${duration.toFixed(3)}[aout]`);
  }

  const filterComplex = [...vFilters, ...aFilters].join(';');
  const args: string[] = ['-y', '-progress', 'pipe:1', '-nostats'];
  inputs.forEach((inp) => {
    if (inp.image) args.push('-loop', '1', '-framerate', String(fps));
    args.push('-i', inp.url);
  });
  args.push('-filter_complex', filterComplex, '-map', '[vout]', '-map', '[aout]', '-r', String(fps), '-t', duration.toFixed(3));
  // GPU: NVENC when the worker host has it (see worker detectNvenc); WebM stays CPU (libvpx).
  if (opts.fmt === 'mp4' && opts.hw) args.push('-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', opts.res === '4K' ? '22' : '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart');
  else if (opts.fmt === 'mp4') args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', opts.res === '4K' ? '20' : '18', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart');
  else args.push('-c:v', 'libvpx-vp9', '-b:v', opts.res === '4K' ? '20M' : opts.res === '1080p' ? '10M' : '5M', '-c:a', 'libvorbis', '-movflags', '0');

  return { args, inputs, duration, warnings, width: W, height: H };
}
