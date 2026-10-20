/**
 * Rendered board art: a top-down wood image and stone sprites. Stone sprites are square, the
 * stone filling 1/1.25 of the width (black's diameter); the shadow sprite is twice as wide and
 * already offset by the light. Several sprites per colour are spread over the board by point.
 * (Its own module so plain .ts code and tests can use it without the Board component.)
 */
export interface BoardSkin {
  wood: string;
  black: string[];
  white: string[];
  shadow: string;
}
