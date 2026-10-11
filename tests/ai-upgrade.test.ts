import { describe, expect, it } from 'vitest';
import { Board, replay } from '../src/lib/go/board';
import { symmetric } from '../src/lib/go/coords';
import { PASS, type Color, type Move } from '../src/lib/go/types';
import { Search, type AnchorSource, type LeafEvaluator, type RootPosition } from '../src/lib/engine/mcts';
import type { NetEval } from '../src/lib/engine/parse';
import { OpeningBook, bookKey, storeEntry, type BookFile } from '../src/lib/engine/book';
import { deepenBudget, positionsToDeepen, visitBudget } from '../src/lib/analysis/pipeline';
import { moveChange } from '../src/lib/analysis/moveChange';
import { pcEval, pcSnapshot, type KgResult } from '../src/state/pc';
import { encodeBoard, encodeMoves } from '../src/lib/student/encode';
import type { GameAnalysis, GameRecord, PositionEval } from '../src/lib/types';

const S = 19;
const at = (x: number, y: number) => y * S + x;

describe('eval bar move change', () => {
  it('is the mover’s gain or loss, with a tone by size', () => {
    // White moved; Black's win rate went from 40% to 50%: White lost 10 points of win rate.
    const c = moveChange(2, 0.4, 0.5, -2, 1.5);
    expect(c.text).toBe('−10.0%');
    expect(c.points).toBe('−3.5');
    expect(c.tone).toBe('bad');
    expect(moveChange(1, 0.5, 0.51, 0, 0.5)).toMatchObject({ text: '+1.0%', tone: 'good' });
    expect(moveChange(1, 0.5, 0.47, null, null)).toMatchObject({ text: '−3.0%', points: '', tone: 'meh' });
    expect(moveChange(1, 0.8, 0.5, 5, -2).tone).toBe('awful');
  });
});

describe('opening book', () => {
  const moves: Move[] = [
    { color: 1, loc: at(15, 3) },
    { color: 2, loc: at(3, 15) },
    { color: 1, loc: at(16, 15) },
  ];
  const board = replay(S, [], moves);
  const best = at(3, 3);
  const stored = storeEntry(board.stones, 2, S, {
    visits: 800,
    bWin: 0.46,
    bLead: -0.7,
    moves: [
      { loc: best, visits: 500, winrate: 0.55, scoreLead: 0.7, prior: 0.4 },
      { loc: at(2, 16), visits: 200, winrate: 0.53, scoreLead: 0.4, prior: 0.2 },
    ],
    pv: [best, at(16, 2)],
  });
  const file: BookFile = { version: 1, size: S, komi: 7, network: 'kata1-b18c384nbt', visits: 800, built: '', entries: { [stored.key]: stored.entry } };
  const book = new OpeningBook(file);

  it('finds every rotation and mirror image of a position, with the moves turned to match', () => {
    for (let sym = 0; sym < 8; sym++) {
      const b = new Board(S);
      for (let i = 0; i < S * S; i++) if (board.stones[i]) b.stones[symmetric(i, S, sym)] = board.stones[i];
      expect(bookKey(b.stones, 2, S).key).toBe(stored.key);
      const e = book.lookup(b, 2)!;
      expect(e.visits).toBe(800);
      expect(e.bWin).toBeCloseTo(0.46, 3);
      expect(e.moves[0].loc).toBe(symmetric(best, S, sym));
      expect(e.pv[1]).toBe(symmetric(at(16, 2), S, sym));
    }
  });

  it('keeps the side to move apart', () => {
    expect(book.lookup(board, 1)).toBeNull();
  });
});

describe('search only what matters', () => {
  // A searched position: Black's win rate and lead, the side to move, the network's doubt.
  const ev = (toPlay: Color, bWin: number, bLead: number, doubt = 0): PositionEval =>
    ({ toPlay, bWin, bLead, policy: [], candidates: [], bestLoc: 0, pv: [], visits: 25, depth: 'deep', searched: true, doubt }) as unknown as PositionEval;
  const game = { moves: [{ color: 1, loc: 10 }, { color: 2, loc: 20 }, { color: 1, loc: 30 }, { color: 2, loc: 40 }], setup: [], size: 19 } as unknown as GameRecord;

  it('scouts every position, then deepens only around the moves the scouts could not clear', () => {
    const analysis = {
      // Move 1 (White) gives Black 4 points; the network is unsure about position 3.
      evals: [ev(1, 0.5, 0), ev(2, 0.5, 0.2), ev(1, 0.62, 4.2), ev(2, 0.62, 4, 0.2), ev(1, 0.61, 4)],
      deepTargets: [],
    } as unknown as GameAnalysis;
    expect(positionsToDeepen(analysis, game)).toEqual([1, 2, 3, 4]);
    expect(visitBudget(analysis, 0, 200)).toBe(50);
    expect(visitBudget(analysis, 0, 200, true, true)).toBe(30);
    expect(visitBudget(analysis, 0, 200, false)).toBe(200);
    expect(deepenBudget(200)).toBe(200);
    expect(deepenBudget(200, true)).toBe(120);
    const quiet = { evals: [ev(1, 0.5, 0), ev(2, 0.5, 0.3), ev(1, 0.51, 0.4), ev(2, 0.5, 0.1), ev(1, 0.5, 0.2)], deepTargets: [] } as unknown as GameAnalysis;
    expect(positionsToDeepen(quiet, game)).toEqual([]);
  });
});

describe('big brain at the top', () => {
  const HW = S * S;
  // A small network that thinks every position is even.
  const small: LeafEvaluator = async (leaves) =>
    leaves.map((l): NetEval => {
      const legal = l.board.legalMask(l.toPlay);
      const policy = new Float32Array(HW + 1);
      let z = 0;
      for (let i = 0; i < HW; i++) if (legal[i]) z += policy[i] = 1;
      for (let i = 0; i < HW; i++) policy[i] /= z;
      return { policy, bWin: 0.5, bLead: 0 };
    });
  const root = (): RootPosition => ({ size: S, komi: 7.5, moves: [], toPlay: 1, board: new Board(S) });

  it('moves the whole tree towards the judge’s value', async () => {
    const plain = await new Search(small, root()).run({ visits: 120 });
    expect(plain.bWin).toBeCloseTo(0.5, 2);
    // The judge says Black is clearly better wherever it is asked.
    let asked = 0;
    const judge: AnchorSource = async () => {
      asked++;
      return { eval: { policy: new Float32Array(0), bWin: 0.8, bLead: 6 }, policy: false };
    };
    const s = new Search(small, root());
    s.setAnchor(judge);
    await s.run({ visits: 120 });
    for (let k = 0; k < 50 && s.anchorStats.judged < s.anchorStats.asked; k++) await new Promise((r) => setTimeout(r, 5));
    const snap = s.snapshot();
    expect(asked).toBeGreaterThan(0);
    expect(snap.bWin).toBeGreaterThan(0.6);
    expect(snap.bLead).toBeGreaterThan(2);
  });
});

describe('PC helper answers', () => {
  const r: KgResult = {
    id: 'q',
    turnNumber: 1,
    moveInfos: [
      { move: 'D4', visits: 300, winrate: 0.42, scoreLead: -1.5, prior: 0.3, order: 0, pv: ['D4', 'Q16'] },
      { move: 'pass', visits: 2, winrate: 0.3, scoreLead: -4, prior: 0.01, order: 1, pv: ['pass'] },
    ],
    rootInfo: { winrate: 0.42, scoreLead: -1.5, visits: 302, currentPlayer: 'W' },
  };

  it('turns Black-perspective numbers into the side to move’s', () => {
    const snap = pcSnapshot(r, 2, S, 1000);
    expect(snap.bWin).toBeCloseTo(0.42);
    expect(snap.candidates[0].winrate).toBeCloseTo(0.58);
    expect(snap.candidates[0].scoreLead).toBeCloseTo(1.5);
    expect(snap.candidates[0].loc).toBe(at(3, 15));
    expect(snap.candidates[1].loc).toBe(PASS);
    expect(snap.evalsPerSec).toBeCloseTo(302);
  });

  it('becomes a searched analysis that keeps this device’s first look', () => {
    const fast = { toPlay: 2, bWin: 0.5, bLead: 0, policy: [], candidates: [], bestLoc: 0, pv: [], visits: 1, depth: 'fast' } as unknown as PositionEval;
    const e = pcEval(r, fast, S);
    expect(e.source).toBe('pc');
    expect(e.searched).toBe(true);
    expect(e.visits).toBe(302);
    expect(e.net).toEqual({ bWin: 0.5, bLead: 0 });
    expect(e.bestLoc).toBe(at(3, 15));
  });
});

describe('student network inputs', () => {
  it('encodes stones, liberties, ko and the last moves', () => {
    // Black captures a white stone in a ko shape.
    const seq: [Color, number, number][] = [
      [1, 3, 2], [2, 4, 2], [1, 2, 3], [2, 5, 3], [1, 3, 4], [2, 4, 4], [1, 10, 10], [2, 3, 3], [1, 4, 3],
    ];
    const moves: Move[] = seq.map(([color, x, y]) => ({ color, loc: at(x, y) }));
    const b = encodeMoves(moves);
    expect(b[at(3, 3)] & 3).toBe(0); // the white stone was taken
    expect(b[at(3, 3)] & 16).toBe(16); // and is a ko point for White
    expect(b[at(4, 3)] & 3).toBe(1);
    expect((b[at(4, 3)] >> 2) & 3).toBe(1); // the capturing stone is in atari
    expect((b[at(4, 3)] >> 5) & 3).toBe(1); // last move
    expect((b[at(10, 10)] >> 5) & 3).toBe(3); // three moves ago
    expect((b[at(10, 10)] >> 2) & 3).toBe(0); // four liberties
    expect(b[at(0, 0)]).toBe(0);
    // The same through encodeBoard with an explicit board.
    const board = replay(S, [], moves);
    expect(encodeBoard(board, [moves[8].loc, moves[7].loc, moves[6].loc])).toEqual(b);
  });
});
