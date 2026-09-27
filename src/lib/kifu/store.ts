import { db, kvGet, kvSet } from '../db/db';
import type { Kifu } from './kifu';

/** Saved kifu live in the key-value store under "kifu:<id>"; the study board's working copy under "study.draft". */
const PREFIX = 'kifu:';
const DRAFT = 'study.draft';

export async function listKifus(): Promise<Kifu[]> {
  const rows = await (await db()).getAll('kv', IDBKeyRange.bound(PREFIX, PREFIX + '￿'));
  return rows.map((r) => r.value as Kifu).sort((a, b) => b.updatedAt - a.updatedAt);
}

export const getKifu = (id: string) => kvGet<Kifu>(PREFIX + id);

export async function saveKifu(k: Kifu) {
  await kvSet(PREFIX + k.id, { ...k, saved: true });
}

export async function deleteKifu(id: string) {
  await (await db()).delete('kv', PREFIX + id);
}

export const loadDraft = () => kvGet<Kifu>(DRAFT);
export const saveDraft = (k: Kifu) => kvSet(DRAFT, k);
