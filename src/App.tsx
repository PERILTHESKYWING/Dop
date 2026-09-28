import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { href, useRoute } from './router';
import { useStore } from './state/store';
import { init } from './state/actions';
import { Toasts } from './components/common';
import { Scenery } from './components/Scenery';
import { storedTheme, THEME_PREF, themeInfo, type ThemeId } from './lib/themes';
import { BrandLoader } from './components/Brand';

/** Browser toolbar colour per theme (matches the first-paint splash in index.html). */
const THEME_COLOR: Record<ThemeId, string> = { sunrise: '#ffdcb8', sakura: '#f1c9da', mist: '#d9dfea', aurora: '#0f1a3e' };
import { BrandMark, Icon, type IconName } from './components/Icons';
import { Dashboard } from './pages/Dashboard';
import { Landing } from './pages/Landing';
import { Library } from './pages/Library';
import { Review } from './pages/Review';
import { PlayerDNA } from './pages/PlayerDNA';
import { Doppelganger } from './pages/Doppelganger';
import { Forge } from './pages/Forge';
import { ForgeHome } from './pages/ForgeHome';
import { ProblemSet } from './pages/ProblemSet';
import { BlindTests } from './pages/BlindTests';
import { Search } from './pages/Search';
import { Opponents } from './pages/Opponents';
import { Settings } from './pages/Settings';
import { Broadcast } from './pages/Broadcast';
import { Study } from './pages/Study';
import './styles/shell.css';

interface NavItem {
  page: string;
  label: string;
  /** Label in the phone tab bar and the "More" sheet. */
  short: string;
  icon: IconName;
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Study',
    items: [
      { page: 'dashboard', label: 'Dashboard', short: 'Home', icon: 'sunrise' },
      { page: 'library', label: 'Game Library', short: 'Games', icon: 'library' },
      { page: 'review', label: 'Game Review', short: 'Review', icon: 'board' },
      { page: 'study', label: 'Study Board', short: 'Study', icon: 'kifu' },
      { page: 'live', label: 'Live AI Games', short: 'Live', icon: 'broadcast' },
      { page: 'dna', label: 'Player DNA', short: 'Player DNA', icon: 'dna' },
      { page: 'doppel', label: 'Doppelgänger', short: 'Doppelgänger', icon: 'twin' },
    ],
  },
  {
    label: 'Train',
    items: [
      { page: 'forge', label: 'Forge', short: 'Forge', icon: 'flame' },
      { page: 'blind', label: 'Blind Tests', short: 'Blind Tests', icon: 'eyeOff' },
      { page: 'search', label: 'Position Search', short: 'Search', icon: 'search' },
    ],
  },
  {
    label: 'Prepare',
    items: [{ page: 'opponents', label: 'Opponents', short: 'Opponents', icon: 'swords' }],
  },
];
const SETTINGS_ITEM: NavItem = { page: 'settings', label: 'Engine & Settings', short: 'Settings', icon: 'sliders' };
const ALL_ITEMS = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];
/** The phone tab bar: the most used pages; everything else is in "More". */
const TABS = ['dashboard', 'library', 'review', 'forge'];
const byPage = (page: string) => ALL_ITEMS.find((i) => i.page === page)!;

/** What the engine, the analysis queue and the LLM are doing, for the status card and the phone top bar. */
function useStatus() {
  const engine = useStore((s) => s.engine);
  const queue = useStore((s) => s.queue);
  const games = useStore((s) => s.games);
  const llm = useStore((s) => s.llm);
  const pending = games.filter((g) => g.status !== 'done' && g.status !== 'error' && g.status !== 'skipped').length;
  const cur = games.find((g) => g.id === queue.currentGameId);
  const engDot = engine.status === 'ready' ? 'ok' : engine.status === 'loading' || engine.status === 'detecting' ? 'busy' : engine.status === 'error' || engine.status === 'unsupported' ? 'err' : '';
  const p = engine.progress;
  const engineText =
    engine.status === 'ready'
      ? engine.info?.backend === 'webgpu'
        ? 'WebGPU'
        : 'CPU'
      : engine.status === 'loading'
        ? p?.stage === 'download'
          ? `downloading ${p.total ? Math.round((p.loaded / p.total) * 100) + '%' : Math.round(p.loaded / 1e6) + ' MB'}`
          : p?.stage === 'check'
            ? 'testing'
            : 'loading'
        : engine.status === 'off'
          ? 'starts when needed'
          : engine.status;
  const queueDot = queue.running ? 'busy' : pending ? '' : 'ok';
  const queueText =
    queue.running && cur
      ? cur.status === 'deep'
        ? `searching ${cur.progress.deep}/${cur.progress.deepTotal}`
        : `first look ${cur.progress.fast}/${cur.progress.total}`
      : pending
        ? `${pending} game${pending > 1 ? 's' : ''} waiting`
        : 'Analysis up to date';
  const llmDot = llm?.available ? 'ok' : llm?.configured ? 'err' : '';
  const llmText = llm?.available ? 'connected' : llm?.configured ? 'not answering' : 'off (optional)';
  // The phone top bar has room for one line: whatever is most worth knowing.
  const brief = queue.running ? { dot: 'busy', text: 'Analysing' } : engine.status === 'loading' ? { dot: 'busy', text: 'Loading KataGo' } : engine.status === 'error' || engine.status === 'unsupported' ? { dot: 'err', text: 'KataGo stopped' } : pending ? { dot: '', text: `${pending} waiting` } : engine.status === 'ready' ? { dot: 'ok', text: `KataGo · ${engineText}` } : { dot: queueDot, text: 'Up to date' };
  return { engDot, engineText, queueDot, queueText, analysing: queue.running && !!cur, llmDot, llmText, brief };
}

function StatusCard() {
  const s = useStatus();
  return (
    <a className="status" href={href('settings')} title="Engine & Settings">
      <div className="status-row">
        <span className={`dot ${s.engDot}`} />
        <span className="status-text">
          KataGo <span className="muted">· {s.engineText}</span>
        </span>
      </div>
      <div className="status-row">
        <span className={`dot ${s.queueDot}`} />
        <span className="status-text">{s.analysing ? <>Analysing <span className="muted">{s.queueText}</span></> : s.queueText}</span>
      </div>
      <div className="status-row">
        <span className={`dot ${s.llmDot}`} />
        <span className="status-text">
          LLM <span className="muted">· {s.llmText}</span>
        </span>
      </div>
    </a>
  );
}

function NavLink({ item, current }: { item: NavItem; current: string }) {
  const on = current === item.page;
  return (
    <a href={href(item.page)} className={`item ${on ? 'active' : ''}`} aria-current={on ? 'page' : undefined} title={item.label}>
      <Icon name={item.icon} />
      <span className="item-label">{item.label}</span>
    </a>
  );
}

function MoreGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.8" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8" />
      <circle cx="16.75" cy="16.75" r="3.25" />
    </svg>
  );
}

/** Phone navigation: a bottom tab bar with the most used pages and a sheet with the rest. */
function TabBar({ current }: { current: string }) {
  const [sheet, setSheet] = useState<'closed' | 'open' | 'closing'>('closed');
  const route = useRoute();
  const panel = useRef<HTMLDivElement>(null);
  const rest = ALL_ITEMS.filter((i) => !TABS.includes(i.page));
  const moreActive = !TABS.includes(current);
  const close = () => setSheet((s) => (s === 'open' ? 'closing' : s));
  // Any navigation closes the sheet.
  useEffect(() => {
    setSheet('closed');
  }, [route]);
  useEffect(() => {
    if (sheet === 'closing') {
      const t = setTimeout(() => setSheet('closed'), 220);
      return () => clearTimeout(t);
    }
    if (sheet !== 'open') return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);
  return (
    <>
      <nav className="tabbar" aria-label="Main">
        {TABS.map((page) => {
          const it = byPage(page);
          const on = current === page;
          return (
            <a key={page} href={href(page)} className={`tab ${on ? 'on' : ''}`} aria-current={on ? 'page' : undefined}>
              <Icon name={it.icon} />
              <span>{it.short}</span>
            </a>
          );
        })}
        <button className={`tab ${moreActive || sheet === 'open' ? 'on' : ''}`} aria-expanded={sheet === 'open'} aria-haspopup="dialog" onClick={() => setSheet(sheet === 'open' ? 'closing' : 'open')}>
          <MoreGlyph />
          <span>More</span>
        </button>
      </nav>
      {sheet !== 'closed' && (
        <div className={`sheet-wrap ${sheet}`}>
          <div className="sheet-backdrop" onClick={close} />
          <div className="sheet" role="dialog" aria-modal="true" aria-label="More pages" tabIndex={-1} ref={panel}>
            <div className="sheet-grip" />
            <div className="sheet-head">
              <strong>More</strong>
              <button className="btn small ghost" onClick={close}>
                Close
              </button>
            </div>
            <div className="sheet-grid">
              {rest.map((it) => (
                <a key={it.page} href={href(it.page)} className={`sheet-item ${current === it.page ? 'on' : ''}`} aria-current={current === it.page ? 'page' : undefined}>
                  <span className="sheet-ico">
                    <Icon name={it.icon} />
                  </span>
                  <span>{it.short}</span>
                </a>
              ))}
            </div>
            <StatusCard />
            <a className="sheet-about" href={href('welcome')}>
              <BrandMark className="brand-mark sheet-about-mark" />
              <span>
                <strong>About DOPPELGÄNGER</strong>
                <small>What it does, privacy and themes</small>
              </span>
            </a>
          </div>
        </div>
      )}
    </>
  );
}

function PhoneTopBar() {
  const s = useStatus();
  return (
    <header className="topbar">
      <a className="brand" href={href('dashboard')}>
        <BrandMark />
        <span className="brand-name">DOPPELGÄNGER</span>
      </a>
      <a className="topbar-status" href={href('settings')} title="Engine & Settings">
        <span className={`dot ${s.brief.dot}`} />
        {s.brief.text}
      </a>
    </header>
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
  const savedTheme = useStore((s) => s.settings.theme) ?? 'sunrise';
  // Until the settings have loaded, keep the theme index.html already painted from this browser's copy.
  const [hint] = useState(storedTheme);
  const theme = loaded ? savedTheme : (hint ?? savedTheme);
  const onboarded = useStore((s) => s.settings.onboarded);
  const hasGames = useStore((s) => s.games.length > 0);
  useEffect(() => {
    void init();
  }, []);
  // The theme is also kept in this browser so the next visit paints it before the app loads (index.html).
  useEffect(() => {
    if (!loaded) return;
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = themeInfo(theme).dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme] ?? THEME_COLOR.sunrise);
    try {
      localStorage.setItem(THEME_PREF, theme);
    } catch {
      /* private mode */
    }
  }, [theme, loaded]);

  // The landing page: at #/welcome, and in place of the dashboard on the very first visit.
  const landing = loaded && (route.page === 'welcome' || (route.page === 'dashboard' && !onboarded && !hasGames));

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
        // forge: problem settings; forge/set: a problem set; forge/mine or forge/<weakness>: drills on your own mistakes.
        page = !route.params[0] ? (
          <ForgeHome />
        ) : route.params[0] === 'set' ? (
          <ProblemSet daily={route.query.get('daily') === '1'} />
        ) : (
          <Forge weaknessId={route.params[0] === 'mine' ? undefined : route.params[0]} />
        );
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
      case 'live':
        page = <Broadcast table={route.params[0]} />;
        break;
      case 'study':
        page = <Study id={route.params[0]} query={route.query} />;
        break;
      default:
        page = <Dashboard />;
    }
  }
  const current = route.page === '' ? 'dashboard' : route.page;
  // A new page starts at the top (the scroll area outlives pages), and so does the dashboard when the
  // first games arrive and the welcome view turns into the lab. Query changes (a move in Review) keep it.
  const scrollKey = `${current}/${route.params.join('/')}${current === 'dashboard' && hasGames ? ':lab' : ''}`;
  useLayoutEffect(() => {
    document.querySelector('.app .main')?.scrollTo({ top: 0, behavior: 'instant' });
  }, [scrollKey]);

  return (
    <div className={`app ${fx}`} data-theme={theme}>
      <Scenery theme={theme} />
      {landing ? (
        <PageGuard>
          <Landing />
        </PageGuard>
      ) : (
        <>
          <div className={`shell ${loaded ? '' : 'booting'}`}>
            <nav className="nav" aria-label="Main">
              <a className="brand" href={href('dashboard')} title="Dashboard">
                <BrandMark />
                <span className="brand-name">
                  DOPPELGÄNGER
                  <small>Go training lab</small>
                </span>
              </a>
              <div className="nav-groups">
                {NAV_GROUPS.map((g) => (
                  <div key={g.label} className="nav-group" role="group" aria-label={g.label}>
                    <div className="nav-label">{g.label}</div>
                    {g.items.map((it) => (
                      <NavLink key={it.page} item={it} current={current} />
                    ))}
                  </div>
                ))}
              </div>
              <div className="nav-foot">
                <NavLink item={SETTINGS_ITEM} current={current} />
                <a className="item nav-about" href={href('welcome')} title="About DOPPELGÄNGER">
                  <Icon name="spark" />
                  <span className="item-label">About</span>
                </a>
                <StatusCard />
              </div>
            </nav>
            {loaded && <PhoneTopBar />}
            <main className="main">
              {loaded ? (
                <div key={current + '/' + route.params.join('/')} className="route">
                  <PageGuard>{page}</PageGuard>
                </div>
              ) : null}
            </main>
          </div>
          {loaded && <TabBar current={current} />}
        </>
      )}
      {!loaded && <BrandLoader overlay label="Opening your lab…" />}
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
