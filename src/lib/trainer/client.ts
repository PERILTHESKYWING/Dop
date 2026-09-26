/**
 * Client for Dop Trainer, the program in trainer/ that trains a Go network on the user's own GPU
 * and serves it on http://127.0.0.1:7474. The site only talks to it from the user's browser;
 * nothing goes through Vercel.
 */

export const DEFAULT_TRAINER_URL = 'http://127.0.0.1:7474';
const URL_KEY = 'dop.trainerUrl';

export function trainerUrl(): string {
  try {
    return localStorage.getItem(URL_KEY) || DEFAULT_TRAINER_URL;
  } catch {
    return DEFAULT_TRAINER_URL;
  }
}

export function setTrainerUrl(url: string) {
  try {
    const clean = url.trim().replace(/\/+$/, '');
    if (!clean || clean === DEFAULT_TRAINER_URL) localStorage.removeItem(URL_KEY);
    else localStorage.setItem(URL_KEY, clean);
  } catch {
    /* private mode: the default is used */
  }
}

export type TrainerPhase = 'starting' | 'selfplay' | 'shuffle' | 'train' | 'export' | 'rating' | 'waiting' | 'paused' | 'stopped' | 'error';

export interface GenerationView {
  gen: number;
  label: string;
  name: string;
  created: number;
  trainSamples: number | null;
  dataRows: number | null;
  selfplayGames: number | null;
  rated: boolean;
  /** False once the network file was deleted to save disk (every tenth generation is kept). */
  playable: boolean;
  elo: number | null;
  /** Standard error of the Elo estimate (null while unknown). */
  se: number | null;
}

export interface TrainerStatus {
  app: 'dop-trainer';
  version: string;
  katago: string;
  backend: string;
  modelKind: string;
  preset: string;
  phase: TrainerPhase;
  detail: string;
  done: number;
  total: number;
  phaseSeconds: number;
  cycle: number;
  paused: boolean;
  error: string;
  log: string[];
  selfplayGames: number;
  cycles: number;
  trainingHours: number;
  runStarted: number;
  generations: number;
  latest: GenerationView | null;
  uptime: number;
}

export interface ReferenceView {
  label: string;
  name: string;
  elo: number;
  se: number | null;
}

export interface TrainerHistory {
  generations: GenerationView[];
  references: ReferenceView[];
  pairs: { a: string; b: string; a_wins: number; b_wins: number }[];
  ratingVisits: number;
  ratingBoardSize: number;
}

export interface PlayRequest {
  /** Moves so far as [colour, GTP vertex], e.g. ["B", "Q16"] or ["W", "pass"]. */
  moves: [string, string][];
  size: number;
  komi: number;
  rules: string;
  visits: number;
  /** "latest" or a generation label like "gen12". */
  model: string;
}

export interface PlayCandidate {
  move: string;
  winrate: number;
  scoreLead: number;
  visits: number;
  pv: string[];
}

export interface PlayResponse {
  model: string;
  move: string;
  /** Black's winrate and score lead after the search. */
  winrate: number | null;
  scoreLead: number | null;
  visits: number | null;
  candidates: PlayCandidate[];
  seconds: number;
}

export class TrainerError extends Error {
  constructor(
    message: string,
    /** 'offline': nothing answered (not running, or the browser blocked the local connection). */
    public kind: 'offline' | 'http',
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(trainerUrl() + path, { ...init, signal: ctl.signal, cache: 'no-store' });
  } catch (e) {
    throw new TrainerError((e as Error).name === 'AbortError' ? 'The trainer did not answer in time.' : 'Could not reach the trainer.', 'offline');
  } finally {
    clearTimeout(timer);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new TrainerError((body as { error?: string }).error || `The trainer answered ${res.status}.`, 'http');
  return body as T;
}

const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const trainer = {
  status: () => call<TrainerStatus>('/api/status'),
  history: () => call<TrainerHistory>('/api/history'),
  play: (req: PlayRequest) => call<PlayResponse>('/api/play', post(req), 180_000),
  control: (action: 'pause' | 'resume') => call<{ ok: boolean; paused: boolean }>('/api/control', post({ action })),
};

/** Milestones worth celebrating, from the rating history (in the order they can happen). */
export interface Milestone {
  id: string;
  title: string;
  detail: string;
  reachedAt: number | null;
  gen: string | null;
}

/**
 * Ratings are Elo above the untrained network (gen 0 = 0). A 200 Elo gap means the stronger side
 * wins about 76% of games; 400 means about 91%.
 */
export function milestones(h: TrainerHistory): Milestone[] {
  const gens = h.generations.filter((g) => g.elo !== null);
  const firstAbove = (elo: number) => gens.find((g) => (g.elo ?? -Infinity) >= elo) ?? null;
  const ref = (label: string) => h.references.find((r) => r.label === label) ?? null;
  const beat = (a: string, b: string) => h.pairs.find((p) => (p.a === a && p.b === b && p.a_wins > 0) || (p.b === a && p.a === b && p.b_wins > 0));
  const firstWin = (label: string) => h.generations.find((g) => beat(g.label, label)) ?? null;
  const out: Milestone[] = [];
  const add = (id: string, title: string, detail: string, g: GenerationView | null) => out.push({ id, title, detail, reachedAt: g?.created ?? null, gen: g?.label ?? null });
  add('first-net', 'First network', 'Training produced its first network from self-play.', h.generations[0] ?? null);
  add('e200', '+200 Elo', 'Beats the untrained network about 3 games in 4.', firstAbove(200));
  add('e500', '+500 Elo', 'Wins about 19 games in 20 against the untrained network.', firstAbove(500));
  add('e1000', '+1000 Elo', 'Plays with purpose: captures, connections, simple life and death.', firstAbove(1000));
  const rp = ref('ref-policy');
  add('ref-policy-win', 'First win against the reference instinct', 'Beat the strong b10 reference network playing without reading (1 visit).', firstWin('ref-policy'));
  if (rp) add('ref-policy-par', 'Level with the reference instinct', 'Rated as high as the b10 reference playing on instinct alone.', firstAbove(rp.elo));
  add('ref-win', `First win against the reference at ${h.ratingVisits} visits`, 'Beat the b10 reference network when both sides read ahead.', firstWin('ref'));
  return out;
}

export function fmtElo(elo: number | null | undefined, sign = true): string {
  if (elo === null || elo === undefined || !Number.isFinite(elo)) return '–';
  const r = Math.round(elo);
  return sign && r > 0 ? `+${r}` : String(r);
}

export function fmtAgo(ts: number | null | undefined): string {
  if (!ts) return '';
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export function fmtDuration(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} days`;
}
