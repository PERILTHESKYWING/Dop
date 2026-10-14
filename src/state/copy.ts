import { create } from 'zustand';
import { db, kvGet, kvSet, markChanged } from '../lib/db/db';
import { decodeOwnership, moverView } from '../lib/engine/parse';
import type { Board } from '../lib/go/board';
import { replay } from '../lib/go/board';
import { buildContext } from '../lib/go/features';
import { PASS, type Color, type Loc, type Move } from '../lib/go/types';
import { describeExample } from '../lib/profile/copyTrain';
import { runCopyJob, type CopyReply, type CopyRequest } from '../lib/profile/copyJob';
import { readDials, type CopyDials } from '../lib/profile/dials';
import { buildExample, type DoppelExample, type DoppelModel } from '../lib/profile/doppel';
import { bestGenome } from '../lib/profile/evolve';
import { TILT_LOSS } from '../lib/profile/human';
import type { GameAnalysis, GameRecord, PolicyEntry, PositionEval } from '../lib/types';
import { uid } from '../lib/util/hash';

/**
 * The copy's training data and settings: examples from the player's analysed moves, the
 * "not me" corrections, the dials for games against it, and training/evolution in a worker.
 */

/** A "not me" from a game against the copy: the position, the copy's move, and the player's own (if they showed it). */
export interface CopyFeedback {
  id: string;
  at: number;
  /** "me" or an imported player's id. */
  copyOf: string;
  size: number;
  setup: Move[];
  history: Move[];
  toPlay: Color;
  /** KataGo's policy there (its top entries) and ownership, as read in the game. */
  policy: PolicyEntry[];
  ownership?: string;
  /** The copy's side's winrate. */
  win: number;
  copyLoc: Loc;
  /** Where the player says they would have played (null: only "not this"). */
  mine: Loc | null;
}

interface CopyLabState {
  loaded: boolean;
  dials: CopyDials;
  feedback: CopyFeedback[];
  /** Evolution running in the background. */
  evolving: null | { target: string; done: number; total: number; best: number | null };
}

export const useCopyLab = create<CopyLabState>(() => ({ loaded: false, dials: readDials(null), feedback: [], evolving: null }));

const DIALS_KEY = 'copyDials';
const FEEDBACK_KEY = 'copyFeedback';
/** Corrections kept (the newest). */
const MAX_FEEDBACK = 400;

let loading: Promise<void> | null = null;
export function loadCopyLab(): Promise<void> {
  if (!loading)
    loading = (async () => {
      try {
        const [dials, feedback] = await Promise.all([kvGet<unknown>(DIALS_KEY), kvGet<CopyFeedback[]>(FEEDBACK_KEY)]);
        useCopyLab.setState({ loaded: true, dials: readDials(dials), feedback: Array.isArray(feedback) ? feedback : [] });
      } catch {
        useCopyLab.setState({ loaded: true });
      }
    })();
  return loading;
}

export async function setCopyDials(d: CopyDials) {
  useCopyLab.setState({ dials: d });
  await kvSet(DIALS_KEY, d).catch(() => undefined);
}

export async function addCopyFeedback(f: Omit<CopyFeedback, 'id' | 'at'>) {
  await loadCopyLab();
  const fb: CopyFeedback = { ...f, id: uid('fb'), at: Date.now() };
  const list = [...useCopyLab.getState().feedback, fb].slice(-MAX_FEEDBACK);
  useCopyLab.setState({ feedback: list });
  await kvSet(FEEDBACK_KEY, list).catch(() => undefined);
  return fb;
}

/** Corrections not yet learned from (newer than the copy). */
export function pendingFeedback(copyOf: string, model: DoppelModel | null | undefined): number {
  const since = model?.trainedAt ?? 0;
  return useCopyLab.getState().feedback.filter((f) => f.copyOf === copyOf && f.at > since).length;
}

// ------------------------------------------------------------------ examples

/** What each of KataGo's evaluated candidates loses against the best of them (mover's points). */
export function candidateLosses(ev: Pick<PositionEval, 'candidates'>): Map<Loc, number> {
  const c = (ev.candidates ?? []).filter((x) => x.scoreLead !== undefined && x.loc !== PASS);
  const out = new Map<Loc, number>();
  if (c.length < 2) return out;
  const best = Math.max(...c.map((x) => x.scoreLead!));
  for (const x of c) out.set(x.loc, Math.max(0, best - x.scoreLead!));
  return out;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Copy training examples from one side's moves in analysed games, with what the mistake
 * model needs (candidate costs from KataGo's search, guard flags, mistake kinds), the book
 * keys, and each game's age in `order` (game ids, oldest first).
 */
export async function copyExamples(
  moves: readonly { gameId: string; index: number; color: Color; loc: Loc; scoreLoss?: number }[],
  gameOf: (id: string) => GameRecord | undefined,
  analysisOf: (id: string) => GameAnalysis | undefined,
  boardsOf: (id: string) => Board[],
  order: readonly string[] = [],
): Promise<DoppelExample[]> {
  const examples: DoppelExample[] = [];
  const age = new Map(order.map((id, i) => [id, order.length - 1 - i]));
  const sorted = [...moves].sort((a, b) => (a.gameId === b.gameId ? a.index - b.index : a.gameId < b.gameId ? -1 : 1));
  let prevGame = '';
  let prevLoss = 0;
  let n = 0;
  for (const r of sorted) {
    if (r.gameId !== prevGame) {
      prevGame = r.gameId;
      prevLoss = 0;
    }
    const g = gameOf(r.gameId);
    const e = analysisOf(r.gameId)?.evals[r.index];
    if (!g || !e || r.loc === PASS) continue;
    const board = boardsOf(r.gameId)[r.index];
    const ctx = buildContext(board, decodeOwnership(e.ownership));
    const prev = r.index > 0 ? g.moves[r.index - 1] : null;
    const lastOpp = prev && prev.color !== r.color ? prev.loc : null;
    const own = r.index > 1 && g.moves[r.index - 2].color === r.color ? g.moves[r.index - 2].loc : null;
    const view = moverView(e.bWin, e.bLead, r.color);
    const ex = buildExample(ctx, e.policy, r.color, lastOpp, r.loc, r.gameId, { moveNumber: r.index, win: view.win, lastOwn: own });
    const losses = candidateLosses(e);
    const playedLoss = r.scoreLoss ?? losses.get(r.loc);
    if (ex) {
      describeExample(ex, {
        ctx,
        board,
        color: r.color,
        lastOpp,
        moveNumber: r.index,
        leadBefore: view.lead,
        losses,
        playedLoss,
        afterMistake: prevLoss >= TILT_LOSS,
        age: age.get(r.gameId),
      });
      examples.push(ex);
    }
    prevLoss = playedLoss ?? 0;
    if (++n % 150 === 0) await tick();
  }
  return examples;
}

/** Examples from "not me" corrections for this copy. */
export function feedbackExamples(copyOf: string): DoppelExample[] {
  const out: DoppelExample[] = [];
  for (const f of useCopyLab.getState().feedback) {
    if (f.copyOf !== copyOf) continue;
    try {
      const board = replay(f.size, f.setup, f.history);
      const ctx = buildContext(board, decodeOwnership(f.ownership));
      const h = f.history;
      const last = h.length ? h[h.length - 1] : null;
      const lastOpp = last && last.color !== f.toPlay ? last.loc : null;
      const own = h.length > 1 && h[h.length - 2].color === f.toPlay ? h[h.length - 2].loc : null;
      const ex = buildExample(ctx, f.policy, f.toPlay, lastOpp, f.mine, `fix:${f.id}`, { moveNumber: h.length, win: f.win, lastOwn: own });
      if (!ex) continue;
      ex.fix = true;
      if (f.mine === null) {
        const neg = ex.candidates.indexOf(f.copyLoc);
        if (neg < 0) continue;
        ex.neg = neg;
      }
      out.push(ex);
    } catch {
      /* a malformed correction is skipped */
    }
  }
  return out;
}

// ------------------------------------------------------------------ training

let worker: Worker | null = null;
let jobId = 1;
const jobs = new Map<number, { resolve: (m: DoppelModel) => void; reject: (e: Error) => void; onProgress?: (d: number, t: number, b: number | null) => void }>();

function copyWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('../lib/profile/copy.worker.ts', import.meta.url), { type: 'module', name: 'copy' });
      worker.onmessage = (e: MessageEvent<CopyReply>) => {
        const r = e.data;
        const j = jobs.get(r.id);
        if (!j) return;
        if (r.type === 'progress') j.onProgress?.(r.done, r.total, r.best);
        else {
          jobs.delete(r.id);
          if (r.type === 'done') j.resolve(r.model);
          else j.reject(new Error(r.error));
        }
      };
      worker.onerror = (e) => {
        for (const j of jobs.values()) j.reject(new Error(e.message || 'copy training stopped'));
        jobs.clear();
        worker?.terminate();
        worker = null;
      };
    } catch {
      worker = null;
    }
  }
  return worker;
}

/**
 * Train a copy (in a worker when there is one), with the best settings evolved so far, after
 * `generations` more generations of evolution (0: none).
 */
export function trainCopyModel(
  examples: DoppelExample[],
  opts: { version: number; prev?: DoppelModel | null; generations?: number; onProgress?: (done: number, total: number, best: number | null) => void },
): Promise<DoppelModel> {
  const req: Omit<CopyRequest, 'id'> = {
    examples,
    version: opts.version,
    genome: bestGenome(opts.prev?.evo) ?? opts.prev?.genome,
    evo: opts.prev?.evo,
    generations: opts.generations ?? 0,
    seed: Date.now() & 0xffffff,
  };
  const w = copyWorker();
  if (!w) return Promise.resolve().then(() => runCopyJob(req, opts.onProgress));
  const id = jobId++;
  return new Promise<DoppelModel>((resolve, reject) => {
    jobs.set(id, { resolve, reject, onProgress: opts.onProgress });
    w.postMessage({ ...req, id } satisfies CopyRequest);
  }).catch(() => runCopyJob(req, opts.onProgress)); // a worker that cannot start or crashed: train here instead
}

/** Copy versions kept in the database (older ones only make the account snapshot bigger). */
const KEEP_VERSIONS = 3;

/** Store a new version of the player's copy and drop old ones. */
export async function putCopyModel(model: DoppelModel) {
  const d = await db();
  await d.put('doppel', model);
  const keys = (await d.getAllKeys('doppel')).map(Number).sort((a, b) => b - a);
  for (const k of keys.slice(KEEP_VERSIONS)) await d.delete('doppel', k);
  markChanged();
}
