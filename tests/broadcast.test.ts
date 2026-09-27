import { describe, expect, it } from 'vitest';
import { decodeMoves, encodeMoves, type BroadcastFile, type BroadcastGame } from '../src/lib/broadcast/data';
import { allTables, BREAK_MS, EPOCH, findShowing, makeSchedule, MOVE_MS, phaseOf, showingMoves, TABLES, tableAt } from '../src/lib/broadcast/schedule';
import { PASS } from '../src/lib/go/types';
import { safeChoices } from '../src/lib/broadcast/choose';

function game(i: number, n: number): BroadcastGame {
  const locs = Array.from({ length: n }, (_, k) => (k * 7 + i) % 361);
  return {
    id: `t-${i}`,
    size: 19,
    komi: 7.5,
    rules: 'chinese',
    moves: encodeMoves(locs, 19),
    wr: Array.from({ length: n + 1 }, (_, k) => 500 + ((k * 13) % 200) - 100),
    lead: Array.from({ length: n + 1 }, () => 5),
    cands: Array.from({ length: n }, (_, k) => [locs[k], 520, 5, 30]),
    result: i % 2 ? 'W+2.5' : 'B+R',
    end: i % 2 ? 'score' : 'resign',
  };
}
const pool: BroadcastFile = { version: 1, generatedAt: '', engine: 'test', games: Array.from({ length: 20 }, (_, i) => game(i, 150 + i * 5)) };

describe('broadcast data', () => {
  it('encodes moves and passes', () => {
    const locs = [0, 18, 360, PASS, 200];
    expect(decodeMoves(encodeMoves(locs, 19), 19)).toEqual(locs);
  });
});

describe('broadcast schedule', () => {
  const s = makeSchedule(pool);
  const now = EPOCH + 123_456_789;

  it('is the same for every visitor at the same moment', () => {
    expect(allTables(makeSchedule(pool), now)).toEqual(allTables(s, now));
  });

  it('shows different games on every table', () => {
    const t = allTables(s, now);
    expect(t).toHaveLength(TABLES);
    expect(new Set(t.map((g) => g.game.id)).size).toBe(TABLES);
  });

  it('plays a move every few seconds and breaks between games', () => {
    const g = tableAt(s, 3, now);
    const later = tableAt(s, 3, now + MOVE_MS);
    if (g.shown < g.total - 1) {
      expect(later.key).toBe(g.key);
      expect(later.shown).toBe(g.shown + 1);
    }
    const end = tableAt(s, 3, g.end + 1000);
    expect(end.key).toBe(g.key);
    expect(end.phase).toBe('finished');
    const next = tableAt(s, 3, g.end + BREAK_MS + 1);
    expect(next.key).not.toBe(g.key);
    expect(next.shown).toBe(0);
  });

  it('finds a showing again from its key, in the same orientation', () => {
    const g = tableAt(s, 5, now);
    const again = findShowing(s, g.key, g.game.id)!;
    expect(again.key).toBe(g.key);
    expect(again.sym).toBe(g.sym);
    expect(again.black).toBe(g.black);
    expect(showingMoves(again)).toEqual(showingMoves(g));
    expect(findShowing(s, g.key, 'another-game')).toBeNull();
  });

  it('names the phase', () => {
    expect(phaseOf(10, 250)).toBe('opening');
    expect(phaseOf(100, 250)).toBe('middle');
    expect(phaseOf(200, 250)).toBe('endgame');
    expect(phaseOf(250, 250)).toBe('finished');
  });
});

describe('move choice in the broadcast games', () => {
  const c = (loc: number, visits: number, winrate: number, scoreLead: number) => ({ loc, visits, winrate, scoreLead, prior: 0.1, pv: [loc] });
  it('keeps only moves that lose next to nothing and were read enough', () => {
    const list = [c(1, 100, 0.55, 1.0), c(2, 40, 0.54, 0.8), c(3, 30, 0.5, -0.5), c(4, 3, 0.56, 1.2)];
    expect(safeChoices(list, 0.5, 0.03).map((x) => x.loc)).toEqual([1, 2]);
  });
});
