import { allPositions, type Board } from '../go/board';
import { engineKomi } from '../go/rules';
import { engineEvaluator, Search } from '../engine/mcts';
import type { EngineBackend } from '../engine/types';
import type { GameAnalysis, GameRecord, PositionEval } from '../types';
import { ANALYSIS_VERSION, evaluateFast, positionKey, rootPosition, searchedEval, toPlayAt, type PositionSpec } from './analyzer';

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

async function cachedOr(store: AnalysisStore, key: string, compute: () => Promise<PositionEval>) {
  const hit = await store.getCached(key);
  if (hit) return hit;
  const e = await compute();
  await store.putCached(e);
  return e;
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
  const analysis: GameAnalysis = stored && analysisIsCurrent(stored, game, engine.info.modelId) ? stored : freshAnalysis(game, komi);
  analysis.engine = engine.info;
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
  for (let i = 0; i <= n; i++) {
    if (analysis.evals[i]) continue;
    await opts.yieldTo?.();
    stop();
    const spec = specAt(game, boards, i);
    analysis.evals[i] = await cachedOr(store, positionKey(spec, engine.info.modelId), () => evaluateFast(engine, spec));
    game.progress.fast = analysis.evals.filter(Boolean).length;
    if (++since >= checkpoint) {
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
  const search = new Search(engineEvaluator(engine), rootPosition(specAt(game, boards, 0)), { batch: engine.batch ?? 1 });
  since = 0;
  for (let i = 0; i <= n; i++) {
    const current = analysis.evals[i]!;
    const want = analysis.deepTargets.includes(i) ? opts.visits * 4 : opts.visits;
    if (current.searched && current.visits >= want) continue;
    const spec = specAt(game, boards, i);
    const played = game.moves[i]?.loc;
    const cached = await store.getCached(current.key);
    if (cached?.searched && cached.visits >= want) {
      analysis.evals[i] = cached;
    } else {
      search.setPosition(rootPosition(spec));
      let snap;
      for (;;) {
        await opts.yieldTo?.();
        stop();
        snap = await search.run({ visits: want, forced: played, forcedShare: 0.1, shouldStop: () => !!opts.interrupted?.() || !!opts.shouldStop?.() });
        if (snap.visits >= want || search.rootVisits >= want) break;
        if (!opts.interrupted?.() && !opts.shouldStop?.()) break; // nothing left to search
      }
      analysis.evals[i] = searchedEval(current, snap, { played });
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
