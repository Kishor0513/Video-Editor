// Real multi-tab collaboration: BroadcastChannel project sync. Same-machine realtime.
import type { Project } from '../types';
const ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('cutforge-pro') : null;
export function publish(p: Project) { try { ch?.postMessage({ type: 'project', p }); } catch { /* noop */ } }
export function subscribe(cb: (p: Project) => void) {
  if (!ch) return () => undefined;
  const h = (e: MessageEvent) => { if (e.data?.type === 'project') cb(e.data.p as Project); };
  ch.addEventListener('message', h);
  return () => ch.removeEventListener('message', h);
}
