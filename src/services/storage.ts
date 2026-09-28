// IndexedDB local-first storage: drafts, versions, recovery. tab-sync via BroadcastChannel; versions in IndexedDB.
import type { Project } from '../types';
const DB = 'cutforge', STORE = 'projects';
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function idbSet(key: string, val: unknown) {
  try { const d = await db(); await new Promise<void>((res, rej) => { const t = d.transaction(STORE, 'readwrite').objectStore(STORE).put(JSON.stringify(val), key); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); } catch { /* private mode */ }
}
export async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const d = await db();
    return await new Promise((res) => {
      const t = d.transaction(STORE).objectStore(STORE).get(key);
      t.onsuccess = () => { try { res(t.result ? JSON.parse(t.result) as T : null); } catch { res(null); } };
      t.onerror = () => res(null);
    });
  } catch { return null; }
}
export async function saveVersion(p: Project) {
  const list = (await idbGet<Project[]>('versions:' + p.id)) ?? [];
  list.push({ ...p }); while (list.length > 10) list.shift();
  await idbSet('versions:' + p.id, list);
}
export async function listVersions(id: string) { return (await idbGet<Project[]>('versions:' + id)) ?? []; }

// ---- Media library persistence (IndexedDB blobs, survives reload) ----
const ADB = 'cutforge-assets';
function adb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(ADB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('blobs')) r.result.createObjectStore('blobs'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function saveAssetBlob(id: string, blob: Blob): Promise<void> {
  try {
    const d = await adb();
    await new Promise<void>((res, rej) => {
      const t = d.transaction('blobs', 'readwrite').objectStore('blobs').put(blob, id);
      t.onsuccess = () => res(); t.onerror = () => rej(t.error);
    });
    d.close();
  } catch { /* private mode */ }
}
export async function getAssetBlob(id: string): Promise<Blob | null> {
  try {
    const d = await adb();
    const out = await new Promise<Blob | null>((res) => {
      const t = d.transaction('blobs').objectStore('blobs').get(id);
      t.onsuccess = () => res((t.result as Blob) ?? null);
      t.onerror = () => res(null);
    });
    d.close();
    return out;
  } catch { return null; }
}
export async function deleteAssetBlob(id: string): Promise<void> {
  try {
    const d = await adb();
    await new Promise<void>((res) => {
      const t = d.transaction('blobs', 'readwrite').objectStore('blobs').delete(id);
      t.onsuccess = () => res(); t.onerror = () => res();
    });
    d.close();
  } catch { /* noop */ }
}
