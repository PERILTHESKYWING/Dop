/**
 * What the account looks like right now, as a tiny store with no network code, so the sidebar
 * can show "Synced" without lib/account.ts in the first-paint bundle. lib/account.ts (loaded
 * when the browser is idle) writes it.
 */
import { useSyncExternalStore } from 'react';

export interface AccountView {
  /** null until probed; false = hide every account surface. */
  available: boolean | null;
  /** The address typed at sign-in (the server never knows it). */
  email: string | null;
  signedIn: boolean;
  syncing: boolean;
  lastSync: number | null;
  /** Last sync problem, shown small on the Account page only. */
  error: string | null;
}

export const NO_ACCOUNT: AccountView = { available: null, email: null, signedIn: false, syncing: false, lastSync: null, error: null };

let view: AccountView = NO_ACCOUNT;
const listeners = new Set<() => void>();

export function setAccountView(v: AccountView) {
  view = v;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** The account as the sidebar and Settings show it. */
export function useAccountView(): AccountView {
  return useSyncExternalStore(subscribe, () => view);
}

/** "2 minutes ago" ("2 min ago" short), "just now". */
export function ago(at: number, now = Date.now(), short = false): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return short ? `${m} min ago` : `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
