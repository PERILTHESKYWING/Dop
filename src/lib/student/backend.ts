import { Board } from '../go/board';
import { symmetric } from '../go/coords';
import { PASS, type Color, type Loc, type Move } from '../go/types';
import type { RawNetOutput } from '../engine/parse';
import { encodeBoard, STUDENT_SIZE } from './encode';
import type { DopnetRuntime } from './runtime';

/** One position for the student network (EngineRequest plus a symmetry). */
export interface StudentRequest {
  komi: number;
  /** Setup stones as leading moves, then the game moves (as kataeval takes them). */
  moves: Move[];
  toPlay: Color;
  ownership?: boolean;
  /** Board symmetry 0-7 to look at the position under (for averaging and the doubt meter). */
  symmetry?: number;
}

const N = STUDENT_SIZE * STUDENT_SIZE;

/**
 * Boards by move sequence, so a search's leaves (one or two moves past a position already
 * looked at) replay only their last moves.
 */
class BoardCache {
  private map = new Map<number, Board>();
  private order: number[] = [];

  boardFor(moves: Move[]): Board {
    const hashes = new Float64Array(moves.length + 1);
    let h = 0;
    for (let i = 0; i < moves.length; i++) {
      h = (h * 1000003 + (moves[i].loc + 2) * 3 + moves[i].color) % 2147483647;
      hashes[i + 1] = h + (i + 1) * 4294967296;
    }
    let from = 0;
    let b: Board | null = null;
    for (let i = moves.length; i >= Math.max(1, moves.length - 12); i--) {
      const hit = this.map.get(hashes[i]);
      if (hit) {
        b = hit.clone();
        from = i;
        break;
      }
    }
    b ??= new Board(STUDENT_SIZE);
    for (let i = from; i < moves.length; i++) b.play(moves[i].loc, moves[i].color, true);
    if (from < moves.length) this.put(hashes[moves.length], b.clone());
    return b;
  }

  private put(k: number, b: Board) {
    if (this.map.has(k)) return;
    this.map.set(k, b);
    this.order.push(k);
    if (this.order.length > 256) this.map.delete(this.order.shift()!);
  }
}

const boards = new BoardCache();

/** The student's answer for one position, as the raw outputs kataeval gives (side to move). */
export function studentRaw(rt: DopnetRuntime, req: StudentRequest, opts: { allowExit?: boolean } = {}): RawNetOutput & { exited: boolean } {
  const board = boards.boardFor(req.moves);
  const recent: Loc[] = [];
  for (let i = req.moves.length - 1; i >= 0 && recent.length < 3; i--) recent.push(req.moves[i].loc);
  let bytes = encodeBoard(board, recent);
  const sym = req.symmetry ?? 0;
  if (sym) {
    const t = new Uint8Array(N);
    for (let p = 0; p < N; p++) t[symmetric(p, STUDENT_SIZE, sym)] = bytes[p];
    bytes = t;
  }
  const out = rt.evaluate(bytes, req.toPlay, req.komi, { ownership: !!req.ownership, allowExit: opts.allowExit });
  let policyLogits = out.policyLogits;
  let ownership = out.ownership;
  if (sym) {
    const pol = new Float32Array(N + 1);
    for (let p = 0; p < N; p++) pol[p] = policyLogits[symmetric(p, STUDENT_SIZE, sym)];
    pol[N] = policyLogits[N];
    policyLogits = pol;
    if (ownership) {
      const own = new Float32Array(N);
      for (let p = 0; p < N; p++) own[p] = ownership[symmetric(p, STUDENT_SIZE, sym)];
      ownership = own;
    }
  }
  // kataeval's value outputs: [win, loss, no-result] logits, score mean / 20, lead / 20.
  const value = Float32Array.from([out.winLogit, 0, -30, out.lead / 20, out.lead / 20]);
  return { policyLogits, value, ownership, exited: out.exited };
}

export const isStudentPosition = (size: number, moves: Move[]) => size === STUDENT_SIZE && moves.every((m) => m.loc === PASS || (m.loc >= 0 && m.loc < N));
