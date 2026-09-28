import { symmetric } from '../go/coords';
import { PASS, type Loc } from '../go/types';
import { candidatesAt, decodeMoves, type BroadcastFile, type BroadcastGame, type EngineCandidate } from './data';
import { classifyMove, lossFromEvals, type EvalSummary, type MoveClass } from '../coach/classify';

/**
 * The broadcast schedule. There is no game server: every visitor computes the same
 * schedule from the wall clock, so everyone sees the same move on the same table at the
 * same moment, and bets settle the same way everywhere.
 *
 * Each table plays the whole pool in one fixed order, one move every MOVE_MS, with a
 * short break between games. The tables are spread evenly around that cycle, so at any
 * moment some are in the opening, some in the middle game and some in the endgame. Each
 * time a game comes round again it is shown in another of the board's 8 symmetries,
 * between two other players.
 */

export const MOVE_MS = 3000;
export const BREAK_MS = 20_000;
/** Once the losing side drops under the viewer's floor, the game stays up this long, then goes. */
export const LEAVE_MS = 10_000;
/** Games that drop under the floor this early are left out rather than flashing past. */
export const MIN_CUT_MOVES = 20;
export const TABLES = 8;
/** The day the broadcast began; changing it reshuffles every table. */
export const EPOCH = Date.UTC(2026, 8, 1);

export const PLAYERS = [
  'Hoshi', 'Komoku', 'Tengen', 'Sansan', 'Takamoku', 'Mokuhazushi', 'Tesuji', 'Miai', 'Sente', 'Moyo',
  'Hane', 'Aji', 'Kikashi', 'Shinogi', 'Nozoki', 'Tsuke', 'Kosumi', 'Keima', 'Ogeima', 'Seki',
];

export type Phase = 'opening' | 'middle' | 'endgame' | 'finished';

export const PHASE_LABEL: Record<Phase, string> = { opening: 'Opening', middle: 'Middle game', endgame: 'Endgame', finished: 'Finished' };

export interface Schedule {
  pool: BroadcastFile;
  /** The minimum losing-side winrate, in percent (0: no floor). */
  floor: number;
  order: number[];
  /** Per slot in `order`: the move before which the losing side first drops under the floor, or null. */
  cuts: (number | null)[];
  /** Start of each game within the cycle, in the cycle's order, and the cycle length. */
  offsets: number[];
  cycle: number;
}

export const movesOf = (g: BroadcastGame) => g.wr.length - 1;
const slotMs = (g: BroadcastGame, cut: number | null) => (cut === null ? movesOf(g) * MOVE_MS + BREAK_MS : cut * MOVE_MS + LEAVE_MS);

/**
 * The number of moves on the board when the losing side's winrate first falls under
 * `floorPct`, or null if it never does before the game ends.
 */
export function cutOf(g: BroadcastGame, floorPct: number): number | null {
  if (floorPct <= 0) return null;
  const f = floorPct * 10; // per mille
  for (let i = 0; i < g.wr.length - 1; i++) if (Math.min(g.wr[i], 1000 - g.wr[i]) < f) return i;
  return null;
}

/**
 * The schedule for one floor. Every viewer at the same floor computes the same one. A game
 * whose losing side drops under the floor ends LEAVE_MS after it does and the table moves
 * on; games that drop under it within the first MIN_CUT_MOVES are left out altogether.
 */
export function makeSchedule(pool: BroadcastFile, floorPct = 0): Schedule {
  // A fixed shuffle so neighbouring tables don't show games generated side by side.
  const all = pool.games.map((_, i) => i).sort((a, b) => hash(`o${a}`) - hash(`o${b}`) || a - b);
  const cutAll = new Map(all.map((i) => [i, cutOf(pool.games[i], floorPct)]));
  const order = all.filter((i) => {
    const c = cutAll.get(i)!;
    return c === null || c >= MIN_CUT_MOVES;
  });
  const cuts = order.map((i) => cutAll.get(i)!);
  const offsets: number[] = [];
  let t = 0;
  order.forEach((i, k) => {
    offsets.push(t);
    t += slotMs(pool.games[i], cuts[k]);
  });
  return { pool, floor: floorPct, order, cuts, offsets, cycle: Math.max(t, 1) };
}

/** A game as it is shown on one table at one time. */
export interface LiveGame {
  /** Identifies this showing (table, cycle, game): the key bets are placed on. */
  key: string;
  table: number;
  game: BroadcastGame;
  /** The symmetry it is shown in (coords.ts symmetric). */
  sym: number;
  black: string;
  white: string;
  /** Wall-clock start, and when the last move lands. */
  start: number;
  end: number;
  total: number;
  /** Moves on the board now. */
  shown: number;
  phase: Phase;
  /** Milliseconds until the next move (or until the next game during the break). */
  nextIn: number;
  /** When the losing side has dropped under the floor: which side, and ms until the game goes. */
  leaving: { side: 1 | 2; in: number } | null;
}

/** FNV-1a: a small, stable hash so every browser picks the same. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function pick(seed: string, n: number) {
  return hash(seed) % n;
}

export function tableAt(s: Schedule, table: number, now: number): LiveGame {
  const shift = Math.floor((table * s.cycle) / TABLES);
  const t = now - EPOCH + shift;
  const cycleNo = Math.floor(t / s.cycle);
  const pos = t - cycleNo * s.cycle;
  // The last slot starting at or before pos.
  let lo = 0, hi = s.offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s.offsets[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  const gi = s.order[lo];
  const game = s.pool.games[gi];
  const start = now - (pos - s.offsets[lo]);
  const total = movesOf(game);
  const elapsed = now - start;
  const shown = Math.min(total, Math.floor(elapsed / MOVE_MS));
  const cut = s.cuts[lo];
  const key = s.floor ? `${table}:${cycleNo}:${lo}:f${s.floor}` : `${table}:${cycleNo}:${lo}`;
  const b = pick(`${key}:b:${game.id}`, PLAYERS.length);
  let w = pick(`${key}:w:${game.id}`, PLAYERS.length - 1);
  if (w >= b) w++;
  const end = start + total * MOVE_MS;
  return {
    key,
    table,
    game,
    sym: pick(`${key}:s:${game.id}`, 8),
    black: PLAYERS[b],
    white: PLAYERS[w],
    start,
    end,
    total,
    shown,
    phase: phaseOf(shown, total),
    nextIn: shown < total ? MOVE_MS - (elapsed % MOVE_MS) : end + BREAK_MS - now,
    leaving: cut !== null && shown >= cut ? { side: game.wr[cut] < 500 ? 1 : 2, in: Math.max(0, start + cut * MOVE_MS + LEAVE_MS - now) } : null,
  };
}

export function phaseOf(shown: number, total: number): Phase {
  if (shown >= total) return 'finished';
  if (shown < 50) return 'opening';
  if (shown >= 170 || (total - shown <= 40 && shown >= 120)) return 'endgame';
  return 'middle';
}

export function allTables(s: Schedule, now: number): LiveGame[] {
  return Array.from({ length: TABLES }, (_, t) => tableAt(s, t, now));
}

/** The floor a showing's key was made under (keys carry it so a showing can be found again). */
export function floorOfKey(key: string): number {
  const f = key.split(':')[3];
  return f?.startsWith('f') ? Number(f.slice(1)) || 0 : 0;
}

/** A showing by its key, if it is still in the schedule (it may have been refreshed). */
export function findShowing(s: Schedule, key: string, gameId: string): LiveGame | null {
  const [table, cycleNo, slot] = key.split(':').slice(0, 3).map(Number);
  if (floorOfKey(key) !== s.floor || !(slot >= 0 && slot < s.order.length)) return null;
  const game = s.pool.games[s.order[slot]];
  if (!game || game.id !== gameId) return null;
  const shift = Math.floor((table * s.cycle) / TABLES);
  const start = EPOCH - shift + cycleNo * s.cycle + s.offsets[slot];
  const g = tableAt(s, table, start);
  return g.key === key ? g : null;
}

/** The game's moves in the symmetry it is shown in. */
export function showingMoves(g: LiveGame): Loc[] {
  return decodeMoves(g.game.moves, g.game.size).map((l) => (l === PASS ? PASS : symmetric(l, g.game.size, g.sym)));
}

export function showingCandidates(g: LiveGame, index: number): EngineCandidate[] {
  return candidatesAt(g.game, index).map((c) => ({ ...c, loc: c.loc === PASS ? PASS : symmetric(c.loc, g.game.size, g.sym) }));
}

/** Black's winrate and lead with `shown` moves on the board. */
export function valueAt(g: BroadcastGame, shown: number) {
  const i = Math.max(0, Math.min(g.wr.length - 1, shown));
  return { bWin: g.wr[i] / 1000, bLead: g.lead[i] / 10 };
}

export const winnerOf = (g: BroadcastGame): 1 | 2 => (g.result.startsWith('B') ? 1 : 2);

/**
 * The class of move `i` of a broadcast game (Best, Excellent, Great...), from what the
 * engine read before it and the value after it. Book and Brilliant need lookups the
 * broadcast skips.
 */
export function moveClassAt(g: LiveGame, moves: readonly Loc[], i: number): MoveClass | null {
  const summary = (j: number): EvalSummary | null => {
    if (j < 0 || j >= g.game.wr.length) return null;
    const cands = showingCandidates(g, j);
    const v = valueAt(g.game, j);
    return { toPlay: j % 2 === 0 ? 1 : 2, bWin: v.bWin, bLead: v.bLead, visits: Math.max(2, cands.reduce((a, c) => a + c.visits, 0)), cands };
  };
  const parent = summary(i);
  const loc = moves[i];
  if (!parent || loc === undefined || loc === PASS) return null;
  const loss = lossFromEvals(parent, loc, summary(i + 1));
  if (!loss) return null;
  const grand = summary(i - 1);
  const prev = grand && moves[i - 1] !== undefined && moves[i - 1] !== PASS ? lossFromEvals(grand, moves[i - 1], parent) : null;
  return classifyMove({ ...loss, prev });
}
