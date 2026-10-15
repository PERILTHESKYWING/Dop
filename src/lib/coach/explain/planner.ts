/**
 * The planner: read the position, then decide what else is worth reading inside the budget.
 *
 * - best / overview: the best line, one or two alternatives, the opponent's answer to the
 *   best move (for sente/gote and miai), and, with reads to spare, a consequence search of
 *   the runner-up against the best move ("why this and not that").
 * - why-move / why-not: play the asked move and read it; compare with the best move.
 *   - about equal (< EQUAL_PTS): show both.
 *   - big loss (>= BIG_PTS): refutation from the reply's PV, extended by one more read
 *     when the trusted part of the PV is short.
 *   - small or slow loss: consequence search (consequence.ts) when the budget has line
 *     reads, else the reply's line as a what-if.
 *   - the asked move is the best move: compare it with the runner-up the same way.
 *
 * It only gathers reads (Findings); concepts.ts and text.ts turn them into words.
 */
import type { Board } from '../../go/board';
import { chebyshev } from '../../go/coords';
import { other, PASS, type Color, type Loc, type Move } from '../../go/types';
import { capitalize, cutAt, cutPly, ownerWords, playLines, regionLoss, turnPhrase, TURN_PTS, type ConsequenceResult, type RegionLoss } from './consequence';
import { afterMoves, boardOf, colorWord, coord, fmt1, lineMoves, sideLead, sideWin, trustedLen } from './geometry';
import { localR } from './concepts';
import { Reader, type ReaderOptions } from './reader';
import type { Budget, EngineRead, ExplainPosition, Prober, Question, ThoughtStep, Variation } from './types';

/** Below this the asked move is "about as good" as the best. */
export const EQUAL_PTS = 0.5;
/** From this loss on, look for a refutation rather than a slow consequence. */
export const BIG_PTS = 3;
/** Two candidates this close can be miai. */
export const MIAI_PTS = 0.6;
/** Root candidates need this share of the root's visits to count as alternatives. */
const ALT_SHARE = 0.05;
/** A refutation whose trusted line is shorter than this is read once more. */
const SHORT_LINE = 6;

export type Mode =
  /** The engine gave nothing. */
  | 'unread'
  | 'best'
  | 'overview'
  /** The asked move cannot be played; answered as 'best'. */
  | 'illegal'
  /** The asked move could not be read in time. */
  | 'unchecked'
  /** The asked move is the best move. */
  | 'good'
  | 'equal'
  | 'refutation'
  /** A small loss without line reads (Hane): the reply's line only. */
  | 'whatif'
  | 'consequence';

/** A move's value for the side to move. */
export interface MoveEval {
  loc: Loc;
  lead: number;
  win: number;
  visits: number;
  pv: Loc[];
}

export interface AskedMove {
  loc: Loc;
  legal: boolean;
  isBest: boolean;
  /** The read right after the asked move (opponent to play). */
  read: EngineRead | null;
  lead: number;
  win: number;
  /** Points worse than the best move, for the side to move (negative = better in this read). */
  loss: number;
  /** The opponent's best answer. */
  reply?: Loc;
}

export interface Refutation {
  moves: Move[];
  /** The last read along it (its ownership is where the damage shows). */
  endRead: EngineRead;
  extended: boolean;
  region: RegionLoss | null;
  /** The ownership it was compared with: right after the best move, else the position itself. */
  against: 'best' | 'root';
}

export interface Findings {
  pos: ExplainPosition;
  question: Question;
  budget: Budget;
  mover: Color;
  board: Board;
  mode: Mode;
  root: EngineRead | null;
  best?: MoveEval;
  alternatives: MoveEval[];
  /** The read right after the best move (opponent to play). */
  afterBest: EngineRead | null;
  asked?: AskedMove;
  /** In 'good' mode and for 'best' questions: the runner-up the best move was compared with. */
  other?: MoveEval & { loss: number };
  refutation?: Refutation;
  consequence?: ConsequenceResult;
  /** Which moves the consequence lines start with. */
  lineMovesFrom?: { a: Loc; b: Loc };
  miai?: { a: Loc; b: Loc; gap: number; reply: Loc };
  vars: { best?: string; alts: string[]; asked?: string; lineA?: string; lineB?: string; other?: string };
  variations: Variation[];
  reads: number;
  visits: number;
  thoughts: ThoughtStep[];
  ms: number;
}

const evalOf = (c: EngineRead['candidates'][number]): MoveEval => ({ loc: c.loc, lead: c.scoreLead, win: c.winrate, visits: c.visits, pv: c.pv });

/** The part of a PV worth showing: what its visits vouch for, but at least a few moves. */
export function shownPv(c: { visits: number; pv: Loc[] }): Loc[] {
  return c.pv.slice(0, Math.max(Math.min(4, c.pv.length), trustedLen(c.visits)));
}

/** "Black leads by 2.3" / "Black trails by 1.0" / "the game is even", for a side's lead. */
export function sideLeadPhrase(lead: number, c: Color): string {
  const r = Math.round(lead * 10) / 10;
  if (r === 0) return 'the game is even';
  return r > 0 ? `${colorWord(c)} leads by ${fmt1(r)}` : `${colorWord(c)} trails by ${fmt1(-r)}`;
}

export async function runPlan(pos: ExplainPosition, question: Question, prober: Prober, budget: Budget, opts: ReaderOptions = {}): Promise<Findings> {
  const reader = new Reader(prober, budget, opts);
  const mover = pos.toPlay;
  const opp = other(mover);
  const size = pos.size;
  const board = boardOf(pos);
  const variations: Variation[] = [];
  const addVar = (v: Omit<Variation, 'id'>): string => {
    const id = `v${variations.length + 1}`;
    const out: Variation = { id, label: v.label, kind: v.kind, moves: v.moves };
    if (v.highlight?.length) out.highlight = v.highlight;
    if (v.scoreLoss !== undefined) out.scoreLoss = Math.round(v.scoreLoss * 10) / 10;
    if (v.note) out.note = v.note;
    variations.push(out);
    return id;
  };
  const f: Findings = {
    pos,
    question,
    budget,
    mover,
    board,
    mode: 'unread',
    root: null,
    alternatives: [],
    afterBest: null,
    vars: { alts: [] },
    variations,
    reads: 0,
    visits: 0,
    thoughts: reader.thoughts,
    ms: 0,
  };
  const done = () => {
    f.reads = reader.reads;
    f.visits = reader.visits;
    f.ms = Math.round(reader.elapsed());
    return f;
  };
  const C = (l: Loc) => coord(l, size);
  const after = (locs: Loc[]) => afterMoves(pos, locs);
  const moverLead = (r: EngineRead) => sideLead(r.bLead, mover);

  const root = await reader.read(pos, budget.visits);
  if (!root || !root.candidates.length) {
    if (root) reader.think('Read the position → KataGo gave no moves');
    return done();
  }
  f.root = root;
  const top = root.candidates[0];
  const best = evalOf(top);
  f.best = best;
  f.vars.best = addVar({ label: C(best.loc), kind: 'best', moves: lineMoves(mover, shownPv(top)) });
  reader.think(`Read the position → best is ${C(best.loc)}, ${sideLeadPhrase(best.lead, mover)}`, f.vars.best);
  const altMin = Math.max(3, ALT_SHARE * root.visits);
  f.alternatives = root.candidates.slice(1).filter((c) => c.visits >= altMin && c.loc !== PASS).map(evalOf);

  /** The opponent's answer to a move, as a thought. */
  const replyThought = (move: Loc, r: EngineRead, loss: number | null, variation?: string) => {
    const reply = r.candidates[0];
    const ans = reply ? `${colorWord(opp)} answers ${C(reply.loc)}${chebyshev(reply.loc, move, size) <= localR(size) ? ' nearby' : ' elsewhere'}` : `${colorWord(opp)} has no answer`;
    const tail = loss === null ? `, ${sideLeadPhrase(moverLead(r), mover)}` : loss >= 0.05 ? `, −${fmt1(loss)} pts` : loss <= -0.05 ? `, +${fmt1(-loss)} pts` : ', same score';
    reader.think(`Checked ${C(move)} → ${ans}${tail}`, variation);
  };

  /** Consequence lines A (worse move) against B (better move), as variations. */
  const consequence = async (a: { loc: Loc; read?: EngineRead | null }, b: { loc: Loc; read?: EngineRead | null }, loss: number) => {
    const res = await playLines(reader, pos, a, b, { a: C(a.loc), b: C(b.loc) });
    f.consequence = res;
    f.lineMovesFrom = { a: a.loc, b: b.loc };
    const tp = res.turning;
    const endA = tp ? cutAt(res.a.moves, cutPly(tp)) : res.a.moves;
    const endB = tp ? cutAt(res.b.moves, cutPly(tp)) : res.b.moves;
    const lastMove = (moves: Move[]) => pos.moves.length + moves.length;
    f.vars.lineA = addVar({
      label: `${C(a.loc)} to move ${lastMove(endA)}`,
      kind: 'consequence',
      moves: endA,
      highlight: tp?.highlight,
      scoreLoss: Math.max(0, loss),
      note: tp ? `${capitalize(turnPhrase(tp, mover))}.` : 'No single area flips; the difference is spread over the board.',
    });
    f.vars.lineB = addVar({
      label: `${C(b.loc)} to move ${lastMove(endB)}`,
      kind: 'best',
      moves: endB,
      highlight: tp?.highlight,
      note: tp ? `Here the ${tp.region} is ${ownerWords(tp.ownB)}.` : undefined,
    });
    if (res.common.length) {
      reader.think(
        tp ? `Compared the two lines → the ${tp.region} turns at move ${tp.moveNumber}` : `Compared the two lines to move ${pos.moves.length + res.common[res.common.length - 1]} → no single area flips`,
        f.vars.lineA,
        true,
      );
    }
    const b1 = res.b.checkpoints.find((c) => c.ply === 1);
    if (b1 && b.loc === best.loc) f.afterBest = b1.read;
  };

  /** The best-move answer: alternatives, the reply to the best move, and why not the runner-up. */
  const bestFlow = async () => {
    for (const alt of f.alternatives.slice(0, budget.lineDepth > 0 ? 2 : 1)) {
      f.vars.alts.push(addVar({ label: C(alt.loc), kind: 'alternative', moves: lineMoves(mover, shownPv(alt)), scoreLoss: Math.max(0, best.lead - alt.lead) }));
    }
    if (reader.readsLeft() > 0 && best.loc !== PASS) {
      f.afterBest = await reader.read(after([best.loc]), budget.lineVisits || budget.visits);
      if (f.afterBest) replyThought(best.loc, f.afterBest, null, f.vars.best);
    }
    const alt = f.alternatives[0];
    if (alt && budget.lineDepth > 0 && reader.readsLeft() >= 3 && best.lead - alt.lead >= EQUAL_PTS) {
      f.other = { ...alt, loss: best.lead - alt.lead };
      await consequence({ loc: alt.loc }, { loc: best.loc, read: f.afterBest }, f.other.loss);
    }
  };

  const M = question.move;
  const asksMove = (question.kind === 'why-move' || question.kind === 'why-not') && M !== undefined;
  if (!asksMove) {
    f.mode = question.kind === 'overview' ? 'overview' : 'best';
    await bestFlow();
  } else if (M !== PASS && (M < 0 || M >= size * size || !board.isLegal(M, mover))) {
    f.mode = 'illegal';
    f.asked = { loc: M, legal: false, isBest: false, read: null, lead: 0, win: 0, loss: 0 };
    await bestFlow();
  } else if (M === best.loc) {
    // The asked move is KataGo's choice: show why, against the runner-up.
    f.mode = 'good';
    const r = await reader.read(after([M]), budget.visits);
    f.afterBest = r;
    f.asked = { loc: M, legal: true, isBest: true, read: r, lead: best.lead, win: best.win, loss: 0, reply: r?.candidates[0]?.loc };
    if (r) replyThought(M, r, null, f.vars.best);
    const alt = f.alternatives[0];
    if (alt) {
      f.other = { ...alt, loss: best.lead - alt.lead };
      if (f.other.loss >= EQUAL_PTS && budget.lineDepth > 0 && reader.readsLeft() >= 3) {
        await consequence({ loc: alt.loc }, { loc: M, read: r }, f.other.loss);
      } else {
        f.vars.other = addVar({ label: C(alt.loc), kind: 'alternative', moves: lineMoves(mover, shownPv(alt)), scoreLoss: Math.max(0, f.other.loss) });
      }
    }
  } else {
    const r = await reader.read(after([M]), budget.visits);
    const rootCand = root.candidates.find((c) => c.loc === M);
    if (!r) {
      // Out of time: fall back to what the root read said about the move, if anything.
      f.mode = 'unchecked';
      f.asked = rootCand
        ? { loc: M, legal: true, isBest: false, read: null, lead: rootCand.scoreLead, win: rootCand.winrate, loss: best.lead - rootCand.scoreLead }
        : { loc: M, legal: true, isBest: false, read: null, lead: 0, win: 0, loss: 0 };
      return done();
    }
    const lead = moverLead(r);
    const loss = best.lead - lead;
    const reply = r.candidates[0];
    f.asked = { loc: M, legal: true, isBest: false, read: r, lead, win: sideWin(r.bWin, mover), loss, reply: reply?.loc };
    if (loss < EQUAL_PTS) {
      f.mode = 'equal';
      f.vars.asked = addVar({ label: C(M), kind: 'what-if', moves: lineMoves(mover, [M, ...(reply ? shownPv(reply) : [])]), scoreLoss: Math.max(0, loss) });
      replyThought(M, r, loss, f.vars.asked);
      if (reader.readsLeft() > 0) {
        f.afterBest = await reader.read(after([best.loc]), budget.lineVisits || budget.visits);
        if (f.afterBest) replyThought(best.loc, f.afterBest, null, f.vars.best);
      }
    } else if (loss >= BIG_PTS || budget.lineDepth <= 0 || reader.readsLeft() < 2) {
      f.mode = loss >= BIG_PTS ? 'refutation' : 'whatif';
      const locs = [M, ...(reply ? shownPv(reply) : [])];
      replyThought(M, r, loss);
      let endRead = r;
      let extended = false;
      if (f.mode === 'refutation' && reply && locs.length - 1 < SHORT_LINE && reader.readsLeft() > 0 && budget.lineDepth > 0) {
        const r2 = await reader.read(after(locs), budget.lineVisits || budget.visits);
        const top2 = r2?.candidates[0];
        if (r2 && top2) {
          locs.push(...shownPv(top2));
          endRead = r2;
          extended = true;
          reader.think(`Followed the refutation to move ${pos.moves.length + locs.length} → ${sideLeadPhrase(moverLead(r2), mover)}`);
        }
      }
      if (reader.readsLeft() > 0 && budget.lineDepth > 0) {
        f.afterBest = await reader.read(after([best.loc]), budget.lineVisits || budget.visits);
        if (f.afterBest) replyThought(best.loc, f.afterBest, null, f.vars.best);
      }
      const refOwn = f.afterBest?.ownership ?? root.ownership;
      const region = endRead.ownership && refOwn ? regionLoss(endRead.ownership, refOwn, mover, size, TURN_PTS) : null;
      f.refutation = { moves: lineMoves(mover, locs), endRead, extended, region, against: f.afterBest?.ownership ? 'best' : 'root' };
      const where = f.refutation.against === 'best' ? `after ${C(best.loc)}` : 'now';
      f.vars.asked = addVar({
        label: C(M),
        kind: f.mode === 'refutation' ? 'refutation' : 'what-if',
        moves: f.refutation.moves,
        highlight: region?.highlight,
        scoreLoss: loss,
        note: region ? `At the end the ${region.region} is ${ownerWords(region.ownA)}; ${where} it is ${ownerWords(region.ownB)}.` : undefined,
      });
      const last = reader.thoughts[reader.thoughts.length - 1];
      if (last && !last.variation) last.variation = f.vars.asked;
    } else {
      f.mode = 'consequence';
      replyThought(M, r, loss);
      await consequence({ loc: M, read: r }, { loc: best.loc }, loss);
      f.vars.asked = f.vars.lineA;
    }
  }

  // Miai: two near-equal moves where taking one makes the other the opponent's best reply.
  const alt = f.alternatives[0];
  const ab = f.afterBest;
  const reply = ab?.candidates[0];
  if (alt && reply && best.loc !== PASS && Math.abs(best.lead - alt.lead) <= MIAI_PTS && alt.visits >= 0.1 * root.visits && chebyshev(best.loc, alt.loc, size) >= 3) {
    if (chebyshev(reply.loc, alt.loc, size) <= 1) f.miai = { a: best.loc, b: alt.loc, gap: Math.abs(best.lead - alt.lead), reply: reply.loc };
  }
  return done();
}
