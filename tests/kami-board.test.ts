import { describe, expect, it } from 'vitest';
import { positionKey, valueOf } from '../kami/src/lib/analysis';
import { boardFromSgf } from '../kami/src/lib/position';
import { candidateMarks, lineOf } from '../src/lib/analysis/candidates';
import type { EngineRead, ExplainPosition } from '../src/lib/coach/explain/types';

const base: ExplainPosition = { size: 9, komi: 6.5, setup: [], moves: [{ color: 1, loc: 40 }], toPlay: 2 };

describe('board reads (Kami)', () => {
  it('keys a position by its moves and side to move', () => {
    const same = { ...base, moves: [{ color: 1 as const, loc: 40 }] };
    expect(positionKey(same)).toBe(positionKey(base));
    expect(positionKey({ ...base, toPlay: 1 })).not.toBe(positionKey(base));
    expect(positionKey({ ...base, moves: [{ color: 1, loc: 41 }] })).not.toBe(positionKey(base));
  });

  it('takes the trend value from KataGo: winrate, lead and the best move', () => {
    const read = {
      visits: 200,
      bWin: 0.55,
      bLead: 1.5,
      ownership: null,
      candidates: [
        { loc: 12, winrate: 0.56, scoreLead: 2, visits: 120, pv: [12] },
        { loc: 13, winrate: 0.5, scoreLead: 0, visits: 30, pv: [13] },
      ],
    } as EngineRead;
    expect(valueOf(read)).toEqual({ bWin: 0.55, bLead: 1.5, best: 12 });
    expect(valueOf(undefined)).toBeNull();
  });
});

describe('candidate discs and variations (shared by Dop and Kami)', () => {
  it('ranks the most visited candidate first and scores the rest against it', () => {
    const marks = candidateMarks([
      { loc: 12, winrate: 0.56, scoreLead: 2, visits: 120 },
      { loc: 13, winrate: 0.5, scoreLead: 0, visits: 30 },
    ]);
    expect(marks[0]).toMatchObject({ loc: 12, rank: 0, share: 1 });
    expect(marks[1].badness).toBeGreaterThan(0);
  });

  it('alternates colours along a candidate line from the side to move', () => {
    expect(lineOf([3, 4, 5], 1).map((m) => m.color)).toEqual([1, 2, 1]);
  });
});

describe('names of a loaded game (Kami)', () => {
  it('keeps the players for the eval bar', () => {
    expect(boardFromSgf('(;GM[1]SZ[19]PB[A]PW[B];B[pd])')).toMatchObject({ black: 'A', white: 'B' });
  });
});
