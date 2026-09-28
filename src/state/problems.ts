import { create } from 'zustand';
import { kvGet, kvSet } from '../lib/db/db';
import { dayKey, loadBank, type History } from '../lib/problems/bank';
import { rankToRating, ratingToRank, updateRating } from '../lib/problems/level';
import { fallbackText, writeTexts } from '../lib/problems/text';
import type { Problem, ProblemCategory } from '../lib/problems/types';
import type { ProblemText } from '../../shared/forgeWriter';

/**
 * Forge problems: the player's settings, results, rating and streak, and the texts the
 * language model wrote. Kept in the key-value store (no database migration needed).
 */

export interface ForgePrefs {
  categories: ProblemCategory[];
  /** Level range, rank numbers (1k = 0, 1d = 1). */
  minLevel: number;
  maxLevel: number;
  /** Problems per set. */
  count: number;
  /** Seconds per problem (0 = no limit). */
  timeLimit: number;
  /** The side that is behind keeps at least this winrate (whole-board problems; local ones are even by design). */
  minLosingWinrate: number;
  /** Longest answer in the player's moves (0 = any). */
  maxMoves: number;
  /** Tap a point, then tap again to play it (safer on phones). */
  confirmMove: boolean;
  /** Go on to the next problem by itself after a right answer. */
  autoNext: boolean;
  /** After a wrong move: show the answer, or let me try again. */
  onWrong: 'answer' | 'retry';
  coords: boolean;
  sound: boolean;
  /** Let the language model write hints and explanations (when it is set up). */
  llmText: boolean;
}

export const DEFAULT_PREFS: ForgePrefs = {
  categories: ['life', 'tesuji'],
  minLevel: -9,
  maxLevel: -3,
  count: 10,
  timeLimit: 0,
  minLosingWinrate: 0.3,
  maxMoves: 0,
  confirmMove: false,
  autoNext: false,
  onWrong: 'answer',
  coords: true,
  sound: true,
  llmText: true,
};

export interface ProblemResult {
  id: string;
  cat: ProblemCategory;
  level: number;
  at: number;
  /** Solved at the first try, without a hint. */
  ok: boolean;
  /** Solved in the end (after retries or a hint). */
  solved: boolean;
  tries: number;
  hint: boolean;
  ms: number;
  /** Rating before and after. */
  before: number;
  after: number;
}

export interface ForgeProgress {
  /** Null until the player's starting level is known. */
  rating: number | null;
  results: ProblemResult[];
  ratingHistory: { at: number; rating: number }[];
  streak: { days: number; best: number; lastDay: string };
  /** Best run of right answers in a row. */
  bestCombo: number;
  /** Problems the language model judged not worth asking. */
  hidden: string[];
  /** Daily set: day and ids solved today. */
  daily: { day: string; done: string[] };
}

const EMPTY_PROGRESS: ForgeProgress = {
  rating: null,
  results: [],
  ratingHistory: [],
  streak: { days: 0, best: 0, lastDay: '' },
  bestCombo: 0,
  hidden: [],
  daily: { day: '', done: [] },
};

interface ForgeState {
  loaded: boolean;
  prefs: ForgePrefs;
  progress: ForgeProgress;
  texts: Record<string, ProblemText>;
  bank: Problem[] | null;
  bankError: string | null;
  /** Problem ids whose text is being written now. */
  writing: string[];
}

export const useForge = create<ForgeState>(() => ({
  loaded: false,
  prefs: DEFAULT_PREFS,
  progress: EMPTY_PROGRESS,
  texts: {},
  bank: null,
  bankError: null,
  writing: [],
}));

const K_PREFS = 'forge.prefs.v1';
const K_PROGRESS = 'forge.progress.v1';
const K_TEXTS = 'forge.texts.v1';
const MAX_RESULTS = 5000;
const MAX_TEXTS = 3000;

let loading: Promise<void> | null = null;

export function loadForge(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    const [prefs, progress, texts] = await Promise.all([
      kvGet<ForgePrefs>(K_PREFS).catch(() => undefined),
      kvGet<ForgeProgress>(K_PROGRESS).catch(() => undefined),
      kvGet<Record<string, ProblemText>>(K_TEXTS).catch(() => undefined),
    ]);
    useForge.setState({
      loaded: true,
      prefs: { ...DEFAULT_PREFS, ...prefs },
      progress: { ...EMPTY_PROGRESS, ...progress },
      texts: texts ?? {},
    });
    try {
      const bank = await loadBank();
      useForge.setState({ bank: bank.problems, bankError: null });
    } catch (e) {
      useForge.setState({ bankError: (e as Error).message });
    }
  })();
  return loading;
}

export async function savePrefs(patch: Partial<ForgePrefs>) {
  const prefs = { ...useForge.getState().prefs, ...patch };
  useForge.setState({ prefs });
  await kvSet(K_PREFS, prefs);
}

async function saveProgress(progress: ForgeProgress) {
  useForge.setState({ progress });
  await kvSet(K_PROGRESS, progress);
}

export function setStartingLevel(rank: number) {
  const p = useForge.getState().progress;
  return saveProgress({ ...p, rating: rankToRating(rank), ratingHistory: [...p.ratingHistory, { at: Date.now(), rating: rankToRating(rank) }] });
}

export const playerRank = (p: ForgeProgress, fallback = -5) => (p.rating === null ? fallback : ratingToRank(p.rating));

export function historyOf(p: ForgeProgress): History {
  const last = new Map<string, { at: number; ok: boolean }>();
  for (const r of p.results) last.set(r.id, { at: r.at, ok: r.ok });
  return { last };
}

/** Right answers in a row at the end of the history. */
export function currentCombo(p: ForgeProgress): number {
  let n = 0;
  for (let i = p.results.length - 1; i >= 0 && p.results[i].ok; i--) n++;
  return n;
}

/**
 * Record a finished problem: rating (a first-try solve counts 1, a solve after a retry or
 * hint 0.5, a miss 0), streak of days and the daily set.
 */
export async function recordResult(problem: Problem, r: Omit<ProblemResult, 'before' | 'after' | 'id' | 'cat' | 'level' | 'at'>, daily = false): Promise<ProblemResult> {
  const p = useForge.getState().progress;
  const before = p.rating ?? rankToRating(-5);
  const score = r.ok ? 1 : r.solved ? 0.5 : 0;
  const after = Math.round(updateRating(before, problem.level, score, p.results.length));
  const now = Date.now();
  const res: ProblemResult = { ...r, id: problem.id, cat: problem.cat, level: problem.level, at: now, before, after };
  const today = dayKey(now);
  const yesterday = dayKey(now - 86_400_000);
  let streak = p.streak;
  if (streak.lastDay !== today) {
    const days = streak.lastDay === yesterday ? streak.days + 1 : 1;
    streak = { days, best: Math.max(streak.best, days), lastDay: today };
  }
  const results = [...p.results, res].slice(-MAX_RESULTS);
  const next: ForgeProgress = {
    ...p,
    rating: after,
    results,
    ratingHistory: [...p.ratingHistory, { at: now, rating: after }].slice(-1000),
    streak,
    bestCombo: Math.max(p.bestCombo, currentCombo({ ...p, results })),
    daily: daily ? { day: today, done: [...(p.daily.day === today ? p.daily.done : []), problem.id] } : p.daily,
  };
  await saveProgress(next);
  return res;
}

export const textOf = (p: Problem): ProblemText => useForge.getState().texts[p.id] ?? fallbackText(p);

/**
 * Have the language model write (and judge) the texts of a set before it is played, in one
 * request. Problems it judges not worth asking are hidden from later sets.
 */
export async function ensureTexts(problems: Problem[], playerLevel: number): Promise<void> {
  const s = useForge.getState();
  if (!s.prefs.llmText) return;
  const todo = problems.filter((p) => !s.texts[p.id] && !s.writing.includes(p.id));
  if (!todo.length) return;
  useForge.setState({ writing: [...s.writing, ...todo.map((p) => p.id)] });
  try {
    for (let i = 0; i < todo.length; i += 10) {
      const batch = todo.slice(i, i + 10);
      const res = await writeTexts(batch, playerLevel);
      if (!res) break;
      const texts = { ...useForge.getState().texts };
      const hidden = new Set(useForge.getState().progress.hidden);
      for (const t of res.texts) {
        texts[t.id] = t;
        if (!t.keep || t.instructive <= 1) hidden.add(t.id);
      }
      const keys = Object.keys(texts);
      if (keys.length > MAX_TEXTS) for (const k of keys.slice(0, keys.length - MAX_TEXTS)) delete texts[k];
      useForge.setState({ texts });
      await kvSet(K_TEXTS, texts);
      if (hidden.size !== useForge.getState().progress.hidden.length) await saveProgress({ ...useForge.getState().progress, hidden: [...hidden] });
    }
  } finally {
    const ids = new Set(todo.map((p) => p.id));
    useForge.setState((st) => ({ writing: st.writing.filter((w) => !ids.has(w)) }));
  }
}

/** Per category: problems tried, first-try solves, and the average level of those solved. */
export function categoryStats(p: ForgeProgress) {
  const out: Partial<Record<ProblemCategory, { tried: number; ok: number; level: number }>> = {};
  for (const r of p.results) {
    const s = (out[r.cat] ??= { tried: 0, ok: 0, level: 0 });
    s.tried++;
    if (r.ok) {
      s.level += r.level;
      s.ok++;
    }
  }
  for (const s of Object.values(out)) if (s && s.ok) s.level /= s.ok;
  return out;
}
