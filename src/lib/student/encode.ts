import { Board } from '../go/board';
import { PASS, type Loc, type Move } from '../go/types';

/**
 * A position as the student network reads it: 361 board bytes (scripts/student/README.md).
 * The same function makes the training records (scripts/student/label.ts) and the
 * runtime's inputs, so the two cannot drift apart.
 *
 *   bits 0-1 stone (0 empty, 1 black, 2 white)
 *   bits 2-3 liberties of the chain: 0 = empty or 4+, else 1..3
 *   bit 4    ko: empty point the side to move may not play now
 *   bits 5-6 recency: 1 last move, 2 the one before, 3 the one before that
 */
export const STUDENT_SIZE = 19;
const N = STUDENT_SIZE * STUDENT_SIZE;

/** recent: the last moves' points, most recent first (PASS for a pass). */
export function encodeBoard(board: Board, recent: Loc[]): Uint8Array {
  if (board.size !== STUDENT_SIZE) throw new Error('the student network is 19x19 only');
  const s = board.stones;
  const out = new Uint8Array(N);
  const chain = new Int32Array(N).fill(-1);
  const stamp = new Int32Array(N).fill(-1);
  const libs: number[] = [];
  const stack: number[] = [];
  const members: number[] = [];
  for (let i = 0; i < N; i++) {
    const c = s[i];
    if (c === 0 || chain[i] >= 0) continue;
    const id = libs.length;
    let count = 0;
    chain[i] = id;
    stack.push(i);
    members.length = 0;
    while (stack.length) {
      const p = stack.pop()!;
      members.push(p);
      const x = p % STUDENT_SIZE;
      const around = [x > 0 ? p - 1 : -1, x < STUDENT_SIZE - 1 ? p + 1 : -1, p - STUDENT_SIZE, p + STUDENT_SIZE];
      for (const q of around) {
        if (q < 0 || q >= N) continue;
        const v = s[q];
        if (v === 0) {
          if (stamp[q] !== id) {
            stamp[q] = id;
            count++;
          }
        } else if (v === c && chain[q] < 0) {
          chain[q] = id;
          stack.push(q);
        }
      }
    }
    libs.push(count);
    const cls = count >= 4 ? 0 : count;
    for (const p of members) out[p] = c | (cls << 2);
  }
  if (board.koPoint !== PASS && board.koPoint >= 0 && s[board.koPoint] === 0) out[board.koPoint] |= 1 << 4;
  for (let k = 0; k < 3 && k < recent.length; k++) {
    const p = recent[k];
    if (p !== PASS && p >= 0 && p < N && s[p] !== 0 && (out[p] >> 5) === 0) out[p] |= (k + 1) << 5;
  }
  return out;
}

/** Board bytes after a sequence of moves (setup stones given as leading moves are fine). */
export function encodeMoves(moves: Move[], setup: Move[] = []): Uint8Array {
  const b = new Board(STUDENT_SIZE);
  for (const m of setup) if (m.loc !== PASS) b.stones[m.loc] = m.color;
  for (const m of moves) b.play(m.loc, m.color, true);
  const recent: Loc[] = [];
  for (let i = moves.length - 1; i >= 0 && recent.length < 3; i--) recent.push(moves[i].loc);
  return encodeBoard(b, recent);
}
