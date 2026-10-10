import { positionKey, type PositionSpec } from '../lib/analysis/analyzer';
import { db, kvGet, kvSet } from '../lib/db/db';
import type { SearchSnapshot } from '../lib/engine/mcts';
import type { Candidate, PositionEval } from '../lib/types';
import { setSharedAnswer } from './brain';

/**
 * Shared results: deep analyses of single positions (live analysis on the PC, deep reads
 * anywhere) kept so that another of the user's devices can show them instead of searching
 * again. Whole games' analyses already travel with the account; this covers the positions
 * looked at on the study board and in live analysis.
 *
 * Each device keeps its own list under its own key (`shared:<device>`) in the key-value
 * store, which the account sync and the backup file carry, so devices never overwrite each
 * other's lists; every device reads all of them.
 */

/** Deep enough to be worth sharing. */
export const SHARE_MIN_VISITS = 1000;
const MAX_ROWS = 4000;

export interface SharedRow {
  /** Position key, the same on every device and network. */
  k: string;
  toPlay: 1 | 2;
  bWin: number;
  bLead: number;
  visits: number;
  /** Who searched it (network). */
  by: string;
  c: Candidate[];
  at: number;
}

const DEVICE = 'dop.deviceId';
function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE);
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      localStorage.setItem(DEVICE, id);
    }
    return id;
  } catch {
    return 'here';
  }
}

export const sharedKey = (spec: Pick<PositionSpec, 'board' | 'toPlay' | 'komi' | 'history' | 'size' | 'setup'>) => positionKey(spec as PositionSpec, 'shared');

let index: Map<string, SharedRow> | null = null;
let mine: SharedRow[] | null = null;

async function load(): Promise<Map<string, SharedRow>> {
  if (index) return index;
  const map = new Map<string, SharedRow>();
  try {
    const rows = (await (await db()).getAll('kv')) as { key: string; value: unknown }[];
    for (const r of rows) {
      if (!r.key.startsWith('shared:') || !Array.isArray(r.value)) continue;
      for (const row of r.value as SharedRow[]) {
        const old = map.get(row.k);
        if (!old || row.visits > old.visits) map.set(row.k, row);
      }
    }
    mine = (await kvGet<SharedRow[]>(`shared:${deviceId()}`)) ?? [];
  } catch {
    mine = [];
  }
  index = map;
  return map;
}

/** Forget what was read (after an account sync brought in other devices' lists). */
export function reloadShared() {
  index = null;
  mine = null;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Keep a deep live result for the user's other devices. */
export async function shareSnapshot(key: string, snap: SearchSnapshot, by: string) {
  if (snap.visits < SHARE_MIN_VISITS) return;
  const map = await load();
  const old = map.get(key);
  if (old && old.visits >= snap.visits) return;
  const row: SharedRow = {
    k: key,
    toPlay: snap.toPlay,
    bWin: Math.round(snap.bWin * 1e4) / 1e4,
    bLead: Math.round(snap.bLead * 100) / 100,
    visits: snap.visits,
    by,
    c: snap.candidates.slice(0, 8).map((c) => ({ loc: c.loc, prior: Math.round(c.prior * 1e4) / 1e4, winrate: Math.round(c.winrate * 1e4) / 1e4, scoreLead: Math.round(c.scoreLead * 100) / 100, visits: c.visits, pv: c.pv.slice(0, 12) })),
    at: Date.now(),
  };
  map.set(key, row);
  mine = [...(mine ?? []).filter((r) => r.k !== key), row].slice(-MAX_ROWS);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void kvSet(`shared:${deviceId()}`, mine).catch(() => {}), 3000);
}

/** A shared result for this position, or null. */
export async function sharedRow(key: string): Promise<SharedRow | null> {
  return (await load()).get(key) ?? null;
}

/** A shared result as a live-analysis result. */
export function sharedSnapshot(r: SharedRow, size: number): SearchSnapshot {
  const hw = size * size;
  const policy = new Float32Array(hw + 1);
  for (const c of r.c) policy[c.loc < 0 ? hw : c.loc] = c.prior;
  return {
    toPlay: r.toPlay,
    visits: r.visits,
    bWin: r.bWin,
    bLead: r.bLead,
    candidates: r.c.map((c) => ({ loc: c.loc, visits: c.visits ?? 0, winrate: c.winrate ?? 0.5, scoreLead: c.scoreLead ?? 0, prior: c.prior, pv: c.pv ?? [c.loc] })),
    policy,
    ownership: null,
    nodes: 0,
    evalsPerSec: 0,
    elapsedMs: 0,
    settled: true,
  };
}

/** For game analysis (pipeline.ts `known`): a shared result as a stored analysis. */
async function sharedAnswer(spec: PositionSpec, fast: PositionEval): Promise<PositionEval | null> {
  const r = await sharedRow(sharedKey(spec));
  if (!r || r.toPlay !== spec.toPlay) return null;
  const net = fast.net ?? (fast.searched ? undefined : { bWin: fast.bWin, bLead: fast.bLead });
  return {
    ...fast,
    ...(net ? { net } : {}),
    bWin: r.bWin,
    bLead: r.bLead,
    candidates: r.c,
    bestLoc: r.c[0]?.loc ?? fast.bestLoc,
    pv: r.c[0]?.pv ?? [],
    visits: r.visits,
    depth: 'deep',
    searched: true,
    source: 'shared',
    analyzedAt: r.at,
  };
}

setSharedAnswer(sharedAnswer);
