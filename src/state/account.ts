import { create } from 'zustand';
import { exportSnapshot, mergeSnapshot, packSnapshot, unpackSnapshot, type MergeReport } from '../lib/sync/snapshot';
import { init } from './actions';
import { toast } from './store';
import { reloadShared } from './shared';

/**
 * The optional account: sign in with a username and password, and this browser's games,
 * kifu and player data sync with the account's copy (see shared/accountServer.ts). Syncing
 * merges the account's copy in first, then uploads the result, so two devices add up
 * rather than overwrite each other. Nothing here is needed to use the app.
 */

export interface SnapshotMeta {
  id: string;
  parts: number;
  size: number;
  updatedAt: number;
  device?: string;
}

export interface AccountState {
  /** null until the first status check. */
  configured: boolean | null;
  user: { name: string } | null;
  snapshot: SnapshotMeta | null;
  syncing: null | 'download' | 'upload';
  progress?: string;
  lastSync: number | null;
  error?: string;
}

const LAST = 'dop.lastSync';
const readLast = () => {
  try {
    return Number(localStorage.getItem(LAST)) || null;
  } catch {
    return null;
  }
};

export const useAccount = create<AccountState>(() => ({ configured: null, user: null, snapshot: null, syncing: null, lastSync: readLast() }));
const set = useAccount.setState;
const get = useAccount.getState;

/** Matches the server's limit for one part (shared/accountServer.ts MAX_PART). */
const PART = 880_000;

async function api<T>(action: string, init?: { method?: string; body?: unknown; query?: Record<string, string> }): Promise<T> {
  const qs = new URLSearchParams({ action, ...(init?.query ?? {}) });
  let r: Response;
  try {
    r = await fetch(`/api/account?${qs}`, {
      method: init?.method ?? 'GET',
      credentials: 'same-origin',
      headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new Error('the site could not be reached (offline?)');
  }
  const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!j) throw new Error(r.status === 404 ? 'accounts are not available on this copy of the app' : `the server answered ${r.status}`);
  if (!r.ok) throw new Error(j.error ?? `the server answered ${r.status}`);
  return j;
}

export async function refreshAccount() {
  try {
    const s = await api<{ configured: boolean; user: { name: string } | null; snapshot: SnapshotMeta | null }>('status');
    set({ configured: s.configured, user: s.user, snapshot: s.snapshot, error: undefined });
  } catch (e) {
    // No /api at all (vite dev without the middleware, a static copy): treat as not set up.
    set({ configured: false, user: null, snapshot: null, error: (e as Error).message });
  }
}

export async function signIn(mode: 'login' | 'register', username: string, password: string) {
  const r = await api<{ user: { name: string }; snapshot: SnapshotMeta | null }>(mode, { method: 'POST', body: { username, password } });
  set({ user: r.user, snapshot: r.snapshot, error: undefined });
  await syncNow();
}

export async function signOut() {
  await api('logout', { method: 'POST' }).catch(() => undefined);
  set({ user: null, snapshot: null });
}

export async function deleteAccount(password: string) {
  await api('delete', { method: 'POST', body: { password } });
  set({ user: null, snapshot: null });
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'a device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'a browser';
  return `${br} on ${os}`;
}

/** Bring the account's copy into this browser (merging), then upload the merged data. */
export async function syncNow(opts: { quiet?: boolean } = {}): Promise<MergeReport | null> {
  if (get().syncing || !get().user) return null;
  let report: MergeReport | null = null;
  try {
    // 1. Download and merge the account's copy, if there is one.
    const st = await api<{ snapshot: SnapshotMeta | null }>('status');
    if (st.snapshot) {
      set({ syncing: 'download', progress: undefined });
      const parts: string[] = [];
      for (let i = 0; i < st.snapshot.parts; i++) {
        set({ progress: st.snapshot.parts > 1 ? `${i + 1}/${st.snapshot.parts}` : undefined });
        const p = await api<{ data: string }>('part', { query: { id: st.snapshot.id, index: String(i) } });
        parts.push(p.data);
      }
      report = await mergeSnapshot(await unpackSnapshot(parts));
      // Other devices' shared results may have come in.
      reloadShared();
      if (report.added || report.updated) await init();
    }
    // 2. Upload this browser's data (now including the account's).
    set({ syncing: 'upload', progress: undefined });
    const packed = await packSnapshot(await exportSnapshot(), PART);
    if (packed.length > 40) throw new Error('your data is too big to sync (over 35 MB compressed); use a backup file instead');
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    for (let i = 0; i < packed.length; i++) {
      set({ progress: packed.length > 1 ? `${i + 1}/${packed.length}` : undefined });
      await api('part', { method: 'PUT', body: { id, index: i, data: packed[i] } });
    }
    const c = await api<{ snapshot: SnapshotMeta }>('commit', { method: 'POST', body: { id, parts: packed.length, device: deviceLabel() } });
    const now = Date.now();
    try {
      localStorage.setItem(LAST, String(now));
    } catch {
      /* private mode */
    }
    set({ snapshot: c.snapshot, lastSync: now, error: undefined });
    if (!opts.quiet) toast(report && (report.added || report.updated) ? `Synced: ${report.added + report.updated} things came from your account, and everything here is saved to it.` : 'Synced: everything here is saved to your account.', 'ok');
    return report;
  } catch (e) {
    const msg = (e as Error).message;
    set({ error: msg });
    if (/sign in/i.test(msg)) set({ user: null });
    if (!opts.quiet) toast(`Sync failed: ${msg}`, 'error');
    return null;
  } finally {
    set({ syncing: null, progress: undefined });
  }
}

let started = false;
/** At startup: learn whether someone is signed in, and if so sync quietly; sync again when
 * the tab is put away, at most every five minutes. */
export function startAccount() {
  if (started) return;
  started = true;
  void refreshAccount().then(() => {
    if (get().user) void syncNow({ quiet: true });
  });
  document.addEventListener('visibilitychange', () => {
    const s = get();
    if (document.visibilityState === 'hidden' && s.user && !s.syncing && Date.now() - (s.lastSync ?? 0) > 5 * 60_000) void syncNow({ quiet: true });
  });
}
