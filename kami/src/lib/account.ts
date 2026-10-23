/**
 * Kiai's optional account: email + password on Dop's /api/account (shared/kiaiAccount.ts),
 * syncing the study path and a few settings. Loaded when the browser is idle (App.tsx), never
 * in the first paint. Chats and boards stay on the device.
 *
 * - Hidden unless the server answers the probe exactly as Dop's account service with Kiai
 *   support and a store (`{service:'dop-account', kiai:1, configured:true}`). A wrong address,
 *   HTML, a timeout or no store: nothing account-related shows and no password is ever sent.
 * - Every call is a CORS "simple request" (POST, text/plain, no custom headers, no cookies), so
 *   the browser sends no preflight. The token travels in the body.
 * - Sync never shows a toast or a modal. A problem shows small on Settings › Account only.
 */
import { useSyncExternalStore } from 'react';
import { emptyDoc, emptyJourney, mergeDoc, sanitizeDoc, type KiaiDoc } from '../../../shared/kiaiJourney';
import { ACCOUNT_API } from '../config';
import { NO_ACCOUNT, setAccountView, type AccountView } from './accountView';
import { applyDoc, localDoc, onJourneyChange } from './journey';
import { onSyncedSettingChange } from './settings';

export type { AccountView } from './accountView';

export const UNREACHABLE = "Can't reach the sync server right now. Your path is saved on this device.";
export const SIGNED_OUT_HERE = 'Signed out on this device. Sign in again to keep syncing.';
export const NOT_SYNCED = "Not synced yet. Kiai tries again when you're online.";

const SESSION = 'kiai.session';
const LAST_SYNC = 'kiai.lastSync';
const PROBE = 'kiai.acct.probe';
const PROBE_TTL = 24 * 3600_000;
const DEBOUNCE = 30_000;
const MIN_GAP = 60_000;
const BACKOFF_MIN = [1, 2, 5, 15];
const KEEPALIVE_MAX = 60_000;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface Session {
  token: string;
  email: string;
  at: number;
}
export interface AccountDeps {
  fetch: typeof fetch;
  storage: Store;
  now: () => number;
  doc: { get(): KiaiDoc; apply(d: KiaiDoc): void; onChange(cb: () => void): () => void };
  /** The account API (default: config.ts ACCOUNT_API). */
  api?: string;
  /** Browser events: back online, and the tab hidden. */
  on?: (event: 'online' | 'hidden', cb: () => void) => () => void;
}

class NetError extends Error {}

export function createAccount(deps: AccountDeps) {
  const api = deps.api ?? ACCOUNT_API;
  const get = (k: string) => {
    try {
      return deps.storage.getItem(k);
    } catch {
      return null;
    }
  };
  const put = (k: string, v: string | null) => {
    try {
      if (v === null) deps.storage.removeItem(k);
      else deps.storage.setItem(k, v);
    } catch {
      /* blocked */
    }
  };
  const readJson = <T>(k: string): T | null => {
    try {
      return JSON.parse(get(k) ?? 'null') as T | null;
    } catch {
      return null;
    }
  };

  let session = readJson<Session>(SESSION);
  if (!session || typeof session.token !== 'string' || typeof session.email !== 'string') session = null;
  const storedLast = Number(get(LAST_SYNC));
  let view: AccountView = { ...NO_ACCOUNT, signedIn: !!session, email: session?.email ?? null, lastSync: storedLast > 0 ? storedLast : null };
  const subs = new Set<() => void>();
  const setView = (p: Partial<AccountView>) => {
    view = { ...view, ...p };
    for (const l of subs) l();
  };

  let started = false;
  let dirty = false;
  let failures = 0;
  let lastPushAt = 0;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> | null = null;
  let again = false;

  async function post(action: string, payload: unknown, keepalive = false): Promise<{ status: number; body: Record<string, unknown> }> {
    const body = JSON.stringify(payload);
    let r: Response;
    try {
      const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(8000) : undefined;
      r = await deps.fetch(`${api}?action=${action}`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body,
        credentials: 'omit',
        mode: 'cors',
        keepalive: keepalive && body.length < KEEPALIVE_MAX,
        signal,
      });
    } catch {
      throw new NetError('network');
    }
    let j: unknown;
    try {
      j = await r.json();
    } catch {
      throw new NetError('not json');
    }
    if (!j || typeof j !== 'object') throw new NetError('not json');
    return { status: r.status, body: j as Record<string, unknown> };
  }

  /** A user action: the server's error text, or "can't reach". */
  async function call(action: string, payload: unknown): Promise<Record<string, unknown>> {
    let r;
    try {
      r = await post(action, payload);
    } catch {
      throw new Error(UNREACHABLE);
    }
    if (r.status === 200) return r.body;
    if (r.body.code === 'signed-out') dropSession(SIGNED_OUT_HERE);
    throw new Error(typeof r.body.error === 'string' ? r.body.error : UNREACHABLE);
  }

  async function probe(): Promise<boolean> {
    const c = readJson<{ configured?: boolean; at?: number }>(PROBE);
    if (c && c.configured === false && typeof c.at === 'number' && deps.now() - c.at < PROBE_TTL) return false;
    try {
      const { status, body: b } = await post('kiai-status', {});
      if (status !== 200 || b.service !== 'dop-account' || b.kiai !== 1) return false;
      if (b.configured === true) {
        put(PROBE, null);
        return true;
      }
      // Only a real "no store" answer is remembered; network errors are tried again next time.
      if (b.configured === false) put(PROBE, JSON.stringify({ configured: false, at: deps.now() }));
      return false;
    } catch {
      return false;
    }
  }

  function dropSession(error: string | null = null) {
    session = null;
    put(SESSION, null);
    dirty = false;
    if (pushTimer) clearTimeout(pushTimer);
    if (retryTimer) clearTimeout(retryTimer);
    pushTimer = retryTimer = null;
    setView({ signedIn: false, email: null, syncing: false, error });
  }

  function schedule() {
    if (pushTimer) clearTimeout(pushTimer);
    const delay = Math.max(DEBOUNCE, lastPushAt + MIN_GAP - deps.now());
    pushTimer = setTimeout(() => {
      pushTimer = null;
      void syncNow();
    }, delay);
  }

  function retry() {
    if (retryTimer) clearTimeout(retryTimer);
    const delay = BACKOFF_MIN[Math.min(failures, BACKOFF_MIN.length - 1)] * 60_000;
    failures++;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void syncNow();
    }, delay);
  }

  async function pushOnce(keepalive: boolean): Promise<void> {
    if (!session) return;
    const token = session.token;
    dirty = false;
    lastPushAt = deps.now();
    setView({ syncing: true });
    try {
      const r = await post('kiai-sync', { token, doc: deps.doc.get() }, keepalive);
      if (r.status === 200) {
        const remote = sanitizeDoc(r.body.doc);
        // Merged with the current local copy, in case of study during the request.
        if (remote) deps.doc.apply(mergeDoc(deps.doc.get(), remote));
        failures = 0;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = null;
        const at = deps.now();
        put(LAST_SYNC, String(at));
        setView({ syncing: false, lastSync: at, error: null });
        return;
      }
      if (r.status === 401) {
        if (session?.token === token) dropSession(SIGNED_OUT_HERE);
        return;
      }
      if (r.status === 400 || r.status === 413) {
        setView({ syncing: false, error: typeof r.body.error === 'string' ? r.body.error : NOT_SYNCED });
        return;
      }
      throw new NetError(String(r.status));
    } catch {
      // Offline, 429 or 5xx: keep the change and try again later.
      dirty = true;
      setView({ syncing: false, error: NOT_SYNCED });
      retry();
    }
  }

  async function syncNow(keepalive = false): Promise<void> {
    if (!session) return;
    if (inflight) {
      again = true;
      return inflight;
    }
    inflight = pushOnce(keepalive);
    try {
      await inflight;
    } finally {
      inflight = null;
    }
    if (again) {
      again = false;
      await syncNow();
    }
  }

  async function join(b: Record<string, unknown>, email: string) {
    if (typeof b.token !== 'string') throw new Error(UNREACHABLE);
    session = { token: b.token, email, at: deps.now() };
    put(SESSION, JSON.stringify(session));
    // This device's guest path joins the account's.
    deps.doc.apply(mergeDoc(deps.doc.get(), sanitizeDoc(b.doc) ?? emptyDoc()));
    failures = 0;
    setView({ available: true, signedIn: true, email, error: null });
    await syncNow();
  }

  const typed = (email: string) => email.trim();

  return {
    view: () => view,
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    start() {
      if (started) return;
      started = true;
      deps.doc.onChange(() => {
        if (!session) return;
        dirty = true;
        schedule();
      });
      deps.on?.('online', () => {
        if (!session && view.available) return;
        void (async () => {
          if (view.available !== true) setView({ available: await probe() });
          if (session) await syncNow();
        })();
      });
      deps.on?.('hidden', () => {
        if (session && dirty) void syncNow(true);
      });
      void probe().then((ok) => {
        setView({ available: ok });
        if (ok && session) void syncNow();
      });
    },
    async register(email: string, password: string) {
      const b = await call('kiai-register', { email, password });
      await join(b, typed(email));
      return { recovery: String(b.recovery ?? '') };
    },
    async login(email: string, password: string) {
      const b = await call('kiai-login', { email, password });
      await join(b, typed(email));
    },
    async recover(email: string, code: string, newPassword: string) {
      const b = await call('kiai-recover', { email, code, newPassword });
      await join(b, typed(email));
      return { recovery: String(b.recovery ?? '') };
    },
    async changePassword(current: string, next: string) {
      if (!session) throw new Error(SIGNED_OUT_HERE);
      const b = await call('kiai-password', { token: session.token, password: current, newPassword: next });
      if (typeof b.token === 'string' && session) {
        session = { ...session, token: b.token };
        put(SESSION, JSON.stringify(session));
      }
    },
    async newRecoveryCode(password: string) {
      if (!session) throw new Error(SIGNED_OUT_HERE);
      const b = await call('kiai-recovery', { token: session.token, password });
      return { recovery: String(b.recovery ?? '') };
    },
    async logout(clearLocalPath: boolean) {
      const token = session?.token;
      if (token) await post('kiai-logout', { token }).catch(() => undefined);
      dropSession();
      if (clearLocalPath) {
        const d = deps.doc.get();
        deps.doc.apply({ ...d, journey: emptyJourney(d.journey.gen) });
      }
    },
    async remove(password: string) {
      if (!session) throw new Error(SIGNED_OUT_HERE);
      await call('kiai-delete', { token: session.token, password });
      dropSession();
    },
    syncNow: () => syncNow(),
  };
}

const safeStorage: Store = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* blocked */
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* blocked */
    }
  },
};

function browserEvents(event: 'online' | 'hidden', cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  if (event === 'online') {
    window.addEventListener('online', cb);
    return () => window.removeEventListener('online', cb);
  }
  const h = () => document.visibilityState === 'hidden' && cb();
  document.addEventListener('visibilitychange', h);
  return () => document.removeEventListener('visibilitychange', h);
}

/** The account wired to this browser: fetch, localStorage, the path and the synced settings. */
export const account = createAccount({
  fetch: (input, init) => fetch(input, init),
  storage: safeStorage,
  now: () => Date.now(),
  doc: {
    get: localDoc,
    apply: applyDoc,
    onChange: (cb) => {
      const a = onJourneyChange(cb);
      const b = onSyncedSettingChange(cb);
      return () => {
        a();
        b();
      };
    },
  },
  on: browserEvents,
});
account.subscribe(() => setAccountView(account.view()));
setAccountView(account.view());

export function useAccount(): AccountView {
  return useSyncExternalStore(account.subscribe, account.view);
}

export function startAccount(): void {
  account.start();
}
