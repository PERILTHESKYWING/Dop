/**
 * KataGo reads for Kami's board panel: the eval bar and best moves for the position on the
 * board, and a quick read of every position in the game for the Trend, Blunder and
 * Performance tabs. Numbers only come from KataGo; nothing here asks a language model.
 *
 * Every read goes through one queue, so board reads, answer reads and trend reads take
 * turns, and a background trend read steps aside (keeping its tree) when the board or an
 * answer wants the engine. Reads are cached by position: stepping through a game or coming
 * back to a tab costs nothing the second time.
 *
 * Two searches are kept between reads, one for the board (and answers) and one for the
 * trend. Stepping one move forward keeps the subtree KataGo already read for that move
 * (KataGo's own tree reuse), and the board shows a quick read as soon as there is one, then
 * deepens it to the full visits. Final reads are at least as deep as before.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { engineMoves } from '../../../src/lib/analysis/analyzer';
import type { PosValue } from '../../../src/lib/analysis/lineStats';
import type { EngineRead, ExplainPosition, Prober } from '../../../src/lib/coach/explain/types';
import { Search, type RootPosition, type SearchSnapshot } from '../../../src/lib/engine/mcts';
import { replay } from '../../../src/lib/go/board';
import type { Move } from '../../../src/lib/go/types';
import { getSearchKit, readStarted, type SearchKit } from './engine';
import { getSetting } from './settings';

/**
 * Default visits for the best moves. Under about 50 visits the lead moves by a point or
 * two, so the board shows quicker reads faded ("reading") until this depth.
 */
export const BOARD_VISITS = 120;
/** Default visits per position for the trend: quicker, so a whole game fills in while you look at it. */
export const TREND_VISITS = 60;
/** The first read the board shows while KataGo goes deeper (fewer visits are mostly the network's guess). */
export const FIRST_VISITS = 16;
/** Time caps, so a slow device returns what it has instead of stalling. */
const TREND_MS = 15000;
/** The depths and cap from Settings › KataGo (the constants above are their defaults). */
const boardVisits = () => getSetting<number>('katago.boardVisits');
const trendVisits = () => getSetting<number>('katago.trendVisits');
const boardMs = () => getSetting<number>('katago.maxSeconds') * 1000;
const trendMs = () => Math.min(TREND_MS, boardMs());
/** Quick steps cost one read: a board read starts after this pause, and a newer step stops it. */
const BOARD_DELAY_MS = 150;
/** How often a deepening board read redraws. */
const BOARD_UPDATE_MS = 500;
const MAX_CACHE = 1500;

export interface Entry {
  read: EngineRead;
  /** The visits a finished read was asked for (0: stopped early, only good for a quick look). */
  asked: number;
  /** Its time cap, when the cap ended it before the visits. */
  cappedMs: number;
}

const cache = new Map<string, Entry>();
/** The board position wanted now: an older board read stops or is skipped. */
let wantedBoard: string | null = null;

const stones = (ms: Move[]) => ms.map((m) => `${m.color}.${m.loc}`).join(',');

/** A position's identity for the cache: board size, komi, setup, the moves and who plays. */
export function positionKey(p: ExplainPosition): string {
  return `${p.size}|${p.komi}|${p.toPlay}|${stones(p.setup)}|${stones(p.moves)}`;
}

/** The trend value of a read: Black's winrate and lead, and KataGo's best move. */
export function valueOf(r: EngineRead | undefined): PosValue | null {
  if (!r) return null;
  return { bWin: r.bWin, bLead: r.bLead, best: r.candidates[0]?.loc ?? null };
}

/** A finished read good enough for `visits` within `maxMs`: as deep, or capped by at least as much time. */
const enough = (e: Entry | undefined, visits: number, maxMs = Infinity): boolean =>
  !!e && e.asked > 0 && (e.read.visits >= visits || (e.asked >= visits && e.cappedMs >= maxMs));

let queue: Promise<unknown> = Promise.resolve();
/** Runs one read after the others; a failed read does not hold up the next. */
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job);
  queue = run.catch(() => undefined);
  return run;
}
/** Board and answer reads waiting their turn: a background trend read steps aside for them. */
let urgent = 0;

/**
 * Which read a position keeps: a finished read always beats an unfinished one (a board read
 * stopped at 90 visits must not hide the finished 60-visit trend read, or the trend has a
 * hole and reads it again and again); between two of the same kind, the deeper one.
 */
export function keepEntry(old: Entry | undefined, e: Entry): Entry {
  if (!old) return e;
  const oldDone = old.asked > 0;
  const newDone = e.asked > 0;
  if (oldDone !== newDone) return oldDone ? old : e;
  return old.read.visits > e.read.visits ? old : e;
}

function remember(key: string, e: Entry) {
  const old = cache.get(key);
  cache.delete(key);
  cache.set(key, keepEntry(old, e));
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** The finished read known for a position, if any (any depth). */
export const cachedRead = (p: ExplainPosition): EngineRead | undefined => {
  const e = cache.get(positionKey(p));
  return e && e.asked > 0 ? e.read : undefined;
};

/** Any read of the position, finished or not, for a quick look while a deeper one runs. */
const anyRead = (key: string): EngineRead | undefined => cache.get(key)?.read;

// ---- The kept searches ------------------------------------------------------------------

type Lane = 'board' | 'line';
const lanes: Record<Lane, Search | null> = { board: null, line: null };
let laneKit: SearchKit | null = null;
let kitSource: () => Promise<SearchKit> = getSearchKit;
let startRead: () => () => void = readStarted;

/** Benches and tests: read with another engine (a WASM engine in Node). Clears the cache. */
export function setSearchKitSource(src: () => Promise<SearchKit>) {
  kitSource = src;
  startRead = () => () => {};
  laneKit = null;
  lanes.board = lanes.line = null;
  cache.clear();
}

const rootOf = (p: ExplainPosition): RootPosition => ({
  size: p.size,
  komi: p.komi,
  moves: engineMoves(p.setup, p.moves, p.toPlay),
  toPlay: p.toPlay,
  board: replay(p.size, p.setup, p.moves),
});

const toRead = (s: SearchSnapshot): EngineRead => ({
  visits: s.visits,
  bWin: s.bWin,
  bLead: s.bLead,
  ownership: s.ownership,
  candidates: s.candidates.map((c) => ({ loc: c.loc, winrate: c.winrate, scoreLead: c.scoreLead, visits: c.visits, pv: [...c.pv] })),
});

interface LaneRun {
  visits: number;
  maxMs: number;
  stop: () => boolean;
  onRead?: (r: EngineRead) => void;
}

/**
 * One read in a kept search. A position that continues the lane's last one keeps the subtree
 * already read there; any other starts a fresh tree. Evaluations are shared with every other
 * search through the engine's NN cache either way.
 */
async function laneRead(lane: Lane, p: ExplainPosition, run: LaneRun): Promise<{ read: EngineRead | null; stopped: boolean; capped: boolean }> {
  const kit = await kitSource();
  if (kit !== laneKit) {
    // Another engine (the tuned one, or a restart): fresh trees; reads stay unless the network changed.
    if (laneKit && laneKit.modelId !== kit.modelId) cache.clear();
    laneKit = kit;
    lanes.board = lanes.line = null;
  }
  const root = rootOf(p);
  let s = lanes[lane];
  if (s) s.setPosition(root);
  else s = lanes[lane] = new Search(kit.evaluator, root, { batch: kit.batch });
  let stopped = false;
  let shown = 0;
  const t0 = Date.now();
  const ended = startRead();
  try {
    const snap = await s.run({
      visits: run.visits,
      maxMs: run.maxMs,
      ownership: true,
      updateMs: 50,
      shouldStop: () => (stopped = run.stop()),
      onUpdate: run.onRead
        ? (sn) => {
            if (sn.visits < FIRST_VISITS || sn.visits >= run.visits || !sn.candidates.length) return;
            const t = Date.now();
            if (shown && t - shown < BOARD_UPDATE_MS) return;
            shown = t;
            run.onRead!(toRead(sn));
          }
        : undefined,
    });
    const capped = !stopped && snap.visits < run.visits && Date.now() - t0 >= run.maxMs;
    return { read: snap.visits > 0 && snap.candidates.length ? toRead(snap) : null, stopped: stopped && snap.visits < run.visits, capped };
  } catch (e) {
    lanes[lane] = null;
    throw e;
  } finally {
    ended();
  }
}

export interface ReadOptions {
  /** 'board' (also answers): goes before background reads. 'line' (default): background, steps aside. */
  lane?: Lane;
  /** Quicker reads of the same search while it deepens (from FIRST_VISITS on). */
  onRead?: (r: EngineRead) => void;
}

/**
 * A read of `p` at least `visits` deep: from the cache when it is deep enough, else KataGo.
 * `wanted` says whether the read is still needed; a stale one is skipped or stopped, so quick
 * steps through a game do not queue up reads nobody will see.
 */
export function readPosition(p: ExplainPosition, visits: number, maxMs: number, wanted: () => boolean = () => true, opts: ReadOptions = {}): Promise<EngineRead | null> {
  const key = positionKey(p);
  const hit = cache.get(key);
  if (enough(hit, visits, maxMs)) return Promise.resolve(hit!.read);
  const lane = opts.lane ?? 'line';
  const isUrgent = lane === 'board';
  let spent = 0;
  const attempt = (): Promise<EngineRead | null> => {
    if (isUrgent) urgent++;
    let yielded = false;
    const job = inTurn(async () => {
      if (isUrgent) urgent--;
      const again = cache.get(key);
      if (enough(again, visits, maxMs)) return again!.read;
      if (!wanted()) return null;
      const t = Date.now();
      const stop = () => {
        if (!wanted()) return true;
        if (!isUrgent && urgent > 0) return (yielded = true);
        return false;
      };
      const r = await laneRead(lane, p, { visits, maxMs: Math.max(1, maxMs - spent), stop, onRead: opts.onRead });
      spent += Date.now() - t;
      if (r.read) remember(key, { read: r.read, asked: r.stopped ? 0 : visits, cappedMs: r.capped ? maxMs : 0 });
      return r.read ?? again?.read ?? null;
    });
    // A background read that stepped aside goes on later, from the tree it kept.
    return job.then((r) => (yielded && wanted() && spent < maxMs ? attempt() : r));
  };
  return attempt();
}

/**
 * The engine for answers: reads go before background trend reads, come from the cache when a
 * read as deep is known (the board's read of the position asked about), and continue the
 * board's search when the position follows it.
 */
export async function getAnswerProber(signal?: AbortSignal): Promise<Prober> {
  await kitSource();
  // Stop ends the answer's read at once (a queued one is skipped), so the board is not kept waiting.
  const wanted = () => !signal?.aborted;
  return { read: (pos, budget) => readPosition(pos, budget.visits, budget.maxMs, wanted, { lane: 'board' }) };
}

export interface BoardRead {
  /** The read of the position on the board: a quick one while `pending`, then the full one. Null while there is none. */
  read: EngineRead | null;
  /** The last read shown, possibly of the position before: the eval bar fades it. */
  last: EngineRead | null;
  pending: boolean;
}

/**
 * The read of the board's position: after a short pause (quick steps cost one read), a quick
 * read first, then the full one. `p` is null when there is nothing on the board yet.
 */
export function useBoardRead(p: ExplainPosition | null): BoardRead {
  const key = p ? positionKey(p) : null;
  const [state, setState] = useState<{ key: string | null; read: EngineRead | null; pending: boolean }>({ key: null, read: null, pending: false });
  useEffect(() => {
    if (!p || !key) return;
    const visits = boardVisits();
    const maxMs = boardMs();
    const hit = cache.get(key);
    if (enough(hit, visits, maxMs)) {
      wantedBoard = key;
      setState({ key, read: hit!.read, pending: false });
      return;
    }
    // A quicker read of this position (a trend read, a stopped board read) shows at once.
    const known = anyRead(key);
    setState((s) => ({ key, read: known ?? (s.key === key ? s.read : null), pending: true }));
    let alive = true;
    const timer = setTimeout(() => {
      wantedBoard = key;
      readPosition(p, visits, maxMs, () => wantedBoard === key, {
        lane: 'board',
        onRead: (r) => alive && setState((s) => (s.read && s.key === key && s.read.visits >= r.visits ? s : { key, read: r, pending: true })),
      }).then(
        (r) => alive && setState({ key, read: r, pending: false }),
        () => alive && setState({ key, read: null, pending: false }),
      );
    }, BOARD_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // The effect follows the position, not the object that describes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const current = !!p && state.key === key;
  return {
    read: current ? state.read : null,
    last: state.read,
    pending: !!p && (!current || state.pending),
  };
}

export interface LineReads {
  /** `values[i]` is the position after i moves; null where KataGo has not read it yet. */
  values: (PosValue | null)[];
  done: number;
  total: number;
  running: boolean;
}

/**
 * The order to read a line in: from `current` to the end, then from the start, so the move on
 * the board fills in first and each read continues the one before (tree reuse).
 */
export function nextToRead(n: number, current: number, isDone: (i: number) => boolean): number {
  const from = Math.max(0, Math.min(n - 1, current));
  for (let i = from; i < n; i++) if (!isDone(i)) return i;
  for (let i = 0; i < from; i++) if (!isDone(i)) return i;
  return -1;
}

/**
 * Quick reads of each position along a line, one after another in the background, for the
 * trend tabs. `positions[i]` is the position after i moves; `current` (the move on the board)
 * is read first. Stops when the line changes or the tabs close (`positions` becomes null).
 */
export function useLineReads(positions: ExplainPosition[] | null, current = 0): LineReads {
  const keys = useMemo(() => (positions ? positions.map(positionKey) : null), [positions]);
  const sig = keys ? keys.join('\n') : '';
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(false);
  const cursor = useRef(current);
  cursor.current = current;
  useEffect(() => {
    if (!positions || !keys) return;
    const finished = (i: number) => (cache.get(keys[i])?.asked ?? 0) > 0;
    if (positions.every((_, i) => finished(i))) {
      setRunning(false);
      return;
    }
    let alive = true;
    setRunning(true);
    (async () => {
      const tried = new Set<number>();
      let n = 0;
      for (;;) {
        if (!alive) return;
        const i = nextToRead(positions.length, cursor.current, (j) => tried.has(j) || finished(j));
        if (i < 0) return;
        tried.add(i);
        try {
          await readPosition(positions[i], trendVisits(), trendMs(), () => alive);
        } catch {
          return;
        }
        // Redraw every few positions, not on each one.
        if (++n % 4 === 0) setTick((t) => t + 1);
      }
    })().finally(() => {
      if (!alive) return;
      setRunning(false);
      setTick((t) => t + 1);
    });
    return () => {
      alive = false;
    };
    // The reads follow the line itself (sig), not the array object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  // `tick` changes when a read lands, so the values below are read again.
  void tick;
  const values = keys ? keys.map((k) => valueOf(cachedReadByKey(k))) : [];
  const done = values.filter((v) => v !== null).length;
  return { values, done, total: values.length, running };
}

function cachedReadByKey(k: string): EngineRead | undefined {
  const e = cache.get(k);
  return e && e.asked > 0 ? e.read : undefined;
}
