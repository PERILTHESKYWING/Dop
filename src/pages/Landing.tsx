import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type ReactNode, type RefObject } from 'react';
import { toast, useStore } from '../state/store';
import { importFiles, loadDemo, saveSettings } from '../state/actions';
import { Board, cropAround, shortCount, type Mark } from '../components/Board';
import { WinBar } from '../components/Analysis';
import { candidateMarks, type ShownCandidate } from '../components/Live';
import { BrandMark, Icon, type IconName } from '../components/Icons';
import { BrandSpinner } from '../components/Brand';
import { switchTheme } from '../components/Scenery';
import { THEMES, type ThemeId } from '../lib/themes';
import { replay } from '../lib/go/board';
import { locToGtp } from '../lib/go/coords';
import { go, href } from '../router';
import './landing.css';

/*
 * The landing page: what DOPPELGÄNGER is, shown with the app's own pieces (the board,
 * candidate discs, the winrate bar) on a position from the bundled demo games. It opens on
 * the first visit and stays reachable at #/welcome.
 */

const SIZE = 19;
/** Mira vs Arin (demo game), the first 54 moves. Black (Mira) is to play move 55. */
const SHOW_MOVES = [
  307, 72, 300, 41, 249, 97, 54, 73, 53, 51, 52, 71, 32, 320, 319, 301, 263, 282, 281, 264, 339, 340, 283, 338, 321, 358, 302, 339, 245, 262, 244, 316, 317, 318, 298,
  336, 299, 337, 50, 70, 55, 148, 111, 110, 129, 130, 128, 112, 149, 131, 167, 297, 261, 243,
];
/** Where Mira played (R15). */
const SHOW_PLAYED = 92;
/**
 * KataGo's candidates in that position (winrate and score for Black, from the demo analysis).
 * `visits` is where the animated search ends up; `k` shapes how early a move attracts visits
 * (moves the network likes at first are explored early, the real best move overtakes later).
 */
const SHOW_CANDS = [
  { loc: 242, winrate: 0.5869, scoreLead: 1.26, visits: 1620, k: 1.45, bias: -0.075 },
  { loc: 241, winrate: 0.4759, scoreLead: -0.39, visits: 540, k: 0.45, bias: 0.07 },
  { loc: 223, winrate: 0.4913, scoreLead: 0.03, visits: 430, k: 1.1, bias: 0.02 },
  { loc: 260, winrate: 0.4711, scoreLead: -0.45, visits: 310, k: 0.8, bias: 0.035 },
  { loc: 147, winrate: 0.4401, scoreLead: -0.86, visits: 180, k: 0.9, bias: 0.03 },
  { loc: 92, winrate: 0.2761, scoreLead: -4.37, visits: 40, k: 1.3, bias: 0.08 },
];
const SEARCH_SECONDS = 7;
/** The showcase zooms in on the right side, where the fight and all the candidates are. */
const DESK_CROP = { x0: 6, y0: 1, x1: 18, y1: 14 };
const PHONE_CROP = { x0: 8, y0: 1, x1: 18, y1: 14 };

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function useMedia(query: string) {
  const [on, setOn] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(query);
    const f = () => setOn(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [query]);
  return on;
}

/** The candidates after `s` seconds of the (replayed) search. */
function searchAt(s: number): ShownCandidate[] {
  const p = Math.max(0, Math.min(1, s / SEARCH_SECONDS));
  const settle = 1 - Math.pow(1 - p, 3);
  const after = Math.max(0, s - SEARCH_SECONDS);
  const grow = 1 + Math.min(5, after * 0.018);
  return SHOW_CANDS.map((c, i) => {
    const visits = Math.floor(c.visits * Math.pow(p, c.k) * grow);
    const wobble = 0.014 * (1 - settle) * Math.sin(s * 3.1 + i * 1.7) + 0.0016 * Math.sin(s * 1.3 + i * 2.3);
    const drift = c.bias * Math.pow(1 - settle, 1.5);
    return {
      loc: c.loc,
      visits,
      winrate: Math.max(0.01, Math.min(0.99, c.winrate + drift + wobble)),
      scoreLead: c.scoreLead + (drift + wobble) * 14,
      prior: 0,
      pv: [c.loc],
    };
  })
    .filter((c) => c.visits > 0)
    .sort((a, b) => b.visits - a.visits);
}

/** Seconds since the showcase came into view (frozen at the end with reduced motion). */
function useSearchClock(el: RefObject<HTMLElement | null>) {
  const [s, setS] = useState(() => (reducedMotion() ? SEARCH_SECONDS : 0));
  useEffect(() => {
    if (reducedMotion()) return;
    const node = el.current;
    let visible = false;
    let elapsed = 0;
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const now = performance.now();
      if (visible && !document.hidden) elapsed += (now - last) / 1000;
      last = now;
      setS(Math.max(0, elapsed - 0.7));
      timer = setTimeout(tick, elapsed < SEARCH_SECONDS + 1 ? 180 : 650);
    };
    last = performance.now();
    tick();
    const io =
      node && 'IntersectionObserver' in window
        ? new IntersectionObserver((es) => {
            visible = es.some((e) => e.isIntersecting);
          })
        : null;
    if (io && node) io.observe(node);
    else visible = true;
    return () => {
      clearTimeout(timer);
      io?.disconnect();
    };
  }, [el]);
  return s;
}

/** Adds `.in` to each `.reveal` element as it scrolls into view. */
function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const els = root.current ? [...root.current.querySelectorAll<HTMLElement>('.reveal')] : [];
    if (!els.length) return;
    if (reducedMotion() || !('IntersectionObserver' in window)) {
      els.forEach((e) => e.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [root]);
}

// ------------------------------------------------------------------ small glyphs (landing only)

const GLYPHS: Record<string, JSX.Element> = {
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.4" />
      <path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7" />
      <path d="M12 14.6v2.2" />
    </>
  ),
  device: (
    <>
      <rect x="3.5" y="5" width="17" height="11.5" rx="2" />
      <path d="M9 20h6M12 16.5V20" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M5 20c.9-3.6 3.7-5.6 7-5.6s6.1 2 7 5.6" />
      <path d="M4 4l16 16" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l8-8M16 7l2.5 2.5M14 9l2 2" />
    </>
  ),
  sigma: <path d="M17 5H7l6 7-6 7h10" />,
};

function Glyph({ name, className }: { name: keyof typeof GLYPHS; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {GLYPHS[name]}
    </svg>
  );
}

// ------------------------------------------------------------------ showcase: live analysis

function LiveShowcase() {
  const ref = useRef<HTMLDivElement>(null);
  const s = useSearchClock(ref);
  const phone = useMedia('(max-width: 640px)');
  const stones = useMemo(
    () =>
      replay(
        SIZE,
        [],
        SHOW_MOVES.map((loc, i) => ({ color: i % 2 ? 2 : 1, loc }) as const),
      ).stones,
    [],
  );
  const cands = useMemo(() => searchAt(s), [s]);
  const marks = useMemo(() => candidateMarks(cands), [cands]);
  const total = cands.reduce((a, c) => a + c.visits, 0);
  const top = cands[0];
  const played = SHOW_CANDS.find((c) => c.loc === SHOW_PLAYED)!;
  const best = SHOW_CANDS[0];
  const searching = s < SEARCH_SECONDS;
  return (
    <div className="lp-stage" ref={ref}>
      <div className="lp-board-card">
        <div className="lp-board-head">
          <span className="lp-live">
            <i data-on={total > 0 ? '1' : '0'} /> Live
          </span>
          <span className="lp-board-game">Mira vs Arin · move 55</span>
          <span className="lp-visits">{total ? `${shortCount(total)} visits` : 'starting'}</span>
        </div>
        <div className={`lp-board ${phone ? 'phone' : ''}`}>
          <Board
            size={SIZE}
            stones={stones}
            lastMove={SHOW_MOVES[SHOW_MOVES.length - 1]}
            candidates={marks}
            crop={phone ? PHONE_CROP : DESK_CROP}
            detail="full"
            ariaLabel="Demo position, KataGo candidates"
          />
        </div>
        <div className="lp-board-foot">
          <WinBar bWin={top ? top.winrate : null} bLead={top ? top.scoreLead : null} pending={!top} />
        </div>
      </div>
      <div className={`lp-float lp-float-best ${!searching ? 'show' : ''}`}>
        <span className="lp-disc best" />
        <span>
          <strong>KataGo {locToGtp(best.loc, SIZE)}</strong>
          <small>B {(best.winrate * 100).toFixed(1)}%</small>
        </span>
      </div>
      <div className={`lp-float lp-float-you ${!searching ? 'show' : ''}`}>
        <span className="lp-disc you" />
        <span>
          <strong>Played {locToGtp(SHOW_PLAYED, SIZE)}</strong>
          <small>−{(best.scoreLead - played.scoreLead).toFixed(1)} pts</small>
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ showcase: features

const DUO_STONES = replay(
  SIZE,
  [],
  SHOW_MOVES.map((loc, i) => ({ color: i % 2 ? 2 : 1, loc }) as const),
).stones;

function CopyVisual() {
  const crop = useMemo(() => cropAround([SHOW_PLAYED, 242], SIZE, 4), []);
  const marks: Mark[] = [
    { loc: SHOW_PLAYED, kind: 'doppel', label: 'D' },
    { loc: 242, kind: 'best', label: 'K' },
  ];
  return (
    <div className="lp-copy-visual">
      <div className="lp-mini-board">
        <Board size={SIZE} stones={DUO_STONES} marks={marks} crop={crop} lastMove={243} animate={false} ariaLabel="Copy vs KataGo" />
      </div>
      <div className="lp-copy-bars">
        <div className="lp-copy-row">
          <span className="lp-tag doppel">D</span>
          <span>
            <strong>Your copy</strong>
            <small>your likely move</small>
          </span>
        </div>
        <div className="lp-copy-row">
          <span className="lp-tag kata">K</span>
          <span>
            <strong>KataGo</strong>
            <small>best move</small>
          </span>
        </div>
        <p className="lp-note">The gap is your lost points.</p>
      </div>
    </div>
  );
}

const DNA_AXES: [string, number][] = [
  ['Opening', 0.88],
  ['Fighting', 0.48],
  ['Territory', 0.68],
  ['Endgame', 0.38],
  ['Tactics', 0.48],
  ['Direction', 0.62],
];

function DnaVisual() {
  const c = 100;
  const R = 66;
  const pt = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / DNA_AXES.length;
    return [c + Math.cos(a) * r, c + Math.sin(a) * r] as const;
  };
  const ring = (f: number) =>
    DNA_AXES.map((_, i) => pt(i, R * f))
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');
  const shape = DNA_AXES.map(([, v], i) => pt(i, R * v))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
  return (
    <svg className="lp-radar" viewBox="0 0 200 200" role="img" aria-label="Player DNA radar">
      <defs>
        <linearGradient id="lp-radar-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'rgb(var(--accent-rgb, 255 142 82))', stopOpacity: 0.7 }} />
          <stop offset="1" style={{ stopColor: 'rgb(var(--accent-end-rgb, 240 86 111))', stopOpacity: 0.5 }} />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} className="lp-radar-ring" points={ring(f)} />
      ))}
      {DNA_AXES.map((_, i) => {
        const [x, y] = pt(i, R);
        return <line key={i} className="lp-radar-ring" x1={c} y1={c} x2={x} y2={y} />;
      })}
      <g className="lp-radar-shape">
        <polygon points={shape} />
        {DNA_AXES.map(([, v], i) => {
          const [x, y] = pt(i, R * v);
          return <circle key={i} cx={x} cy={y} r="3" />;
        })}
      </g>
      {DNA_AXES.map(([label], i) => {
        const [x, y] = pt(i, R + 17);
        return (
          <text key={label} className="lp-radar-label" x={x} y={y}>
            {label}
          </text>
        );
      })}
    </svg>
  );
}

function ForgeVisual() {
  const crop = useMemo(() => cropAround([241, 242, 243], SIZE, 3), []);
  const marks: Mark[] = [
    { loc: 223, kind: 'played' },
    { loc: 242, kind: 'best' },
  ];
  return (
    <div className="lp-forge-visual">
      <div className="lp-mini-board small">
        <Board size={SIZE} stones={DUO_STONES} marks={marks} crop={crop} lastMove={243} animate={false} ariaLabel="Training position" />
      </div>
      <div className="lp-forge-side">
        <span className="lp-grade">
          <Icon name="check" /> Correct
        </span>
        <div className="lp-meter" aria-label="Mastery 72%">
          <span style={{ '--v': 0.72 } as CSSProperties} />
        </div>
        <small>mastery</small>
      </div>
    </div>
  );
}

function BlindVisual() {
  const results = [1, 1, 0, 1, 1, 1, 0, 1, 1, 1];
  const right = results.filter(Boolean).length;
  const C = 2 * Math.PI * 34;
  return (
    <div className="lp-blind-visual">
      <svg className="lp-ring" viewBox="0 0 84 84" aria-hidden>
        <circle cx="42" cy="42" r="34" className="lp-ring-track" />
        <circle cx="42" cy="42" r="34" className="lp-ring-value" strokeDasharray={`${(C * right) / results.length} ${C}`} />
      </svg>
      <div className="lp-ring-label">
        <strong>
          {right}/{results.length}
        </strong>
        <small>correct</small>
      </div>
      <div className="lp-blind-dots">
        {results.map((r, i) => (
          <i key={i} className={r ? 'ok' : 'miss'} style={{ '--i': i } as CSSProperties} />
        ))}
      </div>
    </div>
  );
}

function Feature({ icon, eyebrow, title, children, visual, className }: { icon: IconName; eyebrow: string; title: string; children: ReactNode; visual: ReactNode; className?: string }) {
  return (
    <article className={`lp-feature reveal ${className ?? ''}`}>
      <div className="lp-feature-text">
        <div className="lp-eyebrow">
          <span className="lp-ico">
            <Icon name={icon} />
          </span>
          {eyebrow}
        </div>
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
      <div className="lp-feature-visual">{visual}</div>
    </article>
  );
}

// ------------------------------------------------------------------ page

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'upload', title: 'Import', text: 'Drop your SGF files.' },
  { icon: 'board', title: 'Analyse', text: 'KataGo reads every move on your GPU or CPU.' },
  { icon: 'dna', title: 'Profile', text: 'Your style, repeat mistakes and a copy of you.' },
  { icon: 'flame', title: 'Train', text: 'Drill each weakness, then test it blind.' },
];

const PRIVACY: { glyph: keyof typeof GLYPHS; title: string; text: string }[] = [
  { glyph: 'device', title: 'On this device', text: 'Nothing is uploaded.' },
  { glyph: 'user', title: 'No account', text: 'No sign-up or tracking.' },
  { glyph: 'key', title: 'Keys on the server', text: 'The optional LLM key never reaches the browser.' },
  { glyph: 'sigma', title: 'Numbers from KataGo', text: 'The LLM only names patterns.' },
];

function ThemePicker({ compact }: { compact?: boolean }) {
  const theme = useStore((s) => s.settings.theme) ?? 'sunrise';
  const pick = (id: ThemeId) => void switchTheme(id);
  if (compact)
    return (
      <div className="lp-swatches" role="radiogroup" aria-label="Background theme">
        {THEMES.map((t) => (
          <button key={t.id} role="radio" aria-checked={theme === t.id} className={`lp-swatch sw-${t.id} ${theme === t.id ? 'on' : ''}`} title={t.name} onClick={() => pick(t.id)}>
            <span className="sr-only">{t.name}</span>
          </button>
        ))}
      </div>
    );
  return (
    <div className="lp-themes" role="radiogroup" aria-label="Background theme">
      {THEMES.map((t, i) => (
        <button
          key={t.id}
          role="radio"
          aria-checked={theme === t.id}
          className={`lp-theme reveal ${theme === t.id ? 'on' : ''}`}
          style={{ '--d': `${i * 0.07}s` } as CSSProperties}
          onClick={() => pick(t.id)}
        >
          <span className={`lp-theme-art sw-${t.id}`}>
            {theme === t.id && (
              <span className="lp-theme-check">
                <Icon name="check" />
              </span>
            )}
          </span>
          <strong>{t.name}</strong>
          <small>{t.description}</small>
        </button>
      ))}
    </div>
  );
}

export function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const games = useStore((s) => s.games);
  const onboarded = useStore((s) => s.settings.onboarded);
  const [busy, setBusy] = useState<null | 'import' | 'demo'>(null);
  const [drag, setDrag] = useState(false);
  const returning = onboarded || games.length > 0;
  const hasDemo = games.some((g) => g.source === 'demo');
  useReveal(root);

  const enter = async () => {
    if (!useStore.getState().settings.onboarded) await saveSettings({ onboarded: true });
    go('dashboard');
  };
  const onFiles = async (files: File[]) => {
    if (!files.length || busy) return;
    setBusy('import');
    try {
      const { imported } = await importFiles(files);
      if (imported) await enter();
    } catch (e) {
      toast(`Import failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };
  const demo = async () => {
    if (busy) return;
    setBusy('demo');
    try {
      await loadDemo();
      await enter();
    } catch (e) {
      toast(`Demo failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };
  const pickFiles = () => input.current?.click();
  const scrollTo = (id: string) => root.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });

  const importBtn = (primary: boolean, label = 'Import games') => (
    <button className={`btn big ${primary ? 'primary' : ''}`} onClick={pickFiles} disabled={!!busy}>
      {busy === 'import' ? <BrandSpinner /> : <Icon name="upload" />} {busy === 'import' ? 'Importing' : label}
    </button>
  );
  const demoBtn = (
    <button className="btn big" onClick={() => void demo()} disabled={!!busy}>
      {busy === 'demo' ? <BrandSpinner /> : <Icon name="stones" />} {busy === 'demo' ? 'Loading' : 'Demo'}
    </button>
  );
  const labBtn = (primary: boolean) => (
    <button className={`btn big ${primary ? 'primary' : 'lp-quiet'}`} onClick={() => void enter()} disabled={!!busy}>
      Open lab <Glyph name="arrow" />
    </button>
  );

  return (
    <div
      className={`lp ${drag ? 'dragging' : ''}`}
      ref={root}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        void onFiles([...e.dataTransfer.files]);
      }}
    >
      {/* No accept filter: iOS and many Android pickers grey out .sgf files when one is set. */}
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          void onFiles(files);
        }}
      />

      <header className="lp-top">
        <a className="lp-brand" href={href('welcome')} onClick={(e) => (e.preventDefault(), root.current?.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }))}>
          <BrandMark className="brand-mark lp-brand-mark" />
          <span>DOPPELGÄNGER</span>
        </a>
        <nav className="lp-links" aria-label="Sections">
          <button onClick={() => scrollTo('features')}>Features</button>
          <button onClick={() => scrollTo('how')}>How</button>
          <button onClick={() => scrollTo('privacy')}>Privacy</button>
        </nav>
        <div className="lp-top-end">
          <ThemePicker compact />
          <button className="btn small lp-top-cta" onClick={() => void enter()}>
            Open lab <Glyph name="arrow" />
          </button>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-text lp-halo">
          <div className="lp-hero-brand">
            <BrandMark className="brand-mark lp-mark" />
            <span className="lp-kicker">Go training</span>
          </div>
          <h1 className="lp-title">DOPPELGÄNGER</h1>
          <p className="lp-tagline">
            Find <em>your</em> repeat mistakes. Train them out.
          </p>
          <p className="lp-promise">KataGo reviews your games in the browser and drills the habits that cost you points.</p>
          <div className="lp-cta">
            {returning ? (
              <>
                {labBtn(true)}
                {importBtn(false, 'Import games')}
                {!hasDemo && demoBtn}
              </>
            ) : (
              <>
                {importBtn(true)}
                {demoBtn}
                {labBtn(false)}
              </>
            )}
          </div>
          <ul className="lp-trust">
            <li>
              <Glyph name="lock" /> Local
            </li>
            <li>
              <Icon name="cpu" /> In-browser KataGo
            </li>
            <li>
              <Glyph name="user" /> No account
            </li>
          </ul>
        </div>
        <LiveShowcase />
        <button className="lp-scroll" onClick={() => scrollTo('features')} aria-label="Features">
          <Glyph name="down" />
        </button>
      </section>

      <section className="lp-section" id="features">
        <div className="lp-head lp-halo">
          <div className="lp-eyebrow-lg reveal">Features</div>
          <h2 className="reveal">Built from your own games.</h2>
        </div>
        <div className="lp-bento">
          <Feature className="wide" icon="twin" eyebrow="Doppelgänger" title="A copy of you" visual={<CopyVisual />}>
            Predicts your moves and plays in your style. Compare it with KataGo.
          </Feature>
          <Feature icon="dna" eyebrow="Player DNA" title="Your style" visual={<DnaVisual />}>
            Accuracy by area and phase.
          </Feature>
          <Feature icon="flame" eyebrow="Forge" title="Drill weaknesses" visual={<ForgeVisual />}>
            Your own positions. Pick a move, see KataGo’s.
          </Feature>
          <Feature icon="eyeOff" eyebrow="Blind tests" title="Check progress" visual={<BlindVisual />}>
            Fresh positions, no hints, a real statistical check.
          </Feature>
          <article className="lp-feature lp-also reveal">
            <div className="lp-feature-text">
              <div className="lp-eyebrow">
                <span className="lp-ico">
                  <Icon name="spark" />
                </span>
                More tools
              </div>
              <ul className="lp-also-list">
                <li>
                  <Icon name="board" />
                  <span>
                    <strong>Game Review</strong> with live analysis
                  </span>
                </li>
                <li>
                  <Icon name="search" />
                  <span>
                    <strong>Position Search</strong>
                  </span>
                </li>
                <li>
                  <Icon name="swords" />
                  <span>
                    <strong>Opponent profiles</strong>
                  </span>
                </li>
              </ul>
            </div>
          </article>
        </div>
      </section>

      <section className="lp-section" id="how">
        <div className="lp-head lp-halo">
          <div className="lp-eyebrow-lg reveal">How</div>
          <h2 className="reveal">SGFs in, training plan out.</h2>
        </div>
        <ol className="lp-steps">
          {STEPS.map((st, i) => (
            <li key={st.title} className="lp-step reveal" style={{ '--d': `${i * 0.09}s` } as CSSProperties}>
              <span className="lp-step-n">{i + 1}</span>
              <span className="lp-step-ico">
                <Icon name={st.icon} />
              </span>
              <strong>{st.title}</strong>
              <p>{st.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="lp-section">
        <div className="lp-head lp-halo">
          <div className="lp-eyebrow-lg reveal">Theme</div>
          <h2 className="reveal">Pick a backdrop.</h2>
        </div>
        <ThemePicker />
      </section>

      <section className="lp-section" id="privacy">
        <div className="lp-privacy reveal">
          <div className="lp-privacy-lead">
            <span className="lp-lock">
              <Glyph name="lock" />
            </span>
            <div className="lp-eyebrow-lg">Privacy</div>
            <h2>Your games stay in this browser.</h2>
          </div>
          <ul className="lp-privacy-list">
            {PRIVACY.map((p) => (
              <li key={p.title}>
                <span className="lp-ico">
                  <Glyph name={p.glyph} />
                </span>
                <span>
                  <strong>{p.title}</strong>
                  <small>{p.text}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lp-final lp-halo">
        <BrandMark className="brand-mark lp-final-mark" />
        <h2 className="reveal">Start with your games.</h2>
        <div className="lp-cta center reveal">
          {returning ? labBtn(true) : importBtn(true)}
          {!hasDemo ? demoBtn : returning ? importBtn(false, 'Import games') : labBtn(false)}
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-foot-brand">
          <BrandMark className="brand-mark lp-foot-mark" />
          <span>
            <strong>DOPPELGÄNGER</strong>
            <small>Go training lab</small>
          </span>
        </div>
        <nav className="lp-foot-links" aria-label="Footer">
          <button onClick={() => void enter()}>Open lab</button>
          <a href={href('settings')} onClick={() => void saveSettings({ onboarded: true })}>
            Settings
          </a>
          <a href="/engine/LICENSE-KataGo.txt" target="_blank" rel="noreferrer">
            KataGo licence
          </a>
        </nav>
        <p className="lp-credit">Analysis by KataGo (David J Wu and contributors) via katago-webgpu.</p>
      </footer>

      {drag && (
        <div className="lp-drop" aria-hidden>
          <div>
            <Icon name="upload" />
            <strong>Drop SGF files</strong>
          </div>
        </div>
      )}
    </div>
  );
}
