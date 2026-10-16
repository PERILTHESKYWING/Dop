import { describe, expect, it } from 'vitest';
import { pointView, splitPoints } from '../kami/src/lib/points';
import { getSetting, SETTINGS, setSetting } from '../kami/src/lib/settings';
import { accuracy, moveAccuracy, phaseClass, reviewMoves } from '../kami/src/lib/review';
import type { ExplainPosition, Variation } from '../src/lib/coach/explain/types';

const at = (gtp: string, size = 19) => (size - parseInt(gtp.slice(1), 10)) * size + 'ABCDEFGHJKLMNOPQRST'.indexOf(gtp[0]);

describe('splitPoints', () => {
  it('finds board points and leaves other words alone', () => {
    const parts = splitPoints('Black plays R16, then Q3. Not BR16, I5 or Z9.', 19);
    expect(parts.filter((p) => p.type === 'point').map((p) => p.text)).toEqual(['R16', 'Q3']);
    expect(parts.map((p) => p.text).join('')).toBe('Black plays R16, then Q3. Not BR16, I5 or Z9.');
  });
  it('ignores points off a small board', () => {
    expect(
      splitPoints('C3 and R16', 9)
        .filter((p) => p.type === 'point')
        .map((p) => p.text),
    ).toEqual(['C3']);
  });
});

describe('pointView', () => {
  const base: ExplainPosition = { size: 19, komi: 7.5, rules: 'area', setup: [], moves: [{ color: 1, loc: at('Q16') }], toPlay: 2 } as unknown as ExplainPosition;
  const v = {
    id: 'v1',
    label: 'D4',
    kind: 'best',
    moves: [
      { color: 2, loc: at('D4') },
      { color: 1, loc: at('C3') },
    ],
  } as unknown as Variation;
  it('shows the line a point starts', () => {
    expect(pointView(at('D4'), base, [v]).variation).toBe(v);
  });
  it('shows the line a point is part of, marked', () => {
    const r = pointView(at('C3'), base, [v]);
    expect(r.variation).toBe(v);
    expect(r.highlight).toEqual([at('C3')]);
  });
  it('marks a stone already on the board and plays an empty point for the side to move', () => {
    expect(pointView(at('Q16'), base, [])).toEqual({ line: [], highlight: [at('Q16')] });
    expect(pointView(at('K10'), base, []).line).toEqual([{ color: 2, loc: at('K10') }]);
  });
});

describe('settings', () => {
  it('has unique keys and a 30% default for built positions', () => {
    const keys = SETTINGS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(getSetting('positions.minWinrate')).toBe(0.3);
  });
  it('clamps numbers to their range', () => {
    setSetting('positions.minWinrate', 0.9);
    expect(getSetting('positions.minWinrate')).toBe(0.5);
    setSetting('katago.boardVisits', 1);
    expect(getSetting('katago.boardVisits')).toBe(30);
  });
});

describe('Kami performance numbers', () => {
  it("uses chess.com's accuracy curve on the winning chance lost", () => {
    expect(moveAccuracy(0)).toBeCloseTo(100, 0);
    expect(moveAccuracy(0.1)).toBeCloseTo(63.8, 0);
    expect(moveAccuracy(1)).toBe(0);
  });
  it('gives each phase an icon from its accuracy', () => {
    expect(phaseClass(95)).toBe('best');
    expect(phaseClass(75)).toBe('good');
    expect(phaseClass(30)).toBe('blunder');
    expect(phaseClass(null)).toBeNull();
  });
  it('classifies moves from the reads before and after them', () => {
    const pos = (n: number) => ({ size: 9, komi: 7, setup: [], moves: [], toPlay: (n % 2 ? 2 : 1) as 1 | 2 });
    const read = (bWin: number, bLead: number, cands: { loc: number; winrate: number; scoreLead: number; visits: number }[]) => ({
      visits: 60,
      bWin,
      bLead,
      ownership: null,
      candidates: cands.map((c) => ({ ...c, pv: [] })),
    });
    const moves = [
      { color: 1 as const, loc: 40 },
      { color: 2 as const, loc: 20 },
    ];
    const reads = [
      read(0.5, 0, [
        { loc: 40, winrate: 0.5, scoreLead: 0, visits: 50 },
        { loc: 41, winrate: 0.3, scoreLead: -4, visits: 10 },
      ]),
      read(0.5, 0, [{ loc: 30, winrate: 0.5, scoreLead: 0, visits: 50 }]),
      read(0.9, 9, []),
    ];
    const list = reviewMoves([pos(0), pos(1), pos(2)], reads, moves, 9, new Map([[0, 0.05]]));
    expect(list.map((m) => m.cls)).toEqual(['brilliant', 'blunder']);
    expect(accuracy(list, 1)).toBeCloseTo(100, 0);
  });
});
