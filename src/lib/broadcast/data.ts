import { PASS, type Loc } from '../go/types';

/**
 * The games the live broadcast plays: KataGo against itself, generated ahead of time by
 * scripts/generate-broadcast.ts and played back on a shared clock (see schedule.ts).
 */

export interface BroadcastGame {
  id: string;
  size: number;
  komi: number;
  rules: string;
  /** Moves as two-letter SGF points, "tt" for a pass. Black moves first. */
  moves: string;
  /** Black's winrate (per mille) and lead (tenths of a point) before each move, and after the last. */
  wr: number[];
  lead: number[];
  /**
   * What the engine considered before each move: up to four candidates as
   * [loc, winrate per mille, lead in tenths (both for the side to move), visits] flattened.
   */
  cands: number[][];
  result: string;
  end: 'score' | 'resign';
}

export interface BroadcastFile {
  version: 1;
  generatedAt: string;
  engine: string;
  games: BroadcastGame[];
}

const A = 'a'.charCodeAt(0);

export function encodeMoves(locs: Loc[], size: number): string {
  return locs.map((l) => (l === PASS ? 'tt' : String.fromCharCode(A + (l % size), A + Math.floor(l / size)))).join('');
}

export function decodeMoves(s: string, size: number): Loc[] {
  const out: Loc[] = [];
  for (let i = 0; i + 1 < s.length; i += 2) {
    const x = s.charCodeAt(i) - A;
    const y = s.charCodeAt(i + 1) - A;
    out.push(x >= size || y >= size ? PASS : y * size + x);
  }
  return out;
}

export interface EngineCandidate {
  loc: Loc;
  winrate: number;
  scoreLead: number;
  visits: number;
}

export function candidatesAt(g: BroadcastGame, index: number): EngineCandidate[] {
  const f = g.cands[index] ?? [];
  const out: EngineCandidate[] = [];
  for (let i = 0; i + 3 < f.length; i += 4) out.push({ loc: f[i], winrate: f[i + 1] / 1000, scoreLead: f[i + 2] / 10, visits: f[i + 3] });
  return out;
}

/**
 * The minimum losing-side winrates a viewer can pick, in percent (0: no minimum). The floor
 * is applied in the browser (schedule.ts): a game leaves its table 10 seconds after the
 * losing side drops under it, and games that drop under it in the opening are skipped.
 */
export const BROADCAST_FLOORS = [0, 10, 20, 25, 30, 35, 40] as const;
export const DEFAULT_FLOOR = 20;

/** Extra pools the "Broadcast games" workflow can add (games-20.json …); merged in when present. */
const EXTRA_POOLS = ['games-20.json', 'games-30.json'];

let loading: Promise<BroadcastFile> | null = null;

async function fetchPool(name: string): Promise<BroadcastFile | null> {
  const r = await fetch(`/broadcast/${name}`);
  // The host answers a missing file with the app's index.html, so check it really is JSON.
  if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
  try {
    const f = (await r.json()) as BroadcastFile;
    return Array.isArray(f?.games) ? f : null;
  } catch {
    return null;
  }
}

/** Every broadcast game there is, fetched once per visit: games.json plus any extra pools. */
export function loadBroadcast(): Promise<BroadcastFile> {
  if (!loading) {
    loading = (async () => {
      const [main, ...extra] = await Promise.all([fetchPool('games.json'), ...EXTRA_POOLS.map((n) => fetchPool(n).catch(() => null))]);
      if (!main) throw new Error('the broadcast games are missing');
      const seen = new Set(main.games.map((g) => g.id));
      const games = [...main.games];
      for (const f of extra) for (const g of f?.games ?? []) if (!seen.has(g.id)) (seen.add(g.id), games.push(g));
      return { ...main, games };
    })();
    loading.catch(() => (loading = null));
  }
  return loading;
}
