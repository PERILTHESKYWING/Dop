import { describe, expect, it } from 'vitest';
import { gradeAnswer, gradeOf } from '../src/lib/forge/grading';
import { buildBlindSet, newMastery, pickItem, scoreBlindTest, updateMastery } from '../src/lib/forge/scheduler';
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
