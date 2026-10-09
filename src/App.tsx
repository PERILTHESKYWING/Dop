import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { href, useRoute } from './router';
import { useStore } from './state/store';
import { init } from './state/actions';
import { startAccount } from './state/account';
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
import { Account } from './pages/Account';
import { Broadcast } from './pages/Broadcast';
import { Study } from './pages/Study';
import { Chat } from './pages/Chat';
import './styles/shell.css';
import './styles/ux.css';

interface NavItem {
  /** Unique key (several items can share `page`, e.g. the three Doppelgänger entries). */
  id: string;
  /** The route's top segment; also what groups items sharing one page for the active check. */
  page: string;
  /** The href target, including any sub-path. Defaults to `page` when built with navItem(). */
  path: string;
  /** Which first route param(s) this entry is active for. Omit to match `page` alone
   * (the old behaviour); '' means "no param". */
  sub?: string[];
  label: string;
  /** Label in the phone tab bar and the "More" sheet. */
  short: string;
  icon: IconName;
}

function navItem(page: string, label: string, short: string, icon: IconName, opts?: { path?: string; sub?: string[] }): NavItem {
  return { id: opts?.path ?? page, page, path: opts?.path ?? page, label, short, icon, sub: opts?.sub };
}

/** Whether a nav entry should show as the current page. */
function navActive(item: NavItem, current: string, params0: string) {
  return item.page === current && (item.sub === undefined || item.sub.includes(params0));
}

/* The app is mainly the study board (free AI analysis) and the Doppelgänger: those two and
 * Home come first everywhere, and are the only three tabs on a phone; the rest is in "More". */
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Main',
    items: [
      navItem('dashboard', 'Home', 'Home', 'home'),
      navItem('study', 'Study Board', 'Study board', 'kifu'),
      navItem('doppel', 'Doppelgänger', 'Doppelgänger', 'twin', { sub: ['', 'play'] }),
    ],
  },
  {
    label: 'Study',
    items: [
      navItem('library', 'Game Library', 'Games', 'library'),
      navItem('review', 'Game Review', 'Review', 'board'),
      navItem('chat', 'Go Coach Chat', 'Coach', 'chat'),
      navItem('live', 'Live AI Games', 'Live games', 'broadcast'),
      navItem('dna', 'Player DNA', 'Player DNA', 'dna'),
      navItem('doppel', 'The Copy', 'The Copy', 'stones', { path: 'doppel/copy', sub: ['copy'] }),
      navItem('doppel', 'Where It Differs', 'Where it differs', 'target', { path: 'doppel/differences', sub: ['differences'] }),
    ],
  },
  {
    label: 'Train',
    items: [
      navItem('forge', 'Forge', 'Forge', 'flame'),
      navItem('blind', 'Blind Tests', 'Blind tests', 'eyeOff'),
      navItem('search', 'Position Search', 'Search', 'search'),
    ],
  },
  {
    label: 'Prepare',
    items: [navItem('opponents', 'Opponents', 'Opponents', 'swords')],
  },
];
const SETTINGS_ITEM: NavItem = navItem('settings', 'Engine & Settings', 'Settings', 'sliders');
const ACCOUNT_ITEM: NavItem = navItem('account', 'Account & Sync', 'Account', 'user');
const ALL_ITEMS = [...NAV_GROUPS.flatMap((g) => g.items), ACCOUNT_ITEM, SETTINGS_ITEM];
/** The phone tab bar: the three main pages, bigger; everything else is in "More". */
const TABS = ['dashboard', 'study', 'doppel'];
const byPage = (page: string) => ALL_ITEMS.find((i) => i.page === page)!;
/** The phone tab for a page: the Doppelgänger tab covers only its play page, the rest of it is in More. */
const onTab = (current: string, params0: string) => TABS.includes(current) && (current !== 'doppel' || params0 === '' || params0 === 'play');

/** What the engine, the analysis queue and the LLM are doing, for the status card. */
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
  return { engDot, engineText, queueDot, queueText, analysing: queue.running && !!cur, llmDot, llmText };
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
  const route = useRoute();
  const on = navActive(item, current, route.params[0] ?? '');
  return (
    <a href={href(item.path)} className={`item ${on ? 'active' : ''}`} aria-current={on ? 'page' : undefined} title={item.label} style={{ '--i': ALL_ITEMS.indexOf(item) } as CSSProperties}>
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
  const params0 = route.params[0] ?? '';
  const rest = ALL_ITEMS.filter((i) => !TABS.includes(i.page) || (i.page === 'doppel' && i.sub && !i.sub.includes('')));
  const moreActive = !onTab(current, params0);
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
          const on = current === page && onTab(current, params0);
          return (
            <a key={page} href={href(page)} className={`tab main ${on ? 'on' : ''}`} aria-current={on ? 'page' : undefined}>
              <Icon name={it.icon} />
              <span>{it.short}</span>
            </a>
          );
        })}
        <button className={`tab more ${moreActive || sheet === 'open' ? 'on' : ''}`} aria-expanded={sheet === 'open'} aria-haspopup="dialog" onClick={() => setSheet(sheet === 'open' ? 'closing' : 'open')}>
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
                <a key={it.id} href={href(it.path)} className={`sheet-item ${navActive(it, current, params0) ? 'on' : ''}`} aria-current={navActive(it, current, params0) ? 'page' : undefined}>
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

const NAV_PREF = 'dop.navClosed';

/** Whether the sidebar is tucked away (desktop and tablet; phones use the tab bar). */
function useNavClosed() {
  const [closed, setClosed] = useState(() => {
    try {
      return localStorage.getItem(NAV_PREF) === '1';
    } catch {
      return false;
    }
  });
  const set = (v: boolean) => {
    setClosed(v);
    try {
      localStorage.setItem(NAV_PREF, v ? '1' : '0');
    } catch {
      /* private mode */
    }
  };
  // Ctrl/⌘ + B, as in most editors.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setClosed((c) => {
          try {
            localStorage.setItem(NAV_PREF, c ? '0' : '1');
          } catch {
            /* private mode */
          }
          return !c;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return [closed, set] as const;
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
  const [navClosed, setNavClosed] = useNavClosed();
  const savedTheme = useStore((s) => s.settings.theme) ?? 'sunrise';
  // Until the settings have loaded, keep the theme index.html already painted from this browser's copy.
  const [hint] = useState(storedTheme);
  const theme = loaded ? savedTheme : (hint ?? savedTheme);
  const onboarded = useStore((s) => s.settings.onboarded);
  const hasGames = useStore((s) => s.games.length > 0);
  useEffect(() => {
    void init();
  }, []);
  // The optional account: once the lab is open, see who is signed in and sync quietly.
  useEffect(() => {
    if (loaded) startAccount();
  }, [loaded]);
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
      case 'account':
        page = <Account />;
        break;
      case 'live':
        page = <Broadcast table={route.params[0]} />;
        break;
      case 'study':
        page = <Study id={route.params[0]} query={route.query} />;
        break;
      case 'chat':
        page = <Chat query={route.query} />;
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
          <div className={`shell ${loaded ? '' : 'booting'} ${navClosed ? 'nav-closed' : ''}`}>
            <nav className="nav" aria-label="Main" aria-hidden={navClosed || undefined} inert={navClosed || undefined}>
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
                      <NavLink key={it.id} item={it} current={current} />
                    ))}
                  </div>
                ))}
              </div>
              <div className="nav-foot">
                <NavLink item={ACCOUNT_ITEM} current={current} />
                <NavLink item={SETTINGS_ITEM} current={current} />
                <a className="item nav-about" href={href('welcome')} title="About DOPPELGÄNGER">
                  <Icon name="spark" />
                  <span className="item-label">About</span>
                </a>
                <button className="item nav-about nav-collapse" onClick={() => setNavClosed(true)} title="Hide the sidebar (Ctrl+B)">
                  <Icon name="sidebar" />
                  <span className="item-label">Hide sidebar</span>
                </button>
                <StatusCard />
              </div>
            </nav>
            {loaded && (
              <button className="nav-reopen" onClick={() => setNavClosed(false)} title="Show the sidebar (Ctrl+B)" aria-label="Show the sidebar" tabIndex={navClosed ? 0 : -1}>
                <BrandMark />
                <span className="nav-reopen-chev" aria-hidden>
                  ›
                </span>
              </button>
            )}
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
