import { create } from 'zustand';
import { analyzeGame, MemoryStore } from '../lib/analysis/pipeline';
import { BrowserEngine } from '../lib/engine/browserEngine';
import { bundledModel } from '../lib/engine/models';
import type { Color, Move } from '../lib/go/types';
import { estimateWith, type LevelCalibration, type LevelEstimate } from '../lib/level/model';
import { gameLevelSample, networkCoverage, networkRecords, PHASES, type GameLevelSample } from '../lib/level/stats';
import type { GameAnalysis, GameRecord, Phase } from '../lib/types';
import { hashString } from '../lib/util/hash';
import { keyOf, loadLevel, useLevel } from './level';
import { get as getApp } from './store';

/**
 * The Skill tab: both players' level in one game, for the whole game and each phase.
 * Measured the way the rank calibration was (the bundled network's first look at every
 * position): read straight from the game's analysis when it was made with that network,
 * otherwise with a bundled-network engine of its own that looks at each position once.
 */

export interface SkillGame {
  size: number;
  komi: number;
  rules?: string;
  handicap?: number;
  setup?: Move[];
  moves: Move[];
  black: string;
  white: string;
  /** The saved game it comes from, when there is one (its stored measurements are reused). */
  gameId?: string;
  analysis?: GameAnalysis;
}

export type SideSkill = { overall: LevelEstimate | null; phases: Partial<Record<Phase, LevelEstimate>> };
export type GameSkill = Record<Color, SideSkill>;

interface SkillState {
  /** Samples per game key (moves hash), both sides. */
  samples: Record<string, Record<Color, GameLevelSample | null>>;
  running: { key: string; done: number; total: number } | null;
  error: string | null;
}

export const useSkill = create<SkillState>(() => ({ samples: {}, running: null, error: null }));

export const skillKey = (g: SkillGame) => `${g.size}|${g.komi}|${hashString(JSON.stringify([g.setup ?? [], g.moves]))}`;

function record(g: SkillGame, key: string): GameRecord {
  return {
    id: `skill:${key}`,
    source: 'opponent',
    fileName: '',
    sgf: '',
    size: g.size,
    komi: g.komi,
    handicap: g.handicap ?? 0,
    setup: g.setup ?? [],
    moves: g.moves,
    black: g.black,
    white: g.white,
    rules: g.rules,
    playerColor: null,
    importedAt: 0,
    status: 'pending',
    warnings: [],
    progress: { fast: 0, deep: 0, deepTotal: 0, total: g.moves.length + 1 },
  };
}

/** Samples readable without engine work: from the analysis or from stored level measurements. */
function known(cal: LevelCalibration, g: SkillGame, key: string): Record<Color, GameLevelSample | null> | null {
  const cached = useSkill.getState().samples[key];
  if (cached) return cached;
  if (g.analysis && g.analysis.engine?.modelId === cal.modelId && networkCoverage(g.analysis) >= 0.9 && g.analysis.evals.length >= g.moves.length + 1) {
    const recs = networkRecords(record(g, key), g.analysis);
    return { 1: gameLevelSample(recs, 1), 2: gameLevelSample(recs, 2) };
  }
  if (g.gameId) {
    const s = useLevel.getState().samples;
    const b = s[keyOf(g.gameId, 1)], w = s[keyOf(g.gameId, 2)];
    if (b && w) return { 1: b.sample, 2: w.sample };
  }
  return null;
}

function estimate(cal: LevelCalibration, s: GameLevelSample | null): SideSkill {
  if (!s) return { overall: null, phases: {} };
  const overall = estimateWith(cal, null, [s]);
  const phases: Partial<Record<Phase, LevelEstimate>> = {};
  for (const p of PHASES) {
    const f = s.phases[p];
    const e = f ? estimateWith(cal, p, [f], overall?.rank) : null;
    if (e) phases[p] = e;
  }
  return { overall, phases };
}

/** Both players' skill in this game, or null while it still has to be measured. */
export function gameSkill(cal: LevelCalibration, g: SkillGame): GameSkill | null {
  const key = skillKey(g);
  const s = known(cal, g, key);
  return s ? { 1: estimate(cal, s[1]), 2: estimate(cal, s[2]) } : null;
}

let engine: Promise<BrowserEngine> | null = null;
/** Positions already read, shared between runs (a live game or a study line grows a move at a time). */
let positions = new MemoryStore();
let runs = 0;
let idle: ReturnType<typeof setTimeout> | null = null;
let wanted: string | null = null;

function levelEngine(): Promise<BrowserEngine> {
  if (idle) clearTimeout(idle);
  if (!engine) {
    const cpuOnly = getApp().settings.forceCpu || !getApp().caps?.webgpu;
    engine = BrowserEngine.load({ spec: bundledModel(), forceCpu: cpuOnly }).catch((e) => {
      if (cpuOnly) throw e;
      return BrowserEngine.load({ spec: bundledModel(), forceCpu: true });
    });
    engine.catch(() => (engine = null));
  }
  return engine;
}

/** Free the engine a while after the last measurement. */
function releaseLater() {
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => {
    void engine?.then((e) => e.terminate()).catch(() => undefined);
    engine = null;
  }, 60_000);
}

/** Measure this game (both sides) unless it is known already. The latest request wins. */
export async function measureSkill(g: SkillGame): Promise<void> {
  await loadLevel();
  const cal = useLevel.getState().calibration;
  if (!cal) return;
  const key = skillKey(g);
  if (known(cal, g, key)) return;
  wanted = key;
  if (useSkill.getState().running) return; // the running one picks the newest request up when it ends
  const game = record(g, key);
  useSkill.setState({ running: { key, done: 0, total: g.moves.length + 1 }, error: null });
  try {
    const eng = await levelEngine();
    if (++runs % 40 === 0) positions = new MemoryStore();
    const analysis = await analyzeGame(game, eng, positions, {
      visits: 0,
      stage: 'fast',
      shouldStop: () => wanted !== key,
      onProgress: (gr) => useSkill.setState({ running: { key, done: gr.progress.fast, total: gr.progress.total } }),
      checkpointEvery: 8,
    });
    const recs = networkRecords(game, analysis);
    useSkill.setState((s) => ({ samples: { ...s.samples, [key]: { 1: gameLevelSample(recs, 1), 2: gameLevelSample(recs, 2) } } }));
  } catch (e) {
    if (wanted === key) useSkill.setState({ error: (e as Error).message });
  } finally {
    useSkill.setState({ running: null });
    releaseLater();
  }
}
