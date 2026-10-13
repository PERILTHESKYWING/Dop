import { create } from 'zustand';
import { exportSnapshot, mergeSnapshot, packSnapshot, unpackSnapshot, type MergeReport } from '../lib/sync/snapshot';
import { onLocalChange } from '../lib/db/db';
import { init } from './actions';
import { toast, useStore, type AppState } from './store';
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
/** The id of the account copy this browser last uploaded or merged: no need to download it again. */
const BASE = 'dop.syncedId';
const readBase = () => {
  try {
    return localStorage.getItem(BASE);
  } catch {
    return null;
  }
};
const writeBase = (id: string | null) => {
  try {
    if (id) localStorage.setItem(BASE, id);
    else localStorage.removeItem(BASE);
  } catch {
    /* private mode */
  }
};
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
  if (!r.ok) throw Object.assign(new Error(j.error ?? `the server answered ${r.status}`), { code: (j as { code?: string }).code });
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
  // Save the latest changes to the account before leaving it.
  if (isDirty()) await syncNow({ quiet: true });
  await api('logout', { method: 'POST' }).catch(() => undefined);
  writeBase(null);
  set({ user: null, snapshot: null });
}

export async function deleteAccount(password: string) {
  await api('delete', { method: 'POST', body: { password } });
  writeBase(null);
  set({ user: null, snapshot: null });
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'a device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'a browser';
  return `${br} on ${os}`;
}

/** Something saved here changed since the last upload (kept across reloads: a tab can close
 * before its upload finishes). */
const DIRTY = 'dop.syncDirty';
let dirtyNow = (() => {
  try {
    return localStorage.getItem(DIRTY) === '1';
  } catch {
    return false;
  }
})();
const isDirty = () => dirtyNow;
function setDirty(v: boolean) {
  if (dirtyNow === v) return;
  dirtyNow = v;
  try {
    if (v) localStorage.setItem(DIRTY, '1');
    else localStorage.removeItem(DIRTY);
  } catch {
    /* private mode */
  }
}
/** Changes made while a sync merges the account's copy in are the sync's own, not the user's. */
let merging = false;

/**
 * Bring the account's copy into this browser (merging), then upload the merged data. With
 * `pullOnly`, only bring in a newer copy from another device, and upload nothing unless
 * something here changed.
 */
export async function syncNow(opts: { quiet?: boolean; pullOnly?: boolean } = {}, retry = 1): Promise<MergeReport | null> {
  if (get().syncing || !get().user) return null;
  let report: MergeReport | null = null;
  let uploading = false;
  try {
    // 1. Download and merge the account's copy, unless it is the one this browser already has.
    const st = await api<{ snapshot: SnapshotMeta | null }>('status');
    set({ snapshot: st.snapshot });
    const base = st.snapshot?.id ?? null;
    if (st.snapshot && st.snapshot.id !== readBase()) {
      set({ syncing: 'download', progress: undefined });
      const parts: string[] = [];
      for (let i = 0; i < st.snapshot.parts; i++) {
        set({ progress: st.snapshot.parts > 1 ? `${i + 1}/${st.snapshot.parts}` : undefined });
        const p = await api<{ data: string }>('part', { query: { id: st.snapshot.id, index: String(i) } });
        parts.push(p.data);
      }
      merging = true;
      try {
        report = await mergeSnapshot(await unpackSnapshot(parts));
        // Other devices' shared results may have come in.
        reloadShared();
        if (report.added || report.updated || report.removed) await init();
      } finally {
        merging = false;
      }
      // The first sync on this browser: what was here before has to go up too.
      if (!readBase()) setDirty(true);
      writeBase(st.snapshot.id);
    } else if (!st.snapshot) setDirty(true);
    if (opts.pullOnly && !isDirty()) {
      set({ error: undefined });
      return report;
    }
    // 2. Upload this browser's data (now including the account's).
    set({ syncing: 'upload', progress: undefined });
    uploading = true;
    setDirty(false);
    const packed = await packSnapshot(await exportSnapshot(), PART);
    if (packed.length > 40) throw new Error('your data is too big to sync (over 35 MB compressed); use a backup file instead');
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    for (let i = 0; i < packed.length; i++) {
      set({ progress: packed.length > 1 ? `${i + 1}/${packed.length}` : undefined });
      await api('part', { method: 'PUT', body: { id, index: i, data: packed[i] } });
    }
    // `base` makes the server refuse this if another device uploaded in the meantime.
    const c = await api<{ snapshot: SnapshotMeta }>('commit', { method: 'POST', body: { id, parts: packed.length, device: deviceLabel(), base } });
    writeBase(c.snapshot.id);
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
    // What this upload carried still has to go up.
    if (uploading) setDirty(true);
    if ((e as { code?: string }).code === 'stale' && retry > 0) {
      set({ syncing: null, progress: undefined });
      return syncNow(opts, retry - 1);
    }
    const msg = (e as Error).message;
    set({ error: msg });
    if (/sign in/i.test(msg)) set({ user: null });
    if (!opts.quiet) toast(`Sync failed: ${msg}`, 'error');
    return null;
  } finally {
    set({ syncing: null, progress: undefined });
  }
}

// ---------------------------------------------------------------- automatic sync

/** Upload this long after the last change, so a burst of moves or an analysis run is one upload. */
const QUIET_MS = 45_000;
/** But never wait longer than this while changes keep coming. */
const MAX_WAIT_MS = 4 * 60_000;
/** Look for another device's newer copy at most this often (when the tab comes back). */
const PULL_MS = 60_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let firstChange = 0;
let lastPull = 0;

function scheduleUpload() {
  if (!get().user) return;
  const now = Date.now();
  if (!firstChange) firstChange = now;
  if (timer) clearTimeout(timer);
  const wait = Math.max(1000, Math.min(QUIET_MS, firstChange + MAX_WAIT_MS - now));
  timer = setTimeout(runScheduled, wait);
}

function runScheduled() {
  timer = null;
  // A sync already running: try again once it is done.
  if (get().syncing) return void (timer = setTimeout(runScheduled, 5000));
  firstChange = 0;
  void syncNow({ quiet: true, pullOnly: true }).then(() => {
    if (isDirty() && !get().error) scheduleUpload();
  });
}

function changed() {
  if (merging) return;
  setDirty(true);
  scheduleUpload();
}

/** Saved state in the app store that an account carries (see lib/sync/snapshot.ts). */
const SYNCED: (keyof AppState)[] = ['settings', 'games', 'analyses', 'profile', 'weaknesses', 'doppel', 'items', 'attempts', 'mastery', 'blindTests', 'opponents'];

let started = false;
/**
 * At startup: learn whether someone is signed in, and if so sync quietly. After that every
 * change is uploaded on its own shortly after it happens (and at once when the tab is put
 * away), and a newer copy from another device is brought in when the tab comes back.
 */
export function startAccount() {
  if (started) return;
  started = true;
  void refreshAccount().then(() => {
    if (get().user) void syncNow({ quiet: true, pullOnly: true }).then(() => (lastPull = Date.now()));
  });
  onLocalChange(changed);
  useStore.subscribe((s, prev) => {
    if (SYNCED.some((k) => s[k] !== prev[k])) changed();
  });
  document.addEventListener('visibilitychange', () => {
    const s = get();
    if (!s.user || s.syncing) return;
    if (document.visibilityState === 'hidden') {
      if (isDirty()) {
        if (timer) clearTimeout(timer);
        timer = null;
        firstChange = 0;
        void syncNow({ quiet: true, pullOnly: true });
      }
    } else if (Date.now() - lastPull > PULL_MS) {
      lastPull = Date.now();
      void syncNow({ quiet: true, pullOnly: true });
    }
  });
}
