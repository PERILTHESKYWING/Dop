import { Board } from '../go/board';
import { PASS, type Color, type Loc, type Move, other } from '../go/types';
import { encodeOwnership, moverView, processRawOutput, round, topPolicy } from '../engine/parse';
import type { EngineBackend, EngineRequest } from '../engine/types';
import type { Candidate, PositionEval } from '../types';
import { hashString } from '../util/hash';

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
  return `${modelId}|${spec.size}|${hashString(`${s}|${spec.toPlay}|${spec.komi}|${b.koPoint}|${recent}`)}`;
}

function request(spec: PositionSpec, extra: Move[] = [], toPlay = spec.toPlay): EngineRequest {
  return { size: spec.size, komi: spec.komi, moves: engineMoves(spec.setup, [...spec.history, ...extra]), toPlay };
}

/** Fast pass: one network evaluation (policy, value, score, ownership). */
export async function evaluateFast(engine: EngineBackend, spec: PositionSpec): Promise<PositionEval> {
  const raw = await engine.evalRaw(request(spec), true);
  const net = processRawOutput(raw, spec.toPlay, (loc) => spec.board.isLegal(loc, spec.toPlay), engine.postProcess);
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

export interface DeepOptions {
  visits: number;
  maxMs: number;
  /** Extra moves that must be evaluated as candidates (e.g. the move actually played). */
  mustInclude?: Loc[];
  candidateCount?: number;
}

/**
 * A position's value once KataGo has looked past the network's first impression, which is
 * optimistic for the side to move (by a few points in sharp positions) and can call a lost
 * position even:
 *  - after a search, the network's value mixed with the searched candidates' values,
 *    weighted by visits, as KataGo's search averages them;
 *  - with one-ply candidate values but no search, the value after the best candidate;
 *  - otherwise the network's value.
 */
export function searchedValue(e: { bWin: number; bLead: number; toPlay: Color; candidates?: Candidate[] }): { bWin: number; bLead: number } {
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

/**
 * Deep pass: a search for the best move and PV, then a one-ply evaluation after each
 * candidate (and the played move) so every candidate has a comparable winrate and
 * score for the side to move.
 */
export async function evaluateDeep(
  engine: EngineBackend,
  spec: PositionSpec,
  fast: PositionEval,
  opts: DeepOptions,
  evalAfter?: (loc: Loc) => Promise<{ bWin: number; bLead: number } | null>,
): Promise<PositionEval> {
  const mover = spec.toPlay;
  let bestLoc = fast.bestLoc;
  let pv: Loc[] = [];
  let visits = 1;
  const searchInfo = new Map<Loc, { visits: number; winrate: number; prior: number }>();
  if (opts.visits > 1) {
    try {
      const r = await engine.searchRaw(request(spec), opts.visits, opts.maxMs);
      bestLoc = r.best;
      pv = r.pv;
      visits = r.visits;
      for (const c of r.children) searchInfo.set(c.loc, c);
    } catch {
      // Search failure is not fatal: fall back to policy candidates.
    }
  }
  const want = new Set<Loc>();
  if (bestLoc !== PASS) want.add(bestLoc);
  const bySearch = [...searchInfo.entries()].sort((a, b) => b[1].visits - a[1].visits).map(([loc]) => loc);
  const count = opts.candidateCount ?? 5;
  for (const loc of bySearch) if (want.size < count && loc !== PASS) want.add(loc);
  for (const p of fast.policy) if (want.size < count && p.loc !== PASS) want.add(p.loc);
  for (const loc of opts.mustInclude ?? []) if (loc !== PASS && spec.board.isLegal(loc, mover)) want.add(loc);

  const candidates: Candidate[] = [];
  for (const loc of want) {
    let res: { bWin: number; bLead: number } | null = null;
    if (evalAfter) res = await evalAfter(loc);
    if (!res) {
      const after = spec.board.clone();
      after.play(loc, mover, true);
      const raw = await engine.evalRaw(request(spec, [{ color: mover, loc }], other(mover)), false);
      const net = processRawOutput(raw, other(mover), (l) => after.isLegal(l, other(mover)), engine.postProcess);
      res = { bWin: net.bWin, bLead: net.bLead };
    }
    const v = moverView(res.bWin, res.bLead, mover);
    const s = searchInfo.get(loc);
    candidates.push({
      loc,
      prior: round(fast.policy.find((p) => p.loc === loc)?.p ?? s?.prior ?? 0, 5),
      winrate: round(v.win),
      scoreLead: round(v.lead, 2),
      visits: s?.visits,
      pv: loc === bestLoc ? pv : undefined,
    });
  }
  candidates.sort((a, b) => (b.visits ?? 0) - (a.visits ?? 0) || (b.scoreLead ?? 0) - (a.scoreLead ?? 0));
  // bWin/bLead stay the raw network values so consecutive positions remain comparable;
  // the search result lives in bestLoc, pv, visits and the candidates.
  return {
    ...fast,
    candidates,
    bestLoc,
    pv,
    visits,
    depth: 'deep',
    analyzedAt: Date.now(),
  };
}
