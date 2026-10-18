/**
 * Ikki, Kiai's razorbill, in side profile: a round black head and its deep, blunt, hooked bill
 * with the white band across it, and the fine white line from the bill to the eye. No neck.
 * Black and white only.
 * `tile` puts it on a white rounded square (app icon). Below 40 px the eye and its line are left
 * out and the band is drawn heavier, so the mark stays a bird at 16 px. `thinking` animates it:
 * Ikki dips its head as if diving for a read, blinks, and a glint runs down the band.
 */
import { useId } from 'react';

/** The head is one circle (centre 82,114, radius 54); the bill leaves it between -41 and 30 degrees. */
const HEAD = 'M122.8 78.6 C150 64 184 80 197 116 C201 124 196 131 188 130 C170 126 150 134 128.8 141.0 A54 54 0 1 1 122.8 78.6 Z';
const BAND = 'M160 62 Q170 98 163 144';
const LINE = 'M124 79 C115 82 106 88 99 95 C108 91 117 88 126 86 Z';
const EYE = { x: 93, y: 98, r: 4.5 };
const FRAME = 'translate(110 110) scale(1.06) translate(-114 -114)';

export function IkkiHead({ ink = '#0b0f14', paper = '#ffffff', small = false }: { ink?: string; paper?: string; small?: boolean }) {
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
        <path className="ikki-band" d={BAND} fill="none" stroke={paper} strokeWidth={small ? 15 : 10} strokeLinecap="round" />
        {!small && <path d={LINE} fill={paper} />}
      </g>
      {!small && <circle className="ikki-eye" cx={EYE.x} cy={EYE.y} r={EYE.r} fill={ink} stroke={paper} strokeWidth={1.6} />}
    </g>
  );
}

export function Logo({ size = 22, tile = false, thinking = false, className }: { size?: number; tile?: boolean; thinking?: boolean; className?: string }) {
  const small = size < 40;
  const cls = ['logo', tile && 'tile', thinking && 'thinking', className].filter(Boolean).join(' ');
  return (
    <svg className={cls} width={size} height={size} viewBox="0 0 220 220" aria-hidden="true">
      {tile && <rect width="220" height="220" rx="48" fill="#ffffff" />}
      <g transform={FRAME}>
        <IkkiHead small={small} />
      </g>
    </svg>
  );
}
