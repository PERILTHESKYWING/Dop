import { answerLength } from './play';
import type { Problem, ProblemBank, ProblemCategory } from './types';

/** Where the app fetches the bank (built by scripts/problem-bank.ts, grown nightly). */
export const BANK_URL = '/problems/bank.json';

let cached: Promise<ProblemBank> | null = null;

export function loadBank(fetchImpl: typeof fetch = fetch): Promise<ProblemBank> {
  if (!cached) {
    cached = fetchImpl(BANK_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`problem bank: HTTP ${r.status}`);
        return r.json() as Promise<ProblemBank>;
      })
      .catch((e) => {
        cached = null;
        throw e;
      });
  }
  return cached;
}

/** How a problem set is chosen (Forge's settings, in the spirit of 101weiqi's practice settings). */
export interface SetFilter {
  categories: ProblemCategory[];
  /** Level range, rank numbers (1k = 0, 1d = 1, 15k = -14). */
  minLevel: number;
  maxLevel: number;
  /** The side that is behind keeps at least this winrate (0..0.5). */
  minLosingWinrate: number;
  /** Longest answer, in the player's moves (0 = any). */
  maxMoves?: number;
}

export const losingWin = (p: Problem) => Math.min(p.win, 1 - p.win);

export function matches(p: Problem, f: SetFilter): boolean {
  if (!f.categories.includes(p.cat)) return false;
  if (p.level < f.minLevel || p.level > f.maxLevel) return false;
  if (losingWin(p) < f.minLosingWinrate - 1e-9) return false;
  if (f.maxMoves && answerLength(p) > f.maxMoves) return false;
  return true;
}

export interface History {
  /** Last result per problem id. */
  last: Map<string, { at: number; ok: boolean }>;
}

/** A small seeded generator (daily sets are the same all day). */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 2 ** 32;
  };
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Problems missed at least this long ago come back (spaced repetition). */
export const RETRY_AFTER_MS = 20 * 3600_000;

/**
 * Pick `count` problems: first those missed a while ago (at most a quarter of the set), then
 * never-seen ones, then the ones solved longest ago; mixed across the chosen categories and
 * ordered from easier to harder, as a set on 101weiqi climbs.
 */
export function pickSet(bank: readonly Problem[], f: SetFilter, count: number, h: History, rand: () => number = Math.random, now = Date.now()): Problem[] {
  const pool = bank.filter((p) => matches(p, f));
  const missed = shuffle(
    pool.filter((p) => {
      const l = h.last.get(p.id);
      return l && !l.ok && now - l.at > RETRY_AFTER_MS;
    }),
    rand,
  ).slice(0, Math.ceil(count / 4));
  const taken = new Set(missed.map((p) => p.id));
  const unseen = shuffle(pool.filter((p) => !h.last.has(p.id)), rand);
  const seen = pool.filter((p) => h.last.has(p.id) && !taken.has(p.id)).sort((a, b) => h.last.get(a.id)!.at - h.last.get(b.id)!.at);
  // Round-robin over categories so a set is not all one kind.
  const byCat = new Map<ProblemCategory, Problem[]>();
  for (const p of unseen) byCat.set(p.cat, [...(byCat.get(p.cat) ?? []), p]);
  const mixed: Problem[] = [];
  const cats = shuffle([...byCat.keys()], rand);
  while (mixed.length < unseen.length) {
    for (const c of cats) {
      const q = byCat.get(c)!;
      if (q.length) mixed.push(q.shift()!);
    }
  }
  const out = [...missed];
  for (const p of [...mixed, ...seen]) {
    if (out.length >= count) break;
    if (!taken.has(p.id)) {
      out.push(p);
      taken.add(p.id);
    }
  }
  return out.sort((a, b) => a.level - b.level);
}

/** Today's key, in the player's own time zone. */
export const dayKey = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The daily set: 8 problems around the player's level, the same all day. */
export function dailySet(bank: readonly Problem[], level: number, day = dayKey(), minLosingWinrate = 0): Problem[] {
  const seed = [...day].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rand = seeded(seed);
  const f: SetFilter = { categories: ['life', 'tesuji', 'endgame', 'middle'], minLevel: Math.round(level) - 3, maxLevel: Math.round(level) + 2, minLosingWinrate };
  let set = pickSet(bank, f, 8, { last: new Map() }, rand);
  if (set.length < 8) set = pickSet(bank, { ...f, minLevel: f.minLevel - 4, maxLevel: f.maxLevel + 4 }, 8, { last: new Map() }, rand);
  return set;
}

/** How many problems each category and level range has (for the settings page). */
export function countBy(bank: readonly Problem[], f: Omit<SetFilter, 'categories'>): Record<ProblemCategory, number> {
  const out: Record<ProblemCategory, number> = { life: 0, tesuji: 0, endgame: 0, middle: 0 };
  for (const p of bank) if (matches(p, { ...f, categories: [p.cat] })) out[p.cat]++;
  return out;
}
