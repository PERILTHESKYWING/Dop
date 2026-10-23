/**
 * The study path on this device (rules and maths: shared/kiaiJourney.ts). Counts live in
 * localStorage `kiai.journey`; this device's id in `kiai.device`; today's question ids in
 * `kiai.asked`. Every read and write is guarded: blocked storage keeps the path for the visit.
 * Signed in, lib/account.ts syncs the path through onJourneyChange / applyJourney.
 */
import { useSyncExternalStore } from 'react';
import {
  dayKey,
  emptyJourney,
  fill,
  hashId,
  mergeJourney,
  pathLine,
  REVIEW_MIN_MOVES,
  record,
  sanitizeDoc,
  stationName,
  summarise,
  type AskedLog,
  type Journey,
  type JourneySummary,
  type KiaiDoc,
  type StudyKind,
} from '../../../shared/kiaiJourney';
import { sendPathNote, setPathLine } from './pathLine';
import { applySyncedSettings, getSetting, syncedSettings } from './settings';

/** Features that add ways to study; false until they ship (they set it to true). */
export const FEATURES: { solve: boolean; guided: boolean } = { solve: false, guided: false };

const KEY = 'kiai.journey';
const DEVICE = 'kiai.device';
const ASKED = 'kiai.asked';
const memory = new Map<string, string>();

function read(k: string): string | null {
  try {
    const v = localStorage.getItem(k);
    if (v !== null) return v;
  } catch {
    /* blocked */
  }
  return memory.get(k) ?? null;
}
function write(k: string, v: string) {
  memory.set(k, v);
  try {
    localStorage.setItem(k, v);
  } catch {
    /* blocked: kept for this visit */
  }
}

function loadJourney(): Journey {
  try {
    return sanitizeDoc({ v: 1, journey: JSON.parse(read(KEY) ?? 'null'), settings: {} })?.journey ?? emptyJourney();
  } catch {
    return emptyJourney();
  }
}

function deviceId(): string {
  const have = read(DEVICE);
  if (have && /^[a-z0-9]{12}$/.test(have)) return have;
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(12);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < 12; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const id = Array.from(bytes, (b) => abc[b % 36]).join('');
  write(DEVICE, id);
  return id;
}

let journey: Journey = loadJourney();
let today = dayKey();
let version = 0;
let cached: { v: number; today: string; s: JourneySummary } | null = null;
const listeners = new Set<() => void>();
const changeListeners = new Set<() => void>();

function notify() {
  version++;
  const s = summary();
  setPathLine(s.started ? pathLine(s) : '');
  for (const l of listeners) l();
}

function set(j: Journey, local: boolean) {
  journey = j;
  write(KEY, JSON.stringify(j));
  notify();
  if (local) for (const l of changeListeners) l();
}

export function getJourney(): Journey {
  return journey;
}

export function summary(): JourneySummary {
  if (!cached || cached.v !== version || cached.today !== today) cached = { v: version, today, s: summarise(journey, today, FEATURES) };
  return cached.s;
}

/** Count one study action (no-op when Settings › Journey › Keep a study path is off). */
export function recordStudy(kind: StudyKind, opts: { id?: string; lifeDeath?: boolean } = {}): void {
  if (!getSetting<boolean>('journey.on')) return;
  refreshToday();
  let asked: AskedLog | null = null;
  try {
    asked = JSON.parse(read(ASKED) ?? 'null');
  } catch {
    asked = null;
  }
  const before = summary();
  const r = record(journey, deviceId(), today, kind, { ...opts, asked });
  if (r.asked) write(ASKED, JSON.stringify(r.asked));
  if (!r.counted) return;
  set(r.journey, true);
  if (!getSetting<boolean>('journey.notes')) return;
  const after = summary();
  // At most one line per action: a station beats a seal; the rest show on the page.
  let note: string | null = null;
  if (after.station.i > before.station.i) note = fill('noteStation', { label: stationName(after.station) });
  else {
    const was = new Set(before.seals.filter((s) => s.earned).map((s) => s.id));
    const fresh = after.seals.find((s) => s.earned && !was.has(s.id));
    if (fresh) note = fill('noteSeal', { kanji: fresh.kanji, title: fresh.title });
  }
  if (note) sendPathNote(note);
}

/** A whole game reviewed (BoardPanel): counted once per game, ever, from 30 moves. */
export function recordGameReview(size: number, moves: { loc: number }[]): void {
  if (moves.length >= REVIEW_MIN_MOVES) recordStudy('review', { id: gameStudyId(size, moves) });
}

/** An answer about a position or an idea (App.run). */
export function recordAnswer(positionKey: string, text: string, lifeDeath: boolean): void {
  recordStudy('ask', { id: askStudyId(positionKey, text), lifeDeath });
}

/** The path changed on this device (for account sync). */
export function onJourneyChange(cb: () => void): () => void {
  changeListeners.add(cb);
  return () => {
    changeListeners.delete(cb);
  };
}

/** A path from the account, already merged. Never shows a note and never fires onJourneyChange. */
export function applyJourney(j: Journey): void {
  if (JSON.stringify(j) === JSON.stringify(journey)) return;
  set(j, false);
}

/** Start again: a new generation, so every synced device resets too. */
export function resetJourney(): void {
  write(ASKED, 'null');
  set(emptyJourney(journey.gen + 1), true);
}

export function exportJourney(): Blob {
  const s = summary();
  const out = { exported: new Date().toISOString(), points: s.points, station: s.station.label, daysInARow: s.streak.current, best: s.streak.best, journey };
  return new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
}

/** A whole game's id: board size and moves. */
export function gameStudyId(size: number, moves: { loc: number }[]): string {
  return 'r:' + hashId(`${size}:${moves.map((m) => m.loc).join(',')}`);
}

/** A question's id: the position and the words (case and spacing ignored). */
export function askStudyId(positionKey: string, text: string): string {
  return 'a:' + hashId(positionKey + '\n' + text.trim().toLowerCase().replace(/\s+/g, ' '));
}

/** What the account syncs: the path and the synced settings. */
export function localDoc(): KiaiDoc {
  return { v: 1, journey: getJourney(), settings: syncedSettings() };
}
export function applyDoc(d: KiaiDoc): void {
  applyJourney(d.journey);
  applySyncedSettings(d.settings);
}

// "Today" moves on at midnight and when the tab comes back after a while.
function refreshToday() {
  const t = dayKey();
  if (t !== today) {
    today = t;
    notify();
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('focus', refreshToday);
  const atMidnight = () => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    window.setTimeout(() => {
      refreshToday();
      atMidnight();
    }, next.getTime() - now.getTime());
  };
  atMidnight();
  // Another tab studied: pick up its counts.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return;
    try {
      const j = sanitizeDoc({ v: 1, journey: JSON.parse(e.newValue), settings: {} })?.journey;
      if (j) {
        journey = mergeJourney(journey, j);
        notify();
      }
    } catch {
      /* ignore */
    }
  });
}

setPathLine(summary().started ? pathLine(summary()) : '');

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useJourney(): JourneySummary {
  useSyncExternalStore(subscribe, () => version);
  return summary();
}
