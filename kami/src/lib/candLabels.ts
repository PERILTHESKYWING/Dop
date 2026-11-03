/**
 * What the numbers on KataGo's candidate marks say, and the key under the board.
 *
 * Normally each candidate shows how often the side to play wins after it (out of 100). Once
 * every candidate's win chance rounds to 0-2 or 98-100 those numbers are all the same, so each
 * candidate shows what it loses against KataGo's choice in points instead (critics, rounds 1
 * and 2): KataGo's choice (the most visited move, the answer's "best move", drawn with the
 * thick ring) shows its own win chance with a % sign ("1%"), the others the points they lose
 * against it, "0.9", "1.3", in the same rounding as the answer's text ("Q12 is 1.1 points worse"
 * is Q12's "1.1"), and a move within noise of the choice "≈". One convention on every width
 * (critics, 2026-10-26: the phone's "0.9" and the desktop's "−0.9" read as different numbers),
 * and no minus sign on any width (critics, 2026-11-03: the key already says "points lost", and
 * the sign cost a phone's digits their size); the board sets a long label narrower to fit its
 * mark. "The game is decided" is said only when gameDecided() agrees: late in the game, from the
 * point lead.
 */
import { fmt1 } from '../../../src/lib/coach/explain/geometry';

interface Cand {
  winrate: number;
  scoreLead: number;
  /** 0 = KataGo's choice (most visits). */
  rank?: number;
  /** The point (row-major on the board), for spacing a phone's numbered marks. */
  loc?: number;
}

/** A move as good as KataGo's choice: within noise of it, or ahead of it on a shorter read. */
export const SAME = '≈';
/** A loss that rounds to less than this (points) is noise between two reads: "≈". */
export const NOISE = 0.3;

/** Every candidate's win chance rounds to 0-2 or 98-100: win chances no longer tell the moves apart. */
export function lopsidedRead(cands: readonly Cand[] | null | undefined): boolean {
  return (
    !!cands?.length &&
    cands.every((c) => {
      const w = Math.round(c.winrate * 100);
      return w <= 2 || w >= 98;
    })
  );
}

/**
 * A candidate's label against KataGo's choice: the points it loses, "0.9" (one decimal, the
 * answer's rounding, no sign: the key says the numbers are points lost); "≈" when that rounds
 * to under 0.3 points (noise between reads) or the move came out ahead on its shorter read
 * (critics, 2026-11-03: a "+0.1" ring read as better than KataGo's choice). `compact` (a phone's
 * small marks) gives whole points from 10 up ("19"), so a big loss still fits; below 10 it is
 * the same one decimal (critics, round 4: whole points made 0.9 and 1.3 both "1").
 */
export function lossLabel(c: Cand, best: Cand, compact = false): string {
  const loss = best.scoreLead - c.scoreLead;
  const shown = compact && loss >= 9.95 ? String(Math.round(loss)) : fmt1(loss);
  return Number(shown) < NOISE ? SAME : shown;
}

/** KataGo's choice among loss labels: its win chance for the side to play, "1%" (the % tells it from a loss in points). */
export const bestLabel = (best: Cand): string => `${Math.round(best.winrate * 100)}%`;

/** A phone's mark: its radius in points at full size (0.82; 0.76 before its digits grew, critics 2026-11-03). */
export const BIG_R = 0.82;
/** The least radius a crowded phone mark shrinks to: a desktop mark's (0.477), so its number still reads. */
export const MIN_R = 0.48;
/** Marks closer than this (in points) move apart, each by at most MAX_SHIFT. */
const PHONE_GAP = 2 * BIG_R + 0.08;
/** 0.3 of a point (was 0.2): a pair of neighbours then stays near full size, so its larger digits need not shrink (critics, 2026-11-03). */
export const MAX_SHIFT = 0.3;

/** Where a phone's mark sits: moved off its point by (dx, dy) and its radius, in points. */
export interface MarkPlace {
  dx: number;
  dy: number;
  r: number;
}

/**
 * The phone's marks: every candidate carries its number, as on a desktop (critics, 2026-10-28:
 * R10, N8 and R8 were bare rings at 390 px), so each is drawn larger than its point (about 16 px
 * a point there). A mark with room is full size (0.82 of a point); marks closer than 1.72 points
 * move up to 0.3 of a point apart, and each shrinks to clear its nearest neighbour, never below a
 * desktop mark's size, so no number is dropped.
 */
export function phonePlaces(locs: readonly number[], size: number): Map<number, MarkPlace> {
  const xy = locs.map((l) => [l % size, Math.floor(l / size)]);
  const shift = locs.map(() => [0, 0]);
  for (let i = 0; i < locs.length; i++)
    for (let j = i + 1; j < locs.length; j++) {
      const ux = xy[j][0] - xy[i][0], uy = xy[j][1] - xy[i][1];
      const d = Math.hypot(ux, uy);
      if (!d || d >= PHONE_GAP) continue;
      const o = Math.min(MAX_SHIFT, (PHONE_GAP - d) / 2) / d;
      shift[i][0] -= ux * o;
      shift[i][1] -= uy * o;
      shift[j][0] += ux * o;
      shift[j][1] += uy * o;
    }
  // pushed from several sides, a mark still moves at most MAX_SHIFT
  for (const s of shift) {
    const len = Math.hypot(s[0], s[1]);
    if (len > MAX_SHIFT) (s[0] *= MAX_SHIFT / len), (s[1] *= MAX_SHIFT / len);
  }
  const at = xy.map((p, i) => [p[0] + shift[i][0], p[1] + shift[i][1]]);
  const out = new Map<number, MarkPlace>();
  locs.forEach((l, i) => {
    let r = BIG_R;
    for (let j = 0; j < locs.length; j++) if (locs[j] !== l) r = Math.min(r, Math.hypot(at[j][0] - at[i][0], at[j][1] - at[i][1]) / 2 - 0.03);
    out.set(l, { dx: shift[i][0], dy: shift[i][1], r: Math.max(MIN_R, r) });
  });
  return out;
}

/** The label function for the candidate marks (undefined: the default win chance). */
export function candidateLabeler<C extends Cand>(cands: readonly C[] | null | undefined, compact = false): ((c: C) => string) | undefined {
  if (!cands?.length || !lopsidedRead(cands)) return undefined;
  // KataGo's choice is the most visited move (the answer's "best move" too), not a thin read's higher lead.
  const best = cands.find((c) => c.rank === 0) ?? cands[0];
  return (c) => (c === best ? bestLabel(best) : lossLabel(c, best, compact));
}

/**
 * The key under the board: two short clauses, the same words on every width, naming every
 * figure a mark can carry (critics, 2026-10-27 round 1: one name for the number, "win chance").
 * The other marks' unsigned numbers are named as points lost against KataGo's choice. `book`:
 * the book diagram, where marks are printed numbers and KataGo's choice is underlined.
 */
export function keyText(cands: readonly Cand[] | null | undefined, side: 'Black' | 'White', book = false): string {
  const choice = book ? 'Underlined' : 'Thick ring';
  if (!lopsidedRead(cands)) return `${book ? 'Numbers' : 'Rings'}: KataGo’s best moves, with ${side}’s win chance. ${choice}: KataGo’s choice.`;
  // "Others" (not "Other rings") so the clause still fits one line of a 390 px phone with KataGo's choice named
  return `${choice}: KataGo’s choice, with ${side}’s win chance. Others: points lost against KataGo’s choice (≈ same).`;
}
