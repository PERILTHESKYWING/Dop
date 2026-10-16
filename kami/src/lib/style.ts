/**
 * Style memory: what kind of game the student likes, learned from the moves they play by
 * clicking on the board (never from games they load, never from one move). XIAO: "Learn from
 * repeated choices and feedback, allow their preferences to change." So only the last
 * STYLE_KEEP moves count, a style is guessed only after STYLE_MIN of them, and only when one
 * kind holds at least STYLE_SHARE of them. Settings › Profile › How you like to play overrides it.
 *
 * Kept in localStorage (`kami.style`); when storage is blocked it lasts for the visit.
 */
import { useSyncExternalStore } from 'react';
import { styleOf } from '../../../src/lib/coach/explain/shapes';
import type { PlayStyle, StudentLevel, StudentProfile } from '../../../src/lib/coach/explain/types';
import { replay } from '../../../src/lib/go/board';
import { PASS, type Loc } from '../../../src/lib/go/types';
import { toPlayAt, type BoardState } from './position';
import { getSetting } from './settings';

/** How many recent moves are remembered. */
export const STYLE_KEEP = 60;
/** Fewer moves than this: no guess. */
export const STYLE_MIN = 8;
/** The share of the remembered moves one style needs before Kami names it. */
export const STYLE_SHARE = 0.45;

export const PLAY_STYLES: PlayStyle[] = ['solid', 'territory', 'influence', 'fighting'];

/** Plain names, as the Settings choice shows them. */
export const STYLE_LABELS: Record<PlayStyle, string> = {
  solid: 'Solid and safe',
  territory: 'Territory',
  influence: 'Influence and moyo',
  fighting: 'Fighting',
};

export interface LearnedStyle {
  /** The dominant style, or null when there is no clear one yet. */
  style: PlayStyle | null;
  /** Moves of that style among the remembered ones (0 when style is null). */
  count: number;
  /** Moves remembered. */
  total: number;
}

/** The dominant style of `seen`: at least STYLE_MIN moves and a STYLE_SHARE share, else null. */
export function dominantStyle(seen: readonly PlayStyle[]): LearnedStyle {
  const recent = seen.slice(-STYLE_KEEP);
  const total = recent.length;
  if (total < STYLE_MIN) return { style: null, count: 0, total };
  const counts = PLAY_STYLES.map((s) => recent.filter((x) => x === s).length);
  const count = Math.max(...counts);
  // A tie is not a preference.
  if (count / total < STYLE_SHARE || counts.filter((n) => n === count).length > 1) return { style: null, count: 0, total };
  return { style: PLAY_STYLES[counts.indexOf(count)], count, total };
}

const STORE = 'kami.style';
let seen: PlayStyle[] = load();
let version = 0;
const listeners = new Set<() => void>();

function load(): PlayStyle[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '[]');
    return Array.isArray(raw) ? raw.filter((s): s is PlayStyle => PLAY_STYLES.includes(s)).slice(-STYLE_KEEP) : [];
  } catch {
    return [];
  }
}

function save() {
  version++;
  try {
    localStorage.setItem(STORE, JSON.stringify(seen));
  } catch {
    /* blocked: remembered for this visit */
  }
  for (const l of listeners) l();
}

/** Remember one move's style. */
export function recordStyle(style: PlayStyle) {
  seen = [...seen, style].slice(-STYLE_KEEP);
  save();
}

/**
 * The student clicked `loc` for the side to move on `board` (the board before the move):
 * remember what kind of move it was. Passes and occupied points are ignored.
 */
export function observeMove(board: BoardState, loc: Loc) {
  if (loc === PASS || loc < 0) return;
  try {
    const before = replay(board.size, board.setup, board.moves, board.cursor);
    if (before.stones[loc]) return;
    recordStyle(styleOf(before, loc, toPlayAt(board)));
  } catch {
    /* a shape the reader cannot place: not worth breaking a move for */
  }
}

export const learnedStyle = (): LearnedStyle => dominantStyle(seen);

/** Forget every remembered move. */
export function resetStyle() {
  seen = [];
  save();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The learned style, re-rendering as moves are played or the memory is reset. */
export function useLearnedStyle(): LearnedStyle {
  useSyncExternalStore(subscribe, () => version);
  return learnedStyle();
}

/** The profile the explainer gets: Settings › Profile, with the learned style when it is on auto. */
export function studentProfile(): StudentProfile {
  const level = getSetting<StudentLevel>('profile.level');
  const chosen = getSetting<string>('profile.style');
  const style = chosen !== 'auto' && PLAY_STYLES.includes(chosen as PlayStyle) ? (chosen as PlayStyle) : learnedStyle().style;
  return { level, style };
}
