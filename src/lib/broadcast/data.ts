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

let loading: Promise<BroadcastFile> | null = null;

/** The broadcast games (fetched once per visit). */
export function loadBroadcast(): Promise<BroadcastFile> {
  if (!loading) {
    loading = fetch('/broadcast/games.json').then((r) => {
      if (!r.ok) throw new Error(`broadcast games: HTTP ${r.status}`);
      return r.json() as Promise<BroadcastFile>;
    });
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}
