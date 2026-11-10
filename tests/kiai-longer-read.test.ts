/** "Read longer" says whether KataGo's pick moved (busy parent, 2026-11-08 and 11-09). */
import { describe, expect, it } from 'vitest';
import type { Explanation } from '../src/lib/coach/explain/types';
import { gtpToLoc } from '../src/lib/go/coords';
import { pickMoveLine, shorterRead } from '../kami/src/lib/longerRead';
import type { Answer } from '../kami/src/lib/store';

const P = (s: string) => gtpToLoc(s, 19);
const answer = (pick: string | null, moves = [P('Q16')]): Answer =>
  ({
    type: 'explain',
    upTo: moves.length,
    writing: { by: 'engine' },
    explanation: {
      position: { size: 19, komi: 7.5, setup: [], moves: moves.map((loc, i) => ({ color: i % 2 ? 2 : 1, loc })), toPlay: moves.length % 2 ? 2 : 1 },
      ...(pick ? { root: { visits: 288, bWin: 0.4, bLead: -1, ownership: null, candidates: [{ loc: P(pick), winrate: 0.4, scoreLead: -1, visits: 100, pv: [P(pick)] }] } } : {}),
    } as unknown as Explanation,
  }) as Answer;

describe('the longer read says if the pick moved', () => {
  it('moved, or stayed, from KataGo’s own first choices', () => {
    const quick = shorterRead(answer('Q10'))!;
    expect(quick.pick).toBe('Q10');
    expect(pickMoveLine(quick, answer('Q9'))).toBe("Longer read: KataGo's pick moved from Q10 to Q9.");
    expect(pickMoveLine(quick, answer('Q10'))).toBe("Longer read: KataGo's pick stays Q10.");
  });

  it('says nothing without a shorter read, on another position, or with no pick', () => {
    const quick = shorterRead(answer('Q10'))!;
    expect(pickMoveLine(undefined, answer('Q9'))).toBeNull();
    expect(pickMoveLine(quick, answer('Q9', [P('Q16'), P('D4')]))).toBeNull();
    expect(pickMoveLine(quick, answer(null))).toBeNull();
    expect(shorterRead({ type: 'error', text: 'x' })).toBeNull();
  });
});
