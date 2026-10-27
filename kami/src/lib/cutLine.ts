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

/**
 * The same at the pane's top edge (a phone's pane follows the end while KataGo reads, and the
 * question's bubble showed sliced under the drag handle): the height of the strip below `edge`
 * that holds only lines cut by it. A bubble (`boxes`: a message's own box, any height) whose
 * part left under that strip is no more than its padding is hidden to its bottom as well, so no
 * empty sliver of it stays either.
 */
export function cutAbove(lines: Iterable<LineBox>, edge: number, boxes: Iterable<LineBox> = [], pad = 24): number {
  let bottom = edge;
  for (const r of lines) {
    const h = r.bottom - r.top;
    if (h <= 0 || h > MAX_LINE) continue;
    if (r.top < edge - 0.5 && r.bottom > edge) bottom = Math.max(bottom, r.bottom);
  }
  for (const b of boxes) if (b.top < edge - 0.5 && b.bottom > edge && b.bottom - bottom <= pad) bottom = Math.max(bottom, b.bottom);
  return Math.max(0, Math.ceil(bottom - edge));
}
