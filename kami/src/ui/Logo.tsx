/**
 * Ikki, Kiai's razorbill, in side profile: a round black head, a deep blunt bill about one and a
 * half times as long as it is deep, ending in a hooked point, the white band across the bill, and
 * the white streak that runs from the base of the bill back over the eye (as on the bird).
 * Black and white only. Below 40 px the streak is left out (it would be a smudge), and at 24 px
 * and below the band and eye are drawn a little bolder so they still read.
 * `tile` puts it on a white rounded square (app icon).
 * `thinking` animates it: Ikki dips its head as if diving for a read, blinks, and a glint runs
 * down the band.
 */
import { useId } from 'react';

const HEAD = 'M74 162 C58 148 52 124 56 102 C62 72 88 54 118 52 C136 51 148 57 156 64 C184 62 212 74 221 92 C227 104 225 117 215 119 C211 120 209 115 204 115 C188 114 168 116 156 122 C151 132 147 146 141 160 C135 168 120 173 104 172 C92 171 82 168 74 162 Z';
const BAND = 'M198 68 L195 120';
/** The white streak: wide where it leaves the bill, tapering to a point behind the eye. */
const STREAK = 'M160 64 C142 59 118 63 100 77 C118 70 140 69 157 73 Z';
const EYE = { x: 116, y: 85, r: 6.5 };
const FRAME = 'translate(110 110) translate(-139 -112)';

export function IkkiHead({ ink = '#0b0f14', paper = '#ffffff', small = false, streak = true }: { ink?: string; paper?: string; small?: boolean; streak?: boolean }) {
  const r = small ? EYE.r * 1.3 : EYE.r;
  const clip = `ikki${useId().replace(/:/g, '')}`;
  return (
    <g className="ikki">
      <defs>
        <clipPath id={clip}>
          <path d={HEAD} />
        </clipPath>
      </defs>
      <path d={HEAD} fill={ink} />
      <g clipPath={`url(#${clip})`}>
        <path className="ikki-band" d={BAND} fill="none" stroke={paper} strokeWidth={small ? 11.5 : 8.5} />
        {streak && !small && <path d={STREAK} fill={paper} />}
      </g>
      <g className="ikki-eye">
        <circle cx={EYE.x} cy={EYE.y} r={r} fill={paper} />
        <circle cx={EYE.x + 2} cy={EYE.y + 0.5} r={r * 0.4} fill={ink} />
      </g>
    </g>
  );
}

export function Logo({ size = 22, tile = false, thinking = false, className }: { size?: number; tile?: boolean; thinking?: boolean; className?: string }) {
  const cls = ['logo', tile && 'tile', thinking && 'thinking', className].filter(Boolean).join(' ');
  return (
    <svg className={cls} width={size} height={size} viewBox="0 0 220 220" aria-hidden="true">
      {tile && <rect width="220" height="220" rx="48" fill="#ffffff" />}
      <g transform={FRAME}>
        <IkkiHead small={size <= 24} streak={size >= 40} />
      </g>
    </svg>
  );
}
