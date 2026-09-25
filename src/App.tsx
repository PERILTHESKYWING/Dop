import { useEffect, useMemo, type CSSProperties } from 'react';
import { href, useRoute } from './router';
import { useStore } from './state/store';
import { init } from './state/actions';
import { Toasts } from './components/common';
import { BrandMark, Icon, type IconName } from './components/Icons';
import { Dashboard } from './pages/Dashboard';
import { Library } from './pages/Library';
import { Review } from './pages/Review';
import { PlayerDNA } from './pages/PlayerDNA';
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
  { label: 'Train' },
  { page: 'forge', label: 'Forge', icon: 'flame' },
  { page: 'blind', label: 'Blind Tests', icon: 'eyeOff' },
  { page: 'search', label: 'Position Search', icon: 'search' },
  { label: 'Prepare' },
  { page: 'opponents', label: 'Opponents', icon: 'swords' },
  { page: 'settings', label: 'Engine & Settings', icon: 'sliders' },
];

/** The painted sunrise behind everything, with slow light rays, drifting clouds and floating motes. */
function Scenery() {
  const motes = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => {
        const r = (k: number) => {
          const x = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
          return x - Math.floor(x);
        };
        return {
          '--x': `${(r(1) * 100).toFixed(1)}%`,
          '--s': `${(3 + r(2) * 6).toFixed(1)}px`,
          '--d': `${(16 + r(3) * 18).toFixed(1)}s`,
          '--delay': `${(-r(4) * 30).toFixed(1)}s`,
          '--dx': `${((r(5) - 0.5) * 120).toFixed(0)}px`,
        } as CSSProperties;
      }),
    [],
  );
  return (
    <div className="scenery" aria-hidden>
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
    </div>
  );
}

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
            Analysing <span className="muted">{cur.status === 'deep' ? `deep ${cur.progress.deep}/${cur.progress.deepTotal}` : `${cur.progress.fast}/${cur.progress.total}`}</span>
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
  useEffect(() => {
    void init();
  }, []);

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
    <div className={`app ${fx}`}>
      <Scenery />
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
              {page}
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
