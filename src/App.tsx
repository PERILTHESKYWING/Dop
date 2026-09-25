import { useEffect } from 'react';
import { href, useRoute } from './router';
import { useStore } from './state/store';
import { init } from './state/actions';
import { Toasts } from './components/common';
import { Dashboard } from './pages/Dashboard';
import { Library } from './pages/Library';
import { Review } from './pages/Review';
import { PlayerDNA } from './pages/PlayerDNA';
import { Forge } from './pages/Forge';
import { BlindTests } from './pages/BlindTests';
import { Search } from './pages/Search';
import { Opponents } from './pages/Opponents';
import { Settings } from './pages/Settings';

const NAV = [
  ['dashboard', 'Dashboard'],
  ['library', 'Game Library'],
  ['review', 'Game Review'],
  ['dna', 'Player DNA'],
  null,
  ['forge', 'Forge'],
  ['blind', 'Blind Tests'],
  ['search', 'Position Search'],
  null,
  ['opponents', 'Opponent Profiles'],
  ['settings', 'Engine & Settings'],
] as const;

function StatusFooter() {
  const engine = useStore((s) => s.engine);
  const queue = useStore((s) => s.queue);
  const games = useStore((s) => s.games);
  const llm = useStore((s) => s.llm);
  const pending = games.filter((g) => g.status !== 'done' && g.status !== 'error' && g.status !== 'skipped').length;
  const cur = games.find((g) => g.id === queue.currentGameId);
  const engDot = engine.status === 'ready' ? 'ok' : engine.status === 'loading' || engine.status === 'detecting' ? 'busy' : engine.status === 'error' || engine.status === 'unsupported' ? 'err' : '';
  return (
    <div className="status">
      <div>
        <span className={`dot ${engDot}`} />
        KataGo{' '}
        {engine.status === 'ready'
          ? `· ${engine.info?.backend === 'webgpu' ? 'WebGPU' : 'CPU'}`
          : engine.status === 'loading'
            ? engine.progress?.stage === 'download'
              ? `· downloading ${engine.progress.total ? Math.round((engine.progress.loaded / engine.progress.total) * 100) + '%' : Math.round(engine.progress.loaded / 1e6) + ' MB'}`
              : '· loading'
            : `· ${engine.status}`}
      </div>
      <div>
        <span className={`dot ${queue.running ? 'busy' : pending ? '' : 'ok'}`} />
        {queue.running && cur ? `Analysing ${cur.progress.fast}/${cur.progress.total}${cur.status === 'deep' ? ` · deep ${cur.progress.deep}/${cur.progress.deepTotal}` : ''}` : pending ? `${pending} game${pending > 1 ? 's' : ''} waiting` : 'Analysis idle'}
      </div>
      <div>
        <span className={`dot ${llm?.configured ? 'ok' : ''}`} />
        LLM {llm?.configured ? 'connected' : 'off (optional)'}
      </div>
    </div>
  );
}

export function App() {
  const route = useRoute();
  const loaded = useStore((s) => s.loaded);
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

  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">
          DOPPELGÄNGER
          <small>Go training lab</small>
        </div>
        {NAV.map((n, i) =>
          n ? (
            <a key={n[0]} href={href(n[0])} className={route.page === n[0] || (route.page === '' && n[0] === 'dashboard') ? 'active' : ''}>
              {n[1]}
            </a>
          ) : (
            <div key={`sep${i}`} className="sep" />
          ),
        )}
        <StatusFooter />
      </nav>
      <main className="main">{loaded ? page : <div className="page muted">Loading your lab…</div>}</main>
      <Toasts />
    </div>
  );
}
