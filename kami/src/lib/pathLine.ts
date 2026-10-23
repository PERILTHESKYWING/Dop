/**
 * The sidebar's study-path line ("Path 14 kyu · 5 days"), without the path maths in the
 * first-paint bundle: lib/journey.ts (loaded when the browser is idle, or at the first counted
 * study) writes the line here and to localStorage `kiai.pathLine`, so a return visit shows it at
 * once. Empty until the path has started.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'kiai.pathLine';
let line = read();
const listeners = new Set<() => void>();

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function setPathLine(next: string) {
  if (next === line) return;
  line = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* blocked */
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function usePathLine(): string {
  return useSyncExternalStore(subscribe, () => line);
}

const notes = new Set<(text: string) => void>();

/** A passed station or a stamped seal (journey.ts sends them; App shows one toast). */
export function onPathNote(cb: (text: string) => void): () => void {
  notes.add(cb);
  return () => {
    notes.delete(cb);
  };
}
export function sendPathNote(text: string) {
  for (const l of notes) l(text);
}

/** lib/journey.ts, loaded once on demand. */
let mod: Promise<typeof import('./journey')> | null = null;
export const loadJourney = () =>
  (mod ??= import('./journey').catch((e) => {
    mod = null;
    throw e;
  }));
