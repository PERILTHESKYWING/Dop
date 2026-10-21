import { useState, type CSSProperties } from 'react';
import '../styles/brand.css';

/** One loop of the loader, in ms. Keep in step with --bl-period in brand.css and the splash in index.html. */
const PERIOD = 2200;

/** Whether the pre-JS splash from index.html was on screen when the bundle started. */
const splashAtLoad = typeof document !== 'undefined' && !!document.getElementById('dop-splash');
const loadedAt = typeof performance !== 'undefined' ? performance.now() : 0;

/**
 * The loader's animation delay. While it takes over from the pre-JS splash (index.html), it runs on the
 * splash's clock (time since navigation) so the hand-over does not jump; a loader shown later starts from
 * the top of the loop, with the D drawing in.
 */
function phase() {
  const now = performance.now();
  const handover = !!document.getElementById('dop-splash') || (splashAtLoad && now - loadedAt < 2000);
  return handover ? `${-Math.round(now % PERIOD)}ms` : '0ms';
}

/** The D of the logo (BrandMark in Icons.tsx), in its 64 x 64 box. */
const D = 'M17 14h12a18 18 0 0 1 0 36H17z';

/**
 * The boot and loading screen: the logo's tile, its D drawing itself and the amber echo stepping out and
 * back. CSS keyframes only (brand.css). Fills its container and centres itself; `overlay` covers the
 * viewport with the theme's backdrop colour.
 */
export function BrandLoader({ label, size = 112, overlay, className }: { label?: string; size?: number; overlay?: boolean; className?: string }) {
  const [delay] = useState(phase);
  const style = { '--bl-size': `${size}px`, '--bl-delay': delay } as CSSProperties;
  return (
    <div className={`brand-loader${overlay ? ' is-overlay' : ''}${className ? ' ' + className : ''}`} role="status" aria-label={label ? undefined : 'Loading'} style={style}>
      <svg className="bl-mark" viewBox="0 0 64 64" width={size} height={size} aria-hidden>
        <rect width="64" height="64" rx="14" fill="#1f2a44" />
        <path className="bl-echo" d={D} fill="none" stroke="#f2b84b" strokeWidth="5" strokeLinejoin="round" />
        <path className="bl-d" d={D} pathLength={100} fill="none" stroke="#f6efe2" strokeWidth="5" strokeLinejoin="round" />
      </svg>
      {label && <span className="bl-label">{label}</span>}
    </div>
  );
}

/** A small inline busy indicator (buttons, rows): a stroke runs round the outline of the logo's D. */
export function BrandSpinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg className={`brand-spinner${className ? ' ' + className : ''}`} viewBox="12 10 32 44" width={size} height={size} aria-hidden>
      <path className="bs-track" d={D} fill="none" strokeWidth="5" strokeLinejoin="round" />
      <path className="bs-run" d={D} pathLength={100} fill="none" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
