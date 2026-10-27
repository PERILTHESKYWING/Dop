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
import { gameDecided } from '../../../src/lib/coach/explain/situation';

interface Cand {
  winrate: number;
  scoreLead: number;
  /** 0 = KataGo's choice (most visits). */
  rank?: number;
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

/** The label function for the candidate stones (undefined: the default win chance). */
export function candidateLabeler<C extends Cand>(cands: readonly C[] | null | undefined, compact = false, explained = false): ((c: C) => string) | undefined {
  if (!cands?.length || !lopsidedRead(cands)) return undefined;
  // KataGo's choice is the most visited move (the answer's "best move" too), not a thin read's higher lead.
  const best = cands.find((c) => c.rank === 0) ?? cands[0];
  // A thin read that came out ahead of the ring shows "+0.5" only when an answer says why
  // ("KataGo read it less, and it came out 0.5 points ahead"); before that it is "≈".
  return (c) => {
    if (c === best) return bestLabel(best);
    const l = lossLabel(c, best, compact);
    return !explained && l.startsWith('+') ? SAME : l;
  };
}

/**
 * The key's sentence for the number on each candidate, e.g. "points Black loses against
 * KataGo’s choice, the thick ring, which shows Black’s win chance. White leads by about 11."
 * `moveNumber` is the move to be played, `bLead` Black's lead.
 */
export function keyNumberText(cands: readonly Cand[] | null | undefined, side: 'Black' | 'White', moveNumber: number, bLead: number | null, size: number, compact = false, same = false): string {
  if (!lopsidedRead(cands)) return `how often ${side} wins after it, out of 100.`;
  // A phone has two short lines under the board; the lead is in the bar above it.
  if (compact) return `points ${side} loses against the thick ring (${side}’s win %)${same ? '; ≈ as good' : ''}.`;
  const lead = bLead ?? 0;
  const leader = lead >= 0 ? 'Black' : 'White';
  const abs = Math.round(Math.abs(lead));
  const where = abs >= 1 ? ` ${leader} leads by about ${abs}${gameDecided(moveNumber, lead, size) ? '; the game is decided' : ''}.` : '';
  return `points ${side} loses against KataGo’s choice, the thick ring, which shows ${side}’s win chance.${where}`;
}
