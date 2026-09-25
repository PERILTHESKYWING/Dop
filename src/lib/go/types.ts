/** 1 = black, 2 = white (the same encoding KataGo's kataeval uses). */
export type Color = 1 | 2;
/** Board point: y * size + x, with y = 0 at the top (SGF "aa" is 0). PASS is -1. */
export type Loc = number;
export const PASS: Loc = -1;
export const EMPTY = 0;

export interface Move {
  color: Color;
  loc: Loc;
}

export const other = (c: Color): Color => (c === 1 ? 2 : 1);
export const colorName = (c: Color) => (c === 1 ? 'Black' : 'White');
