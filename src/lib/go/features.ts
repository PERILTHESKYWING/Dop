import { Board, type Group } from './board';
import { chebyshev, lineOf, regionOf, xy, zoneOf } from './coords';
import { PASS, type Color, type Loc, other } from './types';
import type { MoveFeatures, Phase, PointFeatures } from '../types';

export type GroupStatus = 'weak' | 'safe' | 'dead' | 'settled';

/**
 * Cheap influence-based ownership estimate (Black positive, -1..1) for when no engine
 * ownership is available (e.g. opponent games that were not analysed).
 */
export function estimateOwnership(board: Board): Float32Array {
  const n = board.size;
  const out = new Float32Array(n * n);
  const R = 4;
  for (let s = 0; s < n * n; s++) {
    const c = board.stones[s];
    if (!c) continue;
    const sign = c === 1 ? 1 : -1;
    const [sx, sy] = xy(s, n);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const x = sx + dx, y = sy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const d = Math.abs(dx) + Math.abs(dy);
        if (d > R) continue;
        out[y * n + x] += sign / (1 + d * d * 0.6);
      }
  }
  for (let i = 0; i < out.length; i++) {
    if (board.stones[i]) out[i] = board.stones[i] === 1 ? Math.max(0.5, Math.tanh(out[i])) : Math.min(-0.5, Math.tanh(out[i]));
    else out[i] = Math.tanh(out[i] * 0.8);
  }
  return out;
}

export function groupStatus(g: Group, own: Float32Array | null): GroupStatus {
  const libs = g.liberties.length;
  const sign = g.color === 1 ? 1 : -1;
  if (own) {
    let sum = 0;
    for (const s of g.stones) sum += own[s] * sign;
    const avg = sum / g.stones.length;
    if (avg < -0.55) return 'dead';
    if (libs <= 2 && g.stones.length >= 2 && avg < 0.9) return 'weak';
    if (avg > 0.75) return g.stones.length >= 3 ? 'safe' : 'settled';
    return 'weak';
  }
  if (libs <= 2) return 'weak';
  if (libs >= 4 && g.stones.length >= 4) return 'safe';
  return 'settled';
}

/** Per-position context shared by all candidate moves. */
export interface PositionContext {
  board: Board;
  size: number;
  own: Float32Array;
  hasEngineOwnership: boolean;
  groups: Group[];
  status: Map<Group, GroupStatus>;
  /** For each colour: points within distance 2 of a weak / safe group of that colour. */
  nearWeak: [Uint8Array, Uint8Array, Uint8Array];
  nearSafe: [Uint8Array, Uint8Array, Uint8Array];
  /** Own small weak groups (<= 3 stones, <= 2 liberties) per colour. */
  smallWeak: [Group[], Group[], Group[]];
  weakCount: [number, number, number];
  hasAtari: boolean;
  certainty: number;
}

function stamp(map: Uint8Array, g: Group, size: number, r = 2) {
  for (const s of g.stones) {
    const [sx, sy] = xy(s, size);
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = sx + dx, y = sy + dy;
        if (x >= 0 && y >= 0 && x < size && y < size) map[y * size + x] = 1;
      }
  }
}

export function buildContext(board: Board, ownership: Float32Array | null): PositionContext {
  const size = board.size;
  const own = ownership ?? estimateOwnership(board);
  const groups = board.groups();
  const status = new Map<Group, GroupStatus>();
  const hw = size * size;
  const nearWeak: [Uint8Array, Uint8Array, Uint8Array] = [new Uint8Array(0), new Uint8Array(hw), new Uint8Array(hw)];
  const nearSafe: [Uint8Array, Uint8Array, Uint8Array] = [new Uint8Array(0), new Uint8Array(hw), new Uint8Array(hw)];
  const smallWeak: [Group[], Group[], Group[]] = [[], [], []];
  const weakCount: [number, number, number] = [0, 0, 0];
  let hasAtari = false;
  for (const g of groups) {
    const st = groupStatus(g, ownership);
    status.set(g, st);
    if (g.liberties.length === 1) hasAtari = true;
    if (st === 'weak' && (g.stones.length >= 2 || g.liberties.length <= 2)) {
      stamp(nearWeak[g.color], g, size);
      weakCount[g.color]++;
    }
    if (st === 'safe') stamp(nearSafe[g.color], g, size);
    if (g.stones.length <= 3 && g.liberties.length <= 2) smallWeak[g.color].push(g);
  }
  let certain = 0;
  for (let i = 0; i < hw; i++) if (Math.abs(own[i]) > 0.7) certain++;
  return {
    board,
    size,
    own,
    hasEngineOwnership: !!ownership,
    groups,
    status,
    nearWeak,
    nearSafe,
    smallWeak,
    weakCount,
    hasAtari,
    certainty: certain / hw,
  };
}

export function phaseOf(moveNumber: number, size: number, certainty: number): Phase {
  const openingEnd = Math.round((size * size) / 9); // 40 on 19x19
  if (moveNumber <= openingEnd) return 'opening';
  if (certainty >= 0.78 || moveNumber >= Math.round(size * size * 0.55)) return 'endgame';
  return 'middlegame';
}

const EMPTY_POINT: PointFeatures = {
  line: 0,
  region: 'center',
  zone: 4,
  distLast: 99,
  local: false,
  tenuki: false,
  contact: false,
  captures: 0,
  atari: false,
  selfAtari: false,
  savesAtari: false,
  extendsSmallWeak: false,
  nearOwnWeak: false,
  nearOppWeak: false,
  nearOwnSafe: false,
  invasion: false,
  reduction: false,
  ownership: 0,
};

/** Features of playing `loc` for `color` in the context. `lastOpp` is the opponent's previous move. */
export function pointFeatures(ctx: PositionContext, loc: Loc, color: Color, lastOpp: Loc | null): PointFeatures {
  if (loc === PASS || loc < 0) return { ...EMPTY_POINT, distLast: lastOpp == null || lastOpp === PASS ? 99 : 99 };
  const { board, size, own } = ctx;
  const opp = other(color);
  const sign = color === 1 ? 1 : -1;
  const distLast = lastOpp == null || lastOpp === PASS ? 99 : chebyshev(loc, lastOpp, size);

  let contact = false;
  let savesAtari = false;
  let extendsSmallWeak = false;
  const adjOwn: Group[] = [];
  for (const q of board.neighbors(loc)) {
    const c = board.stones[q];
    if (c === opp) contact = true;
    if (c === color) {
      const g = board.groupAt(q)!;
      adjOwn.push(g);
      if (g.liberties.length === 1) savesAtari = true;
      if (g.stones.length <= 3 && g.liberties.length <= 2) extendsSmallWeak = true;
    }
  }

  let captures = 0;
  let atari = false;
  let selfAtari = false;
  if (board.stones[loc] === 0) {
    const after = board.clone();
    after.koPoint = PASS;
    const r = after.play(loc, color, true);
    captures = r.captured.length;
    for (const q of after.neighbors(loc)) {
      if (after.stones[q] === opp && after.libertyCount(q) === 1) atari = true;
    }
    const mine = after.groupAt(loc);
    if (mine && mine.liberties.length === 1 && captures === 0) selfAtari = true;
    if (savesAtari && (!mine || mine.liberties.length < 2)) savesAtari = false;
  }
  if (captures > 0) extendsSmallWeak = false;

  // Invasion / reduction: playing into the opponent's sphere without nearby support.
  const o = own[loc] * sign;
  let support = false;
  const [lx, ly] = xy(loc, size);
  for (let dy = -2; dy <= 2 && !support; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const x = lx + dx, y = ly + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      if (board.stones[y * size + x] === color) {
        support = true;
        break;
      }
    }
  const line = lineOf(loc, size);
  const invasion = !support && o < -0.45 && line <= 4;
  const reduction = !invasion && !contact && o < -0.15 && o >= -0.75 && line >= 4;

  return {
    line,
    region: regionOf(loc, size),
    zone: zoneOf(loc, size),
    distLast,
    local: distLast <= 2,
    tenuki: distLast >= 5,
    contact,
    captures,
    atari,
    selfAtari,
    savesAtari,
    extendsSmallWeak,
    nearOwnWeak: !!ctx.nearWeak[color][loc],
    nearOppWeak: !!ctx.nearWeak[opp][loc],
    nearOwnSafe: !!ctx.nearSafe[color][loc] && !ctx.nearWeak[color][loc],
    invasion,
    reduction,
    ownership: o,
  };
}

export function moveFeatures(
  ctx: PositionContext,
  played: Loc,
  best: Loc,
  color: Color,
  lastOpp: Loc | null,
  moveNumber: number,
  leadBefore: number,
): MoveFeatures {
  const p = pointFeatures(ctx, played, color, lastOpp);
  const b = pointFeatures(ctx, best, color, lastOpp);
  const opp = other(color);
  return {
    phase: phaseOf(moveNumber, ctx.size, ctx.certainty),
    moveNumber,
    played: p,
    best: b,
    ownWeakGroups: ctx.weakCount[color],
    oppWeakGroups: ctx.weakCount[opp],
    ownSmallWeakGroups: ctx.smallWeak[color].length,
    hasTactics: ctx.hasAtari || b.captures > 0 || b.atari || b.savesAtari,
    leadBefore,
    sameZoneAsBest: played !== PASS && best !== PASS && p.zone === b.zone,
    distToBest: chebyshev(played, best, ctx.size),
    lastNearOwnSafe: lastOpp != null && lastOpp !== PASS && !!ctx.nearSafe[color][lastOpp] && !ctx.nearWeak[color][lastOpp],
  };
}
