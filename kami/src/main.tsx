import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './fonts.css';
// The app stays in the entry: a return visit (the common one) paints it with no extra round trip.
// A first visit's landing is under the 気合 sheet while it loads.
import { App } from './App';
import './styles.css';
import font400 from '@fontsource/alegreya-sans/files/alegreya-sans-latin-400-normal.woff2?url';
import font500 from '@fontsource/alegreya-sans/files/alegreya-sans-latin-500-normal.woff2?url';
import font700 from '@fontsource/alegreya-sans/files/alegreya-sans-latin-700-normal.woff2?url';
import font800 from '@fontsource/alegreya-sans/files/alegreya-sans-latin-800-normal.woff2?url';

// The page's fonts start loading now, not when the first words are laid out, so they are in
// before the words paint and nothing moves when they arrive (the landing's layout shift).
for (const href of [font800, font700, font500, font400]) {
  const l = document.createElement('link');
  l.rel = 'preload';
  l.as = 'font';
  l.type = 'font/woff2';
  l.crossOrigin = '';
  l.href = href;
  document.head.appendChild(l);
}

const Landing = lazy(() => import('./ui/Landing'));
const Annotate = lazy(() => import('./ui/Annotate'));

function entered(): boolean {
  try {
    return localStorage.getItem('kiai.entered') === '1';
  } catch {
    return true;
  }
}

const firstLanding = location.hash === '#welcome' || (!entered() && location.hash !== '#annotate');

/**
 * A first visit's landing, loaded before the first render instead of through Suspense: React 19
 * holds back a Suspense boundary's content for about 300 ms after its fallback shows, which kept
 * the landing (and the 気合 sheet's "ready") back by that much on every visit.
 */
let LandingNow: typeof import('./ui/Landing').default | null = null;

/** First visit (or #welcome): the landing page. After "Open Kiai", straight to the app. */
function Root() {
  const [landing, setLanding] = useState(firstLanding);
  const [notes, setNotes] = useState(() => location.hash === '#annotate');
  useEffect(() => {
    const on = () => {
      if (location.hash === '#welcome') setLanding(true);
      setNotes(location.hash === '#annotate');
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const enter = () => {
    try {
      localStorage.setItem('kiai.entered', '1');
    } catch {
      /* private mode: the landing shows again next time */
    }
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    window.scrollTo(0, 0);
    setLanding(false);
  };
  if (notes)
    return (
      <Suspense fallback={null}>
        <Annotate />
      </Suspense>
    );
  if (landing)
    return LandingNow ? (
      <LandingNow onEnter={enter} />
    ) : (
      <Suspense fallback={null}>
        <Landing onEnter={enter} />
      </Suspense>
    );
  return <App />;
}

const start = () =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
if (firstLanding)
  import('./ui/Landing').then(
    (m) => {
      LandingNow = m.default;
      start();
    },
    start,
  );
else start();
