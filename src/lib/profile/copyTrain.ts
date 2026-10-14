import type { Board } from '../go/board';
import type { PositionContext } from '../go/features';
import { symmetric } from '../go/coords';
import { PASS, type Color, type Loc } from '../go/types';
import { BOOK_DEPTH, bookDepth, bookKey, unsymmetric, type OpeningBook } from './book';
import {
  copyProbs,
  DOPPEL_ALGO,
  evaluate,
  fitCopy,
  initialWeights,
  splitByGame,
  type CopyWeights,
  type DoppelExample,
  type DoppelModel,
} from './doppel';
import { DEFAULT_GENOME, type Genome } from './genome';
import { describeCandidates, learnMistakes, measurePlay, type CandInfo, type MistakeProfile, type MistakeSample } from './human';

/**
 * A full copy: habits (doppel.ts) learned with the evolved settings, the player's mistake
 * profile (human.ts) and opening book (book.ts), measured on games it did not learn from.
 */

/** Book keys are kept for positions up to this many 19x19 moves (the book dial's maximum). */
const BOOK_KEY_DEPTH = 120;
/** Corrections count this many times as much as one of the player's own moves. */
export const CORRECTION_WEIGHT = 3;

/** Fill in what the mistake model and the book need to know about an example's position. */
export function describeExample(
  ex: DoppelExample,
  p: {
    ctx: PositionContext;
    board: Board;
    color: Color;
    lastOpp: Loc | null;
    moveNumber: number;
    /** The mover's score lead before the move. */
    leadBefore: number;
    /** Points each candidate loses, when known. */
    losses?: ReadonlyMap<Loc, number> | null;
    playedLoss?: number;
    afterMistake?: boolean;
    age?: number;
  },
): DoppelExample {
  const losses = p.losses;
  ex.loss = ex.candidates.map((loc) => (losses?.has(loc) ? losses.get(loc)! : null));
  let best = ex.candidates[0];
  let bestLoss = Infinity;
  ex.loss.forEach((l, i) => {
    if (l !== null && l < bestLoss) {
      bestLoss = l;
      best = ex.candidates[i];
    }
  });
  const info = describeCandidates(p.ctx, ex.candidates, p.color, p.lastOpp, p.moveNumber, p.leadBefore, best);
  ex.flags = info.map((x) => x.flags);
  ex.sigs = info.map((x) => x.sigs);
  if (p.playedLoss !== undefined) ex.playedLoss = p.playedLoss;
  if (p.afterMistake) ex.afterMistake = true;
  if (p.age !== undefined) ex.age = p.age;
  if (p.moveNumber < bookDepth(BOOK_KEY_DEPTH, p.board.size)) ex.bookAt = { ...bookKey(p.board, p.color), size: p.board.size, moveNumber: p.moveNumber };
  return ex;
}

/** The book from the examples' own positions and played moves. */
export function bookFromExamples(examples: readonly DoppelExample[], depth19 = BOOK_DEPTH): OpeningBook {
  const counts = new Map<string, Map<number, number>>();
  for (const ex of examples) {
    const b = ex.bookAt;
    if (!b || ex.fix || ex.y < 0 || b.moveNumber >= bookDepth(depth19, b.size)) continue;
    const loc = ex.candidates[ex.y];
    if (loc === PASS) continue;
    let e = counts.get(b.key);
    if (!e) counts.set(b.key, (e = new Map()));
    const c = symmetric(loc, b.size, b.sym);
    e.set(c, (e.get(c) ?? 0) + 1);
  }
  const entries: OpeningBook['entries'] = {};
  for (const [k, e] of counts) entries[k] = [...e].sort((a, b) => b[1] - a[1]);
  return { depth: depth19, entries, positions: counts.size };
}

/** The player's book moves for an example's position (in its orientation). */
function bookFor(book: OpeningBook | undefined, ex: DoppelExample, depth19: number): { loc: Loc; n: number }[] {
  const b = ex.bookAt;
  if (!book || !b || b.moveNumber >= bookDepth(Math.min(depth19, book.depth), b.size)) return [];
  return (book.entries[b.key] ?? []).map(([c, n]) => ({ loc: unsymmetric(c, b.size, b.sym), n }));
}

/**
 * An example as the chooser sees it at play time: the copy's candidates (a played move
 * outside KataGo's list is not one of them, as in a real game) plus the book's moves.
 */
export function sampleOf(model: CopyWeights, ex: DoppelExample, book?: OpeningBook, depth19 = BOOK_DEPTH): MistakeSample {
  let p = copyProbs(model, ex);
  let n = ex.candidates.length;
  if (ex.outside) {
    n--;
    const z = p.slice(0, n).reduce((a, b) => a + b, 0) || 1;
    p = p.slice(0, n).map((v) => v / z);
  }
  const cands: CandInfo[] = [];
  for (let i = 0; i < n; i++) {
    const l = ex.loss?.[i];
    cands.push({ loc: ex.candidates[i], p: p[i], prior: ex.prior?.[i] ?? 0, ...(l !== null && l !== undefined ? { loss: l } : {}), flags: ex.flags?.[i] ?? 0, sigs: ex.sigs?.[i] ?? 0 });
  }
  for (const m of bookFor(book, ex, depth19)) {
    const c = cands.find((x) => x.loc === m.loc);
    if (c) c.book = m.n;
    else {
      // A book move outside the copy's candidates: KataGo's view of it is only known for the played move.
      const j = ex.candidates.indexOf(m.loc);
      const l = j >= 0 ? ex.loss?.[j] : undefined;
      cands.push({ loc: m.loc, p: 0, prior: j >= 0 ? ex.prior?.[j] ?? 0 : 0, ...(l !== null && l !== undefined ? { loss: l } : {}), flags: 0, sigs: 0, book: m.n });
    }
  }
  const played = ex.y >= 0 ? cands.findIndex((c) => c.loc === ex.candidates[ex.y]) : -1;
  const playedLoss = ex.playedLoss ?? (ex.y >= 0 ? ex.loss?.[ex.y] ?? undefined : undefined);
  const playedFlags = ex.y >= 0 ? ex.flags?.[ex.y] : undefined;
  return {
    cands,
    played,
    ...(playedLoss !== undefined && playedLoss !== null ? { playedLoss } : {}),
    ...(playedFlags !== undefined ? { playedFlags } : {}),
    state: { phase: ex.phase ?? 1, sit: ex.sit ?? 1, afterMistake: !!ex.afterMistake } };
}

/** Example weights for recency (half-life in games) and corrections. */
export function weighted(examples: readonly DoppelExample[], genome: Genome): DoppelExample[] {
  return examples.map((e) => {
    const rec = genome.halfLife > 0 && e.age !== undefined ? Math.pow(0.5, e.age / genome.halfLife) : 1;
    const w = (e.fix ? CORRECTION_WEIGHT : 1) * rec;
    return w === (e.w ?? 1) ? e : { ...e, w };
  });
}

export function fitWith(examples: readonly DoppelExample[], genome: Genome): CopyWeights {
  const train = examples.filter((e) => !e.outside && (e.y >= 0 || e.neg !== undefined));
  const base = Math.max(0.01, 3 / Math.max(train.length, 1));
  return fitCopy(weighted(examples, genome), { l2: base * genome.l2, l2Phase: genome.l2Phase, l2Sit: genome.l2Sit, epochs: 30 });
}

/** Calibration uses at most this many positions (a random-looking but fixed subset). */
const MAX_CALIB = 2500;
const thin = <T,>(a: readonly T[], max: number) => (a.length <= max ? [...a] : a.filter((_, i) => (i * 2654435761) % a.length < max));

export function mistakesWith(model: CopyWeights, examples: readonly DoppelExample[], genome: Genome, book?: OpeningBook): MistakeProfile {
  const real = examples.filter((e) => !e.fix && e.y >= 0);
  return learnMistakes(thin(real, MAX_CALIB).map((e) => sampleOf(model, e, book)), genome);
}

export interface TrainCopyOptions {
  version?: number;
  genome?: Genome;
  /** Kept on the model (profile/evolve.ts). */
  evo?: DoppelModel['evo'];
}

/**
 * Train a full copy. The measured copy learns from four games in five and is tested on the
 * fifth (habits, book and mistake profile all from the four); the copy kept learns from all.
 */
export function trainCopy(examples: readonly DoppelExample[], opts: TrainCopyOptions = {}): DoppelModel {
  const genome = opts.genome ?? DEFAULT_GENOME;
  const data = examples.filter((e) => e.y >= 0 || e.neg !== undefined);
  const real = data.filter((e) => !e.fix);
  const fixes = data.filter((e) => e.fix);
  const games = [...new Set(real.map((e) => e.gameId))];
  const { train, test } = splitByGame(real);

  const measured = fitWith([...train, ...fixes], genome);
  const mBook = bookFromExamples(train);
  const mMistakes = mistakesWith(measured, train, genome, mBook);
  const habits = evaluate(measured, test);
  const kata = evaluate({ weights: Array.from(initialWeights()) }, test);
  const play = measurePlay(
    test.map((e) => sampleOf(measured, e, mBook)),
    { mistakes: mMistakes, genome },
  );

  const w = fitWith(data, genome);
  const book = bookFromExamples(real);
  const mistakes = mistakesWith(w, real, genome, book);
  const listed = real.filter((e) => !e.outside).length;
  return {
    version: opts.version ?? 1,
    algo: DOPPEL_ALGO,
    ...w,
    trainedOn: listed,
    moves: real.length,
    gameIds: games.filter(Boolean),
    outsideRate: real.length ? (real.length - listed) / real.length : 0,
    trainedAt: Date.now(),
    metrics: {
      top1: habits.top1,
      top3: habits.top3,
      logLoss: habits.logLoss,
      baselineTop1: kata.top1,
      baselineTop3: kata.top3,
      baselineLogLoss: kata.logLoss,
      testSize: test.length,
      play,
    },
    mistakes,
    book,
    genome,
    ...(opts.evo ? { evo: opts.evo } : {}),
    ...(fixes.length ? { corrections: fixes.length } : {}),
  };
}
