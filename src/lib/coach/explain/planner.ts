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
import { chebyshev, lineOf as lineOfLoc } from '../../go/coords';
import { other, PASS, type Color, type Loc, type Move } from '../../go/types';
import { capitalize, cutAt, cutPly, ownerWords, playLines, regionLoss, turnPhrase, TURN_PTS, type ConsequenceResult, type RegionLoss } from './consequence';
import { afterMoves, boardOf, colorWord, coord, fmt1, lineMoves, sideLead, sideWin, trustedLen } from './geometry';
import { localR } from './concepts';
import { Reader, type ReaderOptions } from './reader';
import { shapeOf, type Shape } from './shapes';
import type { Budget, EngineRead, ExplainPosition, Prober, Question, ThoughtStep, Variation } from './types';

/** Below this the asked move is "about as good" as the best. */
export const EQUAL_PTS = 0.5;
/** From this loss on, a local reply is read as a refutation rather than a slow consequence. */
export const BIG_PTS = 3;
/** From this loss on it is a refutation even when the reply is elsewhere. */
export const HUGE_PTS = 10;
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
  /** The opponent moving first (the mover passes): what the mover's move is up against. */
  threat?: Threat;
  /** The opponent ignoring the best move (it passes after it): the mover's follow-up. */
  ignore?: Threat;
  /** The opponent taking the key point after `first` (a pass or the asked move): the mover to answer. */
  oppAt?: { read: EngineRead; first: Loc; move: Loc };
  /** A solid shape move a student can play instead, close enough to the best (opening, handicap). */
  teachAlt?: TeachAlt;
  /** The two compared lines meet again (consequence lines only). */
  moveOrder?: MoveOrder;
  vars: { best?: string; alts: string[]; asked?: string; lineA?: string; lineB?: string; other?: string; threat?: string; ignore?: string; teach?: string };
  variations: Variation[];
  reads: number;
  visits: number;
  thoughts: ThoughtStep[];
  ms: number;
}

/** A read with one side passing first, and the other side's best move there. */
export interface Threat {
  read: EngineRead;
  move: Loc;
  /** The line shown, from the asked position (a pass first). */
  line: Loc[];
}

export interface TeachAlt extends MoveEval {
  /** Points and winrate (0-1) worse than the best move, for the mover. */
  loss: number;
  winLoss: number;
  shape: Shape;
}

/**
 * How two compared lines relate: 'same' when they end in (nearly) the same stones, 'order'
 * when one plays the other's first move later (a question of move order).
 */
export interface MoveOrder {
  kind: 'same' | 'order';
  /** Stones only in line A's end / only in line B's end, at the compared ply. */
  onlyA: Move[];
  onlyB: Move[];
  /** Line B plays line A's first move later (and the other way round), at that move (1-based). */
  bPlaysA: number;
  aPlaysB: number;
  ply: number;
}

/** Below this the teaching alternative is close enough to the best (points / winrate). */
export const TEACH_PTS = 2.5;
export const TEACH_WIN = 0.03;

/**
 * The part of a line that stays local: moves near the anchors (and near the moves kept so
 * far), stopping at the first move elsewhere once `min` moves are kept. XIAO: "keep variations
 * focused on the question… stop before unrelated exchanges overwhelm the explanation".
 */
export function localLine(locs: readonly Loc[], anchors: readonly Loc[], size: number, max: number, min = 2): Loc[] {
  const r = localR(size) + 1;
  const area = anchors.filter((l) => l !== PASS && l >= 0);
  const out: Loc[] = [];
  for (const l of locs) {
    if (out.length >= max) break;
    const near = l !== PASS && (!area.length || area.some((a) => chebyshev(a, l, size) <= r));
    if (!near) {
      // A move elsewhere (or a pass) ends the local line; within the first `min` moves it is
      // still shown (the opponent answering elsewhere is part of the story), then the line stops.
      if (out.length >= min) break;
      out.push(l);
      if (out.length >= min) break;
      continue;
    }
    out.push(l);
    area.push(l);
  }
  return out;
}

/** How long a local line may run: what the visits vouch for, plus a few moves while it stays local. */
export const localMax = (visits: number, pvLen: number) => Math.min(pvLen, Math.max(trustedLen(visits) + 3, 6), 12);

/** The stones on the board after a line, as "loc:colour" keys. */
function stonesAfter(pos: ExplainPosition, moves: readonly Move[]): Map<Loc, 1 | 2> {
  const b = boardOf({ ...pos, moves: [...pos.moves, ...moves] });
  const out = new Map<Loc, 1 | 2>();
  for (let l = 0; l < b.stones.length; l++) if (b.stones[l]) out.set(l, b.stones[l] as 1 | 2);
  return out;
}

/** Compare two lines from the same position at the same length (see MoveOrder). */
export function compareLines(pos: ExplainPosition, a: readonly Move[], b: readonly Move[]): MoveOrder | null {
  const ply = Math.min(a.length, b.length);
  if (ply < 2) return null;
  const A = stonesAfter(pos, a.slice(0, ply));
  const B = stonesAfter(pos, b.slice(0, ply));
  const onlyA: Move[] = [];
  const onlyB: Move[] = [];
  for (const [l, c] of A) if (B.get(l) !== c) onlyA.push({ color: c, loc: l });
  for (const [l, c] of B) if (A.get(l) !== c) onlyB.push({ color: c, loc: l });
  // Where line B plays line A's first move (and the other way round), 1-based; 0 when it does not.
  const at = (line: readonly Move[], m: Move) => {
    const i = line.slice(1, ply).findIndex((x) => x.loc === m.loc && x.color === m.color);
    return i < 0 ? 0 : i + 2;
  };
  const bPlaysA = at(b, a[0]);
  const aPlaysB = at(a, b[0]);
  // A transposition needs one line to play the other's first move; two lines that differ only
  // in their first moves are just those two moves, not a move-order story.
  if (!bPlaysA && !aPlaysB) return null;
  if (onlyA.length + onlyB.length <= 2) return { kind: 'same', onlyA, onlyB, bPlaysA, aPlaysB, ply };
  return { kind: 'order', onlyA, onlyB, bPlaysA, aPlaysB, ply };
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

/** Stones on the board, and whether the setup is a handicap (only black stones placed). */
function boardCounts(pos: ExplainPosition, board: Board): { stones: number; handicap: boolean } {
  let stones = 0;
  for (let l = 0; l < board.stones.length; l++) if (board.stones[l]) stones++;
  const black = pos.setup.filter((m) => m.color === 1).length;
  const white = pos.setup.filter((m) => m.color === 2).length;
  return { stones, handicap: black >= 2 && white === 0 && pos.moves.length <= 30 };
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
  const counts = boardCounts(pos, board);
  const local = question.intent === 'live' || question.intent === 'kill' || question.intent === 'tesuji';

  // Time plans: each read gets the share of the time left that its visits are of the visits
  // still planned. The root read cannot know the path yet, so it plans for the likely one.
  const lv = budget.lineVisits || budget.visits;
  const lineReads = budget.lineDepth > 0 ? Math.max(0, budget.reads - 2) : 0;
  const M0 = question.move;
  const asks = (question.kind === 'why-move' || question.kind === 'why-not') && M0 !== undefined;
  const root = await reader.read(pos, budget.visits, asks ? 2 * budget.visits + 0.75 * lineReads * lv : budget.visits + lv + 0.5 * lineReads * lv);
  if (!root || !root.candidates.length) {
    if (root) reader.think('Read the position → KataGo gave no moves');
    return done();
  }
  f.root = root;
  const top = root.candidates[0];
  const best = evalOf(top);
  f.best = best;
  /** A candidate's line, kept local to `anchors` (the best move, the asked move…). */
  const lineOf = (c: { visits: number; pv: Loc[] }, anchors: Loc[]) => localLine(c.pv, anchors, size, localMax(c.visits, c.pv.length));
  f.vars.best = addVar({ label: C(best.loc), kind: 'best', moves: lineMoves(mover, lineOf(top, [best.loc])) });
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

  /**
   * What the best move is up against: the mover passes and the opponent plays first. Its
   * ownership against the read after the best move shows what the move does; its line shows
   * what happens if the move is missed (stones that die, the key point taken).
   */
  const threatRead = async (planned: number) => {
    if (reader.readsLeft() <= 0 || budget.lineDepth <= 0 || best.loc === PASS) return;
    const r = await reader.read(after([PASS]), lv, planned);
    const t = r?.candidates[0];
    if (!r || !t || t.loc === PASS) return;
    const line = [PASS, ...lineOf(t, [best.loc, t.loc])];
    f.threat = { read: r, move: t.loc, line };
    f.vars.threat = addVar({ label: `without ${C(best.loc)}`, kind: 'what-if', moves: lineMoves(mover, line) });
    reader.think(`Checked what ${colorWord(opp)} plays if ${colorWord(mover)} does not play ${C(best.loc)} → ${C(t.loc)}${chebyshev(t.loc, best.loc, size) <= 1 ? ', the same point' : ''}`, f.vars.threat);
  };

  /** The opponent ignoring a sente best move: the mover's follow-up (what answering prevents). */
  const ignoreRead = async (planned: number) => {
    if (reader.readsLeft() <= 0 || best.loc === PASS) return;
    const r = await reader.read(after([best.loc, PASS]), lv, planned);
    const t = r?.candidates[0];
    if (!r || !t || t.loc === PASS || chebyshev(t.loc, best.loc, size) > localR(size) + 1) return;
    const line = [best.loc, PASS, ...lineOf(t, [best.loc, t.loc])];
    f.ignore = { read: r, move: t.loc, line };
    f.vars.ignore = addVar({ label: `if ${colorWord(opp)} ignores ${C(best.loc)}`, kind: 'what-if', moves: lineMoves(mover, line) });
    reader.think(`Checked what happens if ${colorWord(opp)} ignores ${C(best.loc)} → ${colorWord(mover)} follows up at ${C(t.loc)}`, f.vars.ignore);
  };

  /** The opponent takes the point `move` after `first` (a pass or the asked move): must the mover answer? */
  const oppAtRead = async (first: Loc, move: Loc, planned: number) => {
    if (reader.readsLeft() <= 0 || move === PASS) return;
    const r = await reader.read(after([first, move]), lv, planned);
    if (!r || !r.candidates.length) return;
    f.oppAt = { read: r, first, move };
    const reply = r.candidates[0];
    reader.think(`Checked ${colorWord(opp)} at ${C(move)} → ${colorWord(mover)} ${chebyshev(reply.loc, move, size) <= localR(size) ? `answers nearby at ${C(reply.loc)}` : `can play elsewhere (${C(reply.loc)})`}`);
  };

  /**
   * A solid shape (a knight's move, a one-space jump) near the action that a student can play
   * with confidence, when it is close enough to the best (XIAO: "suggest a keima as a solid
   * option even if it is not the top move"). Only in the opening or a handicap game.
   */
  const teachAltRead = async (planned: number) => {
    if (budget.lineDepth <= 0 || best.loc === PASS) return;
    const opening = counts.stones <= 0.12 * size * size || counts.handicap;
    if (!opening) return;
    const bestShape = shapeOf(board, best.loc, mover);
    if (bestShape && (bestShape.id === 'keima' || bestShape.id === 'one-space-jump')) return;
    const lastOpp = [...pos.moves].reverse().find((m) => m.color === opp && m.loc !== PASS)?.loc;
    const focus = lastOpp ?? best.loc;
    const opts: { loc: Loc; shape: Shape }[] = [];
    for (let l = 0; l < size * size; l++) {
      if (board.stones[l] || !board.isLegal(l, mover) || chebyshev(l, focus, size) > localR(size) + 2) continue;
      const line = lineOfLoc(l, size);
      if (line < 3 || line > 4) continue;
      const sh = shapeOf(board, l, mover);
      if (sh && (sh.id === 'keima' || sh.id === 'one-space-jump')) opts.push({ loc: l, shape: sh });
    }
    if (!opts.length) return;
    // A shape KataGo already read at the root is priced for free; else read the nearest one.
    const known = opts
      .map((o) => ({ o, c: root.candidates.find((c) => c.loc === o.loc && c.visits >= 3) }))
      .filter((x) => x.c)
      .sort((a, b) => b.c!.scoreLead - a.c!.scoreLead)[0];
    let pick: TeachAlt | null = null;
    if (known) {
      const c = known.c!;
      pick = { ...evalOf(c), loss: best.lead - c.scoreLead, winLoss: best.win - c.winrate, shape: known.o.shape };
    } else if (reader.readsLeft() > 0) {
      const o = opts.sort((a, b) => chebyshev(a.loc, focus, size) - chebyshev(b.loc, focus, size))[0];
      const r = await reader.read(after([o.loc]), lv, planned);
      const reply = r?.candidates[0];
      if (r && reply) {
        const lead = moverLead(r);
        const win = sideWin(r.bWin, mover);
        pick = { loc: o.loc, lead, win, visits: r.visits, pv: [o.loc, ...reply.pv], loss: best.lead - lead, winLoss: best.win - win, shape: o.shape };
      }
    }
    if (!pick || pick.loss > TEACH_PTS || pick.winLoss > TEACH_WIN) {
      if (pick) reader.think(`Tried ${pick.shape.name} at ${C(pick.loc)} as a simpler move → ${fmt1(pick.loss)} points worse, not shown`, undefined, true);
      return;
    }
    f.teachAlt = pick;
    f.vars.teach = addVar({ label: C(pick.loc), kind: 'alternative', moves: lineMoves(mover, localLine(pick.pv, [pick.loc], size, 6)), scoreLoss: Math.max(0, pick.loss) });
    reader.think(`Checked ${pick.shape.name} at ${C(pick.loc)} as a simpler move → close to the best`, f.vars.teach, true);
  };

  /** Consequence lines A (worse move) against B (better move), as variations. */
  const consequence = async (a: { loc: Loc; read?: EngineRead | null }, b: { loc: Loc; read?: EngineRead | null }, loss: number) => {
    const res = await playLines(reader, pos, a, b, { a: C(a.loc), b: C(b.loc) });
    f.consequence = res;
    f.lineMovesFrom = { a: a.loc, b: b.loc };
    const tp = res.turning;
    // Lines that meet again are shown whole (the move order is the story); else cut where they turn.
    f.moveOrder = compareLines(pos, res.a.moves, res.b.moves) ?? undefined;
    const order = f.moveOrder;
    const endA = order ? res.a.moves.slice(0, order.ply) : tp ? cutAt(res.a.moves, cutPly(tp)) : res.a.moves;
    const endB = order ? res.b.moves.slice(0, order.ply) : tp ? cutAt(res.b.moves, cutPly(tp)) : res.b.moves;
    f.vars.lineA = addVar({
      label: `after ${C(a.loc)}`,
      kind: 'consequence',
      moves: endA,
      highlight: tp?.highlight,
      scoreLoss: Math.max(0, loss),
      note: tp ? `${capitalize(turnPhrase(tp, mover, { a: a.loc, b: b.loc, C }))}.` : order?.kind === 'same' ? undefined : 'No single area flips; the difference is spread over the board.',
    });
    f.vars.lineB = addVar({
      label: `${C(b.loc)} first`,
      kind: 'best',
      moves: endB,
      highlight: tp?.highlight,
      note: tp && ownerWords(tp.ownB) !== ownerWords(tp.ownA) ? `Here the ${tp.region} is ${ownerWords(tp.ownB)}.` : undefined,
    });
    if (res.common.length) {
      const last = pos.moves.length + res.common[res.common.length - 1];
      reader.think(
        order
          ? `Compared the two lines → they ${order.kind === 'same' ? 'reach the same position' : 'meet again in another move order'} by move ${pos.moves.length + order.ply}`
          : tp
            ? `Compared the two lines → the ${tp.region} turns at move ${tp.moveNumber}`
            : `Compared the two lines to move ${last} → no single area flips`,
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
      f.vars.alts.push(addVar({ label: C(alt.loc), kind: 'alternative', moves: lineMoves(mover, lineOf(alt, [alt.loc])), scoreLoss: Math.max(0, best.lead - alt.lead) }));
    }
    const alt0 = f.alternatives[0];
    const willCompare = !local && f.mode !== 'overview' && !!alt0 && budget.lineDepth > 0 && best.lead - alt0.lead >= EQUAL_PTS;
    const planned = (n: number) => n * lv + (willCompare ? Math.max(0, lineReads - 4) * lv : 0);
    if (reader.readsLeft() > 0 && best.loc !== PASS) {
      f.afterBest = await reader.read(after([best.loc]), lv, planned(4));
      if (f.afterBest) replyThought(best.loc, f.afterBest, null, f.vars.best);
    }
    await threatRead(planned(3));
    // A sente best move: what the opponent risks by ignoring it.
    const ab = f.afterBest?.candidates[0];
    if (ab && ab.loc !== PASS && chebyshev(ab.loc, best.loc, size) <= localR(size) && reader.readsLeft() > (willCompare ? 3 : 0)) await ignoreRead(planned(2));
    // The opponent's threat is the same point: is it sente for them too (double sente)?
    const t = f.threat;
    if (t && chebyshev(t.move, best.loc, size) <= 1 && !local && reader.readsLeft() > (willCompare ? 3 : 0)) await oppAtRead(PASS, t.move, planned(2));
    if (!local && f.mode !== 'overview') await teachAltRead(planned(1));
    const alt = f.alternatives[0];
    if (willCompare && alt && reader.readsLeft() >= 3) {
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
    const alt0 = f.alternatives[0];
    const willCompare = !!alt0 && budget.lineDepth > 0 && best.lead - alt0.lead >= EQUAL_PTS;
    const r = await reader.read(after([M]), budget.visits, budget.visits + lv + (willCompare ? lineReads * lv : 0));
    f.afterBest = r;
    f.asked = { loc: M, legal: true, isBest: true, read: r, lead: best.lead, win: best.win, loss: 0, reply: r?.candidates[0]?.loc };
    if (r) replyThought(M, r, null, f.vars.best);
    // What the move does: against the opponent playing first there.
    await threatRead(lv + (willCompare ? lineReads * lv : 0));
    const alt = f.alternatives[0];
    if (alt) {
      f.other = { ...alt, loss: best.lead - alt.lead };
      if (f.other.loss >= EQUAL_PTS && budget.lineDepth > 0 && reader.readsLeft() >= 3) {
        await consequence({ loc: alt.loc }, { loc: M, read: r }, f.other.loss);
      } else {
        f.vars.other = addVar({ label: C(alt.loc), kind: 'alternative', moves: lineMoves(mover, lineOf(alt, [alt.loc])), scoreLoss: Math.max(0, f.other.loss) });
      }
    }
  } else {
    const r = await reader.read(after([M]), budget.visits, budget.visits + lineReads * lv);
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
    // The opponent answers by taking (or touching) KataGo's point: is that sente for them too?
    const keyReply = reply && reply.loc !== PASS && best.loc !== PASS && chebyshev(reply.loc, best.loc, size) <= 1 && loss >= EQUAL_PTS;
    if (loss < EQUAL_PTS) {
      f.mode = 'equal';
      f.vars.asked = addVar({ label: C(M), kind: 'what-if', moves: lineMoves(mover, [M, ...(reply ? lineOf(reply, [M, reply.loc]) : [])]), scoreLoss: Math.max(0, loss) });
      replyThought(M, r, loss, f.vars.asked);
      if (reader.readsLeft() > 0) {
        f.afterBest = await reader.read(after([best.loc]), lv, 2 * lv);
        if (f.afterBest) replyThought(best.loc, f.afterBest, null, f.vars.best);
      }
      // What the asked move does, against the opponent playing first.
      await threatRead(lv);
    } else if ((loss >= BIG_PTS && (loss >= HUGE_PTS || !reply || reply.loc === PASS || chebyshev(reply.loc, M, size) <= localR(size) + 1)) || budget.lineDepth <= 0 || reader.readsLeft() < 2) {
      f.mode = loss >= BIG_PTS ? 'refutation' : 'whatif';
      const locs = [M, ...(reply ? lineOf(reply, [M, reply.loc]) : [])];
      replyThought(M, r, loss);
      let endRead = r;
      let extended = false;
      if (f.mode === 'refutation' && reply && locs.length - 1 < SHORT_LINE && reader.readsLeft() > 0 && budget.lineDepth > 0) {
        const r2 = await reader.read(after(locs), lv, 3 * lv);
        const top2 = r2?.candidates[0];
        if (r2 && top2) {
          const more = localLine(top2.pv, [M, ...locs.slice(1)], size, localMax(top2.visits, top2.pv.length), 0);
          locs.push(...more);
          endRead = r2;
          extended = more.length > 0;
          reader.think(`Followed the refutation to move ${pos.moves.length + locs.length} → ${sideLeadPhrase(moverLead(r2), mover)}`);
        }
      }
      if (reader.readsLeft() > 0 && budget.lineDepth > 0) {
        f.afterBest = await reader.read(after([best.loc]), lv, 2 * lv);
        if (f.afterBest) replyThought(best.loc, f.afterBest, null, f.vars.best);
      }
      if (keyReply && budget.lineDepth > 0) await oppAtRead(M, reply!.loc, lv);
      const refOwn = f.afterBest?.ownership ?? root.ownership;
      const region = endRead.ownership && refOwn ? regionLoss(endRead.ownership, refOwn, mover, size, TURN_PTS) : null;
      f.refutation = { moves: lineMoves(mover, locs), endRead, extended, region, against: f.afterBest?.ownership ? 'best' : 'root' };
      const where = f.refutation.against === 'best' ? `after ${C(best.loc)}` : 'now';
      f.vars.asked = addVar({
        label: `after ${C(M)}`,
        kind: f.mode === 'refutation' ? 'refutation' : 'what-if',
        moves: f.refutation.moves,
        highlight: region?.highlight,
        scoreLoss: loss,
        note: region && ownerWords(region.ownA) !== ownerWords(region.ownB) ? `At the end the ${region.region} is ${ownerWords(region.ownA)}; ${where} it is ${ownerWords(region.ownB)}.` : undefined,
      });
      const last = reader.thoughts[reader.thoughts.length - 1];
      if (last && !last.variation) last.variation = f.vars.asked;
    } else {
      f.mode = 'consequence';
      replyThought(M, r, loss);
      if (keyReply) await oppAtRead(M, reply!.loc, (2 + Math.max(0, reader.readsLeft() - 1)) * lv);
      // What the best move does (its purposes) needs the board without it.
      if (!f.threat && reader.readsLeft() > 3) await threatRead((1 + Math.max(0, reader.readsLeft() - 1)) * lv);
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
