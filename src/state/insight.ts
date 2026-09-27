import type { MoveInsight, ProFacts } from '../../shared/ask';
import type { PositionSpec } from '../lib/analysis/analyzer';
import { positionChoices, type MoveChoice } from '../lib/coach/choices';
import { findRate, findRates, REPORT_RANKS, STRONG_AMATEUR, type DifficultyModel } from '../lib/coach/difficulty';
import { classifyMove, CLASS_INFO, type ClassInput, type MoveClass } from '../lib/coach/classify';
import { proStats, type ProExplorer, type ProStats } from '../lib/coach/pro';
import { BrowserEngine } from '../lib/engine/browserEngine';
import { bundledModel } from '../lib/engine/models';
import { locToGtp } from '../lib/go/coords';
import { PASS, type Color, type Loc } from '../lib/go/types';
import { getEngine, markInteractive } from './actions';
import { get as getApp } from './store';

/**
 * Move insights: how good a move is (best, only move, brilliant...) and how hard it is to
 * find at each level, plus what professionals played from the same position. Difficulty
 * uses the bundled network's quick look, the ruler the difficulty model was fitted with, so
 * it runs on the main engine when that is the bundled network and on a small second engine
 * otherwise.
 */

let difficulty: Promise<DifficultyModel | null> | null = null;
let explorer: Promise<ProExplorer | null> | null = null;

const fetchJson = <T,>(url: string) =>
  fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
    .catch(() => null);

export const difficultyModel = () => (difficulty ??= fetchJson<DifficultyModel>('/coach/difficulty.json'));
export const proExplorer = () => (explorer ??= fetchJson<ProExplorer>('/pro/openings.json'));

let own: Promise<BrowserEngine> | null = null;
async function quickEngine() {
  const id = bundledModel().id;
  const main = getEngine();
  if (main && main.info.modelId === id) {
    markInteractive();
    return main;
  }
  own ??= (async () => {
    const cpuOnly = getApp().settings.forceCpu || !getApp().caps?.webgpu;
    return BrowserEngine.load({ spec: bundledModel(), forceCpu: cpuOnly }).catch((e) => {
      if (cpuOnly) throw e;
      return BrowserEngine.load({ spec: bundledModel(), forceCpu: true });
    });
  })();
  own.catch(() => (own = null));
  return own;
}

export interface MoveTarget {
  loc: Loc;
  role: 'played' | 'KataGo';
  /** What the classification needs, except how hard the move is to find. */
  input: Omit<ClassInput, 'strongFind'>;
}

/** How hard a move is to find (from the quick look), before it is graded. */
export interface MoveDifficulty {
  loc: Loc;
  rates: { rank: number; label: string; rate: number }[];
  /** How often strong amateurs (5d) play it. */
  strong: number | null;
}

export interface MoveInsightResult extends MoveDifficulty {
  role: 'played' | 'KataGo';
  label: MoveClass;
  gap?: { points: number; win: number } | null;
}

const cache = new Map<string, Promise<MoveChoice[]>>();

/** Choices at a position (cached per position and requested moves). */
function choicesAt(key: string, spec: PositionSpec, extra: Loc[]): Promise<MoveChoice[]> {
  const k = `${key}|${[...extra].sort().join(',')}`;
  let p = cache.get(k);
  if (!p) {
    p = quickEngine().then((eng) => positionChoices(eng, spec, extra).then((c) => c.choices));
    p.catch(() => cache.delete(k));
    cache.set(k, p);
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
  }
  return p;
}

export async function moveDifficulty(key: string, spec: PositionSpec, locs: readonly Loc[], extraRanks: number[] = []): Promise<MoveDifficulty[]> {
  const model = await difficultyModel();
  const ls = [...new Set(locs.filter((l) => l !== PASS))];
  if (!model || !ls.length) return [];
  const choices = await choicesAt(key, spec, ls);
  const ranks = [...new Set([...REPORT_RANKS, ...extraRanks.map((r) => Math.round(r))])].sort((a, b) => a - b);
  return ls.map((loc) => ({ loc, rates: findRates(model, choices, loc, ranks), strong: findRate(model, STRONG_AMATEUR, choices, loc) }));
}

/** Grade the targets with their difficulty (brilliant needs both). */
export function gradeMoves(targets: readonly MoveTarget[], diffs: readonly MoveDifficulty[]): MoveInsightResult[] {
  return targets.flatMap((t) => {
    const d = diffs.find((x) => x.loc === t.loc);
    return d ? [{ ...d, role: t.role, gap: t.input.gap, label: classifyMove({ ...t.input, strongFind: d.strong }) }] : [];
  });
}

export async function proAt(stones: ArrayLike<number>, toPlay: Color, size: number, played?: Loc): Promise<ProStats | null> {
  if (size !== 19) return null;
  const ex = await proExplorer();
  return ex ? proStats(ex, stones, toPlay, size, played) : null;
}

/** For the language model's fact sheet. */
export function insightFacts(list: readonly MoveInsightResult[], size: number): MoveInsight[] {
  return list.map((i) => ({
    move: locToGtp(i.loc, size),
    role: i.role,
    label: CLASS_INFO[i.label].name,
    gap: i.gap ? { points: Math.round(i.gap.points * 10) / 10, winrate: Math.round(i.gap.win * 1000) / 10 } : undefined,
    findRates: i.rates.map((r) => ({ level: r.label, percent: Math.round(r.rate * 100) })),
  }));
}

export function proFacts(s: ProStats, size: number): ProFacts {
  return {
    games: s.games,
    moves: s.moves.slice(0, 5).map((m) => ({ move: locToGtp(m.loc, size), games: m.count, percent: Math.round((100 * m.count) / s.games), winPercent: Math.round(100 * m.winRate) })),
  };
}
