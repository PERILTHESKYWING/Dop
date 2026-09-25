import { allPositions, type Board } from '../go/board';
import { PASS, type Loc } from '../go/types';
import { moverView } from '../engine/parse';
import type { EngineBackend } from '../engine/types';
import type { GameAnalysis, GameRecord, PositionEval } from '../types';
import { evaluateDeep, evaluateFast, positionKey, toPlayAt, type PositionSpec } from './analyzer';

/** Where analysis results live. IndexedDB in the browser, memory in tests and scripts. */
export interface AnalysisStore {
  getCached(key: string): Promise<PositionEval | undefined>;
  putCached(e: PositionEval): Promise<void>;
  loadAnalysis(gameId: string): Promise<GameAnalysis | undefined>;
  saveAnalysis(a: GameAnalysis): Promise<void>;
  saveGame(g: GameRecord): Promise<void>;
}

export interface PipelineOptions {
  deepVisits: number;
  deepPerGame: number;
  maxSearchMs: number;
  /** Analyse only this colour's moves deeply (the studied player); null = both. */
  focusColor?: 1 | 2 | null;
  onProgress?: (g: GameRecord) => void;
  shouldStop?: () => boolean;
  /** Save progress every N positions (resumable analysis). */
  checkpointEvery?: number;
  /** Awaited before each engine request, so interactive use (the analysis board) goes first. */
  yieldTo?: () => Promise<void>;
}

export class AnalysisStopped extends Error {}

function specAt(game: GameRecord, boards: Board[], i: number): PositionSpec {
  return {
    size: game.size,
    komi: game.komi,
    setup: game.setup,
    history: game.moves.slice(0, i),
    toPlay: toPlayAt(game.setup, game.moves, i, game.handicap),
    board: boards[i],
  };
}

/**
 * Pick positions worth a deep look: the biggest fast-pass swings on the studied
 * player's moves, plus some decision-rich positions (a close call between the top
 * moves) so training can include positions the player got right.
 */
export function selectDeepTargets(game: GameRecord, evals: (PositionEval | null)[], budget: number, focus: 1 | 2 | null): number[] {
  const scored: { i: number; score: number; rich: number }[] = [];
  for (let i = 0; i < game.moves.length; i++) {
    const m = game.moves[i];
    if (m.loc === PASS) continue;
    if (focus && m.color !== focus) continue;
    const before = evals[i];
    const after = evals[i + 1];
    if (!before || !after) continue;
    const b = moverView(before.bWin, before.bLead, m.color);
    const a = moverView(after.bWin, after.bLead, m.color);
    const scoreLoss = Math.max(0, b.lead - a.lead);
    const wrLoss = Math.max(0, b.win - a.win);
    const inTop = before.policy.slice(0, 3).some((p) => p.loc === m.loc);
    // Decided games: winrate barely moves, so score carries the signal.
    const score = scoreLoss + wrLoss * 40 + (inTop ? 0 : 0.5);
    const p0 = before.policy[0]?.p ?? 1;
    const p1 = before.policy[1]?.p ?? 0;
    const rich = p1 / Math.max(p0, 1e-6); // close call between the top two moves
    scored.push({ i, score, rich });
  }
  const bySwing = [...scored].sort((a, b) => b.score - a.score);
  const nSwing = Math.ceil(budget * 0.7);
  const chosen = new Set(bySwing.slice(0, nSwing).map((s) => s.i));
  for (const s of [...scored].sort((a, b) => b.rich - a.rich)) {
    if (chosen.size >= budget) break;
    chosen.add(s.i);
  }
  return [...chosen].sort((a, b) => a - b);
}

async function cachedOr(store: AnalysisStore, key: string, compute: () => Promise<PositionEval>, needDeep = false) {
  const hit = await store.getCached(key);
  if (hit && (!needDeep || hit.depth === 'deep')) return hit;
  const e = await compute();
  await store.putCached(e);
  return e;
}

/**
 * Analyse one game: a fast pass over every position, then a deep pass over the
 * important ones. Progress is checkpointed so an interrupted run resumes where it
 * stopped, and identical positions are served from the cache.
 */
export async function analyzeGame(game: GameRecord, engine: EngineBackend, store: AnalysisStore, opts: PipelineOptions): Promise<GameAnalysis> {
  const boards = allPositions(game.size, game.setup, game.moves);
  const n = game.moves.length;
  let analysis: GameAnalysis = (await store.loadAnalysis(game.id)) ?? {
    gameId: game.id,
    evals: new Array(n + 1).fill(null),
    deepTargets: [],
    updatedAt: Date.now(),
  };
  if (analysis.evals.length !== n + 1) analysis = { ...analysis, evals: new Array(n + 1).fill(null), deepTargets: [] };
  // Analyses from a different network are redone.
  if (analysis.engine && analysis.engine.modelId !== engine.info.modelId) {
    analysis = { ...analysis, evals: new Array(n + 1).fill(null), deepTargets: [] };
  }
  analysis.engine = engine.info;
  const checkpoint = opts.checkpointEvery ?? 12;
  const stop = () => {
    if (opts.shouldStop?.()) throw new AnalysisStopped('stopped');
  };

  game.status = 'fast';
  game.error = undefined;
  game.progress = { ...game.progress, total: n + 1 };
  let since = 0;
  for (let i = 0; i <= n; i++) {
    if (analysis.evals[i]) continue;
    await opts.yieldTo?.();
    stop();
    const spec = specAt(game, boards, i);
    const key = positionKey(spec, engine.info.modelId);
    analysis.evals[i] = await cachedOr(store, key, () => evaluateFast(engine, spec));
    game.progress.fast = analysis.evals.filter(Boolean).length;
    if (++since >= checkpoint) {
      since = 0;
      analysis.updatedAt = Date.now();
      await store.saveAnalysis(analysis);
      await store.saveGame(game);
      opts.onProgress?.(game);
    }
  }
  game.progress.fast = n + 1;
  await store.saveAnalysis(analysis);

  // Deep pass.
  if (!analysis.deepTargets.length) {
    analysis.deepTargets = selectDeepTargets(game, analysis.evals, opts.deepPerGame, opts.focusColor ?? game.playerColor);
  }
  game.status = 'deep';
  game.progress.deepTotal = analysis.deepTargets.length;
  game.progress.deep = analysis.deepTargets.filter((i) => analysis.evals[i]?.depth === 'deep').length;
  await store.saveGame(game);
  opts.onProgress?.(game);

  for (const i of analysis.deepTargets) {
    if (analysis.evals[i]?.depth === 'deep') continue;
    await opts.yieldTo?.();
    stop();
    const spec = specAt(game, boards, i);
    const played: Loc = game.moves[i]?.loc ?? PASS;
    const fast = analysis.evals[i]!;
    // Evaluation after the played move is simply the next position's fast eval.
    const next = analysis.evals[i + 1];
    const evalAfter = async (loc: Loc) => (loc === played && next ? { bWin: next.bWin, bLead: next.bLead } : null);
    const deep = await cachedOr(
      store,
      fast.key,
      () => evaluateDeep(engine, spec, fast, { visits: opts.deepVisits, maxMs: opts.maxSearchMs, mustInclude: [played] }, evalAfter),
      true,
    );
    // A cached deep eval may lack this game's played move (same position, other game).
    if (played !== PASS && !deep.candidates?.some((c) => c.loc === played)) {
      const redo = await evaluateDeep(engine, spec, fast, { visits: opts.deepVisits, maxMs: opts.maxSearchMs, mustInclude: [played] }, evalAfter);
      await store.putCached(redo);
      analysis.evals[i] = redo;
    } else analysis.evals[i] = deep;
    game.progress.deep++;
    analysis.updatedAt = Date.now();
    await store.saveAnalysis(analysis);
    await store.saveGame(game);
    opts.onProgress?.(game);
  }
  game.status = 'done';
  await store.saveAnalysis(analysis);
  await store.saveGame(game);
  opts.onProgress?.(game);
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
