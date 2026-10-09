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
  back: <path d="M19 12H5.5M11 5.5 4.5 12l6.5 6.5" />,
  pen: (
    <>
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
      <circle cx="12" cy="12" r="6.6" />
    </>
  ),
  /** A panel with its sidebar: open or close the navigation. */
  sidebar: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9.5 4v16" />
      <path d="m6 10.5-1.3 1.5L6 13.5" />
    </>
  ),
  home: (
    <>
      <path d="M3.5 11 12 4l8.5 7" />
      <path d="M5.5 9.5V20h4.5v-5.5h4V20h4.5V9.5" />
    </>
  ),
  /** A table of numbers: the "Data" tab. */
  data: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M3.5 9h17M3.5 14.5h17M10 4v16" />
    </>
  ),
  /** A line going up and down: the "Trend" tab. */
  trend: (
    <>
      <path d="M3.5 20h17" />
      <path d="m4 15 4.5-5 3.5 3.5 4-6.5 4 4" />
    </>
  ),
  /** A warning sign: the "Blunder" tab. */
  blunder: (
    <>
      <path d="M12 3.8 21 19.5H3z" />
      <path d="M12 9.5v4.5" />
      <circle cx="12" cy="16.8" r="0.6" fill="currentColor" />
    </>
  ),
  /** Bars of different heights: the "Performance" tab. */
  performance: (
    <>
      <path d="M3.5 20h17" />
      <rect x="5" y="12" width="3.4" height="8" rx="0.8" />
      <rect x="10.3" y="6" width="3.4" height="14" rx="0.8" />
      <rect x="15.6" y="9.5" width="3.4" height="10.5" rx="0.8" />
    </>
  ),
  /** Skill tab: a level gauge. */
  skill: (
    <>
      <path d="M3.5 17a8.5 8.5 0 0 1 17 0" />
      <path d="M12 17l4.2-5.4" />
      <circle cx="12" cy="17" r="1.4" />
    </>
  ),
  /** KataGo's analysis switched on. */
  ai: (
    <>
      <path d="M4 19 8 5h1.6l4 14M5.3 14.5h7" />
      <path d="M18 5v14" />
    </>
  ),
  numbers: (
    <>
      <path d="M4 8.5 6 7v10" />
      <path d="M9.5 9a2.2 2.2 0 1 1 3.6 1.7L9.5 17h4.2" />
      <path d="M16 7.5a2.1 2.1 0 1 1 2.2 3.3 2.2 2.2 0 1 1-2.4 3.6" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />
      <path d="M10.5 11v5.5M13.5 11v5.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  /** An open hand: pass. */
  pass: (
    <>
      <path d="M8 12V5.8a1.4 1.4 0 0 1 2.8 0V11M10.8 10.5V4.5a1.4 1.4 0 0 1 2.8 0v6M13.6 10.5V5.5a1.4 1.4 0 0 1 2.8 0v6.5" />
      <path d="M16.4 12V8.5a1.4 1.4 0 0 1 2.8 0v5.5a7 7 0 0 1-7 7h-.6a6.5 6.5 0 0 1-5.1-2.5L3.6 14.6a1.4 1.4 0 0 1 2.1-1.8L8 15" />
    </>
  ),
  /** A person: the account. */
  user: (
    <>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  /** Two arrows chasing each other: sync. */
  sync: (
    <>
      <path d="M19.5 9.5A7.5 7.5 0 0 0 6 7.2L4.5 9" />
      <path d="M4.5 4.5V9H9" />
      <path d="M4.5 14.5A7.5 7.5 0 0 0 18 16.8l1.5-1.8" />
      <path d="M19.5 19.5V15H15" />
    </>
  ),
  /** Two stones set down before play: setup stones (handicap and problems). */
  setup: (
    <>
      <circle cx="8" cy="9" r="3.6" fill="currentColor" />
      <circle cx="16" cy="9" r="3.6" />
      <circle cx="12" cy="16.5" r="3.6" fill="currentColor" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.8" r="0.6" fill="currentColor" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  territory: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M3.5 12h8.5V3.5" />
      <path d="M6 6.5h3M6 9h3" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  save: (
    <>
      <path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
      <path d="M8 4v5h7V4M8 20v-6h8v6" />
    </>
  ),
  download: <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />,
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
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
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
