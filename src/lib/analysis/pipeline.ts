import { allPositions, type Board } from '../go/board';
import { engineKomi } from '../go/rules';
import { engineEvaluator, Search, type AnchorSource, type LeafEvaluator } from '../engine/mcts';
import type { EngineBackend } from '../engine/types';
import type { GameAnalysis, GameRecord, PositionEval } from '../types';
import { ANALYSIS_VERSION, evaluateFastMany, positionKey, rootPosition, searchedEval, toPlayAt, type PositionSpec } from './analyzer';

/** Where analysis results live. IndexedDB in the browser, memory in tests and scripts. */
export interface AnalysisStore {
  getCached(key: string): Promise<PositionEval | undefined>;
  putCached(e: PositionEval): Promise<void>;
  loadAnalysis(gameId: string): Promise<GameAnalysis | undefined>;
  saveAnalysis(a: GameAnalysis): Promise<void>;
  saveGame(g: GameRecord): Promise<void>;
}

export interface PipelineOptions {
  /** Search visits per position; 0 runs only the network pass. */
  visits: number;
  /** 'fast' stops after the network pass (a quick first look at every game). */
  stage?: 'fast' | 'full';
  onProgress?: (g: GameRecord) => void;
  shouldStop?: () => boolean;
  /** Save progress every N positions (resumable analysis). */
  checkpointEvery?: number;
  /** Awaited before each position, so interactive use (live analysis) goes first. */
  yieldTo?: () => Promise<void>;
  /** A search in progress gives way when this turns true, and resumes after yieldTo. */
  interrupted?: () => boolean;
  /**
   * Spend the visits where they matter (default on): more on positions where the move
   * played looks costly or surprising, fewer on obvious ones, and stop a search once more
   * visits cannot change its best move. Off gives every position the same budget.
   */
  adaptive?: boolean;
  /**
   * Cool mode (phones): quiet and obvious positions get half of their already small budget
   * again; positions that matter keep theirs.
   */
  thrifty?: boolean;
  /**
   * Answers that need no search on this device (the opening book, the PC, shared results):
   * a searched evaluation for the position, or null to search it here.
   */
  known?: (spec: PositionSpec, fast: PositionEval) => Promise<PositionEval | null>;
  /** A stronger judge for the top of every search (engine/mcts.ts AnchorSource). */
  anchor?: AnchorSource | null;
  /** Who evaluates the search's leaves (default: the engine; the student network when it runs). */
  evaluator?: LeafEvaluator;
  /** Positions per evaluator call for that evaluator. */
  evaluatorBatch?: number;
}

/** A searched evaluation that is good enough for `want` visits. */
function isSearched(e: PositionEval, want: number) {
  // Answers from the opening book, the PC or another device are stronger than a search here.
  if (e.searched && e.source) return true;
  return !!e.searched && (e.visits >= want || (e.settled ?? 0) >= want);
}

export type SearchTier = 'obvious' | 'quiet' | 'normal' | 'critical' | 'deep';

/** Share of the base budget each kind of position gets ("search only what matters"). */
export const TIER_SHARE: Record<SearchTier, number> = { obvious: 0.08, quiet: 0.35, normal: 1, critical: 1.75, deep: 4 };
/** Doubt (two looks disagreeing) above this makes a position critical; below QUIET_DOUBT it may be quiet. */
export const CRITICAL_DOUBT = 0.08;
export const QUIET_DOUBT = 0.03;

/**
 * How much position i matters, from the first pass (the network's two looks at every
 * position). Critical: the move played lost 6% or more, was not among the network's top
 * three, or the two looks disagree (the doubt meter). Obvious: the network is sure, the game
 * followed it and nothing changed. Quiet: a move the network expected, little at stake.
 * The model lab's hard examples always get the deep budget.
 */
export function searchTier(analysis: GameAnalysis, game: GameRecord, i: number): SearchTier {
  if (analysis.deepTargets.includes(i)) return 'deep';
  const before = analysis.evals[i];
  if (!before) return 'normal';
  const doubt = Math.max(before.doubt ?? 0, i > 0 ? (analysis.evals[i - 1]?.doubt ?? 0) * 0.5 : 0);
  if (i >= game.moves.length) return doubt >= CRITICAL_DOUBT ? 'critical' : 'normal';
  const after = analysis.evals[i + 1];
  if (!after) return 'normal';
  const mover = before.toPlay;
  const winBefore = mover === 1 ? before.bWin : 1 - before.bWin;
  const winAfter = mover === 1 ? after.bWin : 1 - after.bWin;
  const loss = winBefore - winAfter;
  const played = game.moves[i].loc;
  const top = before.policy[0];
  const rank = before.policy.findIndex((p) => p.loc === played);
  if (loss >= 0.06 || rank < 0 || rank >= 3 || doubt >= CRITICAL_DOUBT || (after.doubt ?? 0) >= CRITICAL_DOUBT) return 'critical';
  // A decided game (one side above 97%) needs no detail unless something happens.
  const decided = winBefore > 0.97 || winBefore < 0.03;
  if (top && top.loc === played && loss < 0.02 && doubt < QUIET_DOUBT && (top.p >= 0.6 || decided)) return 'obvious';
  if (rank <= 1 && loss < 0.03 && doubt < QUIET_DOUBT * 1.5) return 'quiet';
  return 'normal';
}

/**
 * Visits for position i: the base budget times its tier's share (searchTier). Off
 * (`adaptive` false) gives every position the base budget, apart from the deep targets.
 */
export function visitBudget(analysis: GameAnalysis, game: GameRecord, i: number, base: number, adaptive = true, thrifty = false): number {
  if (!adaptive) return analysis.deepTargets.includes(i) ? base * 4 : base;
  const tier = searchTier(analysis, game, i);
  let share = TIER_SHARE[tier];
  if (thrifty && (tier === 'obvious' || tier === 'quiet' || tier === 'normal')) share *= 0.5;
  return Math.max(8, Math.round(base * share));
}

export class AnalysisStopped extends Error {}

function specAt(game: GameRecord, boards: Board[], i: number): PositionSpec {
  return {
    size: game.size,
    komi: engineKomi(game.komi, game.rules),
    setup: game.setup,
    history: game.moves.slice(0, i),
    toPlay: toPlayAt(game.setup, game.moves, i, game.handicap),
    board: boards[i],
  };
}

function freshAnalysis(game: GameRecord, komi: number): GameAnalysis {
  return { gameId: game.id, evals: new Array(game.moves.length + 1).fill(null), deepTargets: [], updatedAt: Date.now(), version: ANALYSIS_VERSION, komi };
}

/** An existing analysis can be continued only if it was made the same way. */
export function analysisIsCurrent(a: GameAnalysis | undefined, game: GameRecord, modelId?: string): boolean {
  return (
    !!a &&
    a.version === ANALYSIS_VERSION &&
    a.komi === engineKomi(game.komi, game.rules) &&
    a.evals.length === game.moves.length + 1 &&
    (!modelId || !a.engine || a.engine.modelId === modelId)
  );
}

/**
 * Analyse one game in two passes:
 *  1. the network's evaluation of every position (seconds; draws the winrate graph);
 *  2. a tree search of every position in game order. The search tree follows the game,
 *     so the part explored under the move actually played carries over to the next
 *     position; the played move always gets some visits.
 * Values stored after pass 2 are the searched ones. Progress is checkpointed so an
 * interrupted run resumes where it stopped, and repeated positions come from the cache.
 */
export async function analyzeGame(game: GameRecord, engine: EngineBackend, store: AnalysisStore, opts: PipelineOptions): Promise<GameAnalysis> {
  const boards = allPositions(game.size, game.setup, game.moves);
  const n = game.moves.length;
  const komi = engineKomi(game.komi, game.rules);
  const stored = await store.loadAnalysis(game.id);
  // A finished analysis made elsewhere (another network, the PC) is kept rather than redone.
  const finished = !!stored && analysisIsCurrent(stored, game) && stored.evals.every((e) => e?.searched);
  const analysis: GameAnalysis = stored && (finished || analysisIsCurrent(stored, game, engine.info.modelId)) ? stored : freshAnalysis(game, komi);
  if (!finished) analysis.engine = engine.info;
  const checkpoint = opts.checkpointEvery ?? 12;
  const stop = () => {
    if (opts.shouldStop?.()) throw new AnalysisStopped('stopped');
  };
  const save = async () => {
    analysis.updatedAt = Date.now();
    await store.saveAnalysis(analysis);
    await store.saveGame(game);
    opts.onProgress?.(game);
  };

  // Pass 1: the network's first look.
  game.status = 'fast';
  game.error = undefined;
  game.progress = { ...game.progress, total: n + 1, fast: analysis.evals.filter(Boolean).length };
  let since = 0;
  // Positions go to the engine in groups, so all its workers and batches are busy.
  const group = Math.max(1, Math.min(32, (engine.batch ?? 1) * 2));
  const todo: number[] = [];
  for (let i = 0; i <= n; i++) if (!analysis.evals[i]) todo.push(i);
  for (let a = 0; a < todo.length; a += group) {
    await opts.yieldTo?.();
    stop();
    const idx = todo.slice(a, a + group);
    const specs = idx.map((i) => specAt(game, boards, i));
    const keys = specs.map((sp) => positionKey(sp, engine.info.modelId));
    const hits = await Promise.all(keys.map((k) => store.getCached(k)));
    const need = idx.map((_, j) => j).filter((j) => !hits[j]);
    const fresh = await evaluateFastMany(
      engine,
      need.map((j) => specs[j]),
      { doubt: opts.adaptive !== false },
    );
    need.forEach((j, k) => (hits[j] = fresh[k]));
    for (const e of fresh) await store.putCached(e);
    idx.forEach((i, j) => (analysis.evals[i] = hits[j]!));
    game.progress.fast = analysis.evals.filter(Boolean).length;
    since += idx.length;
    if (since >= checkpoint) {
      since = 0;
      await save();
    }
  }
  game.progress.fast = n + 1;
  const searchedCount = () => analysis.evals.filter((e) => e?.searched).length;
  game.progress.deepTotal = opts.visits > 0 ? n + 1 : 0;
  game.progress.deep = searchedCount();
  if (opts.stage === 'fast' || opts.visits <= 0) {
    await save();
    return analysis;
  }

  // Pass 2: search every position, following the game with one tree.
  game.status = 'deep';
  await save();
  const search = new Search(opts.evaluator ?? engineEvaluator(engine), rootPosition(specAt(game, boards, 0)), {
    batch: (opts.evaluator ? opts.evaluatorBatch : engine.batch) ?? 1,
  });
  search.setAnchor(opts.anchor ?? null);
  since = 0;
  for (let i = 0; i <= n; i++) {
    const current = analysis.evals[i]!;
    const want = visitBudget(analysis, game, i, opts.visits, opts.adaptive !== false, opts.thrifty);
    if (isSearched(current, want)) continue;
    const spec = specAt(game, boards, i);
    const played = game.moves[i]?.loc;
    const cached = await store.getCached(current.key);
    const known = cached && isSearched(cached, want) ? null : await opts.known?.(spec, current);
    if (cached && isSearched(cached, want)) {
      analysis.evals[i] = cached;
    } else if (known) {
      // Stored under this position's key, and good enough for this budget from now on.
      analysis.evals[i] = { ...known, key: current.key, settled: Math.max(known.settled ?? 0, want) };
      await store.putCached(analysis.evals[i]!);
    } else {
      search.setPosition(rootPosition(spec));
      let snap;
      for (;;) {
        await opts.yieldTo?.();
        stop();
        snap = await search.run({
          visits: want,
          forced: played,
          forcedShare: 0.1,
          earlyStop: opts.adaptive !== false,
          shouldStop: () => !!opts.interrupted?.() || !!opts.shouldStop?.(),
        });
        if (snap.settled || snap.visits >= want || search.rootVisits >= want) break;
        if (!opts.interrupted?.() && !opts.shouldStop?.()) break; // nothing left to search
      }
      analysis.evals[i] = searchedEval(current, snap, { played });
      if (snap.settled) analysis.evals[i] = { ...analysis.evals[i]!, settled: want };
      await store.putCached(analysis.evals[i]!);
    }
    game.progress.deep = searchedCount();
    if (++since >= Math.max(1, Math.round(checkpoint / 4))) {
      since = 0;
      await save();
    }
  }
  game.status = 'done';
  await save();
  return analysis;
}

/** In-memory store for tests and the demo generator. */
export class MemoryStore implements AnalysisStore {
  cache = new Map<string, PositionEval>();
  analyses = new Map<string, GameAnalysis>();
  games = new Map<string, GameRecord>();
  async getCached(key: string) {
    return this.cache.get(key);
  }
  async putCached(e: PositionEval) {
    this.cache.set(e.key, e);
  }
  async loadAnalysis(id: string) {
    const a = this.analyses.get(id);
    return a ? { ...a, evals: [...a.evals] } : undefined;
  }
  async saveAnalysis(a: GameAnalysis) {
    this.analyses.set(a.gameId, { ...a, evals: [...a.evals] });
  }
  async saveGame(g: GameRecord) {
    this.games.set(g.id, { ...g });
  }
}
