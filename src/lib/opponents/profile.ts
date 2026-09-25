import { allPositions } from '../go/board';
import { chebyshev, lineOf, symmetric, xy } from '../go/coords';
import { buildContext, pointFeatures } from '../go/features';
import { PASS, type Color, type Loc } from '../go/types';
import { decodeOwnership } from '../engine/parse';
import type { GameAnalysis, GameRecord } from '../types';
import { computeMoveRecords } from '../analysis/records';
import { mean } from '../util/stats';

export interface SequenceStat {
  key: string;
  /** Moves in canonical orientation (top-left corner), for display. */
  moves: { loc: Loc; color: Color }[];
  count: number;
}

export interface OpponentStats {
  games: number;
  moves: number;
  asBlack: number;
  wins: number;
  resignations: number;
  avgLength: number;
  firstMoves: { label: string; count: number }[];
  openingSequences: SequenceStat[];
  joseki: SequenceStat[];
  fighting: { contactRate: number; atariRate: number; capturesPerGame: number; localResponseRate: number };
  invasions: { perGame: number; reductionsPerGame: number; firstInvasionMove: number | null; threeThreeRate: number };
  strategy: { lowRate: number; highRate: number; tenukiRate: number; cornerRate: number };
  accuracy?: { avgScoreLoss: number; mistakeRate: number; analysedMoves: number };
  notes: string[];
}

const POINT_NAMES: Record<string, string> = {
  '4-4': '4-4 (hoshi)',
  '3-4': '3-4 (komoku)',
  '3-3': '3-3 (sansan)',
  '3-5': '3-5 (mokuhazushi)',
  '4-5': '4-5 (takamoku)',
  '5-5': '5-5',
};

function cornerPointLabel(loc: Loc, size: number): string | null {
  const [x, y] = xy(loc, size);
  const a = Math.min(x, size - 1 - x) + 1;
  const b = Math.min(y, size - 1 - y) + 1;
  if (a > 5 || b > 5) return null;
  const k = `${Math.min(a, b)}-${Math.max(a, b)}`;
  return POINT_NAMES[k] ?? k;
}

/** Which corner (0..3) a point belongs to, if it is inside a corner's 9x9 area. */
function cornerOf(loc: Loc, size: number): number | null {
  const [x, y] = xy(loc, size);
  const lim = Math.ceil(size * 0.45);
  const left = x < lim, right = x >= size - lim, top = y < lim, bottom = y >= size - lim;
  if (top && left) return 0;
  if (top && right) return 1;
  if (bottom && left) return 2;
  if (bottom && right) return 3;
  return null;
}

/** Map a corner's moves to the top-left corner and pick the lexicographically smallest of the diagonal flip. */
function canonicalCornerSeq(moves: { loc: Loc; color: Color }[], corner: number, size: number, firstColor: Color) {
  const sym = corner === 0 ? 0 : corner === 1 ? 1 : corner === 2 ? 2 : 3;
  const norm = moves.map((m) => ({ loc: symmetric(m.loc, size, sym), color: (m.color === firstColor ? 1 : 2) as Color }));
  const flipped = norm.map((m) => ({ ...m, loc: symmetric(m.loc, size, 4) }));
  const key = (ms: typeof norm) => ms.map((m) => `${m.color}${m.loc}`).join(',');
  return key(norm) <= key(flipped) ? { key: key(norm), moves: norm } : { key: key(flipped), moves: flipped };
}

/**
 * A statistical profile of another player from their games. Works without engine
 * analysis (influence estimates are used); with analysis, accuracy numbers are added.
 * It describes tendencies in the sample, it does not simulate the player.
 */
export function buildOpponentStats(name: string, aliases: string[], games: GameRecord[], analyses: Map<string, GameAnalysis>): OpponentStats {
  const names = new Set([name, ...aliases].map((n) => n.trim().toLowerCase()));
  const firstMoves = new Map<string, number>();
  const openings = new Map<string, SequenceStat>();
  const joseki = new Map<string, SequenceStat>();
  let moves = 0, contact = 0, atari = 0, captures = 0, local = 0, localN = 0;
  let invasions = 0, reductions = 0, low = 0, high = 0, tenuki = 0, tenukiN = 0, corner = 0, threeThree = 0;
  const firstInvasion: number[] = [];
  let asBlack = 0, wins = 0, resign = 0;
  const losses: number[] = [];
  let mistakes = 0, analysed = 0;

  for (const g of games) {
    const color: Color | null = names.has(g.black.trim().toLowerCase()) ? 1 : names.has(g.white.trim().toLowerCase()) ? 2 : null;
    if (!color) continue;
    if (color === 1) asBlack++;
    const res = (g.result ?? '').toUpperCase();
    if (res.startsWith(color === 1 ? 'B+' : 'W+')) wins++;
    if (res.includes('+R')) resign++;
    const boards = allPositions(g.size, g.setup, g.moves);
    const a = analyses.get(g.id);
    let invadedAt: number | null = null;

    // Opening: first 4 own moves as corner-point labels.
    const own = g.moves.map((m, i) => ({ ...m, i })).filter((m) => m.color === color && m.loc !== PASS);
    const firstLabels = own.slice(0, 4).map((m) => cornerPointLabel(m.loc, g.size) ?? 'other');
    if (own[0]) {
      const l = cornerPointLabel(own[0].loc, g.size) ?? 'other';
      firstMoves.set(l, (firstMoves.get(l) ?? 0) + 1);
    }
    const okey = firstLabels.join(' · ');
    if (okey) {
      const s = openings.get(okey) ?? { key: okey, moves: [], count: 0 };
      s.count++;
      openings.set(okey, s);
    }

    // Joseki: the first 6 moves played in each corner in the first 60 moves.
    const perCorner: { loc: Loc; color: Color }[][] = [[], [], [], []];
    for (const m of g.moves.slice(0, 60)) {
      if (m.loc === PASS) continue;
      const c = cornerOf(m.loc, g.size);
      if (c !== null && perCorner[c].length < 6) perCorner[c].push(m);
    }
    perCorner.forEach((seq, c) => {
      if (seq.length < 3 || !seq.some((m) => m.color === color)) return;
      const canon = canonicalCornerSeq(seq, c, g.size, seq[0].color);
      const s = joseki.get(canon.key) ?? { key: canon.key, moves: canon.moves, count: 0 };
      s.count++;
      joseki.set(canon.key, s);
    });

    for (let i = 0; i < g.moves.length; i++) {
      const m = g.moves[i];
      if (m.color !== color || m.loc === PASS) continue;
      moves++;
      const ctx = buildContext(boards[i], decodeOwnership(a?.evals[i]?.ownership));
      const prev = i > 0 ? g.moves[i - 1] : null;
      const lastOpp = prev && prev.color !== color ? prev.loc : null;
      const p = pointFeatures(ctx, m.loc, color, lastOpp);
      if (p.contact) contact++;
      if (p.atari) atari++;
      captures += p.captures;
      if (lastOpp !== null && lastOpp !== PASS && i > 20) {
        localN++;
        tenukiN++;
        if (chebyshev(m.loc, lastOpp, g.size) <= 2) local++;
        if (p.tenuki) tenuki++;
      }
      if (i >= 8 && p.invasion) {
        invasions++;
        if (invadedAt === null) invadedAt = i + 1;
      }
      if (p.reduction) reductions++;
      const line = lineOf(m.loc, g.size);
      if (i < 120 && !p.contact) {
        if (line <= 3) low++;
        else high++;
      }
      if (p.region === 'corner') corner++;
      const [x, y] = xy(m.loc, g.size);
      if (i < 60 && Math.min(x, g.size - 1 - x) === 2 && Math.min(y, g.size - 1 - y) === 2) {
        const hoshi = [symmetric(3 * g.size + 3, g.size, 0), symmetric(3 * g.size + 3, g.size, 1), symmetric(3 * g.size + 3, g.size, 2), symmetric(3 * g.size + 3, g.size, 3)];
        if (hoshi.some((h) => chebyshev(h, m.loc, g.size) === 1 && boards[i].stones[h] !== 0 && boards[i].stones[h] !== color)) threeThree++;
      }
    }
    if (invadedAt !== null) firstInvasion.push(invadedAt);
    if (a) {
      const { records } = computeMoveRecords({ ...g, playerColor: color }, a);
      for (const r of records.filter((r) => r.isPlayer)) {
        analysed++;
        losses.push(r.scoreLoss);
        if (r.scoreLoss >= 2.5) mistakes++;
      }
    }
  }
  const n = Math.max(games.length, 1);
  const sortSeq = (m: Map<string, SequenceStat>) => [...m.values()].sort((a, b) => b.count - a.count).slice(0, 6);
  const stats: OpponentStats = {
    games: games.length,
    moves,
    asBlack,
    wins,
    resignations: resign,
    avgLength: mean(games.map((g) => g.moves.length)),
    firstMoves: [...firstMoves.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    openingSequences: sortSeq(openings),
    joseki: sortSeq(joseki).filter((s) => s.count >= 1),
    fighting: {
      contactRate: moves ? contact / moves : 0,
      atariRate: moves ? atari / moves : 0,
      capturesPerGame: captures / n,
      localResponseRate: localN ? local / localN : 0,
    },
    invasions: {
      perGame: invasions / n,
      reductionsPerGame: reductions / n,
      firstInvasionMove: firstInvasion.length ? Math.round(mean(firstInvasion)) : null,
      threeThreeRate: threeThree / n,
    },
    strategy: {
      lowRate: low + high ? low / (low + high) : 0,
      highRate: low + high ? high / (low + high) : 0,
      tenukiRate: tenukiN ? tenuki / tenukiN : 0,
      cornerRate: moves ? corner / moves : 0,
    },
    accuracy: analysed ? { avgScoreLoss: mean(losses), mistakeRate: mistakes / analysed, analysedMoves: analysed } : undefined,
    notes: [],
  };
  stats.notes = describeOpponent(stats);
  return stats;
}

/** Plain-language tendencies with sample sizes. Typical amateur reference values are rough. */
export function describeOpponent(s: OpponentStats): string[] {
  const out: string[] = [];
  if (s.games < 3) out.push(`Only ${s.games} game${s.games === 1 ? '' : 's'}: treat everything below as anecdotes.`);
  if (s.firstMoves[0] && s.firstMoves[0].count >= 2) out.push(`Usually opens on the ${s.firstMoves[0].label} point (${s.firstMoves[0].count} of ${s.games} games).`);
  if (s.invasions.threeThreeRate >= 0.5) out.push(`Invades at 3-3 under a hoshi stone early (${s.invasions.threeThreeRate.toFixed(1)} per game).`);
  if (s.invasions.perGame >= 1.5) out.push(`Invades often: ${s.invasions.perGame.toFixed(1)} deep invasions per game${s.invasions.firstInvasionMove ? `, first around move ${s.invasions.firstInvasionMove}` : ''}.`);
  if (s.strategy.highRate >= 0.45) out.push(`Plays high: ${Math.round(s.strategy.highRate * 100)}% of non-contact moves are on the 4th line or above.`);
  else if (s.strategy.lowRate >= 0.7) out.push(`Plays low and territorial: ${Math.round(s.strategy.lowRate * 100)}% of non-contact moves on the 3rd line or below.`);
  if (s.fighting.contactRate >= 0.45) out.push(`Likes contact fights: ${Math.round(s.fighting.contactRate * 100)}% of moves touch an opponent stone.`);
  if (s.strategy.tenukiRate >= 0.4) out.push(`Tenukis readily: ${Math.round(s.strategy.tenukiRate * 100)}% of replies are elsewhere on the board.`);
  else if (s.fighting.localResponseRate >= 0.7) out.push(`Answers locally most of the time (${Math.round(s.fighting.localResponseRate * 100)}%). Sente moves tend to work against them.`);
  if (s.accuracy) out.push(`Average loss per analysed move: ${s.accuracy.avgScoreLoss.toFixed(1)} points over ${s.accuracy.analysedMoves} moves.`);
  return out;
}
