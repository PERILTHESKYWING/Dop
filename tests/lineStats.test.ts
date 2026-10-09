import { describe, expect, it } from 'vitest';
import { biggestDrops, moveLosses, performance, phaseOf } from '../src/lib/analysis/lineStats';
import type { Move } from '../src/lib/go/types';

const mv = (color: 1 | 2, loc: number): Move => ({ color, loc });

describe('line stats', () => {
  it('measures each move from the mover’s side', () => {
    const values = [
      { bWin: 0.5, bLead: 0, best: 10 },
      { bWin: 0.3, bLead: -4, best: 20 }, // black lost 20%
      { bWin: 0.36, bLead: -3, best: 30 }, // white lost 6%
      { bWin: 0.36, bLead: -3 },
    ];
    const moves = [mv(1, 11), mv(2, 20), mv(1, 30)];
    const l = moveLosses(values, moves, 19);
    expect(l.map((x) => +x.winLoss.toFixed(2))).toEqual([0.2, 0.06, 0]);
    expect(l[0].scoreLoss).toBe(4);
    expect(l.map((x) => x.matched)).toEqual([false, true, true]);
    expect(biggestDrops(l).map((d) => d.index)).toEqual([0, 1]);
    expect(biggestDrops(l, { color: 2 }).map((d) => d.index)).toEqual([1]);
    const b = performance(l, 1);
    expect(b.moves).toBe(2);
    expect(b.blunders).toBe(1);
    expect(b.match).toBe(0.5);
  });

  it('skips moves with an unread position and passes', () => {
    expect(moveLosses([{ bWin: 0.5 }, null, { bWin: 0.5 }], [mv(1, 1), mv(2, 2)], 19)).toEqual([]);
    expect(moveLosses([{ bWin: 0.5 }, { bWin: 0.2 }], [mv(1, -1)], 19)).toEqual([]);
  });

  it('scales the phases with the board', () => {
    expect(phaseOf(10, 19)).toBe('opening');
    expect(phaseOf(100, 19)).toBe('middle');
    expect(phaseOf(200, 19)).toBe('endgame');
    expect(phaseOf(40, 9)).toBe('endgame');
  });
});
