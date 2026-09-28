import { describe, expect, it } from 'vitest';
import { decodeMoves, encodeMoves, type BroadcastFile, type BroadcastGame } from '../src/lib/broadcast/data';
import { allTables, BREAK_MS, cutOf, EPOCH, findShowing, floorOfKey, LEAVE_MS, makeSchedule, MOVE_MS, phaseOf, showingMoves, TABLES, tableAt } from '../src/lib/broadcast/schedule';
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

describe('the losing-side floor', () => {
  // Black's winrate slides from 50% down by 0.5% a move: under 30% before move 41.
  const sliding = (i: number): BroadcastGame => ({ ...game(i, 150), id: `s-${i}`, wr: Array.from({ length: 151 }, (_, k) => Math.max(0, 500 - k * 5)) });
  const early = (i: number): BroadcastGame => ({ ...game(i, 150), id: `e-${i}`, wr: Array.from({ length: 151 }, (_, k) => Math.max(0, 500 - k * 40)) });
  const p: BroadcastFile = { version: 1, generatedAt: '', engine: 'test', games: [...Array.from({ length: 6 }, (_, i) => sliding(i)), early(99)] };

  it('finds when the losing side drops under the floor', () => {
    expect(cutOf(p.games[0], 30)).toBe(41);
    expect(cutOf(p.games[0], 0)).toBeNull();
  });

  it('leaves out games that drop under it in the opening', () => {
    const s = makeSchedule(p, 30);
    expect(s.order.map((i) => p.games[i].id)).not.toContain('e-99');
    expect(s.order).toHaveLength(6);
    expect(makeSchedule(p, 0).order).toHaveLength(7);
  });

  it('shows a game for 10 seconds after it drops under, then moves on', () => {
    const s = makeSchedule(p, 30);
    const g = tableAt(s, 0, EPOCH + 5_000_000);
    const under = g.start + 41 * MOVE_MS;
    const before = tableAt(s, 0, under - 1);
    expect(before.key).toBe(g.key);
    expect(before.leaving).toBeNull();
    const after = tableAt(s, 0, under + 1000);
    expect(after.key).toBe(g.key);
    expect(after.leaving?.side).toBe(1);
    expect(after.leaving!.in).toBe(LEAVE_MS - 1000);
    expect(tableAt(s, 0, under + LEAVE_MS + 1).key).not.toBe(g.key);
  });

  it('finds a showing again only under the same floor', () => {
    const s = makeSchedule(p, 30);
    const g = tableAt(s, 2, EPOCH + 9_000_000);
    expect(floorOfKey(g.key)).toBe(30);
    expect(findShowing(s, g.key, g.game.id)?.key).toBe(g.key);
    expect(findShowing(makeSchedule(p, 20), g.key, g.game.id)).toBeNull();
  });
});
