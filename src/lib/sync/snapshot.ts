import { db } from '../db/db';

/**
 * Everything worth carrying to another device, as one JSON document: games and their
 * analyses, kifu (in the key-value store), player data (profile, weaknesses, the copy,
 * opponents, practice history) and settings. The position cache and the model lab's
 * datasets are left out: they are large and rebuild themselves.
 */

export const SNAPSHOT_STORES = ['games', 'analyses', 'weaknesses', 'items', 'attempts', 'mastery', 'blindTests', 'opponents', 'profile', 'doppel', 'settings', 'kv'] as const;
type StoreName = (typeof SNAPSHOT_STORES)[number];

export interface Snapshot {
  app: 'doppelganger';
  format: 1;
  exportedAt: number;
  stores: Partial<Record<StoreName, unknown[]>>;
}

export async function exportSnapshot(): Promise<Snapshot> {
  const d = await db();
  const stores: Snapshot['stores'] = {};
  for (const name of SNAPSHOT_STORES) {
    stores[name] = (await d.getAll(name)) as unknown[];
  }
  return { app: 'doppelganger', format: 1, exportedAt: Date.now(), stores };
}

export function isSnapshot(v: unknown): v is Snapshot {
  return !!v && typeof v === 'object' && (v as Snapshot).app === 'doppelganger' && (v as Snapshot).format === 1 && typeof (v as Snapshot).stores === 'object';
}

/** When a row was last changed, from whichever timestamp it carries. */
export function stampOf(row: unknown): number {
  const r = row as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return 0;
  const v = (r.value && typeof r.value === 'object' ? (r.value as Record<string, unknown>) : r) as Record<string, unknown>;
  for (const k of ['updatedAt', 'analyzedAt', 'builtAt', 'trainedAt', 'importedAt', 'at', 'startedAt', 'createdAt']) {
    const t = v[k] ?? r[k];
    if (typeof t === 'number' && Number.isFinite(t)) return t;
  }
  return 0;
}

export interface MergeReport {
  added: number;
  updated: number;
  kept: number;
}

/**
 * Bring a snapshot into this browser without losing anything here: rows this browser lacks
 * are added, rows both have keep whichever was changed last, and nothing is deleted. The
 * settings keep this browser's choices once it has been set up, but learn the player's names.
 */
export async function mergeSnapshot(snap: Snapshot): Promise<MergeReport> {
  const d = await db();
  const report: MergeReport = { added: 0, updated: 0, kept: 0 };
  for (const name of SNAPSHOT_STORES) {
    const rows = snap.stores[name];
    if (!Array.isArray(rows) || !rows.length) continue;
    const tx = d.transaction(name, 'readwrite');
    const store = tx.objectStore(name);
    const keyPath = store.keyPath as string;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const key = (row as Record<string, unknown>)[keyPath] as string | number | undefined;
      if (key === undefined) continue;
      const mine = (await store.get(key as never)) as unknown;
      if (mine === undefined) {
        await store.put(row as never);
        report.added++;
      } else if (name === 'settings') {
        await store.put(mergeSettings(mine as Record<string, unknown>, row as Record<string, unknown>) as never);
        report.kept++;
      } else if (stampOf(row) > stampOf(mine)) {
        await store.put(row as never);
        report.updated++;
      } else report.kept++;
    }
    await tx.done;
  }
  return report;
}

function mergeSettings(mine: Record<string, unknown>, theirs: Record<string, unknown>) {
  // A browser that was never set up takes the account's settings whole.
  const base = mine.onboarded ? { ...theirs, ...mine } : { ...mine, ...theirs };
  const names = [...new Set([...((mine.playerNames as string[]) ?? []), ...((theirs.playerNames as string[]) ?? [])])];
  return { ...base, playerNames: names, onboarded: !!(mine.onboarded || theirs.onboarded) };
}

// ---------------------------------------------------------------- compressed text form

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** A snapshot as gzip'd JSON in base64, split into parts of at most `partSize` characters. */
export async function packSnapshot(snap: Snapshot, partSize: number): Promise<string[]> {
  const gz = await pipe(new TextEncoder().encode(JSON.stringify(snap)), new CompressionStream('gzip'));
  const text = toBase64(gz);
  const parts: string[] = [];
  // Base64 splits safely on multiples of 4 characters.
  const step = partSize - (partSize % 4);
  for (let i = 0; i < text.length; i += step) parts.push(text.slice(i, i + step));
  return parts.length ? parts : [''];
}

export async function unpackSnapshot(parts: string[]): Promise<Snapshot> {
  const bytes = await pipe(fromBase64(parts.join('')), new DecompressionStream('gzip'));
  const v = JSON.parse(new TextDecoder().decode(bytes));
  if (!isSnapshot(v)) throw new Error('this is not a DOPPELGÄNGER backup');
  return v;
}

/** The backup file: the same gzip'd JSON, as a download. */
export async function snapshotFile(snap: Snapshot): Promise<Blob> {
  const gz = await pipe(new TextEncoder().encode(JSON.stringify(snap)), new CompressionStream('gzip'));
  return new Blob([gz as BlobPart], { type: 'application/gzip' });
}

export async function readSnapshotFile(file: Blob): Promise<Snapshot> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // gzip starts with 1f 8b; a plain .json backup is accepted too.
  const text = bytes[0] === 0x1f && bytes[1] === 0x8b ? new TextDecoder().decode(await pipe(bytes, new DecompressionStream('gzip'))) : new TextDecoder().decode(bytes);
  const v = JSON.parse(text);
  if (!isSnapshot(v)) throw new Error('this is not a DOPPELGÄNGER backup');
  return v;
}
