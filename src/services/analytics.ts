// Local-only analytics: counts, no media contents, no PII.
const KEY = 'cutforge-events';
export function track(ev: string, data: Record<string, unknown> = {}) {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
    arr.push({ ev, t: Date.now(), ...data });
    localStorage.setItem(KEY, JSON.stringify(arr.slice(-200)));
  } catch { /* noop */ }
  void 0;
}
