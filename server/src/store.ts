// In-memory fallback so the API boots without Postgres (dev).
// Swap to Drizzle queries once DATABASE_URL is set.
export interface RenderJob {
  id: string;
  projectId: string;
  timeline: unknown;
  res: string;
  fmt: string;
  status: 'queued' | 'rendering' | 'complete' | 'failed';
  progress: number;
  outUrl?: string;
  error?: string;
  plan: string;
}
export const renderJobs = new Map<string, RenderJob>();
export const versionLog = new Map<string, unknown[]>();
export const entitlementsMem = new Map<string, { export4k: boolean; premiumFx: boolean; aiCredits: number }>();

export interface UserRec { id: string; email: string; passwordHash: string; salt: string; plan: PlanName; aiCredits: number; createdAt: string }
export type PlanName = 'free' | 'pro' | 'business';
export const users = new Map<string, UserRec>(); // key: email lowercased
export const sessions = new Map<string, { userId: string; email: string; createdAt: number }>(); // key: token
export interface AssetRec { id: string; projectId: string; kind: string; name: string; url: string; duration: number; width: number; height: number; createdAt: string }
export const projectAssets = new Map<string, AssetRec[]>(); // key: projectId

export const uid = () => Math.random().toString(36).slice(2, 12);
