import type { JSX, SVGProps } from 'react';

/** Small line icons (24x24, stroke = currentColor). Drawn for this app. */
const PATHS: Record<string, JSX.Element> = {
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
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  play: <path d="M8 5.5v13l10-6.5z" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {PATHS[name]}
    </svg>
  );
}

/** The app's mark: a slate stone and its shell-white double. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'brand-mark'} viewBox="0 0 48 48" aria-hidden>
      <defs>
        <radialGradient id="bm-b" cx="0.36" cy="0.3" r="0.75">
          <stop offset="0" stopColor="#737985" />
          <stop offset="0.45" stopColor="#23262b" />
          <stop offset="1" stopColor="#050506" />
        </radialGradient>
        <radialGradient id="bm-w" cx="0.36" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.7" stopColor="#f1ece3" />
          <stop offset="1" stopColor="#cfc7ba" />
        </radialGradient>
        <linearGradient id="bm-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffc46a" />
          <stop offset="0.5" stopColor="#ff8e52" />
          <stop offset="1" stopColor="#f0566f" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22.5" fill="none" stroke="url(#bm-ring)" strokeWidth="2" />
      <circle cx="19" cy="25" r="11" fill="url(#bm-b)" />
      <circle cx="29" cy="23" r="11" fill="url(#bm-w)" />
    </svg>
  );
}
