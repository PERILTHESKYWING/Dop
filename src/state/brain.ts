import type { PositionSpec } from '../lib/analysis/analyzer';
import { bookEval, bookIfLoaded, loadBook, type BookEntry } from '../lib/engine/book';
import { BrowserEngine, type StartAttempt } from '../lib/engine/browserEngine';
import { isCool } from '../lib/engine/governor';
import { engineEvaluator, type AnchorSource, type LeafRequest } from '../lib/engine/mcts';
import { MODELS } from '../lib/engine/models';
import type { NetEval } from '../lib/engine/parse';
import type { PositionEval } from '../lib/types';
import { get, set } from './store';

/**
 * Where the site's answers come from, strongest first, so that the device itself computes
 * as little as possible:
 *
 *  1. the PC helper (native KataGo with a big network on the user's own graphics card),
 *     when it is running (state/pc.ts);
 *  2. the opening book: openings searched once, deeply, by a big network (engine/book.ts);
 *  3. shared results: deep analyses another of the user's devices (usually the PC) already
 *     made, synced through the account;
 *  4. this device's own search with the small network, corrected at the top of the tree by
 *     a big network when one can run here ("big brain at the top, small brain below",
 *     engine/mcts.ts anchors).
 */

/** The opening book's answer for a position, or null (no book for this komi, or not in it). */
export async function bookAnswer(spec: Pick<PositionSpec, 'size' | 'komi' | 'setup' | 'board' | 'toPlay'>): Promise<BookEntry | null> {
  if (spec.setup.length || spec.size !== 19) return null;
  const book = await loadBook(spec.komi, spec.size);
  return book?.lookup(spec.board, spec.toPlay) ?? null;
}

/** Anything already known about a position that saves searching it here (see the list above). */
export async function knownAnswer(spec: PositionSpec, fast: PositionEval): Promise<PositionEval | null> {
  const pc = await pcAnswer?.(spec, fast);
  if (pc) return pc;
  const b = await bookAnswer(spec);
  if (b) return bookEval(b, fast);
  return (await sharedAnswer?.(spec, fast)) ?? null;
}

/** Hooks filled in by the PC helper and the shared results (they load later). */
let pcAnswer: ((spec: PositionSpec, fast: PositionEval) => Promise<PositionEval | null>) | null = null;
let sharedAnswer: ((spec: PositionSpec, fast: PositionEval) => Promise<PositionEval | null>) | null = null;
export function setPcAnswer(f: typeof pcAnswer) {
  pcAnswer = f;
}
export function setSharedAnswer(f: typeof sharedAnswer) {
  sharedAnswer = f;
}

// ------------------------------------------------------------- the big network helper

/** The big network for anchors: kata1 b18 (the strongest that runs well in a browser). */
const BIG_ID = 'kata1-b18c384nbt';
let big: Promise<BrowserEngine | null> | null = null;
let bigEngine: BrowserEngine | null = null;

/**
 * Whether a big network can run here beside the main one: on a GPU (WebGPU), or on a
 * computer with plenty of cores and memory. Never in cool mode on the CPU (phones), and
 * not when the main engine is already a big network.
 */
export function bigHelperAllowed(mainModelId: string | undefined): boolean {
  const s = get();
  if (s.settings.bigHelper === 'off') return false;
  const spec = MODELS.find((m) => m.id === BIG_ID);
  if (!spec || !mainModelId || MODELS.find((m) => m.id === mainModelId)?.gpuOnly) return false;
  const gpu = !!s.caps?.webgpu && !s.settings.forceCpu;
  if (gpu) return true;
  if (isCool()) return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (nav.hardwareConcurrency ?? 2) >= 8 && (nav.deviceMemory ?? 8) >= 8;
}

/** Start (once) and return the big network helper, or null when it cannot run here. */
export function bigHelper(mainModelId: string | undefined): Promise<BrowserEngine | null> {
  if (!bigHelperAllowed(mainModelId)) return Promise.resolve(null);
  if (!big) {
    const spec = MODELS.find((m) => m.id === BIG_ID)!;
    const gpu = !!get().caps?.webgpu && !get().settings.forceCpu;
    const attempt: StartAttempt = { spec, forceCpu: !gpu };
    set({ bigHelper: { status: 'loading', model: spec.name } });
    big = BrowserEngine.load(attempt)
      .then((e) => {
        bigEngine = e;
        e.onDeath = () => {
          bigEngine = null;
          big = null;
          set({ bigHelper: { status: 'off', model: spec.name, note: 'stopped' } });
        };
        set({ bigHelper: { status: 'ready', model: spec.name, backend: e.info.backend } });
        return e;
      })
      .catch((err) => {
        set({ bigHelper: { status: 'error', model: spec.name, note: (err as Error).message } });
        return null;
      });
  }
  return big;
}

/** The helper if it is already running (never starts it). */
export const runningBigHelper = () => (bigEngine && !bigEngine.dead ? bigEngine : null);

/**
 * The anchor source for a search on the main engine: the opening book for book positions,
 * then the big network helper when it runs here. Null when neither can help.
 */
export function anchorFor(mainModelId: string | undefined, komi: number, size: number): AnchorSource | null {
  const book = size === 19 ? (bookIfLoaded(komi, size), true) : false;
  const allowBig = bigHelperAllowed(mainModelId);
  if (allowBig) void bigHelper(mainModelId);
  if (!book && !allowBig) return null;
  let bigEval: ReturnType<typeof engineEvaluator> | null = null;
  let bigFor: BrowserEngine | null = null;
  return async (req: LeafRequest) => {
    // Handicap games (setup stones come first as Black moves) are never in the book.
    const handicap = req.moves.length >= 2 && req.moves[0].color === 1 && req.moves[1].color === 1;
    if (book && !handicap) {
      const b = bookIfLoaded(req.komi, req.size)?.lookup(req.board, req.toPlay);
      if (b) return { eval: bookNet(b), policy: false };
    }
    const e = runningBigHelper();
    if (!e) return null;
    if (bigFor !== e) {
      bigEval = engineEvaluator(e);
      bigFor = e;
    }
    const [ev] = await bigEval!([{ ...req, ownership: false }]);
    return { eval: ev, policy: true };
  };
}

/** A book entry as a network evaluation (value only; the policy is not used). */
function bookNet(b: BookEntry): NetEval {
  return { policy: new Float32Array(0), bWin: b.bWin, bLead: b.bLead };
}
