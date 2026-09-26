import { describe, expect, it } from 'vitest';
import { fmtElo, milestones, type GenerationView, type TrainerHistory } from '../src/lib/trainer/client';

const gen = (n: number, elo: number | null, created = 1000 + n): GenerationView => ({
  gen: n,
  label: `gen${n}`,
  name: `dop-s${n}-d${n}`,
  created,
  trainSamples: n * 1000,
  dataRows: n * 500,
  selfplayGames: n * 100,
  rated: elo !== null,
  playable: true,
  elo,
  se: 40,
});

const history = (gens: GenerationView[], extra: Partial<TrainerHistory> = {}): TrainerHistory => ({
  generations: gens,
  references: [{ label: 'gen0', name: 'Untrained', elo: 0, se: 0 }],
  pairs: [],
  ratingVisits: 100,
  ratingBoardSize: 19,
  ...extra,
});

describe('trainer milestones', () => {
  it('marks Elo milestones at the first generation that reaches them', () => {
    const ms = milestones(history([gen(1, 120), gen(2, 260), gen(3, 240), gen(4, 530)]));
    const by = Object.fromEntries(ms.map((m) => [m.id, m]));
    expect(by['first-net'].gen).toBe('gen1');
    expect(by.e200.gen).toBe('gen2');
    expect(by.e500.gen).toBe('gen4');
    expect(by.e1000.reachedAt).toBeNull();
  });

  it('counts a first win against a reference from the match pairs, either way round', () => {
    const h = history([gen(1, 100), gen(2, 300)], {
      references: [
        { label: 'gen0', name: 'Untrained', elo: 0, se: 0 },
        { label: 'ref-policy', name: 'Reference instinct', elo: 900, se: 120 },
      ],
      pairs: [
        { a: 'gen1', b: 'ref-policy', a_wins: 0, b_wins: 8 },
        { a: 'gen2', b: 'ref-policy', a_wins: 1, b_wins: 7 },
      ],
    });
    const win = milestones(h).find((m) => m.id === 'ref-policy-win')!;
    expect(win.gen).toBe('gen2');
    expect(milestones(h).find((m) => m.id === 'ref-policy-par')!.reachedAt).toBeNull();
  });

  it('formats Elo with a sign', () => {
    expect(fmtElo(123.6)).toBe('+124');
    expect(fmtElo(-40.2)).toBe('-40');
    expect(fmtElo(0)).toBe('0');
    expect(fmtElo(null)).toBe('–');
  });
});
