/** A term card's place on screen (Term.tsx), kept apart from the component so it can be tested. */

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Where a floating card goes for a term at `r` (the term's line box): just under the line, else
 * just over it. `prefer: 'above'` turns that round (a phone's term in the note under the board:
 * the card covers the board for a moment rather than the answer under it). When both sides fit,
 * the side that covers less of the `keep` boxes wins (each counts its `weight`, 1 by default:
 * KataGo's numbers 1, a button such as "Read longer" 2), the preferred side on a tie.
 */
export function placeTip(r: Box, w: number, h: number, vw: number, vh: number, avoid: readonly Box[] = [], prefer: 'below' | 'above' = 'below', keep: readonly (Box & { weight?: number })[] = []) {
  // 3 px off the term's box (its 4 px padding): the card meets the next line's top, never slices a line
  const gap = 3;
  const left = Math.max(8, Math.min(vw - w - 8, (r.left + r.right) / 2 - w / 2));
  const fitsBelow = r.bottom + gap + h <= vh - 8;
  const fitsAbove = r.top - gap - h >= 8;
  const cost = (top: number) => keep.reduce((s, k) => s + (k.right > left && k.left < left + w && k.bottom > top && k.top < top + h ? (k.weight ?? 1) : 0), 0);
  let below = prefer === 'above' ? !fitsAbove && fitsBelow : fitsBelow;
  if (fitsBelow && fitsAbove) {
    const under = cost(r.bottom + gap), over = cost(r.top - gap - h);
    if (under !== over) below = under < over;
  }
  let top = below ? r.bottom + gap : Math.max(8, r.top - gap - h);
  // never half over a button: a button an edge of the card would cut is covered whole (the card
  // moves away from the term to take it in) or left clear; never over the term's own line
  const lo = below ? r.bottom + gap : 8, hi = below ? vh - 8 - h : r.top - gap - h;
  for (let i = 0; i < 4; i++) {
    const bottom = top + h;
    const cut = avoid.find((x) => x.right > left && x.left < left + w && ((x.top < top - 0.5 && x.bottom > top + 0.5) || (x.top < bottom - 0.5 && x.bottom > bottom + 0.5)));
    if (!cut) break;
    const whole = cut.top < bottom && cut.bottom > bottom ? cut.bottom + 2 - h : cut.top - 2; // take it in
    const clear = cut.top < bottom && cut.bottom > bottom ? cut.top - 2 - h : cut.bottom + 2; // leave it out
    const pick = [below ? whole : clear, below ? clear : whole].find((t) => t >= lo && t <= hi);
    if (pick === undefined || pick === top) break;
    top = pick;
  }
  return { left, top, below };
}

/**
 * A phone opens a term's card inside the chat, as a block under the paragraph (Term.tsx): the
 * text after it moves down and nothing is covered. The chat stays put unless the card would end
 * below the pane's visible bottom; then it scrolls by just enough to show the card, and never so
 * far that the tapped term leaves the top. Returns the pixels to scroll down (0 = stay put).
 */
export function revealBy(cardBottom: number, paneBottom: number, termTop: number, paneTop: number, pad = 8): number {
  const need = cardBottom + pad - paneBottom;
  if (need <= 0) return 0;
  return Math.max(0, Math.min(Math.ceil(need), Math.floor(termTop - paneTop - pad)));
}

/** The pointer's place on an in-chat card: under the middle of the term's line, clear of the rounded corners. */
export function inlineArrow(lineLeft: number, lineRight: number, cardLeft: number, cardWidth: number): number {
  return Math.round(Math.max(14, Math.min(cardWidth - 14, (lineLeft + lineRight) / 2 - cardLeft)));
}

/**
 * How far down the chat must show once a card opens in the text (critics, 2026-11-06: the answer
 * looked cut off mid-sentence under an open card): the card and the first line after it, the
 * "KataGo's numbers" toggle when it is at most two lines further, and, when all that already fits,
 * the whole of a line the pane's bottom edge cuts (the pane hides a cut line, which read as an
 * empty band above the message box). Lines are the text's line boxes on screen.
 */
export function revealTarget(cardBottom: number, lines: readonly Box[], paneBottom: number, toggle?: Box | null): number {
  const after = lines.filter((l) => l.bottom > l.top && l.top >= cardBottom - 1).sort((a, b) => a.top - b.top);
  let target = after[0]?.bottom ?? cardBottom;
  const lh = after[0] ? after[0].bottom - after[0].top : 24;
  if (toggle && toggle.top >= cardBottom - 1 && toggle.bottom - target <= 2 * lh) target = Math.max(target, toggle.bottom);
  if (target <= paneBottom) {
    const cut = after.find((l) => l.top < paneBottom - 1 && l.bottom > paneBottom + 1);
    if (cut) target = cut.bottom;
  }
  return target;
}

/**
 * A reveal scroll of `by` px, snapped so the pane's top edge falls between rows, never through
 * one (critics, 2026-11-06: a sliver of the cut-off header and a red chip showed at the top).
 * `rows` are what is drawn as a whole (text lines, the header, buttons, bubbles), on screen
 * before the scroll. A cut row is scrolled out whole when that stays within `maxBy` (the tapped
 * term stays in view), else back in whole, never above 0 (where the pane was).
 */
export function snapTop(by: number, paneTop: number, rows: readonly Box[], maxBy: number): number {
  let b = by;
  let backing = false;
  for (let i = 0; i < 8 && b > 0; i++) {
    const edge = paneTop + b;
    const cut = rows.find((r) => r.top < edge - 0.5 && r.bottom > edge + 0.5);
    if (!cut) break;
    const out = Math.ceil(b + cut.bottom - edge);
    const back = Math.max(0, Math.floor(b - (edge - cut.top)));
    // out, so what the reveal wanted below stays in view, when that keeps the term in view; once
    // moving back, only back
    if (!backing && out <= maxBy) b = out;
    else {
      backing = true;
      b = back;
    }
  }
  return b;
}
