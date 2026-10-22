import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './fonts.css';
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
// The app is its own chunk, so a first visit's landing does not wait for it: fetched at once when
// it is the first screen, and in the background while the landing is open (so "Open Kiai" is quick).
const loadApp = () => import('./App');
const App = lazy(() => loadApp().then((m) => ({ default: m.App })));

function entered(): boolean {
  try {
    return localStorage.getItem('kiai.entered') === '1';
  } catch {
    return true;
  }
}

const firstLanding = location.hash === '#welcome' || (!entered() && location.hash !== '#annotate');
if (!firstLanding && location.hash !== '#annotate') void loadApp();

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
  useEffect(() => {
    if (!landing) return;
    // well after the landing's own first paint and its three.js
    const t = window.setTimeout(() => void loadApp().catch(() => undefined), 6000);
    return () => window.clearTimeout(t);
  }, [landing]);
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
    return (
      <Suspense fallback={null}>
        <Landing onEnter={enter} />
      </Suspense>
    );
  return (
    <Suspense fallback={null}>
      <App />
    </Suspense>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
