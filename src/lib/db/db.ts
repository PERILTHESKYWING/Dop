import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DoppelModel } from '../profile/doppel';
import type { DatasetMeta, LiteModelRecord } from '../lab/model';
import type {
  Attempt,
  BlindTest,
  GameAnalysis,
  GameRecord,
  OpponentProfile,
  PlayerProfile,
  PositionEval,
  Settings,
  TrainingItem,
  Weakness,
  WeaknessMastery,
} from '../types';
import type { AnalysisStore } from '../analysis/pipeline';

interface KV {
  key: string;
  value: unknown;
}

interface DopDB extends DBSchema {
  games: { key: string; value: GameRecord; indexes: { source: string } };
  analyses: { key: string; value: GameAnalysis };
  positions: { key: string; value: PositionEval };
  weaknesses: { key: string; value: Weakness };
  items: { key: string; value: TrainingItem; indexes: { weaknessId: string } };
  attempts: { key: string; value: Attempt; indexes: { weaknessId: string; at: number } };
  mastery: { key: string; value: WeaknessMastery };
  blindTests: { key: string; value: BlindTest };
  opponents: { key: string; value: OpponentProfile };
  profile: { key: string; value: PlayerProfile };
  doppel: { key: number; value: DoppelModel };
  labModels: { key: string; value: LiteModelRecord };
  datasets: { key: string; value: DatasetMeta };
  settings: { key: string; value: Settings };
  kv: { key: string; value: KV };
}

const DB_NAME = 'doppelganger';
const DB_VERSION = 1;

let dbp: Promise<IDBPDatabase<DopDB>> | null = null;

export function db(): Promise<IDBPDatabase<DopDB>> {
  if (!dbp) {
    dbp = openDB<DopDB>(DB_NAME, DB_VERSION, {
      upgrade(d) {
        const games = d.createObjectStore('games', { keyPath: 'id' });
        games.createIndex('source', 'source');
        d.createObjectStore('analyses', { keyPath: 'gameId' });
        d.createObjectStore('positions', { keyPath: 'key' });
        d.createObjectStore('weaknesses', { keyPath: 'id' });
        const items = d.createObjectStore('items', { keyPath: 'id' });
        items.createIndex('weaknessId', 'weaknessId');
        const attempts = d.createObjectStore('attempts', { keyPath: 'id' });
        attempts.createIndex('weaknessId', 'weaknessId');
        attempts.createIndex('at', 'at');
        d.createObjectStore('mastery', { keyPath: 'weaknessId' });
        d.createObjectStore('blindTests', { keyPath: 'id' });
        d.createObjectStore('opponents', { keyPath: 'id' });
        d.createObjectStore('profile', { keyPath: 'id' });
        d.createObjectStore('doppel', { keyPath: 'version' });
        d.createObjectStore('labModels', { keyPath: 'id' });
        d.createObjectStore('datasets', { keyPath: 'id' });
        d.createObjectStore('settings', { keyPath: 'id' });
        d.createObjectStore('kv', { keyPath: 'key' });
      },
      blocked() {
        console.warn('database upgrade blocked by another tab');
      },
    });
    dbp.catch(() => {
      dbp = null;
    });
  }
  return dbp;
}

/** Test hook: forget the open connection (fake-indexeddb resets). */
export function resetDbHandle() {
  dbp = null;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('kv', key))?.value as T | undefined;
}

export async function kvSet(key: string, value: unknown) {
  await (await db()).put('kv', { key, value });
}

/** IndexedDB-backed store for the analysis pipeline (position cache + checkpoints). */
export const idbAnalysisStore: AnalysisStore = {
  async getCached(key) {
    return (await db()).get('positions', key);
  },
  async putCached(e) {
    await (await db()).put('positions', e);
  },
  async loadAnalysis(id) {
    return (await db()).get('analyses', id);
  },
  async saveAnalysis(a) {
    await (await db()).put('analyses', a);
  },
  async saveGame(g) {
    await (await db()).put('games', g);
  },
};

export async function clearAll() {
  const d = await db();
  const stores = [...d.objectStoreNames];
  const tx = d.transaction(stores, 'readwrite');
  await Promise.all(stores.map((s) => tx.objectStore(s).clear()));
  await tx.done;
}

export async function deleteGames(ids: string[]) {
  const d = await db();
  const tx = d.transaction(['games', 'analyses'], 'readwrite');
  for (const id of ids) {
    await tx.objectStore('games').delete(id);
    await tx.objectStore('analyses').delete(id);
  }
  await tx.done;
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}
