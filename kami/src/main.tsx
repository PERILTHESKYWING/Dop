import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/500.css';
import '@fontsource/alegreya-sans/700.css';
import '@fontsource/alegreya-sans/800.css';
import { App } from './App';
import './styles.css';

const Landing = lazy(() => import('./ui/Landing'));
const Annotate = lazy(() => import('./ui/Annotate'));

function entered(): boolean {
  try {
    return localStorage.getItem('kiai.entered') === '1';
  } catch {
    return true;
  }
}

/** First visit (or #welcome): the landing page. After "Open Kiai", straight to the app. */
function Root() {
  const [landing, setLanding] = useState(() => location.hash === '#welcome' || (!entered() && location.hash !== '#annotate'));
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
    return (
      <Suspense fallback={null}>
        <Landing onEnter={enter} />
      </Suspense>
    );
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
