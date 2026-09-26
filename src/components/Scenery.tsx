import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { saveSettings } from '../state/actions';
import { useStore } from '../state/store';
import { storedTheme, type ThemeId } from '../lib/themes';

/*
 * The painted, animated background of each theme. The paintings are procedural (tools/art) and
 * live in public/art; styles/scenery.css places them and animates the light, clouds, petals, fog
 * and aurora on top with transforms and opacity only. Each theme's images are referenced only under
 * its own .scene-<id> class, so the browser fetches the art of the theme on screen and nothing else.
 */

/** Deterministic pseudo-random numbers for the particle layouts (the same on every render). */
const rand = (i: number, k: number) => {
  const x = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const vars = (v: Record<string, string>) => v as CSSProperties;

/** The painted sunrise, with slow light rays, drifting clouds and floating motes. */
function SunriseScene() {
  const motes = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) =>
        vars({
          '--x': `${(rand(i, 1) * 100).toFixed(1)}%`,
          '--s': `${(3 + rand(i, 2) * 6).toFixed(1)}px`,
          '--d': `${(16 + rand(i, 3) * 18).toFixed(1)}s`,
          '--delay': `${(-rand(i, 4) * 30).toFixed(1)}s`,
          '--dx': `${((rand(i, 5) - 0.5) * 120).toFixed(0)}px`,
        }),
      ),
    [],
  );
  return (
    <>
      <div className="scenery-art">
        <div className="scenery-img" />
        <div className="scenery-glow" />
        <div className="scenery-rays" />
        <div className="scenery-rays two" />
        <div className="scenery-clouds" />
      </div>
      {motes.map((style, i) => (
        <span key={i} className="mote" style={style} />
      ))}
      <div className="scenery-veil" />
    </>
  );
}

/** A cherry tree at dusk: the sun breathing over the lake, glints on the water, drifting mist, falling petals. */
function SakuraScene() {
  const petals = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) =>
        vars({
          '--x': `${(rand(i, 11) * 104 - 2).toFixed(1)}%`,
          '--s': `${(13 + rand(i, 12) * 13).toFixed(1)}px`,
          '--d': `${(17 + rand(i, 13) * 15).toFixed(1)}s`,
          '--delay': `${(-rand(i, 14) * 32).toFixed(1)}s`,
          '--dx': `${((rand(i, 15) - 0.3) * 22).toFixed(1)}vw`,
          '--c': `${Math.floor(rand(i, 16) * 8)}`,
          '--f': `${(2.6 + rand(i, 17) * 3.2).toFixed(1)}s`,
          '--r0': `${Math.round(rand(i, 18) * 360)}deg`,
        }),
      ),
    [],
  );
  return (
    <>
      <div className="scenery-art">
        <div className="scenery-img" />
        <div className="scenery-glow" />
        <div className="scenery-mist" />
        <div className="scenery-glints">
          <i />
          <i />
        </div>
      </div>
      {petals.map((style, i) => (
        <span key={i} className="petal" style={style}>
          <i />
        </span>
      ))}
      <div className="scenery-veil" />
    </>
  );
}

/** Ink-wash peaks: fog banks sliding at different speeds and a few birds crossing slowly. */
function MistScene() {
  const flock = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) =>
        vars({
          '--bx': `${(i === 0 ? 0 : (rand(i, 21) - 0.2) * 7).toFixed(2)}vmin`,
          '--by': `${(i * 1.1 + rand(i, 22) * 1.4).toFixed(2)}vmin`,
          '--bs': `${(0.75 + rand(i, 23) * 0.5).toFixed(2)}`,
          '--flap': `${(0.9 + rand(i, 24) * 0.5).toFixed(2)}s`,
          '--fd': `${(-rand(i, 25)).toFixed(2)}s`,
        }),
      ),
    [],
  );
  return (
    <>
      <div className="scenery-art">
        <div className="scenery-img" />
        <div className="scenery-glow" />
        <div className="fog f1" />
        <div className="fog f2" />
        <div className="flock">
          {flock.map((style, i) => (
            <span key={i} className="bird" style={style}>
              <svg viewBox="0 0 40 16">
                <path d="M1 7 C8 1 15 2 20 9 C25 2 32 1 39 7 C32 4 25 6 20 13 C15 6 8 4 1 7 Z" />
              </svg>
            </span>
          ))}
        </div>
        <div className="fog f3" />
      </div>
      <div className="scenery-veil" />
    </>
  );
}

/** Northern lights over snowy peaks: curtains waving, stars twinkling, now and then a shooting star. */
function AuroraScene() {
  const stars = useMemo(
    () =>
      Array.from({ length: 34 }, (_, i) =>
        vars({
          '--x': `${(rand(i, 31) * 100).toFixed(2)}%`,
          '--y': `${(rand(i, 32) * rand(i, 33) * 32 + 1).toFixed(2)}%`,
          '--s': `${(1.4 + rand(i, 34) * 1.8).toFixed(1)}px`,
          '--d': `${(2.4 + rand(i, 35) * 4).toFixed(1)}s`,
          '--delay': `${(-rand(i, 36) * 6).toFixed(1)}s`,
        }),
      ),
    [],
  );
  return (
    <>
      <div className="scenery-art">
        <div className="scenery-img" />
        <div className="scenery-glow" />
        <div className="aurora a1" />
        <div className="aurora a2" />
        {stars.map((style, i) => (
          <span key={i} className="star" style={style} />
        ))}
        <span className="shooting s1" />
        <span className="shooting s2" />
      </div>
      <div className="scenery-veil" />
    </>
  );
}

const SCENES: Record<ThemeId, () => ReactNode> = {
  sunrise: SunriseScene,
  sakura: SakuraScene,
  mist: MistScene,
  aurora: AuroraScene,
};

function SceneLayer({ theme, leaving, onGone }: { theme: ThemeId; leaving?: boolean; onGone?: () => void }) {
  const Scene = SCENES[theme] ?? SunriseScene;
  const gone = useRef(onGone);
  gone.current = onGone;
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => gone.current?.(), 900); // the fade takes 700 ms; this also covers a missed transitionend
    return () => clearTimeout(t);
  }, [leaving]);
  return (
    <div className={`scenery scene-${theme}${leaving ? ' leaving' : ''}`} aria-hidden onTransitionEnd={(e) => e.target === e.currentTarget && leaving && gone.current?.()}>
      <Scene />
    </div>
  );
}

/** The painting the stylesheet shows for this theme at the current window size (see scenery.css). */
export function sceneArt(theme: ThemeId): string {
  const mq = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;
  const variant = mq('(max-aspect-ratio: 4/5)') ? 'tall' : mq('(max-width: 1500px) and (max-resolution: 1.5dppx)') ? '1280' : 'wide';
  const base = theme === 'sunrise' ? '/art/meadow' : `/art/${theme}/${theme}`;
  return variant === 'wide' ? `${base}.webp` : `${base}-${variant}.webp`;
}

/** Resolves once the theme's painting is downloaded and decoded (or after `timeout` ms, whichever is first). */
export function preloadTheme(theme: ThemeId, timeout = 2500): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    const done = () => resolve();
    const t = setTimeout(done, timeout);
    img.src = sceneArt(theme);
    img
      .decode()
      .catch(() => undefined)
      .then(() => {
        clearTimeout(t);
        done();
      });
  });
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Switches the theme smoothly: the new painting is fetched first, then the whole page (background,
 * glass and text colours) cross-fades in a view transition where the browser has them. Elsewhere the
 * background cross-fades by itself (Scenery) and the colours change at once.
 */
export async function switchTheme(next: ThemeId) {
  await preloadTheme(next, 1500);
  const root = document.documentElement;
  const doc = document as Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } };
  if (!doc.startViewTransition || reducedMotion()) {
    void saveSettings({ theme: next });
    return;
  }
  root.classList.add('theme-swap');
  try {
    const t = doc.startViewTransition(() => {
      flushSync(() => void saveSettings({ theme: next }));
      root.dataset.theme = next;
    });
    await t.finished.catch(() => undefined);
  } finally {
    root.classList.remove('theme-swap');
  }
}

/**
 * The animated background of the chosen theme (lib/themes.ts). When the theme changes, the old scene
 * stays on top until the new painting is ready and then fades out (700 ms), so it never flashes.
 * During a view transition (switchTheme) the swap is immediate: the transition does the fade.
 */
export function Scenery({ theme: wanted }: { theme: ThemeId }) {
  // Until the settings have loaded, `wanted` is only the default: show the theme stored in this
  // browser instead, so a reload does not fetch (and flash) the default painting first.
  const loaded = useStore((s) => s.loaded);
  const [hint] = useState(storedTheme);
  const theme = loaded ? wanted : (hint ?? wanted);
  const [cur, setCur] = useState(theme);
  const [prev, setPrev] = useState<ThemeId | null>(null);
  const [fading, setFading] = useState(false);
  if (theme !== cur) {
    const instant = typeof document !== 'undefined' && (document.documentElement.classList.contains('theme-swap') || reducedMotion());
    setPrev(instant ? null : cur);
    setFading(false);
    setCur(theme);
  }
  useEffect(() => {
    if (!prev) return;
    let alive = true;
    void preloadTheme(cur).then(() => {
      // two frames so the new painting is on screen under the old one before the fade starts
      requestAnimationFrame(() => requestAnimationFrame(() => alive && setFading(true)));
    });
    return () => {
      alive = false;
    };
  }, [cur, prev]);
  return (
    <>
      <SceneLayer key={cur} theme={cur} />
      {prev && <SceneLayer key={prev} theme={prev} leaving={fading} onGone={() => setPrev(null)} />}
    </>
  );
}
