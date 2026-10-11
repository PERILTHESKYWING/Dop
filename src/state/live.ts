import { create } from 'zustand';
import { replay } from '../lib/go/board';
import type { Color, Move } from '../lib/go/types';
import { engineMoves } from '../lib/analysis/analyzer';
import { Search, type SearchSnapshot } from '../lib/engine/mcts';
import { getEngine, markInteractive, startEngine } from './actions';
import { get as getApp } from './store';
import { idleTooLong, isCool, ponderCap } from '../lib/engine/governor';
import { bookSnapshot } from '../lib/engine/book';
import { MODELS } from '../lib/engine/models';
import { anchorFor, bookAnswer } from './brain';
import { searchEvaluator, startStudent } from './student';
import { pcPonder, pcQueryOf, pcReady, probePc, usePc } from './pc';
import { shareSnapshot, sharedKey, sharedRow, sharedSnapshot } from './shared';

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
  /**
   * 'resting': cool mode stopped after a minute without a touch; any touch resumes.
   * 'book': the opening book's answer is shown (no search needed).
   * 'shared': another of the user's devices already read this position deeply.
   */
  status: 'idle' | 'starting' | 'thinking' | 'paused' | 'limit' | 'resting' | 'book' | 'shared' | 'error';
  /** The network behind a book or shared answer. */
  bookNetwork?: string;
  /** The PC helper is doing the reading. */
  onPc?: boolean;
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
let searchStudent: object | null = null;
let loopRunning: Promise<void> | null = null;
let gen = 0;
let wake: (() => void) | null = null;
const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => poke());
// Cool mode rests after a minute without a touch; the next touch picks up where it stopped.
if (typeof window !== 'undefined') {
  const resume = () => {
    if (useLive.getState().status === 'resting') poke();
  };
  for (const ev of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(ev, resume, { passive: true });
}

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
    const board = replay(t.size, t.setup, t.moves);
    const key = sharedKey({ board, toPlay: t.toPlay, komi: t.komi, history: t.moves, size: t.size, setup: t.setup });
    // On battery, live analysis stops at a limit instead of reading forever.
    const limit = getApp().settings.ponderLimit || ponderCap();

    // 1. The PC helper: native KataGo with a big network does the reading.
    if (pcReady()) {
      useLive.setState({ key: t.key, snap: null, status: 'thinking', error: undefined, onPc: true });
      try {
        const last = await pcPonder(pcQueryOf(t.size, t.komi, t.setup, t.moves, t.toPlay), Number.isFinite(limit) ? limit : 5_000_000, (snap) => {
          if (my === gen) useLive.setState({ key: t.key, snap });
        }, () => my !== gen || hidden() || idleTooLong());
        if (last) void shareSnapshot(key, last, usePc.getState().network ?? 'pc');
        if (my !== gen) continue;
        useLive.setState({ status: isCool() && idleTooLong() ? 'resting' : 'limit' });
        await new Promise<void>((r) => (wake = r));
        continue;
      } catch {
        // The PC went away: carry on here.
        void probePc();
        if (my !== gen) continue;
      }
    }
    useLive.setState({ onPc: false });

    let eng = getEngine();
    if (!eng) {
      useLive.setState({ status: 'starting' });
      eng = await startEngine();
      if (!eng) {
        useLive.setState({ status: 'error', error: 'KataGo could not start. See Settings.' });
        return;
      }
      if (my !== gen) continue;
    }
    const pos = { size: t.size, komi: t.komi, moves: engineMoves(t.setup, t.moves), toPlay: t.toPlay, board };
    // The student network searches when it runs (19x19); KataGo judges the top of the tree.
    const stud = t.size === 19 ? await startStudent(() => eng!.activeLanes) : null;
    if (my !== gen) continue;
    if (!search || searchEngine !== eng || searchStudent !== stud) {
      search = new Search(searchEvaluator(eng, t.size), pos, { batch: stud?.batch ?? eng.batch });
      searchEngine = eng;
      searchStudent = stud;
    } else search.setPosition(pos);
    search.setAnchor(anchorFor(eng.info.modelId, t.komi, t.size, eng));

    // 2. Already known, deeper than this device would read: a result shared by another of
    // the user's devices, or the opening book (searched deeply by a big network). Show it and
    // spare the device, unless a big network runs here anyway.
    const small = !MODELS.find((m) => m.id === eng!.info.modelId)?.gpuOnly;
    if (small || isCool()) {
      const shared = await sharedRow(key);
      if (my !== gen) continue;
      if (shared && shared.toPlay === t.toPlay) {
        useLive.setState({ key: t.key, snap: sharedSnapshot(shared, t.size), status: 'shared', bookNetwork: shared.by, error: undefined });
        await new Promise<void>((r) => (wake = r));
        continue;
      }
      const book = !t.setup.length ? await bookAnswer({ size: t.size, komi: t.komi, setup: t.setup, board, toPlay: t.toPlay }) : null;
      if (my !== gen) continue;
      if (book) {
        useLive.setState({ key: t.key, snap: bookSnapshot(book, t.toPlay, t.size), status: 'book', bookNetwork: book.network, error: undefined });
        await new Promise<void>((r) => (wake = r));
        continue;
      }
    }

    // 3. This device's own search.
    // What the tree already knows about this position shows at once.
    useLive.setState({ key: t.key, snap: search.rootVisits > 0 ? search.snapshot() : null, status: 'thinking', error: undefined });
    let last: SearchSnapshot | null = null;
    try {
      markInteractive(4000);
      last = await search.run({
        visits: limit,
        ownership: true,
        updateMs: 250,
        shouldStop: () => my !== gen || hidden() || idleTooLong(),
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
    if (last) void shareSnapshot(key, last, eng.info.modelId);
    if (my !== gen) continue;
    // The visit limit (or the memory guard) was reached, or a phone rests after a minute
    // untouched: wait for something to change.
    useLive.setState({ status: isCool() && idleTooLong() ? 'resting' : 'limit' });
    await new Promise<void>((r) => (wake = r));
  }
}
