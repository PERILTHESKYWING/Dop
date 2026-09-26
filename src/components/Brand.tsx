import { useState, type CSSProperties } from 'react';
import { BRAND, BrandDefs, BrandStone, useBrandId } from './Icons';
import '../styles/brand.css';

/** One loop of the loader, in ms. Keep in step with --bl-period in brand.css and the splash in index.html. */
const PERIOD = 2200;

/** Whether the pre-JS splash from index.html was on screen when the bundle started. */
const splashAtLoad = typeof document !== 'undefined' && !!document.getElementById('dop-splash');
const loadedAt = typeof performance !== 'undefined' ? performance.now() : 0;

/**
 * The loader's animation delay. While it takes over from the pre-JS splash (index.html), it runs on the
 * splash's clock (time since navigation) so the hand-over does not jump; a loader shown later starts from
 * the top of the loop, with the stones swinging in.
 */
function phase() {
  const now = performance.now();
  const handover = !!document.getElementById('dop-splash') || (splashAtLoad && now - loadedAt < 2000);
  return handover ? `${-Math.round(now % PERIOD)}ms` : '0ms';
}

/**
 * The boot and loading screen: the two stones orbit in and merge, the split orbit draws itself, the lens
 * lights and a sheen passes; then they drift apart and it starts again. CSS keyframes only (brand.css).
 * Fills its container and centres itself; `overlay` covers the viewport with the theme's first-paint colour.
 */
export function BrandLoader({ label, size = 112, overlay, className }: { label?: string; size?: number; overlay?: boolean; className?: string }) {
  const id = useBrandId('bl');
  const [delay] = useState(phase);
  const style = { '--bl-size': `${size}px`, '--bl-delay': delay } as CSSProperties;
  return (
    <div className={`brand-loader${overlay ? ' is-overlay' : ''}${className ? ' ' + className : ''}`} role="status" aria-label={label ? undefined : 'Loading'} style={style}>
      <svg className="bl-mark" viewBox="0 0 64 64" width={size} height={size} aria-hidden>
        <BrandDefs id={id} cutClassName="bl-cut" />
        <linearGradient id={id + 'x'} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.7" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={id + 'c'}>
          <circle cx={BRAND.black[0]} cy={BRAND.black[1]} r={BRAND.r} />
          <circle cx={BRAND.white[0]} cy={BRAND.white[1]} r={BRAND.r} />
        </clipPath>
        <circle className="bl-glow" cx="32" cy="32" r="31" fill={`url(#${id}g)`} />
        <mask id={id + 'o'} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <path className="bl-arc" d={BRAND.orbitA} pathLength={100} fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" />
          <path className="bl-arc" d={BRAND.orbitB} pathLength={100} fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" />
        </mask>
        <path d={BRAND.orbit} fill={`url(#${id}s)`} mask={`url(#${id}o)`} />
        <g mask={`url(#${id}m)`}>
          {(['black', 'white'] as const).map((c) => (
            <g key={c} className="bl-orbit">
              <g className={`bl-drift bl-${c}`}>
                <g className="bl-self">
                  <BrandStone id={id} color={c} />
                </g>
              </g>
            </g>
          ))}
        </g>
        <path className="bl-lens" d={BRAND.lens} fill={`url(#${id}l)`} />
        <circle className="bl-ripple" cx="32" cy="32" r="12" fill="none" stroke={`url(#${id}s)`} strokeWidth="0.9" />
        <g clipPath={`url(#${id}c)`}>
          <g transform="rotate(28 32 32)">
            <rect className="bl-shine" x="25" y="-12" width="14" height="88" fill={`url(#${id}x)`} />
          </g>
        </g>
      </svg>
      {label && <span className="bl-label">{label}</span>}
    </div>
  );
}

/**
 * A small inline busy indicator (buttons, rows): the split orbit turns while the two stones circle each other.
 * The orbit is the sunrise; inside a primary button it takes the text colour (brand.css).
 */
export function BrandSpinner({ size = 16, className }: { size?: number; className?: string }) {
  const id = useBrandId('bs');
  return (
    <svg className={`brand-spinner${className ? ' ' + className : ''}`} viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <defs>
        <linearGradient id={id + 's'} gradientUnits="userSpaceOnUse" x1="3" y1="3" x2="21" y2="21">
          <stop offset="0" style={{ stopColor: 'var(--brand-a, #ffc46a)' }} />
          <stop offset="0.5" style={{ stopColor: 'var(--brand-b, #ff8e52)' }} />
          <stop offset="1" style={{ stopColor: 'var(--brand-c, #f0566f)' }} />
        </linearGradient>
      </defs>
      <g className="bs-orbit" fill="none" strokeWidth="2.2" strokeLinecap="round" style={{ stroke: `var(--brand-spinner-color, url(#${id}s))` }}>
        <path d="M5.64 5.64A9 9 0 0 1 18.36 5.64" />
        <path d="M18.36 18.36A9 9 0 0 1 5.64 18.36" />
      </g>
      <g className="bs-pair">
        <circle className="bs-black" cx="9.9" cy="12" r="3.9" />
        <circle className="bs-white" cx="14.1" cy="12" r="3.9" />
        <path d="M12 8.71A3.9 3.9 0 0 1 12 15.29A3.9 3.9 0 0 1 12 8.71Z" fill={`url(#${id}s)`} />
      </g>
    </svg>
  );
}
