import { searchedValue } from '../analysis/analyzer';
import { PASS, type Loc } from '../go/types';
import type { Candidate, MoveRecord, PolicyEntry, PositionEval, TrainingItem, TrainingKind } from '../types';
import { DEFAULT_MIN_LOSING_WINRATE, isBalanced } from './balance';

/**
 * Is a position worth drilling?
 *
 * A Forge question is worth the player's time when a wrong move there costs real points
 * and there is an answer to find. Opening moves that differ by half a point, a joseki
 * choice KataGo itself rates almost as highly, or a position where any of four moves is
 * fine teach nothing, so they never become Forge or blind-test questions.
 *
 * The rule, in plain words:
 *  1. Something must be at stake. Positions shown as the player's own error ("original")
 *     need the game move to be a real mistake: at least MIN_STAKES points, or
 *     MIN_STAKES_WINRATE of the winning chances in a close game with at least
 *     WINRATE_PATH_SHARE of the points. Other positions also count when KataGo's other
 *     candidate moves typically (median) lose that much.
 *  2. The early opening (the first EARLY_OPENING_MOVES_19 moves on 19×19, scaled by board
 *     area) needs a much bigger loss: OPENING_MIN_STAKES points (or OPENING_MIN_STAKES_WINRATE).
 *  3. A normal move, one KataGo's network itself plays at least NORMAL_MOVE_POLICY of the
 *     time, is only a mistake from NORMAL_MOVE_MAX_LOSS points: below that it is a joseki
 *     or style choice, or evaluation noise.
 *  4. There must be one lesson. When UNCLEAR_GOOD_MOVES or more candidates are within
 *     NEAR_EQUAL_POINTS of the best, any of them is fine; such a position is only kept
 *     for a real blunder (UNCLEAR_BLUNDER_FACTOR times the bar). Without candidate values
 *     (fast analysis only), the network's policy stands in: several moves it rates nearly
 *     as highly as its favourite.
 *  5. The winrate floor of balance.ts still applies on top (practiceItems).
 */

/** Points a wrong move must cost for a position to be worth drilling (after the early opening). */
export const MIN_STAKES = 2;
/** ...or this much of the mover's winning chances, in a close game. */
export const MIN_STAKES_WINRATE = 0.08;
/** Early opening: this many first moves on 19×19, scaled by board area (14 on 13×13, 7 on 9×9). */
export const EARLY_OPENING_MOVES_19 = 30;
/** Points an early-opening move must lose to be worth drilling. */
export const OPENING_MIN_STAKES = 5;
/** ...or this much of the winning chances. */
export const OPENING_MIN_STAKES_WINRATE = 0.15;
/** A loss that qualifies through the winrate still needs this share of the point bar. */
export const WINRATE_PATH_SHARE = 0.75;
/** Candidate moves within this many points of the best are about equally good. */
export const NEAR_EQUAL_POINTS = 1;
/** This many about-equally-good moves: no single lesson to learn... */
export const UNCLEAR_GOOD_MOVES = 3;
/** ...unless the game move lost at least this multiple of the point bar. */
export const UNCLEAR_BLUNDER_FACTOR = 2;
/** A played move with at least this policy is a normal move (joseki, a natural shape)... */
export const NORMAL_MOVE_POLICY = 0.1;
/** ...and only counts as a mistake from this many points. */
export const NORMAL_MOVE_MAX_LOSS = 3;
/** Fast analysis only: moves with this share of the favourite's policy count as about equally natural. */
export const POLICY_PEER_RATIO = 0.6;
/** Searched positions: the options compared are this many most-visited moves (and the game move). */
export const CANDIDATE_LIMIT = 5;
/** More points at stake than this does not make a better question. */
export const STAKES_CAP = 12;

/** The move played in the source game and what it cost. */
export type PlayedMove = NonNullable<TrainingItem['played']>;

export type WorthVerdict = 'worth' | 'opening' | 'normal' | 'unclear' | 'small';
export type SkipVerdict = Exclude<WorthVerdict, 'worth'>;

export interface WorthInput {
  size: number;
  /** Number of the move to find (1 = the first move of the game). */
  moveNumber: number;
  eval: Pick<PositionEval, 'policy' | 'candidates' | 'bestLoc'>;
  /** The move played in the source game, when known. */
  played?: PlayedMove;
  /** The position is shown as the player's own error, so the game move must be a real mistake. */
  requireMistake?: boolean;
}

export interface Worth {
  ok: boolean;
  verdict: WorthVerdict;
  /** 0..1, higher is a better question; 0 when not worth drilling. */
  score: number;
  /** Points a wrong move costs here (the game move's loss, or what the other candidates typically lose). */
  stakes: number;
  /** Moves about as good as the best (from candidates, or policy without them); null when unknown. */
  goodMoves: number | null;
  /** The position is in the early opening. */
  early: boolean;
  /** One short line for the UI. */
  reason: string;
}

interface Bar {
  points: number;
  winrate: number;
}

const EPS = 1e-9;

export const earlyOpeningMoves = (size: number) => Math.round((EARLY_OPENING_MOVES_19 * size * size) / 361);

export const stakesBar = (early: boolean): Bar =>
  early ? { points: OPENING_MIN_STAKES, winrate: OPENING_MIN_STAKES_WINRATE } : { points: MIN_STAKES, winrate: MIN_STAKES_WINRATE };

/** Does a loss clear the bar, in points, or in winrate with most of the points? */
export function bigEnough(points: number, winrate: number, bar: Bar): boolean {
  return points >= bar.points - EPS || (winrate >= bar.winrate - EPS && points >= bar.points * WINRATE_PATH_SHARE - EPS);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface CandidateSpread {
  /** Candidates within NEAR_EQUAL_POINTS of the best, the best included. */
  good: number;
  /** Median points (and winrate) lost by the other candidates. */
  stakes: number;
  stakesWinrate: number;
  /** The mover's winrate after the best candidate, and the highest after any other. */
  bestWin: number;
  otherWin: number;
}

/**
 * How the stored candidates compare to the best one (null without two valued candidates).
 * When every candidate comes from a tree search (all have visits), the best is KataGo's
 * choice, the most visited move, and only the CANDIDATE_LIMIT most visited moves and the
 * game move are compared: a move searched once can look better or worse than it is.
 * One-ply candidates (older analyses) are all compared, against the highest value.
 */
export function candidateSpread(cands: Candidate[] | undefined, playedLoc?: Loc): CandidateSpread | null {
  const valid = (cands ?? [])
    .filter((c) => c.loc !== PASS && Number.isFinite(c.scoreLead) && Number.isFinite(c.winrate))
    .map((c) => ({ loc: c.loc, lead: c.scoreLead as number, win: c.winrate as number, visits: c.visits ?? 0 }));
  const searched = valid.length > 0 && valid.every((c) => c.visits > 0);
  let considered = valid;
  if (searched) {
    const byVisits = [...valid].sort((a, b) => b.visits - a.visits);
    considered = byVisits.slice(0, CANDIDATE_LIMIT);
    const game = byVisits.find((c) => c.loc === playedLoc);
    if (game && !considered.includes(game)) considered.push(game);
  }
  if (considered.length < 2) return null;
  const refLead = searched ? considered[0].lead : Math.max(...considered.map((c) => c.lead));
  const bestByWin = searched ? considered[0] : considered.reduce((a, b) => (b.win > a.win ? b : a));
  // The best itself loses nothing: drop one zero to keep the others.
  const losses = considered.map((c) => Math.max(0, refLead - c.lead)).sort((a, b) => a - b);
  const wrLosses = considered.map((c) => Math.max(0, bestByWin.win - c.win)).sort((a, b) => a - b);
  return {
    good: losses.filter((l) => l <= NEAR_EQUAL_POINTS + EPS).length,
    stakes: median(losses.slice(1)),
    stakesWinrate: median(wrLosses.slice(1)),
    bestWin: bestByWin.win,
    otherWin: Math.max(...considered.filter((c) => c !== bestByWin).map((c) => c.win)),
  };
}

/** Moves the network rates nearly as highly as its favourite (null without a policy). */
export function policyPeers(policy: PolicyEntry[], exclude?: Loc): number | null {
  const ps = policy.filter((p) => p.loc !== PASS && p.loc !== exclude && p.p > 0);
  if (!ps.length) return null;
  const top = Math.max(...ps.map((p) => p.p));
  return ps.filter((p) => p.p >= POLICY_PEER_RATIO * top - EPS).length;
}

const pts = (x: number) => `${x.toFixed(1)} points`;
/** "4.2 points", or "12% winrate (1.6 points)" when the winrate made it count. */
const lossText = (points: number, winrate: number, bar: Bar) => (points >= bar.points - EPS ? pts(points) : `${Math.round(winrate * 100)}% winrate (${pts(points)})`);

function goodClause(s: CandidateSpread): string {
  if (s.good <= 1) return s.bestWin >= 0.5 && s.otherWin < 0.5 ? 'only one move keeps the lead' : 'one move stands out';
  if (s.good === 2) return 'two moves stand out';
  return 'several moves are fine';
}

/** Judge one position as a training question. */
export function assessPosition(input: WorthInput): Worth {
  const early = input.moveNumber <= earlyOpeningMoves(input.size);
  const bar = stakesBar(early);
  const spread = candidateSpread(input.eval.candidates, input.played?.loc);
  // The game move is only a candidate mistake when it was not KataGo's move.
  const p = input.played && input.played.loc !== PASS && input.played.loc !== input.eval.bestLoc ? input.played : undefined;
  const normal = !!p && p.policy >= NORMAL_MOVE_POLICY - EPS && p.scoreLoss < NORMAL_MOVE_MAX_LOSS;
  const mistake = !!p && !normal && bigEnough(p.scoreLoss, p.winrateLoss, bar);
  // "You went wrong here" needs a real mistake; without the game move (older items) the candidates decide.
  const premise = !!input.requireMistake && !!input.played;
  const useSpread = !!spread && (!premise || mistake);
  const fromCandidates = useSpread && bigEnough(spread!.stakes, spread!.stakesWinrate, bar);
  const enough = mistake || fromCandidates;
  const stakes = Math.max(mistake ? p!.scoreLoss : 0, fromCandidates ? spread!.stakes : 0);
  const stakesWinrate = Math.max(mistake ? p!.winrateLoss : 0, fromCandidates ? spread!.stakesWinrate : 0);
  const known = Math.max(p?.scoreLoss ?? 0, spread?.stakes ?? 0);

  const good = spread ? spread.good : policyPeers(input.eval.policy, mistake ? p!.loc : undefined);
  const blunder = mistake && p!.scoreLoss >= UNCLEAR_BLUNDER_FACTOR * bar.points - EPS;
  const several = good !== null && good >= UNCLEAR_GOOD_MOVES;
  // The normal-move rule explains a rejection when the game move is the lesson, or would have counted otherwise.
  const normalBlocked = normal && (premise || bigEnough(p!.scoreLoss, p!.winrateLoss, bar));
  const verdict: WorthVerdict = enough
    ? several && !blunder
      ? 'unclear'
      : 'worth'
    : early
      ? 'opening'
      : normalBlocked
        ? 'normal'
        : several
          ? 'unclear'
          : 'small';

  let reason: string;
  switch (verdict) {
    case 'worth': {
      const head = premise && mistake && p!.byPlayer ? `You lost ${lossText(p!.scoreLoss, p!.winrateLoss, bar)} here` : `${lossText(stakes, stakesWinrate, bar)} at stake`;
      reason = spread ? `${head}; ${goodClause(spread)}` : head;
      break;
    }
    case 'opening':
      reason = spread || p ? `Early opening: only ${pts(known)} at stake` : 'Early opening, nothing measured at stake';
      break;
    case 'normal':
      reason = `A normal move that lost only ${pts(p!.scoreLoss)}`;
      break;
    case 'unclear':
      reason = spread ? `${good} moves are within ${NEAR_EQUAL_POINTS} point of the best` : `${good} moves look about equally natural to KataGo`;
      break;
    default:
      reason = spread || p ? `Only ${pts(known)} at stake` : 'Nothing measured at stake (fast analysis only)';
  }

  let score = 0;
  if (verdict === 'worth') {
    const clarity = good === null ? 0.8 : good <= 1 ? 1 : good === 2 ? 0.8 : 0.5;
    const reliability = spread ? 1 : 0.8;
    score = (Math.log1p(Math.min(stakes, STAKES_CAP)) / Math.log1p(STAKES_CAP)) * clarity * reliability;
    score = Math.round(score * 1000) / 1000;
  }
  return { ok: verdict === 'worth', verdict, score, stakes, goodMoves: good, early, reason };
}

export function playedFromRecord(r: MoveRecord): PlayedMove {
  return { loc: r.loc, scoreLoss: r.scoreLoss, winrateLoss: r.winrateLoss, policy: r.playedPolicy, byPlayer: r.isPlayer };
}

/** Judge the position before a recorded move, as it would be shown in the Forge (`kind`). */
export function assessRecord(r: MoveRecord, e: PositionEval, kind?: TrainingKind): Worth {
  return assessPosition({ size: r.size, moveNumber: r.index + 1, eval: e, played: playedFromRecord(r), requireMistake: kind === 'original' });
}

const itemCache = new WeakMap<TrainingItem, Worth>();

/** Judge a stored training item (items are immutable, so the verdict is cached per object). */
export function assessItem(item: TrainingItem): Worth {
  let w = itemCache.get(item);
  if (!w) {
    w = assessPosition({
      size: item.size,
      moveNumber: item.moves.length + 1,
      eval: item.eval,
      played: item.modification ? undefined : item.played,
      requireMistake: item.kind === 'original' && !item.modification,
    });
    itemCache.set(item, w);
  }
  return w;
}

export const isWorthDrilling = (item: TrainingItem) => assessItem(item).ok;

/**
 * Items that can be asked: above the winrate floor and worth drilling. Applied when
 * choosing questions, so items saved before these rules existed are filtered too.
 */
export function practiceItems(items: TrainingItem[], minLosingWinrate = DEFAULT_MIN_LOSING_WINRATE): TrainingItem[] {
  return items.filter((it) => isBalanced(searchedValue(it.eval).bWin, minLosingWinrate) && isWorthDrilling(it));
}

export interface PracticeSummary {
  total: number;
  kept: number;
  /** Below the winrate floor. */
  lopsided: number;
  opening: number;
  normal: number;
  unclear: number;
  small: number;
}

/** What happened to a weakness's stored items, for an honest empty state. */
export function summarizePractice(items: TrainingItem[], minLosingWinrate = DEFAULT_MIN_LOSING_WINRATE): PracticeSummary {
  const s: PracticeSummary = { total: items.length, kept: 0, lopsided: 0, opening: 0, normal: 0, unclear: 0, small: 0 };
  for (const it of items) {
    if (!isBalanced(searchedValue(it.eval).bWin, minLosingWinrate)) s.lopsided++;
    else {
      const w = assessItem(it);
      if (w.ok) s.kept++;
      else s[w.verdict as SkipVerdict]++;
    }
  }
  return s;
}

const SKIP_TEXT: Record<SkipVerdict | 'lopsided', [string, string]> = {
  opening: ['was an early-opening move', 'were early-opening moves'],
  normal: ['was a normal move that lost little', 'were normal moves that lost little'],
  unclear: ['had several equally good moves', 'had several equally good moves'],
  small: ['had too little at stake', 'had too little at stake'],
  lopsided: ['was already decided', 'were already decided'],
};

/** "3 were early-opening moves, 1 had too little at stake" (biggest group first). */
export function describeSkipped(s: PracticeSummary): string {
  const parts = (Object.keys(SKIP_TEXT) as (keyof typeof SKIP_TEXT)[])
    .filter((k) => s[k] > 0)
    .sort((a, b) => s[b] - s[a])
    .map((k) => `${s[k]} ${SKIP_TEXT[k][s[k] === 1 ? 0 : 1]}`);
  return parts.join(', ');
}
