/**
 * Ikki, Kiai's razorbill, head-on with the head tipped to one side as in XIAO's photo: the black
 * head and neck, the deep bill with its white edges and groove, and the two white lines that run
 * from the bill out to the eyes. Black and white only.
 * `tile` puts it on a white rounded square (app icon, dark theme). Below 40 px the groove is
 * dropped and the face drawn larger and heavier so it still reads.
 */
const HEAD = 'M34 262 C34 200 26 150 30 108 C34 58 70 22 114 24 C152 26 176 60 172 108 C168 150 166 205 168 262 Z';
const BILL = 'M85 69 C85 92 89 112 94 125 C96.5 131.5 103.5 131.5 106 125 C111 112 115 92 115 69 C108.5 62.5 91.5 62.5 85 69 Z';
const GROOVE = 'M100 73 C100 92 100 108 100 123';
// crescents from the bill's upper corners out to the eyes: thick by the bill, fine at the eye
const LINES = 'M113 72 C120 63 132 58 146 59 C134 63 123 68 113 74 Z M87 72 C80 63 68 58 54 59 C66 63 77 68 87 74 Z';
const LINES_HEAVY = 'M112 73 C119 60 133 54 151 56 C136 62 124 69 112 77 Z M88 73 C81 60 67 54 49 56 C64 62 76 69 88 77 Z';

export function IkkiHead({ ink = '#0b0f14', paper = '#ffffff', small = false }: { ink?: string; paper?: string; small?: boolean }) {
  const edge = small ? 7 : 3.4;
  return (
    <g>
      {/* the neck stays upright; the crown leans over it and the face tips with it, as in the photo */}
      <path d={HEAD} fill={ink} />
      <g transform={`translate(10 3) rotate(13 100 85)${small ? ' translate(100 80) scale(1.3) translate(-100 -80)' : ''}`}>
        <path d={BILL} fill={ink} stroke={paper} strokeWidth={edge} strokeLinejoin="round" />
        {!small && <path d={GROOVE} fill="none" stroke={paper} strokeWidth={2} strokeLinecap="round" />}
        <path d={small ? LINES_HEAVY : LINES} fill={paper} />
      </g>
    </g>
  );
}

export function Logo({ size = 22, tile = false, className }: { size?: number; tile?: boolean; className?: string }) {
  const small = size < 40;
  return (
    <svg className={`logo${tile ? ' tile' : ''} ${className ?? ''}`} width={size} height={size} viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <clipPath id={tile ? 'ikki-tile' : 'ikki-box'}>{tile ? <rect width="200" height="200" rx="46" /> : <rect width="200" height="200" />}</clipPath>
      </defs>
      <g clipPath={`url(#${tile ? 'ikki-tile' : 'ikki-box'})`}>
        {tile ? (
          <>
            <rect width="200" height="200" fill="#ffffff" />
            <g transform="translate(20 34) scale(0.8)">
              <IkkiHead small={small} />
            </g>
          </>
        ) : (
          <IkkiHead small={small} />
        )}
      </g>
    </svg>
  );
}
