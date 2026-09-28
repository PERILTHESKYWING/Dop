import { useId, type JSX, type SVGProps } from 'react';

/** Small line icons (24x24, stroke = currentColor). Drawn for this app. */
const PATHS: Record<string, JSX.Element> = {
  chat: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5z" />
      <circle cx="9.5" cy="9.5" r="1.9" fill="currentColor" />
      <circle cx="14.5" cy="9.5" r="1.9" />
    </>
  ),
  sunrise: (
    <>
      <path d="M3 18h18" />
      <path d="M6 18a6 6 0 0 1 12 0" />
      <path d="M12 5v3M5.2 9.2l2 2M18.8 9.2l-2 2M2.5 14h2M19.5 14h2" />
      <path d="M8 21h8" />
    </>
  ),
  library: (
    <>
      <rect x="3.5" y="4" width="4.5" height="16" rx="1" />
      <rect x="9.5" y="4" width="4.5" height="16" rx="1" />
      <path d="m15.6 5.2 3.9-1 3 15.2-3.9 1z" />
      <path d="M5.75 8v1M11.75 8v1" />
    </>
  ),
  board: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
      <circle cx="9" cy="9" r="2.3" fill="currentColor" />
      <circle cx="15" cy="15" r="2.3" fill="#fff" />
    </>
  ),
  dna: (
    <>
      <path d="M8 3c0 5 8 5 8 9s-8 4-8 9" />
      <path d="M16 3c0 5-8 5-8 9s8 4 8 9" />
      <path d="M9.4 6.5h5.2M9.4 17.5h5.2" />
    </>
  ),
  flame: (
    <>
      <path d="M12 3c.8 3.2 5 5.2 5 10a5 5 0 0 1-10 0c0-2.2 1.1-3.8 2.2-4.8.1 2 .9 3.2 2 3.3-.3-3 .2-5.8.8-8.5z" />
      <path d="M12 21a2.2 2.2 0 0 1-2.2-2.2c0-1.4 1.4-2.2 2.2-3.8.8 1.6 2.2 2.4 2.2 3.8A2.2 2.2 0 0 1 12 21z" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 12s3.3-6.5 9-6.5c1.6 0 3 .5 4.3 1.2M21 12s-3.3 6.5-9 6.5c-1.6 0-3-.5-4.3-1.2" />
      <path d="M9.9 14.1a3 3 0 0 1 4.2-4.2" />
      <path d="M4 20 20 4" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.8-4.8" />
    </>
  ),
  swords: (
    <>
      <path d="M4 4l9.5 9.5M4 4v4M4 4h4" />
      <path d="M20 4l-9.5 9.5M20 4v4M20 4h-4" />
      <path d="m7 16-3 3 1 1 3-3M17 16l3 3-1 1-3-3" />
      <path d="M8.5 14.5 6 17M15.5 14.5 18 17" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </>
  ),
  cpu: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </>
  ),
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />,
  stones: (
    <>
      <circle cx="9" cy="12" r="5.5" fill="currentColor" />
      <circle cx="15.5" cy="12" r="5.5" fill="#fff" />
    </>
  ),
  /** An on-air mark: a stone with signal arcs. */
  broadcast: (
    <>
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
      <path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6" />
      <path d="M5.3 5.3a9.5 9.5 0 0 0 0 13.4M18.7 5.3a9.5 9.5 0 0 1 0 13.4" />
    </>
  ),
  /** A kifu: a page with a stone and a line of moves. */
  kifu: (
    <>
      <path d="M6 3.5h9l3.5 3.5v13.5H6z" />
      <path d="M15 3.5V7h3.5" />
      <circle cx="10" cy="11" r="1.7" fill="currentColor" />
      <circle cx="14" cy="14" r="1.7" />
      <path d="M9 17.5h6" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  play: <path d="M8 5.5v13l10-6.5z" />,
  /** A stone and its mirrored copy (the Doppelgänger). */
  twin: (
    <>
      <path d="M12 3v18" strokeDasharray="1.4 2.6" />
      <circle cx="6.6" cy="12" r="3.9" fill="currentColor" />
      <circle cx="17.4" cy="12" r="3.9" strokeDasharray="2.3 1.9" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {PATHS[name]}
    </svg>
  );
}

/**
 * Geometry of the DOPPELGÄNGER mark (viewBox 0 0 64 64), shared with the animated loader in Brand.tsx.
 * A slate stone and its shell-white double overlap on a diagonal; the lens where they agree is lit by the
 * sunrise. Around them the orbit is split along the mirror axis into two tapered crescents, one per stone.
 */
export const BRAND = {
  black: [25.6, 38.4],
  white: [38.4, 25.6],
  r: 15.5,
  /** Where the two stones overlap (tips on the mirror axis). */
  lens: 'M23.1 23.1A15.5 15.5 0 0 1 40.9 40.9A15.5 15.5 0 0 1 23.1 23.1Z',
  /** The two orbit crescents (outer r 30, 4.2 thick at their middle, tapering towards the mirror axis). */
  orbit:
    'M17 6.02A30 30 0 0 1 57.98 47L56.8 46.32A30 30 0 0 0 17.68 7.2ZM47 57.98A30 30 0 0 1 6.02 17L7.2 17.68A30 30 0 0 0 46.32 56.8Z',
  /** Centre lines of the two crescents (r 28), which the loader strokes to draw them in. */
  orbitA: 'M18 7.75A28 28 0 0 1 56.25 46',
  orbitB: 'M46 56.25A28 28 0 0 1 7.75 18',
} as const;

/** Stable, selector-safe ids so several marks on one page never share gradients. */
export function useBrandId(prefix: string) {
  return prefix + useId().replace(/[^A-Za-z0-9_-]/g, '');
}

/**
 * Gradients and the lens cut-out used by the mark. The accent stops read --brand-a/b/c so a theme can
 * retint the mark; without them it is the sunrise. `cutClassName` lets the loader animate the cut-out.
 */
export function BrandDefs({ id, cutClassName }: { id: string; cutClassName?: string }) {
  const a = { stopColor: 'var(--brand-a, #ffc46a)' };
  const b = { stopColor: 'var(--brand-b, #ff8e52)' };
  const c = { stopColor: 'var(--brand-c, #f0566f)' };
  return (
    <defs>
      <linearGradient id={id + 's'} gradientUnits="userSpaceOnUse" x1="10" y1="10" x2="54" y2="54">
        <stop offset="0" style={a} />
        <stop offset="0.5" style={b} />
        <stop offset="1" style={c} />
      </linearGradient>
      <linearGradient id={id + 'l'} gradientUnits="userSpaceOnUse" x1="25" y1="24" x2="40" y2="41">
        <stop offset="0" style={a} />
        <stop offset="0.55" style={b} />
        <stop offset="1" style={c} />
      </linearGradient>
      <radialGradient id={id + 'g'} gradientUnits="userSpaceOnUse" cx="32" cy="32" r="31">
        <stop offset="0" style={{ ...b, stopOpacity: 0.42 }} />
        <stop offset="0.55" style={{ ...b, stopOpacity: 0.14 }} />
        <stop offset="1" style={{ ...b, stopOpacity: 0 }} />
      </radialGradient>
      <radialGradient id={id + 'b'} cx="0.36" cy="0.3" r="0.78">
        <stop offset="0" stopColor="#7a808d" />
        <stop offset="0.42" stopColor="#25282f" />
        <stop offset="1" stopColor="#040405" />
      </radialGradient>
      <radialGradient id={id + 'w'} cx="0.36" cy="0.3" r="0.8">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.66" stopColor="#f3eee6" />
        <stop offset="1" stopColor="#cdc3b4" />
      </radialGradient>
      <linearGradient id={id + 'rb'} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
        <stop offset="0.5" stopColor="#fff" stopOpacity="0.05" />
        <stop offset="1" stopColor="#fff" stopOpacity="0.18" />
      </linearGradient>
      <linearGradient id={id + 'rw'} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#b8ad9c" stopOpacity="0.15" />
        <stop offset="1" stopColor="#8a7c68" stopOpacity="0.7" />
      </linearGradient>
      <radialGradient id={id + 'h'}>
        <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </radialGradient>
      <mask id={id + 'm'} maskUnits="userSpaceOnUse" x="-32" y="-32" width="128" height="128">
        <rect x="-32" y="-32" width="128" height="128" fill="#fff" />
        <path className={cutClassName} d={BRAND.lens} fill="#000" stroke="#000" strokeWidth="3" />
      </mask>
    </defs>
  );
}

/** The black stone (with rim light and a soft highlight) or the white stone, at its place in the mark. */
export function BrandStone({ id, color }: { id: string; color: 'black' | 'white' }) {
  const [cx, cy] = BRAND[color];
  const r = BRAND.r;
  return color === 'black' ? (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}b)`} />
      <circle cx={cx} cy={cy} r={r - 0.4} fill="none" stroke={`url(#${id}rb)`} strokeWidth="0.8" />
      <ellipse cx={cx - 5.6} cy={cy - 6.5} rx="5.9" ry="3.7" transform={`rotate(-35 ${cx - 5.6} ${cy - 6.5})`} fill={`url(#${id}h)`} opacity="0.5" />
    </g>
  ) : (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id}w)`} />
      <circle cx={cx} cy={cy} r={r - 0.4} fill="none" stroke={`url(#${id}rw)`} strokeWidth="0.8" />
    </g>
  );
}

/** The app's mark: a stone and its double, their overlap lit by the sunrise, inside a split orbit. Static. */
export function BrandMark({ className }: { className?: string }) {
  const id = useBrandId('bm');
  return (
    <svg className={className ?? 'brand-mark'} viewBox="0 0 64 64" aria-hidden>
      <BrandDefs id={id} />
      <circle cx="32" cy="32" r="31" fill={`url(#${id}g)`} />
      <path d={BRAND.orbit} fill={`url(#${id}s)`} />
      <g mask={`url(#${id}m)`}>
        <BrandStone id={id} color="black" />
        <BrandStone id={id} color="white" />
      </g>
      <path d={BRAND.lens} fill={`url(#${id}l)`} />
    </svg>
  );
}
