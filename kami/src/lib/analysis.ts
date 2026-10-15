/**
 * KataGo reads for Kami's board panel: the eval bar and best moves for the position on the
 * board, and a quick read of every position in the game for the Trend, Blunder and
 * Performance tabs. Numbers only come from KataGo; nothing here asks a language model.
 *
 * Every read goes through getProber() (the engine the answers use) and one queue, so board
 * reads and trend reads take turns. Reads are cached by position: stepping through a game
 * or coming back to a tab costs nothing the second time.
 */
import { useEffect, useMemo, useState } from 'react';
import type { PosValue } from '../../../src/lib/analysis/lineStats';
import type { EngineRead, ExplainPosition } from '../../../src/lib/coach/explain/types';
import type { Move } from '../../../src/lib/go/types';
import { getProber } from './engine';

/**
 * Visits for the eval bar and best moves. Under about 50 visits the lead moves by a point or
 * two, so the board waits for a deeper read.
 */
export const BOARD_VISITS = 120;
/** Visits per position for the trend: quicker, so a whole game fills in while you look at it. */
export const TREND_VISITS = 60;
/** Time caps, so a slow device returns what it has instead of stalling. */
const BOARD_MS = 20000;
const TREND_MS = 15000;
const BOARD_DELAY_MS = 250;
const MAX_CACHE = 1500;

const cache = new Map<string, EngineRead>();
/** The board position wanted now: an older board read still waiting its turn is skipped. */
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

let queue: Promise<unknown> = Promise.resolve();
/** Runs one read after the others; a failed read does not hold up the next. */
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job);
  queue = run.catch(() => undefined);
  return run;
}

function remember(key: string, r: EngineRead) {
  cache.delete(key);
  cache.set(key, r);
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** The read already known for a position, if any (any depth). */
export const cachedRead = (p: ExplainPosition): EngineRead | undefined => cache.get(positionKey(p));

/**
 * A read of `p` at least `visits` deep: from the cache when it is deep enough, else KataGo.
 * `wanted` says whether the read is still needed when its turn comes; a stale one is skipped,
 * so quick steps through a game do not queue up reads nobody will see.
 */
export function readPosition(p: ExplainPosition, visits: number, maxMs: number, wanted: () => boolean = () => true): Promise<EngineRead | null> {
  const key = positionKey(p);
  const hit = cache.get(key);
  if (hit && hit.visits >= visits) return Promise.resolve(hit);
  return inTurn(async () => {
    const again = cache.get(key);
    if (again && again.visits >= visits) return again;
    if (!wanted()) return null;
    const prober = await getProber();
    const r = await prober.read(p, { visits, maxMs });
    if (r) remember(key, r);
    return r ?? again ?? null;
  });
}

export interface BoardRead {
  /** The read of the position on the board, once it is deep enough. Null while it is not. */
  read: EngineRead | null;
  /** The last read shown, possibly of the position before: the eval bar fades it. */
  last: EngineRead | null;
  pending: boolean;
}

/**
 * The read of the board's position, after a short pause so quick steps cost one read. `p` is
 * null when there is nothing on the board yet.
 */
export function useBoardRead(p: ExplainPosition | null): BoardRead {
  const key = p ? positionKey(p) : null;
  const [state, setState] = useState<{ key: string | null; read: EngineRead | null; pending: boolean }>({ key: null, read: null, pending: false });
  useEffect(() => {
    if (!p || !key) return;
    const hit = cache.get(key);
    if (hit && hit.visits >= BOARD_VISITS) {
      wantedBoard = key;
      setState({ key, read: hit, pending: false });
      return;
    }
    setState((s) => ({ key, read: s.key === key ? s.read : null, pending: true }));
    let alive = true;
    const timer = setTimeout(() => {
      wantedBoard = key;
      readPosition(p, BOARD_VISITS, BOARD_MS, () => wantedBoard === key).then(
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
 * Quick reads of each position along a line, one after another in the background, for the
 * trend tabs. `positions[i]` is the position after i moves. Stops when the line changes or
 * the tabs close (`positions` becomes null).
 */
export function useLineReads(positions: ExplainPosition[] | null): LineReads {
  const keys = useMemo(() => (positions ? positions.map(positionKey) : null), [positions]);
  const sig = keys ? keys.join('\n') : '';
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!positions || !keys) return;
    const todo = positions.filter((_, i) => !cache.has(keys[i]));
    if (!todo.length) {
      setRunning(false);
      return;
    }
    let alive = true;
    setRunning(true);
    (async () => {
      let n = 0;
      for (const p of todo) {
        if (!alive) return;
        try {
          await readPosition(p, TREND_VISITS, TREND_MS);
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
  const values = keys ? keys.map((k) => valueOf(cache.get(k))) : [];
  const done = values.filter((v) => v !== null).length;
  return { values, done, total: values.length, running };
}
