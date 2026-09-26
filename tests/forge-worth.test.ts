import { describe, expect, it } from 'vitest';
import { Corpus } from '../src/lib/corpus';
import { generateItems } from '../src/lib/forge/generator';
import { buildBlindSet, pickItem } from '../src/lib/forge/scheduler';
import {
  assessItem,
  assessPosition,
  describeSkipped,
  earlyOpeningMoves,
  isWorthDrilling,
  practiceItems,
  summarizePractice,
  type PlayedMove,
  type WorthInput,
} from '../src/lib/forge/worth';
import { gtpToLoc } from '../src/lib/go/coords';
import type { Color, Loc } from '../src/lib/go/types';
import type { Candidate, GameRecord, MoveRecord, PositionEval, TrainingItem, Weakness } from '../src/lib/types';
import { record } from './helpers';

const S = 19;
const at = (s: string) => gtpToLoc(s, S);
const ENGINE = { engine: 'fake', backend: 'cpu' as const, modelId: 'm', modelName: 'm', modelVersion: 1 };
/** Candidate points: SPOTS[0] is always KataGo's move. */
const SPOTS = ['D16', 'Q4', 'C3', 'R17', 'K10', 'O3', 'F17', 'J3', 'S10', 'B12'].map(at);

/**
 * Black to play. With `losses`, a deep evaluation whose i-th candidate loses losses[i] points
 * against the best (about 3% winrate per point, Black at `bestWin` after the best move);
 * with null, a fast evaluation (policy only).
 */
function evalWith(losses: number[] | null, opts: { bestWin?: number; policy?: number[]; winPerPoint?: number } = {}): PositionEval {
  const bestWin = opts.bestWin ?? 0.52;
  const perPoint = opts.winPerPoint ?? 0.03;
  const policy = (opts.policy ?? [0.3, 0.2, 0.1, 0.08, 0.05, 0.04, 0.03]).map((p, i) => ({ loc: SPOTS[i], p }));
  const candidates: Candidate[] | undefined = losses?.map((l, i) => ({
    loc: SPOTS[i],
    prior: policy[i]?.p ?? 0,
    winrate: Math.max(0.01, bestWin - l * perPoint),
    scoreLead: 1.5 - l,
  }));
  return {
    key: 'k',
    toPlay: 1,
    bWin: bestWin,
    bLead: 1.5,
    policy,
    candidates,
    bestLoc: SPOTS[0],
    pv: [],
    visits: candidates ? 64 : 1,
    depth: candidates ? 'deep' : 'fast',
    engine: ENGINE,
    analyzedAt: 0,
  };
}

/** A tree search's evaluation: [visits, Black's lead after the move] per candidate, most visits first. */
function searchedWith(rows: [number, number][]): PositionEval {
  const candidates = rows.map(([visits, lead], i) => ({ loc: SPOTS[i], prior: 0.05, visits, scoreLead: lead, winrate: 0.52 + (lead - 1) * 0.03 }));
  return { ...evalWith(null), candidates, visits: rows.reduce((a, [v]) => a + v, 1), depth: 'deep', bLead: 1, bWin: 0.52 };
}

function played(loss: number, policy: number, opts: { winrate?: number; loc?: Loc; byPlayer?: boolean } = {}): PlayedMove {
  return { loc: opts.loc ?? at('B2'), scoreLoss: loss, winrateLoss: opts.winrate ?? loss * 0.03, policy, byPlayer: opts.byPlayer ?? true };
}

/** The position before move `moveNumber`; with a game move it is shown as the player's own error. */
const input = (moveNumber: number, e: PositionEval, p?: PlayedMove): WorthInput => ({ size: S, moveNumber, eval: e, played: p, requireMistake: !!p });

describe('which positions are worth drilling', () => {
  it('rejects an early-opening choice that costs half a point', () => {
    // Move 5: KataGo prefers another corner point to the one played, by half a point.
    const e = evalWith([0, 0.3, 0.5, 0.5, 0.6]);
    const w = assessPosition(input(5, e, played(0.5, 0.25, { loc: SPOTS[2], winrate: 0.015 })));
    expect(w.ok).toBe(false);
    expect(w.verdict).toBe('opening');
    expect(w.early).toBe(true);
    expect(w.score).toBe(0);
    expect(w.reason).toBe('Early opening: only 0.5 points at stake');
    // Not as a similar position either, and a 3-point slip this early is not enough.
    expect(assessPosition(input(5, e)).verdict).toBe('opening');
    expect(assessPosition(input(18, evalWith([0, 1.5, 3, 3.5, 4]), played(3, 0.02, { loc: SPOTS[3], winrate: 0.09 }))).verdict).toBe('opening');
  });

  it('keeps a real blunder in the early opening', () => {
    const w = assessPosition(input(12, evalWith([0, 0.6, 2.5, 3, 9]), played(9, 0.001, { loc: SPOTS[4], winrate: 0.27 })));
    expect(w.ok).toBe(true);
    expect(w.early).toBe(true);
    expect(w.reason).toBe('You lost 9.0 points here; two moves stand out');
  });

  it('scales the early opening with the board size', () => {
    expect(earlyOpeningMoves(19)).toBe(30);
    expect(earlyOpeningMoves(13)).toBe(14);
    expect(earlyOpeningMoves(9)).toBe(7);
    // Other moves lose about 3 points: enough in the middlegame, not in the early opening.
    const e = evalWith([0, 2.5, 3, 3.5, 4]);
    expect(assessPosition(input(30, e)).verdict).toBe('opening');
    expect(assessPosition(input(31, e)).ok).toBe(true);
    expect(assessPosition({ ...input(10, e), size: 13 }).verdict).toBe('opening');
    expect(assessPosition({ ...input(15, e), size: 13 }).ok).toBe(true);
  });

  it('rejects a normal, joseki-like move that lost little', () => {
    const joseki = played(2.4, 0.3, { loc: SPOTS[2], winrate: 0.09 });
    const w = assessPosition(input(60, evalWith([0, 0.5, 2.4, 3, 4]), joseki));
    expect(w.ok).toBe(false);
    expect(w.verdict).toBe('normal');
    expect(w.reason).toBe('A normal move that lost only 2.4 points');
    // A normal move is a mistake from 3 points; a move KataGo would not consider is one already.
    expect(assessPosition(input(60, evalWith([0, 0.5, 3.5, 4, 5]), { ...joseki, scoreLoss: 3.5 })).ok).toBe(true);
    expect(assessPosition(input(60, evalWith([0, 0.5, 2.4, 3, 4]), { ...joseki, policy: 0.02 })).ok).toBe(true);
  });

  it('rejects positions where several moves are about equally good', () => {
    const w = assessPosition(input(90, evalWith([0, 0.2, 0.4, 0.7, 5, 6])));
    expect(w.ok).toBe(false);
    expect(w.verdict).toBe('unclear');
    expect(w.reason).toBe('4 moves are within 1 point of the best');
    // A 2.6-point slip among four fine moves is no single lesson either...
    expect(assessPosition(input(90, evalWith([0, 0.2, 0.4, 0.7, 2.6]), played(2.6, 0.02, { loc: SPOTS[4] }))).verdict).toBe('unclear');
    // ...but a real blunder is, ranked below the same blunder with one clear answer.
    const blunder = assessPosition(input(90, evalWith([0, 0.2, 0.4, 0.7, 9]), played(9, 0.001, { loc: SPOTS[4] })));
    expect(blunder.ok).toBe(true);
    expect(blunder.reason).toBe('You lost 9.0 points here; several moves are fine');
    const clear = assessPosition(input(90, evalWith([0, 3, 4, 5, 9]), played(9, 0.001, { loc: SPOTS[4] })));
    expect(clear.score).toBeGreaterThan(blunder.score);
  });

  it("falls back to the network's policy when only the fast analysis exists", () => {
    const spread = assessPosition(input(100, evalWith(null, { policy: [0.2, 0.18, 0.15, 0.1, 0.05] }), played(3, 0.01)));
    expect(spread.verdict).toBe('unclear');
    expect(spread.reason).toBe('3 moves look about equally natural to KataGo');
    const sharp = assessPosition(input(100, evalWith(null, { policy: [0.6, 0.1, 0.05] }), played(3, 0.01)));
    expect(sharp.ok).toBe(true);
    expect(sharp.reason).toBe('You lost 3.0 points here');
    // Only glanced at, and the game move was KataGo's: nothing measured at stake.
    const fine = assessPosition({ size: S, moveNumber: 100, eval: evalWith(null), played: played(0, 0.3, { loc: SPOTS[0] }) });
    expect(fine.verdict).toBe('small');
  });

  it('keeps a clear middlegame mistake and says why in one line', () => {
    // Black keeps the lead with the best move and loses it with any other.
    const e = evalWith([0, 3.1, 4.2, 5.4, 7], { bestWin: 0.56 });
    const w = assessPosition(input(80, e, played(4.2, 0.02, { loc: SPOTS[2], winrate: 0.13 })));
    expect(w.ok).toBe(true);
    expect(w.early).toBe(false);
    expect(w.goodMoves).toBe(1);
    expect(w.reason).toBe('You lost 4.2 points here; only one move keeps the lead');
    expect(w.score).toBeGreaterThan(0.5);
    // Shown as a similar position, the line does not say whose move it was.
    expect(assessPosition(input(80, e)).reason).toBe('4.8 points at stake; only one move keeps the lead');
    // Behind either way: one move stands out.
    expect(assessPosition(input(80, evalWith([0, 3, 4], { bestWin: 0.45 }))).reason).toBe('3.5 points at stake; one move stands out');
  });

  it("judges searched positions by KataGo's most searched moves", () => {
    // Visits spread over three moves about a point apart; a move searched 3 times shows +4.
    const flat = searchedWith([[300, 1], [250, 0.6], [200, 0.4], [10, -3], [3, 4], [1, -6], [1, -8], [1, -9], [1, -10], [1, -12]]);
    const w = assessPosition(input(100, flat));
    expect(w.verdict).toBe('unclear');
    expect(w.goodMoves).toBe(4);
    // Everything KataGo really considered is within about 2 points; moves it looked at once do not add stakes...
    const close = searchedWith([[400, 1], [50, -0.5], [30, -0.8], [10, -1], [5, -1.2], [1, -10], [1, -10], [1, -10], [1, -10], [1, -10]]);
    expect(assessPosition(input(100, close)).verdict).toBe('small');
    // ...unless one of them is the game move.
    expect(assessPosition(input(100, close, played(11, 0.001, { loc: SPOTS[6], winrate: 0.33 }))).reason).toBe(
      'You lost 11.0 points here; only one move keeps the lead',
    );
  });

  it('rejects small losses but counts a big swing in a close game', () => {
    const small = assessPosition(input(120, evalWith([0, 0.8, 1.2, 1.4, 2]), played(1.2, 0.02, { loc: SPOTS[2], winrate: 0.03 })));
    expect(small.verdict).toBe('small');
    expect(small.reason).toBe('Only 1.3 points at stake');
    const swing = assessPosition(input(120, evalWith([0, 1.6, 2, 2.5, 3], { winPerPoint: 0.08 }), played(1.6, 0.02, { loc: SPOTS[1], winrate: 0.13 })));
    expect(swing.ok).toBe(true);
    expect(swing.reason).toMatch(/^You lost 13% winrate \(1\.6 points\) here; /);
  });

  it('scores bigger, clearer lessons higher', () => {
    const score = (losses: number[]) => assessPosition(input(100, evalWith(losses))).score;
    expect(score([0, 8, 9, 10])).toBeGreaterThan(score([0, 3, 3.5, 4]));
    expect(score([0, 3, 3.5, 4])).toBeGreaterThan(score([0, 0.5, 3.5, 4]));
    expect(score([0, 0.2, 0.3, 0.4])).toBe(0);
  });
});

/** A stored item (no `played`, like the ones saved before these rules) at `moveNumber`. */
function storedItem(id: string, moveNumber: number, e: PositionEval, extra: Partial<TrainingItem> = {}): TrainingItem {
  const moves = Array.from({ length: moveNumber - 1 }, (_, i) => ({ color: (i % 2 ? 2 : 1) as Color, loc: i }));
  return {
    id,
    weaknessId: 'w',
    signature: 'local_over_tenuki',
    kind: 'original',
    sourceMoveId: id,
    gameId: 'g',
    index: moveNumber - 1,
    size: S,
    komi: 6.5,
    setup: [],
    moves,
    toPlay: 1,
    eval: e,
    expectsContext: true,
    difficulty: 2,
    createdAt: 0,
    ...extra,
  };
}

describe('stored practice items', () => {
  const items = [
    storedItem('legacy-opening', 6, evalWith([0, 0.2, 0.3, 0.5, 0.6])),
    storedItem('legacy-clear', 70, evalWith([0, 3, 4, 6])),
    storedItem('joseki', 50, evalWith([0, 1.5, 2, 3.5, 4]), { played: played(1.5, 0.35, { loc: SPOTS[1] }) }),
    storedItem('lopsided', 80, evalWith([0, 4, 5, 6], { bestWin: 0.9 })),
    storedItem('mistake', 80, evalWith([0, 2.5, 4, 5]), { played: played(5, 0.01, { loc: SPOTS[3] }) }),
    storedItem('unclear', 100, evalWith([0, 0.1, 0.4, 0.8, 5]), { kind: 'similar' }),
    storedItem('tiny', 120, evalWith([0, 1.1, 1.3, 1.6]), { kind: 'similar' }),
  ];

  it('filters them when choosing questions, including items saved before these rules', () => {
    expect(practiceItems(items).map((i) => i.id)).toEqual(['legacy-clear', 'mistake']);
    // The winrate floor still applies on top: a lower floor lets the decided position back in.
    expect(practiceItems(items, 0.05).map((i) => i.id)).toEqual(['legacy-clear', 'lopsided', 'mistake']);
    const s = summarizePractice(items);
    expect(s).toEqual({ total: 7, kept: 2, lopsided: 1, opening: 1, normal: 1, unclear: 1, small: 1 });
    expect(describeSkipped(s)).toBe(
      '1 was an early-opening move, 1 was a normal move that lost little, 1 had several equally good moves, 1 had too little at stake, 1 was already decided',
    );
    expect(describeSkipped({ ...s, opening: 5, small: 2, normal: 0, unclear: 0, lopsided: 0 })).toBe('5 were early-opening moves, 2 had too little at stake');
  });

  it('never asks a pointless position and prefers the better questions', () => {
    const strong = storedItem('strong', 90, evalWith([0, 9, 10, 12]));
    const weak = storedItem('weak', 90, evalWith([0, 2.2, 2.5, 3]));
    const pointless = storedItem('pointless', 8, evalWith([0, 0.2, 0.3, 0.4]));
    const pool = [pointless, weak, strong];
    expect(assessItem(strong).score).toBeGreaterThan(assessItem(weak).score);
    expect(pickItem(pool, [], 1, () => 0.5)!.id).toBe('strong');
    const picks: Record<string, number> = { strong: 0, weak: 0, pointless: 0 };
    for (let k = 0; k < 50; k++) picks[pickItem(pool, [], 1, () => (k + 0.5) / 50)!.id]++;
    expect(picks.pointless).toBe(0);
    expect(picks.strong).toBeGreaterThan(picks.weak);
    expect(picks.weak).toBeGreaterThan(0);
    expect(pickItem([pointless], [], 1)).toBeNull();
  });

  it('builds blind tests from positions worth drilling only, better ones first', () => {
    const clear = (i: number) => evalWith([0, 3 + i, 4 + i, 5 + i]);
    const pool = [
      ...Array.from({ length: 8 }, (_, i) => storedItem(`p${i}`, 90, clear(i))),
      ...Array.from({ length: 8 }, (_, i) => storedItem(`n${i}`, 90, clear(i), { kind: 'counterexample', expectsContext: false })),
      ...Array.from({ length: 6 }, (_, i) => storedItem(`x${i}`, 6, evalWith([0, 0.1, 0.2, 0.3]))),
    ];
    const set = buildBlindSet(pool, [], 14);
    expect(set).toHaveLength(14);
    expect(set.every(isWorthDrilling)).toBe(true);
    expect(set.filter((it) => it.expectsContext)).toHaveLength(7);
    // Seven of eight on each side: the smallest lesson is the one left out.
    const ids = buildBlindSet(pool, [], 14, () => 0.5).map((it) => it.id);
    expect(ids).not.toContain('p0');
    expect(ids).not.toContain('n0');
  });
});

describe('Forge item generation', () => {
  /** Stones on points of one colour of a checkerboard never touch, so every move is legal. */
  const points = Array.from({ length: S * S }, (_, l) => l).filter((l) => (Math.floor(l / S) + (l % S)) % 2 === 0);
  const moves = points.slice(0, 130).map((loc, i) => ({ color: (i % 2 ? 2 : 1) as Color, loc }));
  const game: GameRecord = {
    id: 'g1', source: 'user', fileName: 'g1.sgf', sgf: '', size: S, komi: 6.5, handicap: 0, setup: [], moves, black: 'me', white: 'you',
    playerColor: 1, importedAt: 0, status: 'done', warnings: [], progress: { fast: 131, deep: 0, deepTotal: 0, total: 131 },
  };
  const evals: (PositionEval | null)[] = new Array(moves.length + 1).fill(null);
  const records: MoveRecord[] = [];
  const add = (index: number, e: PositionEval, p: PlayedMove) => {
    evals[index] = e;
    records.push({
      ...record(`g1:${index}`, 'g1', index, [], [], p.scoreLoss),
      loc: p.loc,
      bestLoc: e.bestLoc,
      playedPolicy: p.policy,
      winrateLoss: p.winrateLoss,
    });
  };
  add(4, evalWith([0, 0.3, 0.5, 0.5]), played(0.5, 0.3, { loc: SPOTS[2], winrate: 0.015 })); // opening choice
  add(10, evalWith([0, 0.6, 2.5, 3, 9]), played(9, 0.001, { loc: SPOTS[4], winrate: 0.27 })); // early blunder
  add(60, evalWith([0, 3.1, 4.2, 5.4, 7], { bestWin: 0.56 }), played(4.2, 0.02, { loc: SPOTS[2], winrate: 0.13 })); // clear mistake
  add(70, evalWith([0, 0.5, 1.8, 1.9, 2.2]), played(1.8, 0.3, { loc: SPOTS[2] })); // normal move
  add(80, evalWith([0, 3, 5, 6]), played(0, 0.3, { loc: SPOTS[0] })); // played well, much at stake
  add(90, evalWith([0, 0.2, 0.3, 0.5]), played(0, 0.3, { loc: SPOTS[0] })); // several fine moves
  const corpus = new Corpus([], []);
  corpus.games.set(game.id, game);
  corpus.analyses.set(game.id, { gameId: game.id, evals, deepTargets: [], updatedAt: 0 });
  corpus.records = records;
  for (const r of records) corpus.byId.set(r.id, r);
  const weakness = (signature: string, evidence: number[]): Weakness => ({
    id: `w-${signature}`, signature, category: 'fighting', title: signature, description: '', opportunities: 10, occurrences: evidence.length,
    games: 1, errorRate: 0.4, baselineRate: 0.1, avgScoreLoss: 3, totalScoreLoss: 12, confidence: 0.9,
    evidence: evidence.map((i) => ({ moveId: `g1:${i}`, gameId: 'g1', index: i, scoreLoss: 1, winrateLoss: 0 })),
    trend: { older: 0, newer: 0 }, status: 'active', discoveredAt: 0, updatedAt: 0,
  });

  it('only turns positions worth drilling into questions', () => {
    const items = generateItems(corpus, weakness('llm-test', [4, 10, 60, 70]));
    expect(items.map((i) => `${i.kind}@${i.index}`)).toEqual(['original@10', 'original@60', 'similar@80']);
    expect(items.every(isWorthDrilling)).toBe(true);
    expect(items[0].played).toEqual({ loc: SPOTS[4], scoreLoss: 9, winrateLoss: 0.27, policy: 0.001, byPlayer: true });
    expect(assessItem(items[1]).reason).toBe('You lost 4.2 points here; only one move keeps the lead');
    expect(practiceItems(items)).toHaveLength(3);
  });

  it('filters every kind, not just the originals', () => {
    // Every move "commits" the endgame signature, so non-endgame positions become counterexamples.
    const items = generateItems(corpus, weakness('endgame_value', [60]));
    expect(items.filter((i) => i.kind === 'original').map((i) => i.index)).toEqual([60]);
    const counter = items.filter((i) => i.kind === 'counterexample').map((i) => i.index);
    expect(counter).toContain(80);
    expect(counter).not.toContain(4);
    expect(counter).not.toContain(90);
    expect(items.every(isWorthDrilling)).toBe(true);
  });
});
