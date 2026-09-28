import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { ThemeId } from '../lib/themes';

/**
 * Moving through a game: the mouse wheel over the board (down = next move), a clear row of
 * step buttons for the side panel, and, in focus mode, two big buttons drawn as each
 * theme's own object (a sun, a blossom, a jade pebble, an aurora crystal) that can throw
 * off a burst of sparks when pressed.
 */

/**
 * Scroll over an element to step through moves: one step per wheel notch, trackpads
 * accumulate. Returns the ref to put on that element.
 */
export function useWheelSteps(onStep: (delta: number) => void, enabled = true) {
  const step = useRef(onStep);
  step.current = onStep;
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!el || !enabled) return;
    let acc = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // pinch zoom, sideways swipes
      e.preventDefault();
      // Lines (Firefox) count as a notch each; pixels add up until they make one.
      acc += e.deltaMode === 1 ? Math.sign(e.deltaY) * 60 : e.deltaMode === 2 ? Math.sign(e.deltaY) * 60 : e.deltaY;
      clearTimeout(idle);
      idle = setTimeout(() => (acc = 0), 220);
      while (Math.abs(acc) >= 50) {
        const d = Math.sign(acc);
        step.current(d);
        acc -= d * 60;
        if (Math.sign(acc) !== d) acc = 0;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      clearTimeout(idle);
    };
  }, [el, enabled]);
  return setEl;
}

/** The ⏮ ◀ ▶ ⏭ row, bigger and clearer than plain small buttons. */
export function MoveStepper({
  onFirst,
  onBack,
  onForward,
  onLast,
  canBack,
  canForward,
  label,
}: {
  onFirst: () => void;
  onBack: () => void;
  onForward: () => void;
  onLast: () => void;
  canBack: boolean;
  canForward: boolean;
  label?: string;
}) {
  return (
    <div className="move-stepper" role="group" aria-label="Move through the game">
      <button onClick={onFirst} disabled={!canBack} aria-label="First move" title="Start (Home)">
        <StepGlyph kind="first" />
      </button>
      <button className="big" onClick={onBack} disabled={!canBack} aria-label="Previous move" title="Back (← or scroll up on the board)">
        <StepGlyph kind="back" />
      </button>
      {label && <span className="move-stepper-label mono">{label}</span>}
      <button className="big" onClick={onForward} disabled={!canForward} aria-label="Next move" title="Forward (→ or scroll down on the board)">
        <StepGlyph kind="forward" />
      </button>
      <button onClick={onLast} disabled={!canForward} aria-label="Last move" title="End (End)">
        <StepGlyph kind="last" />
      </button>
    </div>
  );
}

function StepGlyph({ kind }: { kind: 'first' | 'back' | 'forward' | 'last' }) {
  const flip = kind === 'first' || kind === 'back';
  return (
    <svg viewBox="0 0 24 24" aria-hidden style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M8 5.5 16 12l-8 6.5z" fill="currentColor" />
      {(kind === 'first' || kind === 'last') && <rect x="17" y="5.5" width="2.4" height="13" rx="1" fill="currentColor" />}
    </svg>
  );
}

// ------------------------------------------------------------------ sparks

const SPARKS_PREF = 'dop.navSparks';

export function useSparksPref() {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(SPARKS_PREF) !== '0';
    } catch {
      return true;
    }
  });
  const set = (v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(SPARKS_PREF, v ? '1' : '0');
    } catch {
      /* private mode */
    }
  };
  return [on, set] as const;
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A burst of theme-shaped particles from the middle of `from`. */
export function burst(from: HTMLElement, theme: ThemeId, dir: 1 | -1) {
  if (reducedMotion()) return;
  const r = from.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = `spark-layer spark-${theme}`;
  layer.style.left = `${r.left + r.width / 2}px`;
  layer.style.top = `${r.top + r.height / 2}px`;
  const n = theme === 'mist' ? 10 : 16;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    // Mostly in the direction of travel, fanned out.
    const a = (dir === 1 ? 0 : Math.PI) + (Math.random() - 0.5) * Math.PI * 1.5;
    const d = 40 + Math.random() * 70;
    p.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    p.style.setProperty('--dy', `${Math.sin(a) * d + (theme === 'sakura' ? 30 : 0)}px`);
    p.style.setProperty('--rot', `${Math.round((Math.random() - 0.5) * 540)}deg`);
    p.style.setProperty('--s', (0.6 + Math.random() * 0.8).toFixed(2));
    p.style.animationDelay = `${Math.round(Math.random() * 60)}ms`;
    layer.appendChild(p);
  }
  if (theme === 'mist') {
    const ring = document.createElement('b');
    layer.appendChild(ring);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1100);
}

// ------------------------------------------------------------------ the focus-mode buttons

/** Big back/forward buttons at the sides of the board in focus mode, drawn per theme. */
export function FocusNav({
  onBack,
  onForward,
  canBack,
  canForward,
  label,
}: {
  onBack: () => void;
  onForward: () => void;
  canBack: boolean;
  canForward: boolean;
  label?: string;
}) {
  const theme = (useStore((s) => s.settings.theme) ?? 'sunrise') as ThemeId;
  const [sparks, setSparks] = useSparksPref();
  const press = (el: HTMLElement, dir: 1 | -1) => {
    el.classList.remove('pressed');
    void el.offsetWidth; // restart the press animation
    el.classList.add('pressed');
    if (sparks) burst(el, theme, dir);
    (dir === 1 ? onForward : onBack)();
  };
  return (
    <div className={`focus-nav theme-${theme}`}>
      <button className="focus-nav-btn back" onClick={(e) => press(e.currentTarget, -1)} disabled={!canBack} aria-label="Previous move" title="Back (← or scroll up)">
        <ThemeObject theme={theme} />
      </button>
      <button className="focus-nav-btn forward" onClick={(e) => press(e.currentTarget, 1)} disabled={!canForward} aria-label="Next move" title="Forward (→ or scroll down)">
        <ThemeObject theme={theme} />
      </button>
      <div className="focus-nav-bar">
        {label && <span className="mono">{label}</span>}
        <button className={`focus-nav-sparks ${sparks ? 'on' : ''}`} onClick={() => setSparks(!sparks)} aria-pressed={sparks} title={sparks ? 'Sparks on: click to turn them off' : 'Sparks off: click to turn them on'}>
          ✦ Sparks
        </button>
      </div>
    </div>
  );
}

const PETAL = 'M50 50C35 33 35 14 45.5 7L50 12.5 54.5 7C65 14 65 33 50 50Z';
const CHEVRON = 'M44 34 60 50 44 66';

/** The object each theme's buttons are made of; always drawn pointing forward (CSS mirrors "back"). */
function ThemeObject({ theme }: { theme: ThemeId }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden className="focus-obj">
      <defs>
        <radialGradient id="fo-sun" cx="0.4" cy="0.36" r="0.7">
          <stop offset="0" stopColor="#fff6c9" />
          <stop offset="0.45" stopColor="#ffc04d" />
          <stop offset="1" stopColor="#f0673f" />
        </radialGradient>
        <linearGradient id="fo-petal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe3ee" />
          <stop offset="1" stopColor="#f08bb1" />
        </linearGradient>
        <radialGradient id="fo-jade" cx="0.36" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#e9f6f1" />
          <stop offset="0.5" stopColor="#8fc3b4" />
          <stop offset="1" stopColor="#3f7f78" />
        </radialGradient>
        <linearGradient id="fo-gem" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7ef2d0" />
          <stop offset="0.5" stopColor="#5aa6ff" />
          <stop offset="1" stopColor="#b77cff" />
        </linearGradient>
      </defs>
      {theme === 'sunrise' && (
        <g>
          <g className="fo-rays">
            {Array.from({ length: 12 }, (_, i) => (
              <path key={i} d="M50 4 54 16H46Z" transform={`rotate(${i * 30} 50 50)`} fill="#ffb347" opacity={i % 2 ? 0.55 : 0.9} />
            ))}
          </g>
          <circle cx="50" cy="50" r="31" fill="url(#fo-sun)" />
          <circle cx="50" cy="50" r="31" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.5" />
        </g>
      )}
      {theme === 'sakura' && (
        <g className="fo-bloom">
          {Array.from({ length: 5 }, (_, i) => (
            <path key={i} d={PETAL} transform={`rotate(${i * 72} 50 50) translate(0 -2) scale(1) `} fill="url(#fo-petal)" stroke="#fff" strokeOpacity="0.7" strokeWidth="1.2" />
          ))}
          <circle cx="50" cy="50" r="9" fill="#f7a8c4" />
          {Array.from({ length: 7 }, (_, i) => (
            <circle key={i} cx={50 + Math.cos((i / 7) * Math.PI * 2) * 6} cy={50 + Math.sin((i / 7) * Math.PI * 2) * 6} r="1.6" fill="#c2456f" />
          ))}
        </g>
      )}
      {theme === 'mist' && (
        <g>
          <ellipse className="fo-ripple" cx="50" cy="54" rx="42" ry="34" fill="none" stroke="#9fb8d8" strokeWidth="1.2" />
          <path d="M50 16C74 15 88 31 87 51 86 73 69 86 48 85 27 84 12 70 13 49 14 29 29 17 50 16Z" fill="url(#fo-jade)" />
          <path d="M31 30C38 23 49 21 58 23" fill="none" stroke="#fff" strokeOpacity="0.8" strokeWidth="3.5" strokeLinecap="round" />
        </g>
      )}
      {theme === 'aurora' && (
        <g className="fo-gem">
          <path d="M50 8 84 30 84 70 50 92 16 70 16 30Z" fill="url(#fo-gem)" />
          <path d="M50 8 50 92M16 30 84 70M84 30 16 70" stroke="#fff" strokeOpacity="0.28" strokeWidth="1.2" />
          <path d="M50 8 84 30 50 50 16 30Z" fill="#fff" opacity="0.2" />
          <path d="M50 8 84 30 84 70 50 92 16 70 16 30Z" fill="none" stroke="#e7f6ff" strokeOpacity="0.8" strokeWidth="1.6" />
        </g>
      )}
      <path className="fo-chev" d={CHEVRON} fill="none" stroke={theme === 'sakura' ? '#b8325e' : theme === 'mist' ? '#23413d' : '#fff'} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
