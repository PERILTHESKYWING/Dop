import { describe, expect, it } from 'vitest';
import { Board } from '../src/lib/go/board';
import { gtpToLoc, symmetric } from '../src/lib/go/coords';
import { PASS, type Loc } from '../src/lib/go/types';
import { bookKey, bookMoves, buildBook, unsymmetric } from '../src/lib/profile/book';
import { bookFromExamples, sampleOf, trainCopy } from '../src/lib/profile/copyTrain';
import { DEFAULT_DIALS, presetDials, readDials } from '../src/lib/profile/dials';
import { copyProbs, describeContextHabits, featureVector, fitCopy, type DoppelExample } from '../src/lib/profile/doppel';
import { bestGenome, evolve, mutate, rngFrom } from '../src/lib/profile/evolve';
import { clampGenome, DEFAULT_GENOME, GENES } from '../src/lib/profile/genome';
import { choiceDistribution, FLAG, learnMistakes, measurePlay, type CandInfo, type ChoiceState, type MistakeSample } from '../src/lib/profile/human';
import { shapeOf } from '../src/lib/profile/shape';
import { pf } from './helpers';

const at = (s: string, n = 9) => gtpToLoc(s, n);
function board(n: number, black: string[], white: string[]) {
  const b = new Board(n);
  for (const s of black) b.play(at(s, n), 1);
  for (const s of white) b.play(at(s, n), 2);
  return b;
}
const mid: ChoiceState = { phase: 1, sit: 1, afterMistake: false };
const cand = (loc: Loc, p: number, prior: number, loss: number | undefined, flags = 0, extra: Partial<CandInfo> = {}): CandInfo => ({ loc, p, prior, ...(loss !== undefined ? { loss } : {}), flags, sigs: 0, ...extra });

describe('shapes', () => {
  it('names hane, jumps, knight moves and empty triangles', () => {
    // Black C3, white D3 above it... hane at D4 is diagonal to C3 and touches D3.
    const b = board(9, ['C3'], ['D3']);
    expect(shapeOf(b, at('D4'), 1).hane).toBe(true);
    expect(shapeOf(b, at('C5'), 1).jump).toBe(true);
    expect(shapeOf(b, at('D5'), 1).knight).toBe(true);
    expect(shapeOf(b, at('B4'), 1).diagonal).toBe(true);
    const t = board(9, ['C3', 'C4'], []);
    expect(shapeOf(t, at('D4'), 1).emptyTriangle).toBe(true);
    expect(shapeOf(t, at('C5'), 1).extend).toBe(true);
    const cut = board(9, ['E5'], ['D5', 'E4']);
    expect(shapeOf(cut, at('D4'), 1).cut).toBe(true);
  });
});

describe('opening book', () => {
  it('finds a position in any orientation and turns the move back', () => {
    const n = 19;
    const moves = ['Q16', 'D4', 'Q3'].map((s) => gtpToLoc(s, n));
    const b = new Board(n);
    moves.forEach((m, i) => b.play(m, i % 2 === 0 ? 1 : 2));
    const reply = gtpToLoc('C16', n);
    const book = buildBook([{ board: b, toPlay: 2, loc: reply, moveNumber: 3 }]);
    expect(book.positions).toBe(1);
    for (let sym = 0; sym < 8; sym++) {
      const t = new Board(n);
      moves.forEach((m, i) => t.play(symmetric(m, n, sym), i % 2 === 0 ? 1 : 2));
      expect(bookKey(t, 2).key).toBe(bookKey(b, 2).key);
      const found = bookMoves(book, t, 2, 3);
      expect(found).toEqual([{ loc: symmetric(reply, n, sym), n: 1 }]);
    }
    // The other colour to play, or past the book's depth: nothing.
    expect(bookMoves(book, b, 1, 3)).toEqual([]);
    expect(bookMoves(book, b, 2, 200)).toEqual([]);
  });

  it('inverts every symmetry', () => {
    for (let sym = 0; sym < 8; sym++) for (const loc of [0, 5, 37, 100, 360]) expect(unsymmetric(symmetric(loc, 19, sym), 19, sym)).toBe(loc);
  });
});

describe('choosing a move like the player', () => {
  it('never plays what the blunder guard stops, unless switched off', () => {
    const cands = [cand(1, 0.5, 0.5, 0), cand(2, 0.5, 0.3, 4, FLAG.selfAtari)];
    const model = { mistakes: undefined, genome: DEFAULT_GENOME };
    expect(choiceDistribution(cands, mid, model, DEFAULT_DIALS, { tau: 50 })[1]).toBe(0);
    expect(choiceDistribution(cands, mid, model, { ...DEFAULT_DIALS, guard: false }, { tau: 50 })[1]).toBeGreaterThan(0.3);
    // A long shot that loses a lot is an obvious blunder too.
    const shot = [cand(1, 0.5, 0.5, 0), cand(2, 0.5, 0.001, 6)];
    expect(choiceDistribution(shot, mid, model, DEFAULT_DIALS, { tau: 50 })[1]).toBe(0);
  });

  it("prefers the mistakes that look natural, and errs less with a smaller τ", () => {
    const cands = [cand(1, 0.34, 0.5, 0), cand(2, 0.33, 0.3, 2), cand(3, 0.33, 0.03, 2)];
    const model = { genome: { ...DEFAULT_GENOME, gamma: 1 } };
    const p = choiceDistribution(cands, mid, model, DEFAULT_DIALS, { tau: 1 });
    expect(p[1]).toBeGreaterThan(p[2] * 3);
    const calm = choiceDistribution(cands, mid, model, DEFAULT_DIALS, { tau: 0.2 });
    expect(calm[0]).toBeGreaterThan(p[0]);
  });

  it('follows the dials: no variety, a mistake cap, fewer mistakes, tilt', () => {
    const cands = [cand(1, 0.3, 0.4, 0), cand(2, 0.4, 0.4, 1.2), cand(3, 0.3, 0.2, 7)];
    const mistakes = learnMistakes([]);
    mistakes.tau = Array(9).fill(2);
    mistakes.tilt = 2;
    const model = { mistakes, genome: DEFAULT_GENOME };
    const p0 = choiceDistribution(cands, mid, model, { ...DEFAULT_DIALS, variety: 0 });
    expect(p0.filter((v) => v === 1)).toHaveLength(1);
    expect(choiceDistribution(cands, mid, model, { ...DEFAULT_DIALS, maxMistake: 5 })[2]).toBe(0);
    const as = choiceDistribution(cands, mid, model, DEFAULT_DIALS);
    const fewer = choiceDistribution(cands, mid, model, { ...DEFAULT_DIALS, mistakes: 0.3 });
    expect(fewer[0]).toBeGreaterThan(as[0]);
    const tilted = choiceDistribution(cands, { ...mid, afterMistake: true }, model, DEFAULT_DIALS);
    expect(tilted[2]).toBeGreaterThan(as[2]);
    const calm = choiceDistribution(cands, { ...mid, afterMistake: true }, model, { ...DEFAULT_DIALS, mood: 'calm' });
    expect(calm[2]).toBeCloseTo(as[2], 10);
  });

  it('mixes in the opening book by how often the move was played', () => {
    const cands = [cand(1, 0.9, 0.6, 0), cand(2, 0.1, 0.2, 0.5, 0, { book: 3 })];
    const model = { genome: { ...DEFAULT_GENOME, bookAlpha: 1 } };
    const p = choiceDistribution(cands, mid, model, DEFAULT_DIALS, { tau: 5 });
    expect(p[1]).toBeGreaterThan(0.75);
  });
});

/** Synthetic player: always plays a cheap move; `bad` share of the time a 3-point one. */
function samples(nPos: number, bad: number, seed = 1): MistakeSample[] {
  const r = rngFrom(seed);
  return Array.from({ length: nPos }, () => {
    const cands = [cand(1, 0.4, 0.4, 0), cand(2, 0.3, 0.3, 0.5), cand(3, 0.2, 0.2, 3), cand(4, 0.1, 0.1, 8)];
    const played = r() < bad ? 2 : r() < 0.5 ? 0 : 1;
    return { cands, played, state: mid };
  });
}

describe('mistake profile', () => {
  it('sets τ so the copy loses what the player loses', () => {
    for (const bad of [0.05, 0.3]) {
      const s = samples(600, bad);
      const prof = learnMistakes(s);
      const m = measurePlay(s, { mistakes: prof });
      const you = m.byPhase[1].you.meanLoss;
      expect(Math.abs(m.byPhase[1].copy.meanLoss - you)).toBeLessThan(0.05);
    }
  });

  it('measures tilt after a mistake', () => {
    const r = rngFrom(3);
    const s: MistakeSample[] = Array.from({ length: 800 }, (_, i) => {
      const after = i % 4 === 0;
      const played = r() < (after ? 0.5 : 0.1) ? 2 : 0;
      return { cands: [cand(1, 0.5, 0.5, 0), cand(2, 0.3, 0.3, 0.5), cand(3, 0.2, 0.2, 4)], played, state: { ...mid, afterMistake: after } };
    });
    expect(learnMistakes(s).tilt).toBeGreaterThan(1.5);
  });
});

/** Training examples with candidate costs: in the opening the player answers locally, in the endgame never. */
function richExamples(n: number, seed = 2): DoppelExample[] {
  const r = rngFrom(seed);
  const out: DoppelExample[] = [];
  for (let i = 0; i < n; i++) {
    const phase = (i % 3) as 0 | 1 | 2;
    const local = 1 + Math.floor(r() * 3);
    const priors = [0.4, 0.3, 0.2, 0.1];
    const x = priors.map((p, j) => featureVector(pf({ local: j === local, tenuki: j !== local, distLast: j === local ? 1 : 8 }), p, j === 0));
    const loc = (j: number) => 20 + j;
    const prefersLocal = phase === 0 ? 0.8 : phase === 2 ? 0.05 : 0.4;
    const y = r() < prefersLocal ? local : local === 1 ? 2 : 1;
    out.push({
      gameId: `g${i % 20}`,
      candidates: priors.map((_, j) => loc(j)),
      x,
      y,
      phase,
      sit: 1,
      prior: priors,
      loss: [0, 0.4, 1.5, 4],
      flags: [0, 0, 0, 0],
      sigs: [0, 0, 0, 0],
      age: 19 - (i % 20),
    });
  }
  return out;
}

describe('training a full copy', () => {
  it('learns phase habits, a book, mistakes and play metrics', () => {
    const ex = richExamples(900);
    const w = fitCopy(ex, { l2Phase: 2, l2Sit: 4 });
    const p0 = copyProbs(w, ex[0]); // an opening example
    const p2 = copyProbs(w, ex[2]); // an endgame example
    const localIdx = (e: DoppelExample) => e.x.findIndex((v) => v[1] === 1);
    expect(p0[localIdx(ex[0])]).toBeGreaterThan(p2[localIdx(ex[2])]);
    expect(describeContextHabits(w).some((h) => h.when === 'In the opening' && /locally more often/.test(h.text))).toBe(true);

    const m = trainCopy(ex, { version: 5 });
    expect(m.version).toBe(5);
    expect(m.phaseWeights).toHaveLength(3);
    expect(m.mistakes?.tau).toHaveLength(9);
    expect(m.metrics.play?.positions).toBeGreaterThan(0);
    expect(m.metrics.play!.match).toBeGreaterThan(0.25);
  });

  it('learns from "not me" corrections', () => {
    const ex = richExamples(300);
    const base = fitCopy(ex);
    const target = ex[1];
    const top = copyProbs(base, target).indexOf(Math.max(...copyProbs(base, target)));
    const fixes = Array.from({ length: 40 }, () => ({ ...target, y: -1, neg: top, fix: true, w: 3, gameId: 'fix' }));
    const fixed = fitCopy([...ex, ...fixes]);
    expect(copyProbs(fixed, target)[top]).toBeLessThan(copyProbs(base, target)[top]);
    expect(trainCopy([...ex, ...fixes]).corrections).toBe(40);
  });

  it('builds the book from the examples and offers it in play', () => {
    const ex = richExamples(30).map((e, i) => ({ ...e, bookAt: { key: `k${i % 3}`, sym: 0, size: 19, moveNumber: 2 } }));
    const book = bookFromExamples(ex);
    expect(book.positions).toBe(3);
    const s = sampleOf(fitCopy(ex), ex[0], book);
    expect(s.cands.some((c) => (c.book ?? 0) > 0)).toBe(true);
  });
});

describe('evolution', () => {
  it('keeps the best settings and records each generation', () => {
    const ex = richExamples(600, 9);
    const evo = evolve(ex, null, DEFAULT_GENOME, { generations: 3, seed: 4 });
    expect(evo.generation).toBe(3);
    expect(evo.history).toHaveLength(3);
    // Elites survive, so the best never gets worse.
    for (let i = 1; i < evo.history.length; i++) expect(evo.history[i].best).toBeGreaterThanOrEqual(evo.history[i - 1].best - 1e-12);
    expect(bestGenome(evo)).toBeDefined();
    // Carrying on keeps the history and the scores (same data).
    const more = evolve(ex, evo, undefined, { generations: 1, seed: 5 });
    expect(more.generation).toBe(4);
    expect(more.history).toHaveLength(4);
  });

  it('mutates within bounds', () => {
    const r = rngFrom(1);
    let g = DEFAULT_GENOME;
    for (let i = 0; i < 200; i++) {
      g = mutate(g, r, 1, 1);
      for (const s of GENES) {
        expect(g[s.key]).toBeGreaterThanOrEqual(s.min);
        expect(g[s.key]).toBeLessThanOrEqual(s.max);
      }
    }
    expect(clampGenome({ temperature: 99 }).temperature).toBe(1.6);
  });
});

describe('dials', () => {
  it('fills defaults and clamps stored values', () => {
    expect(readDials(null)).toEqual(DEFAULT_DIALS);
    const d = readDials({ mistakes: 9, mood: 'weird', guard: false, strength: 3 });
    expect(d.mistakes).toBe(2);
    expect(d.mood).toBe('auto');
    expect(d.guard).toBe(false);
    expect(d.strength).toBe(3);
    expect(presetDials('bad', { strength: null }).mood).toBe('tilted');
    expect(presetDials('stronger').mistakes).toBeLessThan(1);
  });
});

it('a pass is never a candidate in the book', () => {
  expect(bookFromExamples([{ gameId: 'g', candidates: [PASS], x: [], y: 0, bookAt: { key: 'k', sym: 0, size: 9, moveNumber: 0 } }]).positions).toBe(0);
});
