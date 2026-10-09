import { Board } from '../go/board';
import { PASS, type Color, type Loc, type Move, other } from '../go/types';
import { encodeOwnership, moverView, processRawOutput, round, topPolicy, type RawNetOutput } from '../engine/parse';
import { engineEvaluator, Search, type SearchCandidate, type SearchSnapshot } from '../engine/mcts';
import type { EngineBackend, EngineRequest } from '../engine/types';
import type { Candidate, PositionEval } from '../types';
import { hashString } from '../util/hash';

/**
 * Version of stored analyses. 3: values come from a tree search (not the network's first
 * impression), small networks' winrates are derived from the score, and komi follows the
 * rules (Fox's missing komi, territory scoring). Older analyses are redone.
 */
export const ANALYSIS_VERSION = 3;

export interface PositionSpec {
  size: number;
  komi: number;
  setup: Move[];
  /** Moves played before this position. */
  history: Move[];
  toPlay: Color;
  board: Board;
}

/** Setup stones become leading moves (Black first), as kataeval expects for handicap stones. */
export function engineMoves(setup: Move[], history: Move[]): Move[] {
  const blacks = setup.filter((m) => m.color === 1);
  const whites = setup.filter((m) => m.color === 2);
  return [...blacks, ...whites, ...history];
}

export function toPlayAt(setup: Move[], moves: Move[], index: number, handicap: number): Color {
  if (index < moves.length) return moves[index].color;
  if (moves.length) return other(moves[moves.length - 1].color);
  return setup.some((s) => s.color === 1) && handicap > 1 ? 2 : 1;
}

/**
 * Cache key of a position: stones, side to move, komi, ko, the last few moves (the
 * network sees recent-move history), board size and the network used.
 */
export function positionKey(spec: PositionSpec, modelId: string): string {
  const b = spec.board;
  let s = '';
  for (let i = 0; i < b.stones.length; i++) s += b.stones[i];
  const recent = spec.history
    .slice(-5)
    .map((m) => `${m.color}${m.loc}`)
    .join(',');
  return `v${ANALYSIS_VERSION}|${modelId}|${spec.size}|${hashString(`${s}|${spec.toPlay}|${spec.komi}|${b.koPoint}|${recent}`)}`;
}

function request(spec: PositionSpec): EngineRequest {
  return { size: spec.size, komi: spec.komi, moves: engineMoves(spec.setup, spec.history), toPlay: spec.toPlay };
}

/** The tree search's view of a position. */
export function rootPosition(spec: PositionSpec) {
  return { size: spec.size, komi: spec.komi, moves: engineMoves(spec.setup, spec.history), toPlay: spec.toPlay, board: spec.board };
}

function fastEval(engine: EngineBackend, spec: PositionSpec, raw: RawNetOutput): PositionEval {
  const legal = spec.board.legalMask(spec.toPlay);
  const net = processRawOutput(raw, spec.toPlay, (loc) => legal[loc] === 1, engine.postProcess);
  const policy = topPolicy(net.policy, 12);
  return {
    key: positionKey(spec, engine.info.modelId),
    toPlay: spec.toPlay,
    bWin: round(net.bWin),
    bLead: round(net.bLead, 2),
    policy,
    ownership: net.ownership ? encodeOwnership(net.ownership) : undefined,
    bestLoc: policy[0]?.loc ?? PASS,
    pv: [],
    visits: 1,
    depth: 'fast',
    engine: engine.info,
    analyzedAt: Date.now(),
  };
}

/** Fast pass: one network evaluation (policy, value, score, ownership). */
export async function evaluateFast(engine: EngineBackend, spec: PositionSpec): Promise<PositionEval> {
  return fastEval(engine, spec, await engine.evalRaw(request(spec), true));
}

/** The fast pass for many positions at once (spread over the engine's workers and batches). */
export async function evaluateFastMany(engine: EngineBackend, specs: PositionSpec[]): Promise<PositionEval[]> {
  if (!engine.evalSeqBatchRaw || specs.length <= 1) {
    const out: PositionEval[] = [];
    for (const s of specs) out.push(await evaluateFast(engine, s));
    return out;
  }
  const raws = await engine.evalSeqBatchRaw(specs.map((s) => ({ ...request(s), ownership: true })));
  return specs.map((s, i) => fastEval(engine, s, raws[i]));
}

export interface DeepOptions {
  visits: number;
  maxMs: number;
  /** A move that must get some of the visits (e.g. the move actually played). */
  mustInclude?: Loc[];
  candidateCount?: number;
}

/**
 * A position's value after KataGo has looked past the network's first impression. Analyses
 * from version 3 store the searched value itself (`searched`). Older deep analyses stored
 * the network's value with one-ply candidates: mix the root with the candidates by visits,
 * as KataGo's search averages them, or take the best candidate when there are no visits.
 */
export function searchedValue(e: { bWin: number; bLead: number; toPlay: Color; candidates?: Candidate[]; searched?: boolean }): { bWin: number; bLead: number } {
  if (e.searched) return { bWin: e.bWin, bLead: e.bLead };
  const valued = (e.candidates ?? []).filter((c) => c.winrate !== undefined && c.scoreLead !== undefined);
  const root = moverView(e.bWin, e.bLead, e.toPlay);
  let win = root.win;
  let lead = root.lead;
  let n = 1;
  for (const c of valued) {
    if (!c.visits) continue;
    win += c.visits * c.winrate!;
    lead += c.visits * c.scoreLead!;
    n += c.visits;
  }
  if (n === 1) {
    if (!valued.length) return { bWin: e.bWin, bLead: e.bLead };
    const best = valued.reduce((a, c) => (c.winrate! > a.winrate! || (c.winrate === a.winrate && c.scoreLead! > a.scoreLead!) ? c : a));
    win = best.winrate!;
    lead = best.scoreLead!;
  } else {
    win /= n;
    lead /= n;
  }
  const v = moverView(win, lead, e.toPlay);
  return { bWin: v.win, bLead: v.lead };
}

export const toCandidate = (c: SearchCandidate): Candidate => ({
  loc: c.loc,
  prior: round(c.prior, 5),
  winrate: round(c.winrate),
  scoreLead: round(c.scoreLead, 2),
  visits: c.visits,
  pv: c.pv.slice(0, 16),
});

/**
 * A position's stored analysis from a finished search: the searched value, the visited
 * moves (most visits first, the played move always included when it was searched) and
 * the best line. Policy and ownership stay the network's.
 */
export function searchedEval(fast: PositionEval, snap: SearchSnapshot, opts: { played?: Loc; candidateCount?: number } = {}): PositionEval {
  const count = opts.candidateCount ?? 10;
  const cands = snap.candidates.slice(0, count);
  const played = opts.played !== undefined ? snap.candidates.find((c) => c.loc === opts.played) : undefined;
  if (played && !cands.includes(played)) cands.push(played);
  const best = snap.candidates[0];
  // Keep the network's first look (level estimation is calibrated on it). A position that
  // was already searched carries it along, or has lost it if it was searched before this field.
  const net = fast.net ?? (fast.searched ? undefined : { bWin: fast.bWin, bLead: fast.bLead });
  return {
    ...fast,
    ...(net ? { net } : {}),
    bWin: round(snap.bWin),
    bLead: round(snap.bLead, 2),
    candidates: cands.map(toCandidate),
    bestLoc: best?.loc ?? fast.bestLoc,
    pv: best ? best.pv.slice(0, 20) : [],
    visits: snap.visits,
    depth: 'deep',
    searched: true,
    analyzedAt: Date.now(),
  };
}

/** A search of one position with a fresh tree (practice variations, single positions). */
export async function evaluateDeep(engine: EngineBackend, spec: PositionSpec, fast: PositionEval, opts: DeepOptions): Promise<PositionEval> {
  const search = new Search(engineEvaluator(engine), rootPosition(spec), { batch: engine.batch ?? 1 });
  const forced = opts.mustInclude?.find((l) => l === PASS || spec.board.isLegal(l, spec.toPlay));
  const snap = await search.run({ visits: Math.max(2, opts.visits), maxMs: opts.maxMs, forced, forcedShare: 0.1 });
  return searchedEval(fast, snap, { played: forced, candidateCount: opts.candidateCount ?? 10 });
}
