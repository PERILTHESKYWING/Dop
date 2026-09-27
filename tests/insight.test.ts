import { describe, expect, it } from 'vitest';
import { buildAskPrompt, unsupportedFigures, type PositionFacts } from '../shared/ask';
import { canonicalPosition, proStats, transformLoc, type ProExplorer } from '../src/lib/coach/pro';
import { choiceTable, findRate, labelMove, nextBestGap, type DifficultyModel } from '../src/lib/coach/difficulty';
import { keyMoments } from '../src/lib/coach/moments';
import { mainLineComments } from '../src/lib/go/sgf';
import { Board } from '../src/lib/go/board';
import { gtpToLoc } from '../src/lib/go/coords';
import type { GameAnalysis, MoveRecord, PositionEval } from '../src/lib/types';

const at = (s: string) => gtpToLoc(s, 19);

describe('pro explorer', () => {
  it('finds a position in any orientation and maps the moves back', () => {
    const a = new Board(19);
    a.play(at('Q16'), 1);
    a.play(at('D3'), 2);
    // The same position rotated a quarter turn.
    const b = new Board(19);
    const s = 4 | 1; // swap axes, then mirror x
    b.play(transformLoc(s, at('Q16'), 19), 1);
    b.play(transformLoc(s, at('D3'), 19), 2);
    const ca = canonicalPosition(a.stones, 1, 19);
    const cb = canonicalPosition(b.stones, 1, 19);
    expect(ca.key).toBe(cb.key);
    expect(canonicalPosition(a.stones, 2, 19).key).not.toBe(ca.key);

    // An explorer that saw Q3 played from position `a` (stored in the canonical frame).
    const q3 = transformLoc(ca.syms[0], at('Q3'), 19);
    const ex: ProExplorer = { version: 1, source: '', games: 10, maxMove: 40, positions: { [ca.key]: { n: 10, m: [[q3, 7, 4]] } } };
    expect(proStats(ex, a.stones, 1, 19)!.moves[0]).toMatchObject({ loc: at('Q3'), count: 7 });
    // From the rotated board, the answer comes back rotated the same way.
    expect(proStats(ex, b.stones, 1, 19)!.moves[0].loc).toBe(transformLoc(s, at('Q3'), 19));
    expect(proStats(ex, new Board(19).stones, 1, 19)).toBeNull();
  });
});

describe('move difficulty', () => {
  const model: DifficultyModel = {
    version: 2,
    modelId: 'x',
    source: '',
    ranks: [-10, 5],
    // weak: follows the look of a move, often plays something else; strong: also weighs the cost.
    coef: [
      [0.8, 0, 0, 2],
      [1, 0.8, 4, 0],
    ],
    positions: 0,
    createdAt: '',
  };
  const choices = [
    { loc: 1, prior: 0.5, loss: 3, winLoss: 0.1 },
    { loc: 2, prior: 0.3, loss: 2.5, winLoss: 0.08 },
    { loc: 3, prior: 0.1, loss: 4, winLoss: 0.12 },
    // A hidden move, outside the natural-looking ones, that is actually best.
    { loc: 9, prior: 0.004, loss: 0, winLoss: 0 },
  ];

  it('leaves the unlisted moves as one "something else" choice', () => {
    const t = choiceTable(choices);
    expect(t).toHaveLength(5);
    expect(Math.exp(t[4][0])).toBeCloseTo(1 - 0.904);
    expect(t[4][3]).toBe(1);
  });

  it('makes hidden good moves rare for weak players and likelier for strong ones', () => {
    const weak = findRate(model, -10, choices, 9)!;
    const strong = findRate(model, 5, choices, 9)!;
    expect(weak).toBeLessThan(0.02);
    expect(strong).toBeGreaterThan(weak);
    expect(findRate(model, -10, choices, 1)!).toBeGreaterThan(weak);
    expect(findRate(model, 0, choices, 42)).toBeNull();
  });

  it('labels best, only and brilliant moves', () => {
    expect(labelMove('best', null, 0.05)).toBe('best');
    expect(labelMove('best', { points: 0.5, win: 0.02 }, 0.05)).toBe('best');
    expect(labelMove('best', { points: 3, win: 0.05 }, 0.6)).toBe('only');
    expect(labelMove('best', { points: 1, win: 0.12 }, 0.1)).toBe('brilliant');
    expect(labelMove('mistake', { points: 3, win: 0.2 }, 0.01)).toBe('mistake');
  });

  it('measures the gap to the next-best move only from a real search', () => {
    const cands = [
      { loc: 1, winrate: 0.6, scoreLead: 2, visits: 300 },
      { loc: 2, winrate: 0.45, scoreLead: -1, visits: 40 },
      { loc: 3, winrate: 0.7, scoreLead: 5, visits: 1 },
    ];
    expect(nextBestGap(cands, 400)).toEqual({ points: 3, win: expect.closeTo(0.15, 5) });
    expect(nextBestGap(cands, 20)).toBeNull();
    expect(nextBestGap(cands.slice(0, 1), 400)).toBeNull();
  });
});

describe('key moments', () => {
  const rec = (index: number, over: Partial<MoveRecord>): MoveRecord =>
    ({ index, color: index % 2 ? 2 : 1, loc: 100 + index, bestLoc: 200 + index, winrateLoss: 0, scoreLoss: 0, winBefore: 0.5, ...over }) as MoveRecord;
  it('picks the turning points and the only-move positions', () => {
    const records = [rec(0, {}), rec(1, { winrateLoss: 0.3, scoreLoss: 8 }), rec(2, { loc: 7 }), rec(3, { winrateLoss: 0.12 }), rec(4, { winrateLoss: 0.4, winBefore: 0.99 })];
    const evals: (PositionEval | null)[] = records.map(() => null);
    evals[2] = {
      searched: true,
      visits: 500,
      candidates: [
        { loc: 7, prior: 0.01, winrate: 0.7, scoreLead: 4, visits: 450, pv: [] },
        { loc: 8, prior: 0.5, winrate: 0.5, scoreLead: 0, visits: 50, pv: [] },
      ],
    } as unknown as PositionEval;
    const ms = keyMoments(records, { evals } as GameAnalysis);
    expect(ms.map((m) => [m.index, m.kind])).toEqual([
      [1, 'turning-point'],
      [2, 'only-move'],
      [3, 'turning-point'],
    ]);
    expect(ms[1]).toMatchObject({ found: true, best: 7 });
  });
});

describe('game-file comments', () => {
  it('keys comments by the move they follow', () => {
    const c = mainLineComments('(;GM[1]SZ[19]C[Game notes];B[pd]C[A calm start.];W[dp];B[pp]C[Too slow\\] - D16 was bigger](;W[dd]))');
    expect(c.get(0)).toBe('Game notes');
    expect(c.get(1)).toBe('A calm start.');
    expect(c.get(3)).toBe('Too slow] - D16 was bigger');
    expect(c.has(2)).toBe(false);
  });
});

describe('ask with insights', () => {
  const facts: PositionFacts = {
    size: 19,
    komi: 7.5,
    moveNumber: 50,
    toPlay: 'Black',
    diagram: '',
    blackWinrate: 55,
    blackLead: 1.5,
    visits: 400,
    candidates: [{ move: 'R3', winrate: 58, lead: 2.1, visits: 300, line: ['R3', 'Q2'] }],
    groups: [],
    insights: [{ move: 'R3', role: 'KataGo', label: 'Brilliant', gap: { points: 3.4, winrate: 11.2 }, findRates: [{ level: '5k', percent: 2 }, { level: 'pro', percent: 27 }] }],
    pro: { games: 40, moves: [{ move: 'D16', games: 30, percent: 75, winPercent: 52 }] },
    keyMoments: [{ move: 88, player: 'White', kind: 'only move', played: 'K10', kataGo: 'L12', found: false, winrateLoss: 21.5, pointsLost: 6.2 }],
    comments: { nextMove: 'O17 would be calmer.' },
  };
  it('accepts figures from insights, pro games, key moments and comments', () => {
    const a = 'R3 is brilliant: a 5k finds it 2% of the time and pros 27%; every other move is 3.4 points worse. Pros played D16 in 75% of games. At move 88 White missed L12 (6.2 points); the comment suggests O17.';
    expect(unsupportedFigures(a, facts)).toEqual([]);
    expect(unsupportedFigures('A 1d finds it 40% of the time.', facts)).toEqual(['40%']);
  });
  it('puts them in the prompt', () => {
    const t = buildAskPrompt({ task: 'ask-position', question: 'Key moments?', facts });
    expect(t).toContain("KataGo's move R3: Brilliant (the next-best move is 3.4 points and 11.2% worse). Players play it here: 5k 2%, pro 27%.");
    expect(t).toContain('D16 in 30 games (75%, the player won 52%)');
    expect(t).toContain('Move 88, White, only move: played K10, KataGo L12 (missed it');
    expect(t).toContain('O17 would be calmer.');
  });
});
