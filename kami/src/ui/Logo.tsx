/**
 * Ikki, Kiai's razorbill, in side profile: a black head with a flat crown running straight into
 * a deep bill that ends in a hooked point, the white band across the bill and the fine white line
 * from the eye to the bill. The underside is one slant from the gape back to the nape, so there
 * is no neck.
 * Black and white only.
 * `tile` puts it on a white rounded square (app icon). The eye is a white ring with a pupil;
 * below 40 px the eye line and pupil are left out and the eye and band are drawn heavier, so the
 * mark stays a bird at 16 px.
 * `thinking` animates it: Ikki dips its head as if diving for a read, blinks, and a glint runs
 * down the band.
 */
import { useId } from 'react';

const HEAD = 'M62 160 C54 146 52 128 54 112 C54 86 64 66 84 63 L112 62 C121 61 128 62 134 65 C156 64 179 71 193 84 C201 91 203 101 201 110 C199 116 193 115 190 107 C178 106 162 109 147 113 C141 115 137 120 136 128 C118 140 92 152 66 166 C62 168 62 164 62 160 Z';
const BAND = 'M174 70 L173 116';
const LINE = 'M119 84 L137 63 L141 66.5 L122.5 87.5 Z';
const EYE = { x: 111, y: 90, r: 8 };
const FRAME = 'translate(110 110) scale(1.12) translate(-126 -116)';

export function IkkiHead({ ink = '#0b0f14', paper = '#ffffff', small = false, eye = true }: { ink?: string; paper?: string; small?: boolean; eye?: boolean }) {
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
        <path className="ikki-band" d={BAND} fill="none" stroke={paper} strokeWidth={small ? 16 : 10} />
        {!small && <path d={LINE} fill={paper} />}
      </g>
      {eye && (
        <g className="ikki-eye">
          <circle cx={EYE.x} cy={EYE.y} r={small ? EYE.r * 1.25 : EYE.r} fill={paper} />
          {!small && <circle cx={EYE.x + 1.5} cy={EYE.y} r={EYE.r * 0.5} fill={ink} />}
        </g>
      )}
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
