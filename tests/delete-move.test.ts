import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, deleteGames, resetDbHandle, TOMBSTONES } from '../src/lib/db/db';
import { exportSnapshot, mergeSnapshot, type Snapshot } from '../src/lib/sync/snapshot';
import { guessOpponentName, opponentSide } from '../src/lib/games';
import type { GameRecord } from '../src/lib/types';

const game = (id: string, over: Partial<GameRecord> = {}): GameRecord => ({
  id,
  source: 'user',
  fileName: `${id}.sgf`,
  sgf: '',
  size: 19,
  komi: 6.5,
  handicap: 0,
  setup: [],
  moves: [],
  black: 'xiao',
  white: 'rival',
  playerColor: 1,
  importedAt: 1000,
  status: 'done',
  warnings: [],
  progress: { fast: 0, deep: 0, deepTotal: 0, total: 1 },
  ...over,
});

const snap = (games: GameRecord[], kv: unknown[] = []): Snapshot => ({ app: 'doppelganger', format: 1, exportedAt: Date.now(), stores: { games, kv } });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbHandle();
});

describe('deleting games syncs', () => {
  it('a game deleted here does not come back from the account', async () => {
    await (await db()).put('games', game('g1'));
    await deleteGames(['g1']);
    const r = await mergeSnapshot(snap([game('g1')]));
    expect(await (await db()).get('games', 'g1')).toBeUndefined();
    expect(r.added).toBe(0);
  });

  it('a game deleted on another device is deleted here', async () => {
    await (await db()).put('games', game('g1'));
    await (await db()).put('games', game('g2'));
    const r = await mergeSnapshot(snap([game('g2')], [{ key: TOMBSTONES, value: { 'games/g1': 5000 } }]));
    expect(r.removed).toBe(1);
    expect(await (await db()).get('games', 'g1')).toBeUndefined();
    expect(await (await db()).get('games', 'g2')).toBeDefined();
    // The deletion travels on in this browser's next upload.
    const out = await exportSnapshot();
    expect((out.stores.kv as { key: string; value: Record<string, number> }[]).find((r) => r.key === TOMBSTONES)?.value['games/g1']).toBe(5000);
  });

  it('a game imported again after deleting it stays', async () => {
    const r = await mergeSnapshot(snap([game('g1', { importedAt: 9000 })], [{ key: TOMBSTONES, value: { 'games/g1': 5000 } }]));
    expect(r.added).toBe(1);
    expect(await (await db()).get('games', 'g1')).toBeDefined();
  });

  it('a moved game wins over the unmoved copy', async () => {
    await (await db()).put('games', game('g1'));
    await mergeSnapshot(snap([game('g1', { source: 'opponent', opponentId: 'opp-1', playerColor: null, updatedAt: 2000 })]));
    expect((await (await db()).get('games', 'g1'))?.source).toBe('opponent');
  });
});

describe('finding the opponent in a moved game', () => {
  it('uses the opponent name, then the side the user did not play, then the user names', () => {
    expect(opponentSide(game('a'), ['Rival'], ['xiao'])).toBe(2);
    expect(opponentSide(game('a', { black: 'p', white: 'q', playerColor: 2 }), [], [])).toBe(1);
    expect(opponentSide(game('a', { black: 'p', white: 'xiao', playerColor: null }), [], ['XIAO'])).toBe(1);
    expect(opponentSide(game('a', { black: 'p', white: 'q', playerColor: null }), [], ['xiao'])).toBeNull();
  });

  it('guesses the name that recurs on the opponent side', () => {
    const gs = [game('a'), game('b', { black: 'rival', white: 'xiao', playerColor: 2 }), game('c', { black: 'other', white: 'rival', playerColor: null })];
    expect(guessOpponentName(gs, ['xiao'])).toBe('rival');
  });
});
