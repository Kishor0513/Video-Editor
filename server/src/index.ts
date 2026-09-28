import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { renderJobs, versionLog, entitlementsMem, projectAssets, uid } from './store.js';
import { presignPut, hasR2, publicUrl } from './r2.js';
import { registerUser, loginUser, createSession, userFromToken } from './session.js';

const app = new Hono();
app.use('*', cors({ origin: (process.env.APP_URL ?? 'http://localhost:5173').split(','), credentials: true }));

type Ctx = { req: { header: (h: string) => string | undefined } };
const bearerOf = (c: Ctx): string | null => {
  const h = c.req.header('authorization');
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
};
const planOf = (c: Ctx) => {
  const u = userFromToken(bearerOf(c));
  if (u) return u.plan;
  const h = c.req.header('x-plan'); // dev override
  if (h === 'pro' || h === 'business' || h === 'free') return h;
  return (process.env.DEFAULT_PLAN as 'free' | 'pro' | 'business' | undefined) ?? 'business';
};
const entFor = (plan: string) => ({ export4k: plan !== 'free', premiumFx: plan !== 'free', aiCredits: plan === 'free' ? 5 : 1000 });

app.get('/health', (c) => c.json({ ok: true, r2: hasR2(), ts: Date.now() }));
app.get('/me', (c) => {
  const u = userFromToken(bearerOf(c));
  const plan = u?.plan ?? planOf(c);
  return c.json({ plan, email: u?.email ?? null, entitlements: entFor(plan) });
});

// ---- Session auth (email+password; Bearer token) ----
const credsSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
app.post('/auth/signup', async (c) => {
  const parsed = credsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'valid email + 8-char password required' }, 400);
  try {
    const user = registerUser(parsed.data.email, parsed.data.password);
    return c.json({ token: createSession(user.email), plan: user.plan, email: user.email }, 201);
  } catch (e) {
    return c.json({ error: String((e as Error).message) }, 409);
  }
});
app.post('/auth/login', async (c) => {
  const parsed = credsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'email + password required' }, 400);
  try {
    const { token, plan } = loginUser(parsed.data.email, parsed.data.password);
    return c.json({ token, plan, email: parsed.data.email.toLowerCase() });
  } catch {
    return c.json({ error: 'invalid credentials' }, 401);
  }
});
app.post('/auth/logout', (c) => {
  const t = bearerOf(c);
  if (t) {
    import('./store.js').then(({ sessions }) => sessions.delete(t)).catch(() => {});
  }
  return c.json({ ok: true });
});

// ---- Versions (server-first project history) ----
app.post('/projects/:id/versions', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  if (!body?.timeline) return c.json({ error: 'timeline required' }, 400);
  const list = versionLog.get(id) ?? [];
  list.push({ ...body.timeline, savedAt: new Date().toISOString() });
  while (list.length > 20) list.shift();
  versionLog.set(id, list);
  return c.json({ ok: true, count: list.length });
});
app.get('/projects/:id/versions', (c) => {
  const id = c.req.param('id');
  return c.json({ versions: versionLog.get(id) ?? [] });
});

// ---- Assets: presigned R2 upload ----
const presignSchema = z.object({ projectId: z.string(), name: z.string(), contentType: z.string(), kind: z.string() });
app.post('/assets/presign', async (c) => {
  const parsed = presignSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'projectId, name, contentType, kind required' }, 400);
  const { projectId, name } = parsed.data;
  const key = `${projectId}/orig/${uid()}-${name.replace(/[^\w.\-]+/g, '_')}`;
  const { url } = await presignPut(key, parsed.data.contentType);
  return c.json({ key, uploadUrl: url || null, publicUrl: publicUrl(key) || null, direct: !url });
});

// ---- Asset metadata (so any device can list a project's cloud files) ----
const commitSchema = z.object({
  projectId: z.string(),
  id: z.string(),
  kind: z.string(),
  name: z.string(),
  url: z.string(),
  duration: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});
app.post('/assets/commit', async (c) => {
  const parsed = commitSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'projectId, id, kind, name, url required' }, 400);
  const list = projectAssets.get(parsed.data.projectId) ?? [];
  const rec = { ...parsed.data, duration: parsed.data.duration ?? 0, width: parsed.data.width ?? 0, height: parsed.data.height ?? 0, createdAt: new Date().toISOString() };
  const i = list.findIndex((a) => a.id === rec.id);
  if (i >= 0) list[i] = rec;
  else list.push(rec);
  projectAssets.set(parsed.data.projectId, list);
  return c.json({ ok: true, count: list.length }, 201);
});
app.get('/projects/:id/assets', (c) => {
  return c.json({ assets: projectAssets.get(c.req.param('id')) ?? [] });
});

// ---- Cloud renders (queue; ffmpeg worker picks up) ----
const renderSchema = z.object({
  projectId: z.string(),
  timeline: z.unknown(),
  assets: z.array(z.object({ id: z.string(), url: z.string(), kind: z.string(), duration: z.number().optional() })).default([]),
  res: z.enum(['480p', '720p', '1080p', '4K']).default('720p'),
  fmt: z.enum(['webm', 'mp4']).default('webm'),
});
app.post('/renders', async (c) => {
  const parsed = renderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'projectId, timeline required' }, 400);
  const plan = planOf(c);
  if (parsed.data.res === '4K' && plan === 'free') return c.json({ error: '4K needs Pro', upgrade: true }, 402);
  const id = uid();
  renderJobs.set(id, { id, projectId: parsed.data.projectId, timeline: parsed.data.timeline, res: parsed.data.res, fmt: parsed.data.fmt, status: 'queued', progress: 0, plan, assets: parsed.data.assets } as never);
  // In-process worker. Scale out: move runRender behind Redis/BullMQ + GPU fleet.
  const { runRender } = await import('./worker.js');
  void runRender(id);
  return c.json({ id, status: 'queued' }, 202);
});
app.get('/renders/:id', (c) => {
  const j = renderJobs.get(c.req.param('id'));
  if (!j) return c.json({ error: 'not found' }, 404);
  return c.json(j);
});
app.get('/renders/:id/ffmpeg', async (c) => {
  // Debug: inspect the exact ffmpeg args for a queued job (no execution).
  const j = renderJobs.get(c.req.param('id'));
  if (!j) return c.json({ error: 'not found' }, 404);
  const { buildFfmpegArgs } = await import('./render.js');
  const built = buildFfmpegArgs(
    j.timeline as never,
    ((j as unknown as { assets?: { id: string; url: string; kind: string }[] }).assets ?? []) as never,
    { res: j.res as never, fmt: j.fmt as never, aspect: '16:9' },
  );
  return c.json({ args: built.args, inputs: built.inputs, warnings: built.warnings, duration: built.duration });
});

// ---- Metered AI (credits enforced server-side) ----
app.post('/ai/:tool', async (c) => {
  const plan = planOf(c);
  const ent = entitlementsMem.get('dev') ?? entFor(plan);
  if (ent.aiCredits <= 0) return c.json({ error: 'AI credits exhausted', upgrade: true }, 402);
  entitlementsMem.set('dev', { ...ent, aiCredits: ent.aiCredits - 1 });
  return c.json({ ok: true, tool: c.req.param('tool'), remaining: ent.aiCredits - 1, note: 'stub — wire Whisper/TTS/bg-remove providers here' });
});

// ---- Stripe ----
app.post('/billing/checkout', async (c) => {
  const secret = process.env.STRIPE_SECRET_KEY;
  const price = process.env.STRIPE_PRO_PRICE_ID;
  if (!secret || !price) return c.json({ error: 'Stripe not configured', checkoutUrl: null }, 501);
  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(secret);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    success_url: `${process.env.APP_URL}/?billing=success`,
    cancel_url: `${process.env.APP_URL}/?billing=cancelled`,
  });
  return c.json({ checkoutUrl: session.url });
});
app.post('/billing/webhook', async (c) => {
  // Verify with STRIPE_WEBHOOK_SECRET and flip users.plan + entitlements. Stub ack.
  return c.json({ received: true });
});

const port = Number(process.env.PORT ?? 8787);
const { serve } = await import('@hono/node-server').catch(() => ({ serve: null as unknown as null }));
if (serve) {
  (serve as (o: { fetch: unknown; port: number }) => void)({ fetch: app.fetch, port });
  console.log(`cutforge-server on :${port}`);
}
export default app;
