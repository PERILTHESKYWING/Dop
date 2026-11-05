/**
 * What the numbers on KataGo's candidate marks say, and the key under the board.
 *
 * Normally each candidate shows how often the side to play wins after it (out of 100). Once
 * every candidate's win chance rounds to 0-2 or 98-100 those numbers are all the same, so each
 * candidate shows what it loses against KataGo's choice in points instead (critics, rounds 1
 * and 2): KataGo's choice (the most visited move, the answer's "best move", drawn with the
 * thick ring) carries a filled ink dot, a form of its own (critics, 2026-11-04: its "1%" was a
 * chip like the point marks, and a win chance of 1% says nothing a move can change; the key says
 * who is far ahead in words), the others the points they lose
 * against it, "0.9", "1.3", in the same rounding as the answer's text ("Q12 is 1.1 points worse"
 * is Q12's "1.1"), a move within noise of the choice "≈" and one ahead of it on a shorter read
 * "≥" (two marks, each named in the key only when it is on the board). One convention on every width
 * (critics, 2026-10-26: the phone's "0.9" and the desktop's "−0.9" read as different numbers),
 * and no minus sign on any width (critics, 2026-11-03: the key already says "points lost", and
 * the sign cost a phone's digits their size); the board sets a long label narrower to fit its
 * mark. "The game is decided" is said only when gameDecided() agrees: late in the game, from the
 * point lead.
 */
import { gameDecided } from '../../../src/lib/coach/explain/decided';
import { fmt1, winPct } from '../../../src/lib/coach/explain/geometry';

interface Cand {
  winrate: number;
  scoreLead: number;
  /** 0 = KataGo's choice (most visits). */
  rank?: number;
  /** The point (row-major on the board), for spacing a phone's numbered marks. */
  loc?: number;
}

/** A move about as good as KataGo's choice: within noise of it (under 0.3 points either way). */
export const SAME = '≈';
/** A move ahead of KataGo's choice by 0.3 points or more, on its shorter read (no "+": it never reads as a gain). */
export const AHEAD = '≥';
/** KataGo's choice among point labels: drawn as a filled ink dot inside its thick ring, no number. */
export const PICK = '●';
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
 * to under 0.3 points either way (noise between reads), "≥" when the move came out 0.3 or more
 * ahead on its shorter read (critics, 2026-11-03: a "+0.1" ring read as better than KataGo's
 * choice; 2026-11-04: one "≈" for both "equal" and "ahead on a shorter read" was unclear).
 * `compact` (a phone's
 * small marks) gives whole points from 10 up ("19"), so a big loss still fits; below 10 it is
 * the same one decimal (critics, round 4: whole points made 0.9 and 1.3 both "1").
 */
export function lossLabel(c: Cand, best: Cand, compact = false): string {
  const loss = best.scoreLead - c.scoreLead;
  const shown = compact && loss >= 9.95 ? String(Math.round(loss)) : fmt1(loss);
  const n = Number(shown);
  return n <= -NOISE ? AHEAD : n < NOISE ? SAME : shown;
}

/** KataGo's choice among loss labels: the ink dot (its win chance is in the key's words and the eval bar). */
export const bestLabel = (_best: Cand): string => PICK;

/** A phone's mark: its radius in points at full size (0.82; 0.76 before its digits grew, critics 2026-11-03). */
export const BIG_R = 0.82;
/** The least radius a crowded phone mark shrinks to: a desktop mark's (0.477), so its number still reads. */
export const MIN_R = 0.48;
/** Marks closer than this (in points) move apart, each by at most MAX_SHIFT. */
const PHONE_GAP = 2 * BIG_R + 0.08;
/** 0.3 of a point (was 0.2): a pair of neighbours then stays near full size, so its larger digits need not shrink (critics, 2026-11-03). */
export const MAX_SHIFT = 0.3;
/** How far (points) a stone next to a mark pushes it; half that sideways, where a chip has more room. */
const STONE_PUSH = 0.16;

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
export function phonePlaces(locs: readonly number[], size: number, stones?: ArrayLike<number>): Map<number, MarkPlace> {
  const xy = locs.map((l) => [l % size, Math.floor(l / size)]);
  const shift = locs.map(() => [0, 0]);
  // A stone right next to a mark pushes it STONE_PUSH away, so a chip (lower than it is wide)
  // keeps clear of the stone's edge where it can (critics, 2026-11-05: Q12's chip touched R11).
  if (stones)
    xy.forEach(([x, y], i) => {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size || !stones[ny * size + nx]) continue;
        shift[i][0] -= dx * STONE_PUSH * (dx ? 0.5 : 1);
        shift[i][1] -= dy * STONE_PUSH;
      }
    });
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
export function keyText(cands: readonly Cand[] | null | undefined, side: 'Black' | 'White', book = false, game?: KeyGame, compact = false): string {
  // the other moves are chips, not rings (Board candChip, kaya.ts drawChip): the key names them "Numbers"
  const choice = book ? 'Underlined' : 'Ring';
  if (!lopsidedRead(cands)) return `Numbers: KataGo’s best moves, with ${side}’s win chance. ${choice}: KataGo’s choice.`;
  // A one-sided read, said in plain words first (critics, 2026-11-04: at 97%+ say so, rather than
  // show tenths as if they decided the game). "Decided" only when gameDecided() agrees (late, from
  // the point lead); before that "far ahead", with the trailing side's win chance.
  const best = cands!.find((c) => c.rank === 0) ?? cands![0];
  const sideWins = best.winrate >= 0.5;
  const leader = sideWins ? side : side === 'Black' ? 'White' : 'Black';
  const trailer = leader === 'Black' ? 'White' : 'Black';
  const trailWin = winPct(sideWins ? 1 - best.winrate : best.winrate);
  const status =
    game && gameDecided(game.move, game.bLead, game.size) ? `The game is decided (${leader} +${Math.abs(game.bLead).toFixed(1)})` : `${leader} is far ahead (${trailer} ${trailWin})`;
  // each mark named only when it is on the board, so "≈" and "≥" each mean one thing
  const label = candidateLabeler(cands)!;
  const shown = new Set(cands!.map(label));
  // plain teacher wording a beginner can read in one go (critics, 2026-11-04 round 1)
  // `compact` (a phone): the shortest true words, so the key keeps to its two lines
  const marks = [compact ? 'Numbers: points lost' : 'Numbers: points lost by playing there', shown.has(SAME) ? '≈\u00a0about the\u00a0same' : '', shown.has(AHEAD) ? '≥\u00a0ahead on a shorter\u00a0read' : ''].filter(Boolean).join(' · ');
  const pick = book ? 'Underlined: KataGo’s move' : 'KataGo’s move';
  return `${pick}. ${status}. ${marks}.`;
}

/** What the key needs to say whether a one-sided game is decided: the move number, Black's lead, the board size. */
export interface KeyGame {
  move: number;
  bLead: number;
  size: number;
}
