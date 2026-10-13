import { addTombstones, db, kvGet, kvSet, markChanged, tombKey } from '../db/db';
import { blankKifu, type Kifu } from './kifu';

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
  await addTombstones([tombKey('kv', PREFIX + id)]);
  markChanged();
}

export const loadDraft = () => kvGet<Kifu>(DRAFT);
// Stamped when written, so the newest draft wins when an account merges two devices.
export const saveDraft = (k: Kifu) => kvSet(DRAFT, { ...k, updatedAt: Date.now() });
/** An empty draft rather than a deletion, so an older draft from the account can't come back. */
export const clearDraft = () => saveDraft(blankKifu());

