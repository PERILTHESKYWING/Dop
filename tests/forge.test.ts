import { describe, expect, it } from 'vitest';
import { answerCovered, gradeAnswer, gradeOf } from '../src/lib/forge/grading';
import { buildBlindSet, newMastery, pickItem, scoreBlindTest, updateMastery } from '../src/lib/forge/scheduler';
import { balancedItems, isBalanced } from '../src/lib/forge/balance';
import { makeVariation } from '../src/lib/forge/variations';
import { isWorthDrilling } from '../src/lib/forge/worth';
import { searchedValue } from '../src/lib/analysis/analyzer';
import type { EngineRequest } from '../src/lib/engine/types';
import { FakeEngine } from './helpers';
import { gtpToLoc } from '../src/lib/go/coords';
import type { Attempt, TrainingItem, TrainingKind } from '../src/lib/types';

const at = (s: string) => gtpToLoc(s, 9);

function item(id: string, kind: TrainingKind = 'original', expectsContext = true): TrainingItem {
  return {
    id, weaknessId: 'w', signature: 'local_over_tenuki', kind, sourceMoveId: 's', gameId: 'g', index: 4, size: 9, komi: 7, setup: [],
    moves: [{ color: 1, loc: at('E5') }, { color: 2, loc: at('C3') }, { color: 1, loc: at('G7') }, { color: 2, loc: at('C7') }],
    toPlay: 1,
    eval: {
      key: id, toPlay: 1, bWin: 0.6, bLead: 3, policy: [{ loc: at('G3'), p: 0.4 }, { loc: at('D6'), p: 0.2 }], bestLoc: at('G3'), pv: [],
      candidates: [
        { loc: at('G3'), prior: 0.4, winrate: 0.62, scoreLead: 3.2 },
        { loc: at('D6'), prior: 0.2, winrate: 0.55, scoreLead: 1.9 },
        { loc: at('B8'), prior: 0.01, winrate: 0.3, scoreLead: -6 },
      ],
      visits: 64, depth: 'deep', engine: { engine: 'fake', backend: 'cpu', modelId: 'm', modelName: 'm', modelVersion: 1 }, analyzedAt: 0,
    },
    expectsContext, difficulty: 0.5, createdAt: 0,
  };
}

function attempt(itemId: string, correct: boolean, at = Date.now()): Attempt {
  return {
    id: `a-${itemId}-${Math.random()}`, itemId, weaknessId: 'w', signature: 'local_over_tenuki', kind: 'original', mode: 'forge', sessionId: 's', loc: 0,
    timeMs: 3000, scoreLoss: correct ? 0 : 4, winrateLoss: 0, grade: correct ? 'excellent' : 'mistake', conceptCorrect: correct, repeatedError: !correct, at,
  };
}

describe('Forge grading', () => {
  it('grades by score and winrate loss', () => {
    expect(gradeOf(0.2, 0.005)).toBe('excellent');
    expect(gradeOf(1, 0.02)).toBe('good');
    expect(gradeOf(2, 0.05)).toBe('inaccurate');
    expect(gradeOf(5, 0.1)).toBe('mistake');
    expect(gradeOf(12, 0.3)).toBe('blunder');
  });

  it("scores KataGo's move as best and others by candidate loss", () => {
    const it = item('i1');
    expect(gradeAnswer(it, at('G3')).scoreLoss).toBe(0);
    const d6 = gradeAnswer(it, at('D6'));
    expect(d6.scoreLoss).toBeCloseTo(1.3, 5);
    expect(d6.estimated).toBe(false);
    const other = gradeAnswer(it, at('A1'));
    expect(other.estimated).toBe(true);
    expect(other.scoreLoss).toBeGreaterThanOrEqual(2);
  });

  it('uses a live evaluation for moves outside the candidates', () => {
    const r = gradeAnswer(item('i1'), at('A1'), { win: 0.6, lead: 2.7 });
    expect(r.estimated).toBe(false);
    expect(r.scoreLoss).toBeCloseTo(0.5, 5);
  });

  it('measures searched analyses against the most visited move, and rechecks thinly searched answers', () => {
    const it = item('i1');
    it.eval = {
      ...it.eval,
      searched: true,
      candidates: [
        { loc: at('G3'), prior: 0.4, winrate: 0.62, scoreLead: 3.2, visits: 50 },
        { loc: at('D6'), prior: 0.2, winrate: 0.55, scoreLead: 1.9, visits: 20 },
        // Two visits: looks better than the best move, which the search did not trust.
        { loc: at('B8'), prior: 0.01, winrate: 0.7, scoreLead: 5, visits: 2 },
      ],
    };
    expect(answerCovered(it, at('D6'))).toBe(true);
    expect(answerCovered(it, at('B8'))).toBe(false);
    expect(gradeAnswer(it, at('D6')).scoreLoss).toBeCloseTo(1.3, 5);
    expect(gradeAnswer(it, at('G3')).scoreLoss).toBe(0);
    // Checked by a search of its own: the loss is measured within that search.
    const b8 = gradeAnswer(it, at('B8'), { win: 0.4, lead: -2, bestWin: 0.6, bestLead: 3 });
    expect(b8.scoreLoss).toBeCloseTo(5, 5);
    expect(b8.bestLoc).toBe(at('G3'));
  });
});

describe('Forge scheduling', () => {
  it('raises the level after consistent correct decisions and lowers it after misses', () => {
    let m = newMastery('w');
    const hist: Attempt[] = [];
    for (let i = 0; i < 6; i++) {
      const a = attempt('x', true);
      m = updateMastery(m, a, hist);
      hist.push(a);
    }
    expect(m.level).toBeGreaterThan(1);
    expect(m.mastery).toBeGreaterThan(0.5);
    const lvl = m.level;
    for (let i = 0; i < 4; i++) {
      const a = attempt('x', false);
      m = updateMastery(m, a, hist);
      hist.push(a);
    }
    expect(m.level).toBeLessThan(lvl);
  });

  it('prefers unseen items and brings missed items back', () => {
    const items = ['a', 'b', 'c', 'd'].map((id) => item(id));
    const seen = [attempt('a', true), attempt('b', true), attempt('c', true)];
    expect(pickItem(items, seen, 1, () => 0.5)!.id).toBe('d');
    const missed = [attempt('a', false), ...Array.from({ length: 8 }, () => attempt('zz', true))];
    expect(pickItem(items, missed, 1, () => 0.1)!.id).toBe('a');
  });

  it('builds balanced blind sets and scores them against a fixed-habit baseline', () => {
    const items = [
      ...Array.from({ length: 10 }, (_, i) => item(`p${i}`, 'original', true)),
      ...Array.from({ length: 10 }, (_, i) => item(`n${i}`, 'counterexample', false)),
    ];
    const set = buildBlindSet(items, [], 14);
    expect(set).toHaveLength(14);
    expect(set.filter((i) => i.expectsContext).length).toBe(7);
    const atts = set.map((i) => attempt(i.id, true));
    const res = scoreBlindTest({ id: 't', weaknessId: 'w', itemIds: set.map((i) => i.id), startedAt: 0, attempts: atts.map((a) => a.id) }, atts, items);
    expect(res.baseline).toBe(0.5);
    expect(res.verdict).toBe('learned');
    const half = set.map((i, k) => attempt(i.id, k % 2 === 0));
    const res2 = scoreBlindTest({ id: 't', weaknessId: 'w', itemIds: [], startedAt: 0, attempts: half.map((a) => a.id) }, half, items);
    expect(res2.verdict).not.toBe('learned');
  });
});

describe('practice winrate floor', () => {
  it('keeps positions where the side behind still has at least 30%', () => {
    expect(isBalanced(0.5)).toBe(true);
    expect(isBalanced(0.3)).toBe(true);
    expect(isBalanced(0.7)).toBe(true);
    expect(isBalanced(0.29)).toBe(false);
    expect(isBalanced(0.71)).toBe(false);
    expect(isBalanced(Number.NaN)).toBe(false);
    expect(isBalanced(0.25, 0.2)).toBe(true);
  });

  it('filters stored practice items by their evaluation', () => {
    // Black is to move, so the candidates' (mover's) winrates are Black's too.
    const lopsided = (id: string, bWin: number) => {
      const it = item(id);
      return { ...it, eval: { ...it.eval, bWin, candidates: it.eval.candidates!.map((c) => ({ ...c, winrate: bWin })) } };
    };
    expect(balancedItems([item('even'), lopsided('black-wins', 0.85), lopsided('white-wins', 0.12)]).map((x) => x.id)).toEqual(['even']);
  });

  it('judges searched positions by the search, not the raw network', () => {
    const base = item('sharp');
    // The network calls it 60% for Black, but every searched move leaves Black near 20%.
    const candidates = [
      { loc: at('G3'), prior: 0.4, winrate: 0.2, scoreLead: -6, visits: 6 },
      { loc: at('D6'), prior: 0.2, winrate: 0.18, scoreLead: -6.5, visits: 3 },
      { loc: at('B8'), prior: 0.01, winrate: 0.05, scoreLead: -20 }, // the played move, not searched
    ];
    const sharp = { ...base, eval: { ...base.eval, bWin: 0.6, bLead: 1, candidates } };
    expect(searchedValue(sharp.eval).bWin).toBeCloseTo((0.6 + 6 * 0.2 + 3 * 0.18) / 10, 6);
    expect(balancedItems([sharp])).toEqual([]);
    // Without a search, the value after the best one-ply candidate decides.
    expect(searchedValue(base.eval).bWin).toBeCloseTo(0.62, 6);
    expect(balancedItems([base]).map((x) => x.id)).toEqual(['sharp']);
    const noCands = { ...base.eval, candidates: undefined };
    expect(searchedValue(noCands)).toEqual({ bWin: 0.6, bLead: 3 });
    // White to move: candidate values are White's, the result is Black's.
    const w = searchedValue({ bWin: 0.4, bLead: -1, toPlay: 2, candidates: [{ loc: 0, prior: 0, winrate: 0.8, scoreLead: 5, visits: 3 }] });
    expect(w.bWin).toBeCloseTo(1 - (0.6 + 3 * 0.8) / 4, 6);
    expect(w.bLead).toBeCloseTo(-(1 + 3 * 5) / 4, 6);
  });

  /** Black on G3 is worth 8 points to Black however the game goes on: one clear answer to find. */
  class ClearBest extends FakeEngine {
    async evalRaw(req: EngineRequest, ownership: boolean) {
      const r = await super.evalRaw(req, ownership);
      r.policyLogits[at('G3')] = 0.5;
      if (req.moves.some((m) => m.loc === at('G3') && m.color === 1)) r.value[4] += req.toPlay === 1 ? 0.4 : -0.4;
      return r;
    }
  }

  it('drops engine variations that tip the game past the limit', async () => {
    // Worth asking in every other way, so only the winrate limit can drop it.
    class Lopsided extends ClearBest {
      async evalRaw(req: EngineRequest, ownership: boolean) {
        const r = await super.evalRaw(req, ownership);
        r.value[0] = 4; // the side to move is winning ~98%
        return r;
      }
    }
    expect(await makeVariation(item('v1'), new Lopsided(), () => 0.3, 32)).toBeNull();
    expect(await makeVariation(item('v2'), new ClearBest(), () => 0.3, 32)).not.toBeNull();
  });

  it('drops engine variations with nothing at stake', async () => {
    // The plain fake engine rates every move the same: no answer to find.
    expect(await makeVariation(item('v3'), new FakeEngine(), () => 0.3, 32)).toBeNull();
    const source = { ...item('v4'), played: { loc: at('B8'), scoreLoss: 9.2, winrateLoss: 0.32, policy: 0.01, byPlayer: true } };
    const v = await makeVariation(source, new ClearBest(), () => 0.3, 32);
    // A new position: the source game's move and what it cost do not carry over.
    expect(v!.played).toBeUndefined();
    expect(isWorthDrilling(v!)).toBe(true);
  });
});
