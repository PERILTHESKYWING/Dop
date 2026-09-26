import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { encodeMoves, type BroadcastFile } from '../src/lib/broadcast/data';
import { makeSchedule, MOVE_MS, tableAt, EPOCH } from '../src/lib/broadcast/schedule';
import { oddsFor, placeBet, settleBets, useWallet, START_COINS } from '../src/state/bets';

const n = 100;
const pool: BroadcastFile = {
  version: 1,
  generatedAt: '',
  engine: 'test',
  games: Array.from({ length: 10 }, (_, i) => ({
    id: `g${i}`,
    size: 19,
    komi: 7.5,
    rules: 'chinese',
    moves: encodeMoves(Array.from({ length: n }, (_, k) => k), 19),
    wr: Array.from({ length: n + 1 }, () => 600),
    lead: Array.from({ length: n + 1 }, () => 20),
    cands: [],
    result: 'B+3.5',
    end: 'score' as const,
  })),
};

describe('betting', () => {
  it('prices the favourite lower than the underdog, with a margin', () => {
    expect(oddsFor(0.5)).toBeCloseTo(1.9, 2);
    expect(oddsFor(0.8)).toBeLessThan(oddsFor(0.2));
    expect(oddsFor(0.999)).toBeGreaterThan(1);
  });

  it('takes the stake, then pays a win when the game ends', () => {
    const s = makeSchedule(pool);
    const now = EPOCH + 5_000_000;
    const g = tableAt(s, 0, now);
    expect(placeBet(g, 1, 100, 0.6)).toBeNull();
    expect(placeBet(g, 2, 50, 0.4)).toBeNull();
    expect(useWallet.getState().wallet.coins).toBe(START_COINS - 150);
    expect(settleBets(s, g.end - MOVE_MS)).toEqual([]);
    const done = settleBets(s, g.end + 1);
    expect(done.map((b) => b.status).sort()).toEqual(['lost', 'won']);
    const w = useWallet.getState().wallet;
    expect(w.coins).toBe(START_COINS - 150 + Math.floor(100 * oddsFor(0.6)));
    expect(w.lost).toBe(50);
    expect(placeBet(g, 1, 1e9, 0.6)).toBe('Not enough coins.');
  });
});
