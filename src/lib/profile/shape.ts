import type { Board } from '../go/board';
import { lineOf, onBoard, toLoc, xy } from '../go/coords';
import { type Color, type Loc, other } from '../go/types';

/**
 * Local shape of a move: the shapes players recognise (hane, jumps, knight's moves, empty
 * triangles...). Each is a yes/no feature of the copy, so it learns which shapes the player
 * reaches for more or less often than KataGo.
 */
export interface Shape {
  hane: boolean;
  jump: boolean;
  knight: boolean;
  diagonal: boolean;
  extend: boolean;
  connect: boolean;
  cut: boolean;
  emptyTriangle: boolean;
  tigerMouth: boolean;
  twoSpace: boolean;
  crawl: boolean;
}

const ORTHO = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const DIAG = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;
const KNIGHT = [
  [1, 2],
  [2, 1],
  [-1, 2],
  [-2, 1],
  [1, -2],
  [2, -1],
  [-1, -2],
  [-2, -1],
] as const;

export function shapeOf(board: Board, loc: Loc, color: Color): Shape {
  const n = board.size;
  const [x, y] = xy(loc, n);
  const opp = other(color);
  const at = (dx: number, dy: number) => (onBoard(x + dx, y + dy, n) ? board.stones[toLoc(x + dx, y + dy, n)] : -1);
  const own = (dx: number, dy: number) => at(dx, dy) === color;
  const foe = (dx: number, dy: number) => at(dx, dy) === opp;
  const empty = (dx: number, dy: number) => at(dx, dy) === 0;

  const ownAdj = ORTHO.filter(([dx, dy]) => own(dx, dy));
  const foeAdj = ORTHO.filter(([dx, dy]) => foe(dx, dy));
  const ownGroups = new Set<number>();
  const foeGroups = new Set<number>();
  for (const [dx, dy] of ORTHO) {
    const v = at(dx, dy);
    if (v !== color && v !== opp) continue;
    const g = board.groupAt(toLoc(x + dx, y + dy, n));
    if (g) (v === color ? ownGroups : foeGroups).add(Math.min(...g.stones));
  }

  // Hane: diagonal to an own stone, both touching the same enemy stone.
  const hane = DIAG.some(([dx, dy]) => own(dx, dy) && (foe(dx, 0) || foe(0, dy)));
  const noOwnNear = !ownAdj.length;
  const jump = noOwnNear && ORTHO.some(([dx, dy]) => own(2 * dx, 2 * dy) && empty(dx, dy));
  const twoSpace = noOwnNear && lineOf(loc, n) <= 4 && ORTHO.some(([dx, dy]) => own(3 * dx, 3 * dy) && empty(dx, dy) && empty(2 * dx, 2 * dy));
  const diagonal = noOwnNear && DIAG.some(([dx, dy]) => own(dx, dy));
  const knight = noOwnNear && !diagonal && KNIGHT.some(([dx, dy]) => own(dx, dy));
  const extend = ownGroups.size === 1;
  const connect = ownGroups.size >= 2;
  const cut = foeGroups.size >= 2;
  // Empty triangle: three own stones in a 2x2 square (with this move) and the fourth point empty.
  const emptyTriangle = DIAG.some(([dx, dy]) => {
    const a = own(dx, 0), b = own(0, dy), c = own(dx, dy);
    return (a && b && empty(dx, dy)) || (a && c && empty(0, dy)) || (b && c && empty(dx, 0));
  });
  // Tiger's mouth: an empty point next to the move that the move and two more own stones surround.
  const tigerMouth = ORTHO.some(([dx, dy]) => {
    if (!empty(dx, dy)) return false;
    let mine = 0;
    let theirs = 0;
    for (const [ex, ey] of ORTHO) {
      const v = at(dx + ex, dy + ey);
      if (v === color) mine++;
      else if (v === opp) theirs++;
    }
    return mine >= 2 && theirs === 0;
  });
  // Crawling: a low move next to an own low stone, pressed by the opponent.
  const crawl = lineOf(loc, n) <= 2 && foeAdj.length > 0 && ownAdj.some(([dx, dy]) => lineOf(toLoc(x + dx, y + dy, n), n) <= 2);
  return { hane, jump, knight, diagonal, extend, connect, cut, emptyTriangle, tigerMouth, twoSpace, crawl };
}
