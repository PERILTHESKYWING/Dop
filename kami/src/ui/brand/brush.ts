/**
 * 気合 written with a brush, as one SVG string: the loader (inlined into index.html at build time
 * by vite.config.ts), the app's empty chat and the landing all use this, so the strokes, timing
 * and ink look the same everywhere.
 *
 * Each glyph is the real brush outline; a mask of fat round-capped lines, one per stroke in
 * stroke order, uncovers it as each line's dash runs from start to end. "sweep" strokes (harai)
 * press, then speed off thin; "stop" strokes move evenly and slow down where the brush lifts.
 * When the last stroke ends, the whole glyph is uncovered so no sliver the lines missed stays
 * hidden. The edges are a touch ragged and bleed faintly, as sumi does on washi. (Dry-brush
 * streaks and ink thinning toward the tips were tried; critics read both as digital effects.)
 */
import { GLYPHS, STROKES } from './glyphs';

export type Layout = 'v' | 'h';

export interface BrushOptions {
  /** Unique per page: ids for the mask and filter. */
  id: string;
  layout?: Layout;
  /** Write it stroke by stroke (otherwise drawn finished). */
  write?: boolean;
  /** Multiplies every duration; 1 is about 2.1 s for the whole word. */
  speed?: number;
  /** Delay before the first stroke, ms. */
  start?: number;
  ink?: string;
  /** Rough ink edges. Off for small sizes, where it only blurs. */
  texture?: boolean;
}

/** The two layouts: 合 under 気 (a hanging scroll) or beside it. */
const PLACE: Record<Layout, { at: [number, number]; viewBox: string; w: number; h: number }> = {
  v: { at: [0, 860], viewBox: '0 330 1000 1790', w: 1000, h: 1790 },
  h: { at: [960, 0], viewBox: '90 330 1880 930', w: 1880, h: 930 },
};

/** A gap between strokes, as the brush lifts and moves: longer between the two characters. */
const LIFT = 55;
const NEXT_CHAR = 140;
/** Real writing is slower; this keeps the word near two seconds. */
const PACE = 0.36;

const EASE = {
  sweep: 'cubic-bezier(0.55, 0.05, 0.9, 0.55)',
  stop: 'cubic-bezier(0.4, 0.1, 0.3, 1)',
};

export interface Timed {
  delay: number;
  dur: number;
}

/** When each stroke starts and how long it takes, ms; plus when the word is done. */
export function timeline(speed = 1, start = 0): { strokes: Timed[]; done: number } {
  let t = start;
  const strokes = STROKES.map((s, i) => {
    if (i > 0) t += (STROKES[i - 1].glyph !== s.glyph ? NEXT_CHAR : LIFT) * speed;
    const dur = Math.round(s.t * PACE * speed);
    const out = { delay: Math.round(t), dur };
    t += dur;
    return out;
  });
  return { strokes, done: Math.round(t) };
}

export function viewBox(layout: Layout = 'v') {
  return PLACE[layout];
}

export function brushMarkup({ id, layout = 'v', write = false, speed = 1, start = 0, ink = 'currentColor', texture = true }: BrushOptions): string {
  const place = PLACE[layout];
  const { strokes, done } = timeline(speed, start);
  const g = (i: 0 | 1) => (i === 1 ? ` transform="translate(${place.at[0]} ${place.at[1]})"` : '');
  const filter = texture
    ? `<filter id="${id}-ink" x="-4%" y="-4%" width="108%" height="108%" color-interpolation-filters="sRGB">` +
      // edges catch on the paper's fibre: a very fine, even raggedness
      `<feTurbulence type="fractalNoise" baseFrequency="0.22" numOctaves="2" seed="3" result="n"/>` +
      `<feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G" result="d"/>` +
      // nijimi: the faintest grey bleed just outside each stroke, as sumi spreads into washi
      `<feGaussianBlur in="d" stdDeviation="4" result="b"/>` +
      `<feComponentTransfer in="b" result="halo"><feFuncA type="linear" slope="0.16"/></feComponentTransfer>` +
      `<feMerge><feMergeNode in="halo"/><feMergeNode in="d"/></feMerge></filter>`
    : '';
  const glyphs = `<g${texture ? ` filter="url(#${id}-ink)"` : ''} fill="${ink}">` + GLYPHS.map((d, i) => `<path${g(i as 0 | 1)} d="${d}"/>`).join('') + '</g>';
  if (!write)
    return `<svg class="kb" viewBox="${place.viewBox}" aria-hidden="true" focusable="false"><defs>${filter}</defs>${glyphs}</svg>`;
  const lines = STROKES.map((s, i) => {
    const { delay, dur } = strokes[i];
    return (
      `<path${g(s.glyph)} class="kb-s" pathLength="1" d="${s.d}" stroke-width="${s.w}" ` +
      `style="animation-duration:${dur}ms;animation-delay:${delay}ms;animation-timing-function:${EASE[s.ease]}"/>`
    );
  }).join('');
  const all = `<rect class="kb-all" x="-200" y="0" width="2400" height="2400" style="animation-delay:${done}ms"/>`;
  return (
    `<svg class="kb kb-write" viewBox="${place.viewBox}" aria-hidden="true" focusable="false" style="--kb-done:${done}ms">` +
    `<defs>${filter}<mask id="${id}-m">` +
    `<g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">${lines}</g>${all}</mask></defs>` +
    `<g mask="url(#${id}-m)">${glyphs}</g></svg>`
  );
}

/** CSS the markup needs (also inlined into index.html with the loader). */
export const BRUSH_CSS =
  '.kb{display:block;overflow:visible}' +
  '.kb-s{stroke-dasharray:1 3;stroke-dashoffset:1.5;animation-name:kb-write;animation-fill-mode:both}' +
  '.kb-all{fill:#fff;opacity:0;animation:kb-all 160ms linear both}' +
  '.kb-paused .kb-s,.kb-paused .kb-all{animation-play-state:paused}' +
  '@keyframes kb-write{0%{stroke-dashoffset:1.5}0.1%{stroke-dashoffset:0.999}100%{stroke-dashoffset:0}}' +
  '@keyframes kb-all{to{opacity:1}}' +
  '@media (prefers-reduced-motion:reduce){.kb-s,.kb-all{animation:none!important;stroke-dashoffset:0}.kb-all{opacity:1}}';
