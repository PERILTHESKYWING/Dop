/**
 * What the numbers on KataGo's candidate stones say, and the key under the board.
 *
 * Normally each candidate shows how often the side to play wins after it (out of 100). Once
 * every candidate's win chance rounds to 0-2 or 98-100 those numbers are all the same, so each
 * candidate shows what it loses against KataGo's choice in points ("0.0", "−0.9", "−1.3")
 * instead of the same "−11" everywhere (critics, 2026-10-23). "The game is decided" is said
 * only when gameDecided() agrees: late in the game, from the point lead, never from the win
 * chance alone.
 */
import { gameDecided } from '../../../src/lib/coach/explain/situation';

interface Cand {
  winrate: number;
  scoreLead: number;
  /** 0 = KataGo's choice (most visits). */
  rank?: number;
}

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
 * "0.0" for KataGo's choice (and anything as good), "−0.9" or "−12" for the others: points lost
 * against KataGo's choice. "0.0", not "0": a bold 0 on a pale stone reads as a ring.
 */
export function lossLabel(c: Cand, best: Cand): string {
  const loss = Math.max(0, best.scoreLead - c.scoreLead);
  if (loss < 0.05) return '0.0';
  return `−${loss < 10 ? loss.toFixed(1) : Math.round(loss)}`;
}

/** The label function for the candidate stones (undefined: the default win chance). */
export function candidateLabeler<C extends Cand>(cands: readonly C[] | null | undefined): ((c: C) => string) | undefined {
  if (!cands?.length || !lopsidedRead(cands)) return undefined;
  // KataGo's choice is the most visited move (the answer's "best move" too), not a thin read's higher lead.
  const best = cands.find((c) => c.rank === 0) ?? cands[0];
  return (c) => lossLabel(c, best);
}

/**
 * The key's sentence for the number on each candidate, e.g. "points Black loses against the
 * best move. White leads by 11." `moveNumber` is the move to be played, `bLead` Black's lead.
 */
export function keyNumberText(cands: readonly Cand[] | null | undefined, side: 'Black' | 'White', moveNumber: number, bLead: number | null, size: number): string {
  if (!lopsidedRead(cands)) return `how often ${side} wins after it, out of 100.`;
  const lead = bLead ?? 0;
  const leader = lead >= 0 ? 'Black' : 'White';
  const abs = Math.round(Math.abs(lead));
  const where = abs >= 1 ? ` ${leader} leads by about ${abs}${gameDecided(moveNumber, lead, size) ? '; the game is decided' : ''}.` : '';
  return `points ${side} loses against the best move.${where}`;
}
