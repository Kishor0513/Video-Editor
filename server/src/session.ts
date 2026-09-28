import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { sessions, users, uid, type PlanName } from './store.js';

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt ?? randomBytes(16).toString('hex');
  const hash = scryptSync(password, s, 64).toString('hex');
  return { hash, salt: s };
}

export function verifyPassword(password: string, salt: string, expected: string): boolean {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createSession(email: string): string {
  const user = users.get(email.toLowerCase());
  if (!user) throw new Error('unknown user');
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id, email: user.email, createdAt: Date.now() });
  return token;
}

export function userFromToken(token: string | null | undefined): { id: string; email: string; plan: PlanName } | null {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  const user = [...users.values()].find((u) => u.id === s.userId);
  return user ? { id: user.id, email: user.email, plan: user.plan } : null;
}

export function registerUser(email: string, password: string): { id: string; email: string; plan: PlanName } {
  const key = email.toLowerCase();
  if (users.has(key)) throw new Error('email taken');
  if (password.length < 8) throw new Error('password min 8 chars');
  const { hash, salt } = hashPassword(password);
  const rec = { id: uid(), email: key, passwordHash: hash, salt, plan: 'free' as PlanName, aiCredits: 5, createdAt: new Date().toISOString() };
  users.set(key, rec);
  return { id: rec.id, email: rec.email, plan: rec.plan };
}

export function loginUser(email: string, password: string): { token: string; plan: PlanName } {
  const user = users.get(email.toLowerCase());
  if (!user || !verifyPassword(password, user.salt, user.passwordHash)) throw new Error('invalid credentials');
  return { token: createSession(user.email), plan: user.plan };
}
