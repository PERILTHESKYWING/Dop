/**
 * Kiai's mark: a vermilion seal (hanko) with 気 cut into it, the same brush 気 as the
 * calligraphy so the two match. Hand-cut edges, not a perfect square. 気 is drawn in paper
 * colour, so the mark reads the same on light and dark pages.
 */
import { GLYPHS } from './glyphs';

export const SEAL_RED = '#b3302a';
export const SEAL_PAPER = '#f7f0e4';

/** Slightly uneven edges, softened by a round stroke of the same red. */
const EDGE = 'M7.2 8.1 L30 6.9 L51 7.4 L72 6.6 L93.2 7.8 L92.6 30 L93.4 52 L92.8 74 L93.6 92.7 L71 93.4 L49 92.6 L28 93.5 L6.7 92.9 L7.5 71 L6.6 50 L7.3 29Z';
/**
 * 気 drawn for small sizes, as a seal carver would cut it: even strokes, open spaces, so it still
 * reads as 気 at 16 to 32 px, where the brush 気 closes up into a smudge.
 */
const KI_SMALL = 'M33 15 L20 33 M31 25 L79 22 M33 38 L71 36 M16 51 L72 48 Q78 48 75 56 L70 74 Q68 84 79 84 L86 83 L84 70 M27 59 L55 86 M53 58 L22 88';
/** 気 fills the field, as carved seals do. */
const KI = 'translate(50.3 50) scale(0.0905) translate(-530 -791)';

export function sealMarkup({ id, size, red = SEAL_RED, paper = SEAL_PAPER }: { id: string; size: number; red?: string; paper?: string }): string {
  // Worn edges and a slightly uneven press at 48 px and up; 32 px and below use the carved
  // small 気, heavier as it gets smaller, so it still reads on a tab or in a sidebar.
  const texture = size >= 48;
  const small = size <= 32;
  const filter = texture
    ? `<filter id="${id}-st" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">` +
      `<feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="2" seed="5" result="e"/>` +
      `<feDisplacementMap in="SourceGraphic" in2="e" scale="2.2" xChannelSelector="R" yChannelSelector="G" result="d"/>` +
      `<feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="8" result="p"/>` +
      `<feColorMatrix in="p" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -0.3 1.12" result="q"/>` +
      `<feComposite in="d" in2="q" operator="in"/></filter>`
    : '';
  const mark = small
    ? `<path d="${KI_SMALL}" fill="none" stroke="${paper}" stroke-width="${size <= 16 ? 12 : size <= 24 ? 11 : 9}" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path transform="${KI}" d="${GLYPHS[0]}" fill="${paper}"/>`;
  return (
    `<svg class="seal" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
    (filter ? `<defs>${filter}</defs>` : '') +
    `<g${texture ? ` filter="url(#${id}-st)"` : ''}>` +
    `<path d="${EDGE}" fill="${red}" stroke="${red}" stroke-width="4.5" stroke-linejoin="round"/>` +
    `${mark}</g></svg>`
  );
}
