import { describe, expect, it } from 'vitest';
import { detectWeaknesses } from '../src/lib/profile/weaknesses';
import { SIGNATURES } from '../src/lib/profile/signatures';
import { record } from './helpers';
import type { MoveRecord } from '../src/lib/types';

/** Records where every signature arises `n` times per game and errors at a given rate. */
function corpus(games: number, errorRate: Record<string, number>, perGame = 10): MoveRecord[] {
  const out: MoveRecord[] = [];
  let k = 0;
  for (let g = 0; g < games; g++) {
    for (const s of SIGNATURES) {
      const rate = errorRate[s.id] ?? 0.05;
      for (let i = 0; i < perGame; i++) {
        const err = (i + g) / perGame < rate || i < Math.round(rate * perGame) ? [s.id] : [];
        out.push(record(`g${g}:${k}`, `g${g}`, k++, [s.id], err, err.length ? 4 : 0));
      }
    }
  }
  return out;
}

describe('weakness detection', () => {
  it('finds a decision the player gets wrong far more often than usual', () => {
    const recs = corpus(6, { local_over_tenuki: 0.6 });
    const ws = detectWeaknesses(recs, { gameOrder: ['g0', 'g1', 'g2', 'g3', 'g4', 'g5'] });
    expect(ws.map((w) => w.signature)).toEqual(['local_over_tenuki']);
    const w = ws[0];
    expect(w.confidence).toBeGreaterThan(0.95);
    expect(w.evidence.length).toBe(w.occurrences);
    expect(w.games).toBe(6);
    expect(w.description).toMatch(/\d+ of \d+/);
  });

  it('does not call a single bad move a weakness', () => {
    const recs = corpus(6, {});
    recs.push(record('x', 'g0', 999, ['too_low'], ['too_low'], 20));
    const ws = detectWeaknesses(recs, { gameOrder: ['g0', 'g1', 'g2', 'g3', 'g4', 'g5'] });
    expect(ws).toEqual([]);
  });

  it('requires evidence from more than one game', () => {
    const recs: MoveRecord[] = [];
    for (let i = 0; i < 8; i++) recs.push(record(`a${i}`, 'g0', i, ['too_low'], ['too_low'], 5));
    expect(detectWeaknesses(recs, { gameOrder: ['g0'] })).toEqual([]);
  });

  it('marks a weakness as improving when recent games are cleaner', () => {
    const recs: MoveRecord[] = corpus(6, { too_low: 0 });
    const order = ['g0', 'g1', 'g2', 'g3', 'g4', 'g5'];
    order.forEach((g, gi) => {
      for (let i = 0; i < 10; i++) {
        const err = gi < 3 ? i < 7 : i < 1;
        recs.push(record(`${g}:t${i}`, g, 500 + i, ['too_low'], err ? ['too_low'] : [], err ? 4 : 0));
      }
    });
    const ws = detectWeaknesses(recs, { gameOrder: order });
    expect(ws[0].status).toBe('improving');
    expect(ws[0].trend.newer).toBeLessThan(ws[0].trend.older);
  });
});
