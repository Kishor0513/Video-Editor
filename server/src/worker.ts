// Render worker: downloads http(s) assets, runs ffmpeg from buildFfmpegArgs,
// parses -progress output, uploads the result to R2, updates the job store.
// Text/shape-only timelines render without any asset downloads.
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderJobs } from './store.js';
import { buildFfmpegArgs, type RenderTimeline, type RenderAsset } from './render.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export function ffmpegPath(): string | null {
  for (const c of ['ffmpeg', '/usr/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg']) {
    try {
      execFileSync(c, ['-version'], { stdio: 'ignore' });
      return c;
    } catch { /* try next */ }
  }
  return null;
}

let nvencCache: boolean | null = null;
/** True when this worker host can encode H.264 on the GPU (NVIDIA). */
export function detectNvenc(ff?: string | null): boolean {
  if (nvencCache !== null) return nvencCache;
  try {
    const bin = ff ?? ffmpegPath();
    if (!bin) return (nvencCache = false);
    const out = execFileSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
    return (nvencCache = out.includes('h264_nvenc'));
  } catch {
    return (nvencCache = false);
  }
}

async function download(url: string, dest: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`download ${r.status} for asset`);
  const ws = createWriteStream(dest);
  await new Promise<void>((res, rej) => {
    (r.body as unknown as NodeJS.ReadableStream).pipe(ws as unknown as NodeJS.WritableStream);
    ws.on('finish', () => res());
    ws.on('error', rej);
  });
}

export async function runRender(jobId: string): Promise<void> {
  const job = renderJobs.get(jobId);
  if (!job || job.status !== 'queued') return;
  const ff = ffmpegPath();
  if (!ff) {
    job.status = 'failed';
    job.error = 'Render worker has no ffmpeg installed — install ffmpeg on the worker host, or use local export in the editor.';
    return;
  }
  job.status = 'rendering';
  job.progress = 3;
  const workdir = await fs.mkdtemp(join(tmpdir(), `cutforge-${jobId}-`));
  try {
    const timeline = job.timeline as RenderTimeline;
    const incoming = ((job as unknown as { assets?: RenderAsset[] }).assets ?? []) as RenderAsset[];
    // Fetch remote assets to local files so ffmpeg reads them reliably.
    const localAssets: RenderAsset[] = [];
    for (const a of incoming) {
      if (!a.url || a.url.startsWith('blob:') || a.url.startsWith('data:')) continue;
      if (!/^https?:\/\//.test(a.url)) continue;
      const dest = join(workdir, `${a.id}-${Date.now()}`);
      try {
        await download(a.url, dest);
        localAssets.push({ ...a, url: dest });
      } catch { /* skipped with warning below */ }
    }
    const knownIds = new Set(localAssets.map((a) => a.id));
    const missing = incoming.filter((a) => !knownIds.has(a.id) && (a.kind === 'video' || a.kind === 'audio')).length;
    const hw = detectNvenc(ff) && job.fmt === 'mp4';
    if (hw) (job as unknown as { gpu?: boolean }).gpu = true;
    const built = buildFfmpegArgs(timeline, localAssets, { res: job.res as never, fmt: job.fmt as never, aspect: aspectOf(timeline), hw });
    if (missing > 0) built.warnings.push(`${missing} media file(s) unreachable from worker (browser blob URLs can't leave the tab) — upload via /assets/presign for full cloud renders`);
    const outName = `out.${job.fmt === 'mp4' ? 'mp4' : 'webm'}`;
    const outPath = join(workdir, outName);
    await runFfmpeg(ff, [...built.args, outPath], built.duration, (p) => {
      const j = renderJobs.get(jobId);
      if (j && j.status === 'rendering') j.progress = Math.min(99, Math.max(job.progress, p));
    });
    const data = await fs.readFile(outPath);
    const key = `${job.projectId}/renders/${jobId}.${job.fmt === 'mp4' ? 'mp4' : 'webm'}`;
    const publicUrl = await uploadOutput(key, data, job.fmt === 'mp4' ? 'video/mp4' : 'video/webm');
    const done = renderJobs.get(jobId);
    if (done) {
      done.status = 'complete';
      done.progress = 100;
      done.outUrl = publicUrl ?? undefined;
      if (!publicUrl) done.error = 'rendered but R2 upload not configured — file kept on worker';
    }
  } catch (e) {
    const fail = renderJobs.get(jobId);
    if (fail) {
      fail.status = 'failed';
      fail.error = String((e as Error).message ?? e).slice(0, 500);
    }
  } finally {
    await fs.rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

function aspectOf(t: RenderTimeline): '16:9' | '9:16' | '1:1' {
  const clips = t.tracks.flatMap((tr) => tr.clips);
  const wide = clips.some((c) => (c.position?.y ?? 0.5) > 0.8);
  void wide;
  return '16:9';
}

function runFfmpeg(ff: string, args: string[], total: number, onProgress: (p: number) => void): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(ff, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let pending = '';
    child.stdout.on('data', (d: Buffer) => {
      pending += d.toString();
      let idx: number;
      while ((idx = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, idx).trim();
        pending = pending.slice(idx + 1);
        const m = line.match(/^out_time_ms=(\d+)/);
        if (m && total > 0) onProgress(Math.round((Number(m[1]) / 1e6 / total) * 100));
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    child.on('error', (e) => rej(e));
    child.on('close', (code) => {
      if (code === 0) res();
      else rej(new Error(`ffmpeg exit ${code}: ${stderr.split('\n').slice(-4).join(' | ').slice(0, 400)}`));
    });
  });
}

async function uploadOutput(key: string, data: Buffer, contentType: string): Promise<string | null> {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? '';
  const bucket = process.env.R2_BUCKET ?? 'cutforge';
  if (!endpoint || !accessKeyId) return null;
  const client = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey } });
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: contentType }));
  const base = process.env.R2_PUBLIC_BASE;
  return base ? `${base}/${key}` : `r2://${bucket}/${key}`;
}
