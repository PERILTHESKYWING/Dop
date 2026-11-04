/**
 * Whether the game is really decided, from the point lead and the moves left, never from the
 * win chance alone (a 1% win chance at move 34 with 11 points to make up is not a decided game
 * for a human). Late in the game (from about move 150 on 19x19) a lead of 10 points decides it;
 * earlier only a lead of a quarter of the moves still to come (about 250 moves a 19x19 game).
 * Its own module (no imports) so the board's key can use it without the explainer's code.
 */
export function gameDecided(moveNumber: number, lead: number, size = 19): boolean {
  const area = size * size;
  const late = Math.round((150 / 361) * area);
  const total = Math.round((250 / 361) * area);
  const abs = Math.abs(lead);
  const big = Math.max(10, Math.round((10 / 361) * area));
  if (moveNumber >= late && abs >= big) return true;
  return abs >= Math.max(big, 0.25 * Math.max(0, total - moveNumber));
}
