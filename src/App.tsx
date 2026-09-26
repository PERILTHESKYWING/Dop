import { Component, useEffect, useMemo, type ReactNode } from 'react';
import { href, useRoute } from './router';
import { useStore } from './state/store';
import { init } from './state/actions';
import { Toasts } from './components/common';
import { Scenery } from './components/Scenery';
import { THEME_PREF, themeInfo } from './lib/themes';
import { BrandMark, Icon, type IconName } from './components/Icons';
import { Dashboard } from './pages/Dashboard';
import { Library } from './pages/Library';
import { Review } from './pages/Review';
import { PlayerDNA } from './pages/PlayerDNA';
import { Doppelganger } from './pages/Doppelganger';
import { Forge } from './pages/Forge';
import { BlindTests } from './pages/BlindTests';
import { Search } from './pages/Search';
import { Opponents } from './pages/Opponents';
import { Settings } from './pages/Settings';

const NAV: ({ label: string } | { page: string; label: string; icon: IconName })[] = [
  { label: 'Study' },
  { page: 'dashboard', label: 'Dashboard', icon: 'sunrise' },
  { page: 'library', label: 'Game Library', icon: 'library' },
  { page: 'review', label: 'Game Review', icon: 'board' },
  { page: 'dna', label: 'Player DNA', icon: 'dna' },
  { page: 'doppel', label: 'Doppelgänger', icon: 'twin' },
  { label: 'Train' },
  { page: 'forge', label: 'Forge', icon: 'flame' },
  { page: 'blind', label: 'Blind Tests', icon: 'eyeOff' },
  { page: 'search', label: 'Position Search', icon: 'search' },
  { label: 'Prepare' },
  { page: 'opponents', label: 'Opponents', icon: 'swords' },
  { page: 'settings', label: 'Engine & Settings', icon: 'sliders' },
];

function StatusCard() {
  const engine = useStore((s) => s.engine);
  const queue = useStore((s) => s.queue);
  const games = useStore((s) => s.games);
  const llm = useStore((s) => s.llm);
  const pending = games.filter((g) => g.status !== 'done' && g.status !== 'error' && g.status !== 'skipped').length;
  const cur = games.find((g) => g.id === queue.currentGameId);
  const engDot = engine.status === 'ready' ? 'ok' : engine.status === 'loading' || engine.status === 'detecting' ? 'busy' : engine.status === 'error' || engine.status === 'unsupported' ? 'err' : '';
  const p = engine.progress;
  return (
    <a className="status" href={href('settings')} title="Engine & Settings">
      <div>
        <span className={`dot ${engDot}`} />
        KataGo{' '}
        <span className="muted">
          {engine.status === 'ready'
            ? `· ${engine.info?.backend === 'webgpu' ? 'WebGPU' : 'CPU'}`
            : engine.status === 'loading'
              ? p?.stage === 'download'
                ? `· downloading ${p.total ? Math.round((p.loaded / p.total) * 100) + '%' : Math.round(p.loaded / 1e6) + ' MB'}`
                : p?.stage === 'check'
                  ? '· testing'
                  : '· loading'
              : engine.status === 'off'
                ? '· starts when needed'
                : `· ${engine.status}`}
        </span>
      </div>
      <div>
        <span className={`dot ${queue.running ? 'busy' : pending ? '' : 'ok'}`} />
        {queue.running && cur ? (
          <>
            Analysing <span className="muted">{cur.status === 'deep' ? `searching ${cur.progress.deep}/${cur.progress.deepTotal}` : `first look ${cur.progress.fast}/${cur.progress.total}`}</span>
          </>
        ) : pending ? (
          `${pending} game${pending > 1 ? 's' : ''} waiting`
        ) : (
          'Analysis up to date'
        )}
      </div>
      <div>
        <span className={`dot ${llm?.available ? 'ok' : llm?.configured ? 'err' : ''}`} />
        LLM <span className="muted">{llm?.available ? '· connected' : llm?.configured ? '· not answering' : '· off (optional)'}</span>
      </div>
    </a>
  );
}

/** Heavy effects (moving light, blur) only where the device can afford them. */
function useEffectsClass() {
  const effects = useStore((s) => s.settings.effects);
  return useMemo(() => {
    if (effects === 'light') return 'fx-light';
    if (effects === 'full') return '';
    const nav = navigator as Navigator & { deviceMemory?: number };
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const weak = (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
    return reduced || weak ? 'fx-light' : '';
  }, [effects]);
}

export function App() {
  const route = useRoute();
  const loaded = useStore((s) => s.loaded);
  const fx = useEffectsClass();
  const theme = useStore((s) => s.settings.theme) ?? 'sunrise';
  useEffect(() => {
    void init();
  }, []);
  // The theme is also kept in this browser so the next visit paints it before the app loads (index.html).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = themeInfo(theme).dark ? 'dark' : 'light';
    try {
      localStorage.setItem(THEME_PREF, theme);
    } catch {
      /* private mode */
    }
  }, [theme]);

  let page = null;
  if (loaded) {
    switch (route.page) {
      case 'library':
        page = <Library />;
        break;
      case 'review':
        page = <Review gameId={route.params[0]} move={Number(route.query.get('move') ?? '')} />;
        break;
      case 'dna':
        page = <PlayerDNA />;
        break;
      case 'doppel':
        page = <Doppelganger tab={route.params[0]} query={route.query} />;
        break;
      case 'forge':
        page = <Forge weaknessId={route.params[0]} />;
        break;
      case 'blind':
        page = <BlindTests weaknessId={route.params[0]} />;
        break;
      case 'search':
        page = <Search query={route.query} />;
        break;
      case 'opponents':
        page = <Opponents id={route.params[0]} />;
        break;
      case 'settings':
        page = <Settings />;
        break;
      default:
        page = <Dashboard />;
    }
  }
  const current = route.page === '' ? 'dashboard' : route.page;

  return (
    <div className={`app ${fx}`} data-theme={theme}>
      <Scenery theme={theme} />
      <div className="shell">
        <nav className="nav" aria-label="Main">
          <a className="brand" href={href('dashboard')}>
            <BrandMark />
            <span className="brand-name">
              DOPPELGÄNGER
              <small>Go training lab</small>
            </span>
          </a>
          {NAV.map((n) =>
            'page' in n ? (
              <a key={n.page} href={href(n.page)} className={`item ${current === n.page ? 'active' : ''}`} aria-current={current === n.page ? 'page' : undefined}>
                <Icon name={n.icon} />
                {n.label}
              </a>
            ) : (
              <div key={n.label} className="nav-label">
                {n.label}
              </div>
            ),
          )}
          <StatusCard />
        </nav>
        <main className="main">
          {loaded ? (
            <div key={current + '/' + route.params.join('/')} className="route">
              <PageGuard>{page}</PageGuard>
            </div>
          ) : (
            <div className="boot">
              <BrandMark />
              <span>Opening your lab…</span>
            </div>
          )}
        </main>
      </div>
      <Toasts />
    </div>
  );
}

/** A page that fails to draw shows what went wrong instead of blanking the whole app. */
class PageGuard extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel stack">
        <h2>This page ran into a problem</h2>
        <p className="dim small">{this.state.error.message}</p>
        <div className="row">
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <a className="btn" href={href('dashboard')}>
            Back to the dashboard
          </a>
        </div>
      </div>
    );
  }
}
