/**
 * How much of a scroller's bottom edge to hide so no line of text shows cut in half there (a
 * phone's answer pane is a few lines tall, and a half line under it read as hidden behind the
 * composer). `lines` are the text lines' boxes in the viewport, `edge` the pane's bottom edge;
 * the result is the height, in px, of the strip above the edge that holds only cut lines (0: none).
 */
export interface LineBox {
  top: number;
  bottom: number;
}

/** Taller boxes are not lines of text (a board, a whole message). */
const MAX_LINE = 48;

export function cutBelow(lines: Iterable<LineBox>, edge: number): number {
  let top = edge;
  for (const r of lines) {
    const h = r.bottom - r.top;
    if (h <= 0 || h > MAX_LINE) continue;
    if (r.top < edge && r.bottom > edge + 0.5) top = Math.min(top, r.top);
  }
  return Math.max(0, Math.ceil(edge - top));
}
