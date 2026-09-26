import { create } from 'zustand';
import { replay } from '../lib/go/board';
import type { Color, Move } from '../lib/go/types';
import { engineMoves } from '../lib/analysis/analyzer';
import { engineEvaluator, Search, type SearchSnapshot } from '../lib/engine/mcts';
import { getEngine, markInteractive, startEngine } from './actions';
import { get as getApp } from './store';

/**
 * Live analysis ("pondering", as in Lizzie): KataGo keeps searching the position on
 * screen, and the winrates, visits and best moves refine while you watch. One search
 * tree follows you through the game: stepping to the next move keeps what was already
 * read under that move. Background game analysis waits while this runs.
 */

export interface LiveTarget {
  /** Identifies the position; a new key means a new position. */
  key: string;
  size: number;
  /** Komi as given to KataGo (see go/rules.ts engineKomi). */
  komi: number;
  setup: Move[];
  /** Moves played before the position. */
  moves: Move[];
  toPlay: Color;
  /** Called with the last result when the position is left (e.g. to keep a deeper analysis). */
  onLeave?: (snap: SearchSnapshot) => void;
}

export interface LiveState {
  /** Pondering switched on (Space). Remembered in this browser. */
  on: boolean;
  /** The position `snap` belongs to. */
  key: string | null;
  snap: SearchSnapshot | null;
  status: 'idle' | 'starting' | 'thinking' | 'paused' | 'limit' | 'error';
  error?: string;
}

const PREF = 'dop.ponder';
const readPref = () => {
  try {
    return localStorage.getItem(PREF) !== 'off';
  } catch {
    return true;
  }
};

export const useLive = create<LiveState>(() => ({ on: readPref(), key: null, snap: null, status: 'idle' }));

/** The live result for this position, if the search is on it. */
export function useLiveFor(key: string | null | undefined): SearchSnapshot | null {
  return useLive((s) => (key && s.key === key ? s.snap : null));
}

let target: LiveTarget | null = null;
let search: Search | null = null;
let searchEngine: object | null = null;
let loopRunning: Promise<void> | null = null;
let gen = 0;
let wake: (() => void) | null = null;
const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => poke());

let owner: symbol | null = null;

/**
 * Point live analysis at a position. `who` identifies the screen asking, so that a screen
 * closing (null) does not stop the analysis another screen has just started.
 */
export function setLiveTarget(t: LiveTarget | null, who?: symbol) {
  if (!t && who && owner !== who) return;
  if (t) owner = who ?? null;
  if (t?.key === target?.key && !!t === !!target) {
    if (t && target) target.onLeave = t.onLeave;
    return;
  }
  const prev = target;
  const s = useLive.getState();
  if (prev?.onLeave && s.key === prev.key && s.snap) prev.onLeave(s.snap);
  target = t;
  if (!t) useLive.setState({ key: null, snap: null, status: 'idle' });
  poke();
}

export function setPondering(on: boolean) {
  try {
    localStorage.setItem(PREF, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
  useLive.setState({ on });
  poke();
}

export const togglePondering = () => setPondering(!useLive.getState().on);

/** Search again from scratch (e.g. after changing the visit limit). */
export function restartLive() {
  search = null;
  poke();
}

function poke() {
  gen++;
  wake?.();
  wake = null;
  void search?.stop();
  if (!loopRunning) loopRunning = loop().finally(() => (loopRunning = null));
}

async function loop() {
  for (;;) {
    const my = gen;
    const t = target;
    const { on } = useLive.getState();
    if (!t || !on || hidden()) {
      useLive.setState({ status: t ? 'paused' : 'idle' });
      return;
    }
    let eng = getEngine();
    if (!eng) {
      useLive.setState({ status: 'starting' });
      eng = await startEngine();
      if (!eng) {
        useLive.setState({ status: 'error', error: 'KataGo could not start. See Engine & Settings.' });
        return;
      }
      if (my !== gen) continue;
    }
    const board = replay(t.size, t.setup, t.moves);
    const pos = { size: t.size, komi: t.komi, moves: engineMoves(t.setup, t.moves), toPlay: t.toPlay, board };
    if (!search || searchEngine !== eng) {
      search = new Search(engineEvaluator(eng), pos, { batch: eng.batch });
      searchEngine = eng;
    } else search.setPosition(pos);
    // What the tree already knows about this position shows at once.
    useLive.setState({ key: t.key, snap: search.rootVisits > 0 ? search.snapshot() : null, status: 'thinking', error: undefined });
    const limit = getApp().settings.ponderLimit || Infinity;
    try {
      markInteractive(4000);
      await search.run({
        visits: limit,
        ownership: true,
        updateMs: 250,
        shouldStop: () => my !== gen || hidden(),
        onUpdate: (snap) => {
          if (my !== gen) return;
          markInteractive(4000);
          useLive.setState({ key: t.key, snap });
        },
      });
    } catch (e) {
      search = null;
      if (my !== gen) continue;
      useLive.setState({ status: 'error', error: (e as Error).message });
      return;
    }
    if (my !== gen) continue;
    // The visit limit (or the memory guard) was reached: wait for something to change.
    useLive.setState({ status: 'limit' });
    await new Promise<void>((r) => (wake = r));
  }
}
