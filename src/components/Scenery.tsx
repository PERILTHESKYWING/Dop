import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { saveSettings } from '../state/actions';
import { useStore } from '../state/store';
import { storedTheme, type ThemeId } from '../lib/themes';

/*
 * The backdrop of each theme: one quiet colour with a fine grain (styles/scenery.css). It has no
 * images, so a theme switch never waits on a download.
 */

function SceneLayer({ theme, leaving, onGone }: { theme: ThemeId; leaving?: boolean; onGone?: () => void }) {
  const gone = useRef(onGone);
  gone.current = onGone;
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => gone.current?.(), 600); // the fade takes 400 ms; this also covers a missed transitionend
    return () => clearTimeout(t);
  }, [leaving]);
  return <div className={`scenery scene-${theme}${leaving ? ' leaving' : ''}`} aria-hidden onTransitionEnd={(e) => e.target === e.currentTarget && leaving && gone.current?.()} />;
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Switches the theme smoothly: the whole page (background,
 * glass and text colours) cross-fades in a view transition where the browser has them. Elsewhere the
 * background cross-fades by itself (Scenery) and the colours change at once.
 */
export async function switchTheme(next: ThemeId) {
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
 * The backdrop of the chosen theme (lib/themes.ts). When the theme changes, the old backdrop stays
 * on top and fades out (400 ms).
 * During a view transition (switchTheme) the swap is immediate: the transition does the fade.
 */
export function Scenery({ theme: wanted }: { theme: ThemeId }) {
  // Until the settings have loaded, `wanted` is only the default: show the theme stored in this
  // browser instead, so a reload does not flash the default backdrop first.
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
    // two frames so the new backdrop is on screen under the old one before the fade starts
    requestAnimationFrame(() => requestAnimationFrame(() => alive && setFading(true)));
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
