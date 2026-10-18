/**
 * Ikki, Kiai's razorbill, in side profile: a black head with a rounded crown that slopes into a
 * deep bill ending in a hooked point, the white band across the bill, and the white line that
 * sweeps from the base of the bill back to the eye (as on the bird, a curved brow). The underside
 * is one slant from the gape back to the nape, so there is no neck.
 * Black and white only. The drawing is the same at every size; only the brow line is left out at
 * 24 px and below, where it would be a smudge.
 * `tile` puts it on a white rounded square (app icon).
 * `thinking` animates it: Ikki dips its head as if diving for a read, blinks, and a glint runs
 * down the band.
 */
import { useId } from 'react';

const HEAD = 'M66 164 C56 150 52 132 54 114 C56 84 74 60 102 57 C118 55 130 60 138 67 C160 66 182 74 195 88 C203 97 204 108 201 119 C199 124 193 123 191 116 C180 112 164 113 150 116 C143 118 139 122 137 127 C120 138 96 152 72 166 C68 168 67 167 66 164 Z';
const BAND = 'M176 74 L174 120';
const BROW = 'M141 68 C128 70 117 77 111 88';
const EYE = { x: 110, y: 89, r: 7.5 };
const FRAME = 'translate(110 110) scale(1.12) translate(-126 -116)';

export function IkkiHead({ ink = '#0b0f14', paper = '#ffffff', brow = true }: { ink?: string; paper?: string; brow?: boolean }) {
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
        <path className="ikki-band" d={BAND} fill="none" stroke={paper} strokeWidth={9} />
        {brow && <path d={BROW} fill="none" stroke={paper} strokeWidth={6.5} strokeLinecap="round" />}
      </g>
      <g className="ikki-eye">
        <circle cx={EYE.x} cy={EYE.y} r={EYE.r} fill={paper} />
        <circle cx={EYE.x + 1} cy={EYE.y} r={EYE.r * 0.48} fill={ink} />
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
        <IkkiHead brow={size > 24} />
      </g>
    </svg>
  );
}
