import { create } from 'zustand';
import { analyzeGame, MemoryStore } from '../lib/analysis/pipeline';
import { kvGet, kvSet } from '../lib/db/db';
import { BrowserEngine } from '../lib/engine/browserEngine';
import { bundledModel } from '../lib/engine/models';
import type { Color } from '../lib/go/types';
import { estimateLevel, type LevelCalibration, type PlayerLevel } from '../lib/level/model';
import { gameLevelSample, networkCoverage, networkRecords, type GameLevelSample } from '../lib/level/stats';
import type { GameAnalysis, GameRecord } from '../lib/types';
import { get as getApp } from './store';

/**
 * Level estimation state. The rank calibration was measured with the bundled network's
 * first look at every position, so a player's games are measured the same way: straight
 * from their analysis when it was made with that network, otherwise with a second,
 * bundled-network engine that looks at each position once (no search) and then stops.
 */

export interface SideSample {
  gameId: string;
  color: Color;
  sample: GameLevelSample | null;
  at: number;
}

interface LevelState {
  calibration: LevelCalibration | null;
  calibrationError: string | null;
  samples: Record<string, SideSample>;
  loaded: boolean;
  /** The measurement running now (one at a time), with the game sides it covers. */
  measuring: { done: number; total: number; current?: string; keys: string[] } | null;
}

export const useLevel = create<LevelState>(() => ({ calibration: null, calibrationError: null, samples: {}, loaded: false, measuring: null }));

const KV = 'level.samples.v1';
export const keyOf = (gameId: string, color: Color) => `${gameId}:${color}`;

let loading: Promise<void> | null = null;

export function loadLevel(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    const [cal, samples] = await Promise.all([
      fetch('/level/calibration.json')
        .then((r) => (r.ok ? (r.json() as Promise<LevelCalibration>) : Promise.reject(new Error(`HTTP ${r.status}`))))
        .catch((e: Error) => {
          useLevel.setState({ calibrationError: e.message });
          return null;
        }),
      kvGet<Record<string, SideSample>>(KV).catch(() => undefined),
    ]);
    useLevel.setState({ calibration: cal, samples: samples ?? {}, loaded: true });
  })();
  return loading;
}

export function levelCalibration(): Promise<LevelCalibration | null> {
  return loadLevel().then(() => useLevel.getState().calibration);
}

/** A side of a game whose level sample can be read from its analysis without new engine work. */
function sampleFromAnalysis(cal: LevelCalibration, game: GameRecord, analysis: GameAnalysis | undefined, color: Color): GameLevelSample | null | undefined {
  if (!analysis || analysis.engine?.modelId !== cal.modelId || networkCoverage(analysis) < 0.9) return undefined;
  return gameLevelSample(networkRecords(game, analysis), color);
}

export interface LevelTarget {
  game: GameRecord;
  color: Color;
}

/** The sides an opponent played in their games (matched by name or alias). */
export function opponentTargets(o: { name: string; aliases: string[] }, games: readonly GameRecord[]): LevelTarget[] {
  const names = new Set([o.name, ...o.aliases].map((n) => n.trim().toLowerCase()));
  const out: LevelTarget[] = [];
  for (const g of games) {
    const color: Color | null = names.has(g.black.trim().toLowerCase()) ? 1 : names.has(g.white.trim().toLowerCase()) ? 2 : null;
    if (color) out.push({ game: g, color });
  }
  return out;
}

/** The level of whoever played `targets`, from the samples measured so far. */
export function levelOf(targets: readonly LevelTarget[]): PlayerLevel | null {
  const { calibration, samples } = useLevel.getState();
  if (!calibration) return null;
  const analyses = getApp().analyses;
  const list: GameLevelSample[] = [];
  const ordered = [...targets].sort((a, b) => (a.game.date ?? '').localeCompare(b.game.date ?? '') || a.game.importedAt - b.game.importedAt);
  for (const t of ordered) {
    const s = samples[keyOf(t.game.id, t.color)]?.sample ?? sampleFromAnalysis(calibration, t.game, analyses[t.game.id], t.color);
    if (s) list.push(s);
  }
  return list.length ? estimateLevel(calibration, list) : null;
}

/** Targets not yet measured (and not readable from their analysis). */
export function unmeasured(targets: readonly LevelTarget[]): LevelTarget[] {
  const { calibration, samples } = useLevel.getState();
  if (!calibration) return [];
  const analyses = getApp().analyses;
  return targets.filter((t) => !samples[keyOf(t.game.id, t.color)] && sampleFromAnalysis(calibration, t.game, analyses[t.game.id], t.color) === undefined);
}

let stopRequested = false;
export function stopMeasuring() {
  stopRequested = true;
}

/**
 * Look at every position of the unmeasured games once with the bundled network.
 * Several sides of one game share the work. Safe to call repeatedly.
 */
export async function measureLevel(targets: readonly LevelTarget[]): Promise<void> {
  await loadLevel();
  if (useLevel.getState().measuring) return;
  const todo = unmeasured(targets);
  if (!todo.length) return;
  const byGame = new Map<string, LevelTarget[]>();
  for (const t of todo) byGame.set(t.game.id, [...(byGame.get(t.game.id) ?? []), t]);
  stopRequested = false;
  const keys = todo.map((t) => keyOf(t.game.id, t.color));
  useLevel.setState({ measuring: { done: 0, total: byGame.size, keys } });
  let engine: BrowserEngine | null = null;
  try {
    const cpuOnly = getApp().settings.forceCpu || !getApp().caps?.webgpu;
    engine = await BrowserEngine.load({ spec: bundledModel(), forceCpu: cpuOnly }).catch((e) => {
      if (cpuOnly) throw e;
      return BrowserEngine.load({ spec: bundledModel(), forceCpu: true });
    });
    let done = 0;
    for (const [gameId, sides] of byGame) {
      if (stopRequested) break;
      const game = sides[0].game;
      useLevel.setState({ measuring: { done, total: byGame.size, current: `${game.black} – ${game.white}`, keys } });
      const copy: GameRecord = structuredClone(game);
      const analysis = await analyzeGame(copy, engine, new MemoryStore(), { visits: 0, stage: 'fast', shouldStop: () => stopRequested });
      const records = networkRecords(copy, analysis);
      const samples = { ...useLevel.getState().samples };
      for (const s of sides) samples[keyOf(gameId, s.color)] = { gameId, color: s.color, sample: gameLevelSample(records, s.color), at: Date.now() };
      useLevel.setState({ samples });
      await kvSet(KV, samples);
      done++;
    }
  } catch (e) {
    if (!stopRequested) throw e;
  } finally {
    engine?.terminate();
    useLevel.setState({ measuring: null });
  }
  // The weaknesses' comparison with rank peers depends on the level.
  void import('./actions').then((m) => m.rebuildProfile());
}
