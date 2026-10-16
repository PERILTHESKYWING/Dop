/**
 * The game rating on the Performance tab ("5.7d"), by Dop's level system (src/lib/level):
 * every position of the game is looked at once by the bundled b10 network, with no search,
 * because that is how the rank calibration was measured, and each side's numbers are
 * placed on the calibrated scale. A second, small engine does this and then stops, so the
 * board's own KataGo (often the bigger b18) keeps reading meanwhile.
 */
import { useEffect, useState } from 'react';
import { analyzeGame, MemoryStore } from '../../../src/lib/analysis/pipeline';
import { BrowserEngine, detectCapabilities } from '../../../src/lib/engine/browserEngine';
import { bundledModel } from '../../../src/lib/engine/models';
import type { Color, Move } from '../../../src/lib/go/types';
import { estimateWith, type LevelCalibration } from '../../../src/lib/level/model';
import { gameLevelSample, networkRecords, PHASES, type GameLevelSample } from '../../../src/lib/level/stats';
import type { GameRecord, Phase } from '../../../src/lib/types';
import type { BoardState } from './position';

export interface SideRating {
  /** On Dop's scale: 0 = 1k, 1 = 1d, 9 = 9d, 10 = pro (see src/lib/level/ranks). */
  rank: number;
  /** 80% range. */
  low: number;
  high: number;
  /** Rank by phase, where that side played enough moves in it. */
  phases: Partial<Record<Phase, number>>;
  /** Moves counted (moves in a decided game say little and are left out). */
  moves: number;
}

export type GameRating =
  | { state: 'measuring'; done: number; total: number }
  | {
      state: 'done';
      sides: Record<Color, SideRating | null>;
      /** By move index: how likely the network alone thought the played move (for Brilliant). */
      policy: Map<number, number>;
    }
  | { state: 'failed'; error: string };

let calibration: Promise<LevelCalibration> | null = null;
const loadCalibration = () =>
  (calibration ??= fetch('/level/calibration.json')
    .then((r) => (r.ok ? (r.json() as Promise<LevelCalibration>) : Promise.reject(new Error(`rating data: HTTP ${r.status}`))))
    .catch((e) => {
      calibration = null;
      throw e;
    }));

/** The rating of one side from its sample, or null when it played too few counted moves. */
export function sideRating(cal: LevelCalibration, sample: GameLevelSample | null): SideRating | null {
  if (!sample) return null;
  const all = estimateWith(cal, null, [sample]);
  if (!all) return null;
  const phases: Partial<Record<Phase, number>> = {};
  for (const p of PHASES) {
    const f = sample.phases[p];
    const e = f ? estimateWith(cal, p, [f], all.raw ?? all.rank) : null;
    if (e) phases[p] = e.rank;
  }
  return { rank: all.rank, low: all.low, high: all.high, phases, moves: sample.all.n };
}

const key = (b: BoardState) => `${b.size}|${b.komi}|${b.rules ?? ''}|${b.first}|${b.setup.map((m) => `${m.color}${m.loc}`).join(',')}|${b.moves.map((m) => `${m.color}${m.loc}`).join(',')}`;

function gameOf(b: BoardState, moves: Move[]): GameRecord {
  return {
    id: 'kami-rating',
    source: 'user',
    fileName: '',
    sgf: '',
    size: b.size,
    komi: b.komi,
    rules: b.rules,
    handicap: 0,
    setup: b.setup,
    moves,
    black: b.black ?? 'Black',
    white: b.white ?? 'White',
    playerColor: null,
    importedAt: 0,
    status: 'pending',
    warnings: [],
    progress: { fast: 0, deep: 0, deepTotal: 0, total: moves.length + 1 },
  };
}

const done = new Map<string, GameRating>();
let running: { key: string; stop: boolean; listeners: Set<(r: GameRating) => void> } | null = null;

async function measure(b: BoardState, tell: (r: GameRating) => void, stopped: () => boolean): Promise<GameRating> {
  const cal = await loadCalibration();
  const caps = await detectCapabilities();
  const cpuOnly = !caps.webgpu;
  const engine = await BrowserEngine.load({ spec: bundledModel(), forceCpu: cpuOnly }).catch((e) => {
    if (cpuOnly) throw e;
    return BrowserEngine.load({ spec: bundledModel(), forceCpu: true });
  });
  try {
    const game = gameOf(b, b.moves);
    const total = b.moves.length + 1;
    const analysis = await analyzeGame(game, engine, new MemoryStore(), {
      visits: 0,
      stage: 'fast',
      shouldStop: stopped,
      onProgress: (g) => tell({ state: 'measuring', done: Math.min(total, g.progress.fast), total }),
    });
    const records = networkRecords(game, analysis);
    return {
      state: 'done',
      sides: { 1: sideRating(cal, gameLevelSample(records, 1)), 2: sideRating(cal, gameLevelSample(records, 2)) },
      policy: new Map(records.map((r) => [r.index, r.playedPolicy])),
    };
  } finally {
    engine.terminate();
  }
}

/**
 * Both sides' rating of the game on the board, measured while `active` (the Performance tab
 * is open). One game at a time; a finished one is remembered for this visit.
 */
export function useGameRating(b: BoardState, active: boolean): GameRating | null {
  const k = key(b);
  const [state, setState] = useState<{ k: string; r: GameRating | null }>({ k, r: done.get(k) ?? null });
  useEffect(() => {
    if (!active || !b.moves.length) return;
    const hit = done.get(k);
    if (hit) {
      setState({ k, r: hit });
      return;
    }
    const listen = (r: GameRating) => setState({ k, r });
    if (running?.key === k) {
      running.listeners.add(listen);
      return () => void running?.listeners.delete(listen);
    }
    if (running) running.stop = true;
    const job = { key: k, stop: false, listeners: new Set([listen]) };
    running = job;
    const tell = (r: GameRating) => job.listeners.forEach((l) => l(r));
    tell({ state: 'measuring', done: 0, total: b.moves.length + 1 });
    measure(b, tell, () => job.stop)
      .then((r) => {
        done.set(k, r);
        tell(r);
      })
      .catch((e: Error) => {
        if (!job.stop) tell({ state: 'failed', error: e.message });
      })
      .finally(() => {
        if (running === job) running = null;
      });
    return () => {
      job.listeners.delete(listen);
      // Nobody is waiting for it any more (the tab closed or the game changed).
      if (!job.listeners.size) job.stop = true;
    };
    // The measurement follows the game (k), not the board object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, active]);
  return state.k === k ? state.r : (done.get(k) ?? null);
}
