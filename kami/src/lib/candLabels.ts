/**
 * What the numbers on KataGo's candidate marks say, and the key under the board.
 *
 * Normally each candidate shows how often the side to play wins after it (out of 100). Once
 * every candidate's win chance rounds to 0-2 or 98-100 those numbers are all the same, so each
 * candidate shows what it loses against KataGo's choice in points instead (critics, rounds 1
 * and 2): KataGo's choice (the most visited move, the answer's "best move", drawn with the
 * thick ring) shows its own win chance with a % sign ("1%"), the others "−0.9", "−1.3" in the
 * same rounding as the answer's text ("Q12 is 1.1 points worse" is Q12's "−1.1"), a move as
 * good as the choice "≈". One sign convention on every width: a phone shows "−0.9" too
 * (critics, 2026-10-26: the phone's "0.9" and the desktop's "−0.9" read as different numbers);
 * the board sets a long label narrower to fit its mark. "The game is decided" is said only
 * when gameDecided() agrees: late in the game, from the point lead.
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

/** A move as good as KataGo's choice at the label's precision. */
export const SAME = '≈';

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
 * A candidate's label against KataGo's choice: "−0.9" (one decimal, the answer's rounding, with
 * a true minus sign); "≈" when it rounds to no difference; "+0.4" for a thinner read that came
 * out ahead (honest, rare). `compact` (a phone's small marks) gives whole points from 10 up
 * ("−19"), so a big loss still fits; below 10 it is the same one decimal (critics, round 4:
 * whole points made −0.9 and −1.3 both "−1").
 */
export function lossLabel(c: Cand, best: Cand, compact = false): string {
  const loss = best.scoreLead - c.scoreLead;
  const shown = compact && Math.abs(loss) >= 9.95 ? String(Math.round(Math.abs(loss))) : fmt1(Math.abs(loss));
  if (Number(shown) === 0) return SAME;
  return `${loss > 0 ? '−' : '+'}${shown}`;
}

/** KataGo's choice among loss labels: its win chance for the side to play, "1%" (the % tells it from a loss in points). */
export const bestLabel = (best: Cand): string => `${Math.round(best.winrate * 100)}%`;

/** How many marks carry a number on a phone, and how far apart (in points) two numbered marks stay. */
export const PHONE_NUMBERED = 3;
const PHONE_GAP = 1.6;

/**
 * Which candidates carry a number on a phone (critics, 2026-10-27 round 1: every label was
 * unreadable at 390 px, about 15 px a point). A numbered mark is drawn larger than its point, so
 * only KataGo's choice and the next ones in its order that sit 1.6 points or more from every
 * numbered one get a number, at most three; the others are small bare rings (their numbers are
 * in the readout when the move is tapped in the answer).
 */
export function phoneNumbered<C extends Cand>(cands: readonly C[], size: number): Set<C> {
  const out = new Set<C>();
  const ranked = [...cands].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  for (const c of ranked) {
    if (out.size >= PHONE_NUMBERED) break;
    const far = [...out].every((o) => o.loc === undefined || c.loc === undefined || Math.hypot((o.loc % size) - (c.loc % size), Math.floor(o.loc / size) - Math.floor(c.loc / size)) >= PHONE_GAP);
    if (far) out.add(c);
  }
  return out;
}

/**
 * The label function for the candidate marks (undefined: the default win chance). `size` (a
 * phone, with `compact`) leaves all but the phoneNumbered() marks without a number ('').
 */
export function candidateLabeler<C extends Cand>(cands: readonly C[] | null | undefined, compact = false, explained = false, size = 0): ((c: C) => string) | undefined {
  if (!cands?.length) return undefined;
  const numbered = compact && size ? phoneNumbered(cands, size) : null;
  const lopsided = lopsidedRead(cands);
  if (!lopsided && !numbered) return undefined;
  const winChance = (c: C) => String(Math.round(c.winrate * 100));
  if (!lopsided) return (c) => (numbered!.has(c) ? winChance(c) : '');
  // KataGo's choice is the most visited move (the answer's "best move" too), not a thin read's higher lead.
  const best = cands.find((c) => c.rank === 0) ?? cands[0];
  // A thin read that came out ahead of the ring shows "+0.5" only when an answer says why
  // ("KataGo read it less, and it came out 0.5 points ahead"); before that it is "≈".
  return (c) => {
    if (numbered && !numbered.has(c)) return '';
    if (c === best) return bestLabel(best);
    const l = lossLabel(c, best, compact);
    return !explained && l.startsWith('+') ? SAME : l;
  };
}

/**
 * The key under the board: two short clauses, the same words on every width, naming every
 * figure a mark can carry (critics, 2026-10-27 round 1: one name for the number, "win chance").
 * `plus` when a mark shows "+0.4" (a shorter read that came out ahead). `book`: the book
 * diagram, where marks are printed numbers and KataGo's choice is underlined.
 */
export function keyText(cands: readonly Cand[] | null | undefined, side: 'Black' | 'White', plus = false, book = false): string {
  const choice = book ? 'Underlined' : 'Thick ring';
  const others = book ? 'Other numbers' : 'Other rings';
  if (!lopsidedRead(cands)) return `${book ? 'Numbers' : 'Rings'}: KataGo’s best moves, with ${side}’s win chance. ${choice}: KataGo’s choice.`;
  return `${choice}: KataGo’s choice, with ${side}’s win chance. ${others}: points lost against it (≈ about the same${plus ? ', + ahead on a shorter read' : ''}).`;
}
