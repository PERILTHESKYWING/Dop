import { Board } from '../go/board';
import { locToSgf, sgfToLoc, xy } from '../go/coords';
import { type Color, type Loc, type Move, other } from '../go/types';
import { decodeStones, framePosition, inRect, type Rect } from './frame';
import type { Problem, ProblemBranch, ProblemNode } from './types';

/**
 * Solving a problem: the player's moves are checked against the answer tree KataGo searched
 * out, the opponent answers with one of its strongest replies, and a wrong move is shown
 * with the refutation KataGo found for it.
 */

export const colorOf = (p: Problem): Color => (p.toPlay === 'B' ? 1 : 2);
export const rectOf = (p: Problem): Rect | null => (p.view ? { x0: p.view[0], y0: p.view[1], x1: p.view[2], y1: p.view[3] } : null);

/**
 * The board the problem is played on. Local problems get their tsumego frame back (the
 * same one KataGo searched with), so captures at the window's edge work as they did there.
 */
export function problemBoard(p: Problem): Board {
  const stones = decodeStones(p.b, p.w, p.size);
  const r = rectOf(p);
  if (r && p.frame) {
    const framed = framePosition(stones, p.size, r, p.frame === 'B' ? 1 : 2);
    if (framed) return new Board(p.size, framed);
  }
  return new Board(p.size, stones);
}

/**
 * The window drawn: the problem's window plus one line of the frame on every side that is
 * not the board's edge, so the wall that encloses the fight can be seen.
 */
export function viewOf(p: Problem): Rect | null {
  const r = rectOf(p);
  if (!r) return null;
  const n = p.size;
  return { x0: Math.max(0, r.x0 - 1), y0: Math.max(0, r.y0 - 1), x1: Math.min(n - 1, r.x1 + 1), y1: Math.min(n - 1, r.y1 + 1) };
}

/** Can the player play here? Local problems are played inside their window. */
export function playable(p: Problem, board: Board, loc: Loc): boolean {
  const r = rectOf(p);
  if (r) {
    const [x, y] = xy(loc, p.size);
    if (!inRect(r, x, y)) return false;
  }
  return board.isLegal(loc, colorOf(p));
}

export type Outcome = 'continue' | 'solved' | 'wrong';

export interface SolveState {
  board: Board;
  /** Moves played in this attempt (player and opponent). */
  moves: Move[];
  /** The player's turn in the answer tree, or null once the attempt is over. */
  node: ProblemNode | null;
  outcome: Outcome;
  /** After a wrong move: KataGo's refutation (the opponent's reply first), when known. */
  refutation: Loc[] | null;
}

export function startSolve(p: Problem): SolveState {
  return { board: problemBoard(p), moves: [], node: p.tree, outcome: 'continue', refutation: null };
}

/**
 * The player plays `loc`. Returns the new state and the opponent's reply (already on the
 * board) when there is one.
 */
export function playMove(p: Problem, s: SolveState, loc: Loc, rand: () => number = Math.random): { state: SolveState; reply: Loc | null } {
  if (!s.node || s.outcome !== 'continue') return { state: s, reply: null };
  const me = colorOf(p);
  const board = s.board.clone();
  board.play(loc, me);
  const moves = [...s.moves, { color: me, loc }];
  const key = locToSgf(loc, p.size);
  const branches = s.node.ok[key];
  if (!branches) {
    const line = s.node.bad?.[key]?.map((c) => sgfToLoc(c, p.size)) ?? null;
    return { state: { board, moves, node: null, outcome: 'wrong', refutation: line }, reply: null };
  }
  if (!branches.length) return { state: { board, moves, node: null, outcome: 'solved', refutation: null }, reply: null };
  const br: ProblemBranch = branches[Math.floor(rand() * branches.length)];
  const reply = sgfToLoc(br.r, p.size);
  if (board.isLegal(reply, other(me))) board.play(reply, other(me));
  moves.push({ color: other(me), loc: reply });
  const next = br.n ?? null;
  return { state: { board, moves, node: next, outcome: next ? 'continue' : 'solved', refutation: null }, reply };
}

/** The main line of the answer: the first right move, the first reply, and so on. */
export function mainLine(tree: ProblemNode, size: number): Loc[] {
  const out: Loc[] = [];
  let n: ProblemNode | undefined = tree;
  while (n) {
    const keys: string[] = Object.keys(n.ok);
    if (!keys.length) break;
    out.push(sgfToLoc(keys[0], size));
    const br: ProblemBranch | undefined = n.ok[keys[0]][0];
    if (!br) break;
    out.push(sgfToLoc(br.r, size));
    n = br.n;
  }
  return out;
}

/** Continue the main line from where an attempt stands (to show the answer on the board). */
export function answerFrom(p: Problem, s: SolveState): Loc[] {
  // Replay the attempt through the tree to the node it reached, then follow the main line.
  let n: ProblemNode | undefined = p.tree;
  const me = colorOf(p);
  for (let i = 0; i < s.moves.length && n; i += 2) {
    const m = s.moves[i];
    if (m.color !== me) break;
    const br: ProblemBranch[] | undefined = n.ok[locToSgf(m.loc, p.size)];
    if (!br) return mainLine(n, p.size);
    const reply = s.moves[i + 1];
    const chosen: ProblemBranch | undefined = br.find((b) => reply && b.r === locToSgf(reply.loc, p.size)) ?? br[0];
    n = chosen?.n;
    if (!chosen) return [];
  }
  return n ? mainLine(n, p.size) : [];
}

/** Number of moves the player makes along the main line. */
export const answerLength = (p: Problem) => Math.ceil(mainLine(p.tree, p.size).length / 2);

/** The right first moves. */
export const firstAnswers = (p: Problem): Loc[] => Object.keys(p.tree.ok).map((k) => sgfToLoc(k, p.size));

/** Play a line of moves on a copy of the board, starting with `first`. */
export function playLine(board: Board, first: Color, line: readonly Loc[]): Board {
  const b = board.clone();
  let c = first;
  for (const l of line) {
    if (l >= 0 && b.isLegal(l, c)) b.play(l, c);
    c = other(c);
  }
  return b;
}
