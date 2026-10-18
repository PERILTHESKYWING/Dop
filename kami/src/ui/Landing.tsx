import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Board, type Mark } from '../../../src/components/Board';
import { gtpToLoc } from '../../../src/lib/go/coords';
import { Depth } from './Depth';
import { DEMO } from './landingDemo';
import { Logo } from './Logo';
import { KIAI_SKIN } from './skin';
import './landing.css';

/**
 * Kiai's front door: three seconds of Ikki diving through the sky, then the board above the
 * clouds and what Kiai is. Every image is a path-traced render from tools/kiai-art; the answer in
 * "A real answer" is Kiai's own, generated from the position on the board (landingDemo.ts).
 */
const ART = '/kiai';
const COORD = /\b([A-HJ-T](?:1[0-9]|[1-9]))\b/g;

function seenIntro(): boolean {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    return sessionStorage.getItem('kiai.intro') === '1';
  } catch {
    return false;
  }
}
function markIntro() {
  try {
    sessionStorage.setItem('kiai.intro', '1');
  } catch {
    /* private mode */
  }
}

/** The opening shot. Ends on its own after ~3 s; any failure to load or play skips it. */
function Intro({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    markIntro();
    setLeaving(true);
    window.setTimeout(onDone, 650);
  };
  useEffect(() => {
    const v = video.current;
    // If it has not started within 2.5 s (slow network, autoplay refused), go straight to the page.
    const stall = window.setTimeout(() => {
      if (!v || v.currentTime === 0) finish();
    }, 2500);
    const cap = window.setTimeout(finish, 6000);
    v?.play().catch(finish);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish();
    };
    window.addEventListener('keydown', key);
    return () => {
      window.clearTimeout(stall);
      window.clearTimeout(cap);
      window.removeEventListener('keydown', key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={`l-intro${leaving ? ' out' : ''}`} aria-hidden={leaving}>
      <video ref={video} src={`${ART}/flight.mp4`} poster={`${ART}/flight-poster.webp`} muted playsInline preload="auto" onEnded={finish} onError={finish} />
      <button type="button" className="l-skip" onClick={finish}>
        Skip
      </button>
    </div>
  );
}

/** A thin dive gauge down the left edge: how deep you have read, 0 to 120 m. */
function Gauge() {
  const [depth, setDepth] = useState(0);
  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setDepth(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => {
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  const metres = Math.round(depth * 120);
  return (
    <div className="l-gauge" aria-hidden="true">
      <div className="l-gauge-track">
        {Array.from({ length: 13 }, (_, i) => (
          <span key={i} className={`l-tick${i % 3 === 0 ? ' major' : ''}`} style={{ top: `${(i / 12) * 100}%` }} />
        ))}
        <span className="l-gauge-mark" style={{ top: `${depth * 100}%` }}>
          <span className="l-gauge-read">{metres} m</span>
        </span>
      </div>
    </div>
  );
}

/** The answer's text with every board coordinate as a hover target that lights up on the board. */
function Rich({ text, onPoint }: { text: string; onPoint: (gtp: string | null) => void }) {
  const parts = text.split(COORD);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <button key={i} type="button" className="l-coord" onMouseEnter={() => onPoint(p)} onMouseLeave={() => onPoint(null)} onFocus={() => onPoint(p)} onBlur={() => onPoint(null)}>
            {p}
          </button>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

export default function Landing({ onEnter }: { onEnter: () => void }) {
  const [intro, setIntro] = useState(() => !seenIntro());
  const [solid, setSolid] = useState(false);
  const [point, setPoint] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('kiai-landing');
    const meta = document.querySelector('meta[name="theme-color"]');
    const was = meta?.getAttribute('content');
    meta?.setAttribute('content', '#f4f8fc');
    return () => {
      document.documentElement.classList.remove('kiai-landing');
      if (meta && was) meta.setAttribute('content', was);
    };
  }, []);
  useEffect(() => {
    // no scrolling under the opening shot
    document.documentElement.classList.toggle('kiai-hold', intro);
    return () => document.documentElement.classList.remove('kiai-hold');
  }, [intro]);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 24);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  const stones = useMemo(() => {
    const s = new Array<number>(361).fill(0);
    for (const [gtp, c] of DEMO.stones) s[gtpToLoc(gtp, 19)] = c;
    return s;
  }, []);
  const marks = useMemo<Mark[]>(() => {
    const m: Mark[] = [{ loc: gtpToLoc(DEMO.asked, 19), kind: 'best' }];
    if (point && point !== DEMO.asked) m.push({ loc: gtpToLoc(point, 19), kind: 'cand' });
    return m;
  }, [point]);

  const go = (e?: React.MouseEvent) => {
    e?.preventDefault();
    onEnter();
  };

  return (
    <div className="landing">
      {intro && <Intro onDone={() => setIntro(false)} />}
      <Gauge />

      <header className={`l-nav${solid ? ' solid' : ''}`}>
        <a className="l-brand" href="#welcome" aria-label="Kiai">
          <Logo size={30} tile />
          <span>Kiai</span>
        </a>
        <nav className="l-links" aria-label="Sections">
          <a href="#answer">How it reads</a>
          <a href="#depths">Depths</a>
          <a href="#ikki">Ikki</a>
        </nav>
        <a className="l-btn small" href="/" onClick={go}>
          Open Kiai
        </a>
      </header>

      <section className="l-hero" aria-labelledby="l-title">
        <picture className="l-hero-art">
          <source media="(max-width: 720px)" srcSet={`${ART}/hero-tall.webp`} />
          <img src={`${ART}/hero.webp`} alt="A kaya Go board in the middle of a real game, slate and shell stones, on a stone table above a sea of clouds" />
        </picture>
        <div className="l-hero-copy">
          <h1 id="l-title">Read deeper.</h1>
          <p className="l-lead">
            Kiai is a Go AI you talk to. Set up any position and ask: KataGo reads it on your own device, and Kiai answers in plain words, with every number taken
            straight from the engine.
          </p>
          <div className="l-actions">
            <a className="l-btn" href="/" onClick={go}>
              Ask about a position
            </a>
            <a className="l-btn ghost" href="#answer">
              See a real answer
            </a>
          </div>
        </div>
        <figure className="l-chip" aria-label="A question and the start of Kiai's answer">
          <p className="l-q">{DEMO.question}</p>
          <p className="l-a">
            <Logo size={22} tile />
            <span>{DEMO.teaser}</span>
          </p>
        </figure>
      </section>

      <section className="l-sec" id="answer" aria-labelledby="l-answer">
        <div className="l-head">
          <p className="l-kicker">How it reads</p>
          <h2 id="l-answer">Ask the way you would ask a strong player.</h2>
          <p className="l-sub">Point at a move, ask why, ask what else. Kiai reads the position with KataGo first and only then puts it into words.</p>
        </div>
        <div className="l-demo">
          <div className="l-board">
            <Board size={19} stones={stones} lastMove={gtpToLoc(DEMO.last, 19)} marks={marks} coords skin={KIAI_SKIN} animate={false} ariaLabel="The position in the example" />
          </div>
          <div className="l-convo">
            <div className="l-msg you">{DEMO.question}</div>
            <div className="l-msg kiai">
              <div className="l-who">
                <Logo size={22} tile />
                <span>Kiai</span>
                <span className="l-model">{DEMO.model}</span>
              </div>
              {DEMO.answer.map((para, i) => (
                <p key={i}>
                  <Rich text={para} onPoint={setPoint} />
                </p>
              ))}
              <p className="l-foot">{DEMO.footnote}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="l-sec l-alt" id="depths" aria-labelledby="l-depths">
        <div className="l-head">
          <p className="l-kicker">Depths</p>
          <h2 id="l-depths">Three depths of reading.</h2>
          <p className="l-sub">Pick how far Kiai looks before it speaks. The analysis is always KataGo's; only the time it takes and the wording change.</p>
        </div>
        <ol className="l-depth-list">
          <li>
            <span className="l-depth-m">
              <Depth id="hane" size={30} />
              Skim
            </span>
            <span className="l-depth-t">Instant. KataGo’s first look: the best moves, who leads and by how much.</span>
          </li>
          <li>
            <span className="l-depth-m">
              <Depth id="tesuji" size={30} />
              Dive
            </span>
            <span className="l-depth-t">Reads ahead and shows why: the lines that matter, drawn on the board, and what goes wrong otherwise.</span>
          </li>
          <li>
            <span className="l-depth-m">
              <Depth id="myoshu" size={30} />
              Abyss
            </span>
            <span className="l-depth-t">The deepest read, in the richest words. Gemini does the wording when it is switched on; the analysis is still all KataGo’s.</span>
          </li>
        </ol>
      </section>

      <section className="l-sec l-device" aria-labelledby="l-device">
        <figure className="l-macro">
          <img src={`${ART}/macro.webp`} alt="Close-up of slate and clamshell stones on kaya" loading="lazy" />
        </figure>
        <div className="l-head">
          <p className="l-kicker">On your device</p>
          <h2 id="l-device">The engine comes to you.</h2>
          <p className="l-sub">
            KataGo, the open-source engine strong players study with, runs inside your browser. The reading happens on your machine, chats are saved only in this
            browser, and there is no account to make.
          </p>
          <ul className="l-facts">
            <li>
              <b>KataGo</b>
              <span>open-source engine, MIT licence</span>
            </li>
            <li>
              <b>11 MB</b>
              <span>network bundled, so it reads offline once loaded</span>
            </li>
            <li>
              <b>No sign-up</b>
              <span>open it and ask</span>
            </li>
          </ul>
        </div>
      </section>

      <section className="l-sec l-ikki" id="ikki" aria-labelledby="l-ikki">
        <figure className="l-ikki-art">
          <img src={`${ART}/flight-poster.webp`} alt="Ikki the razorbill in fast flight above the clouds" loading="lazy" />
        </figure>
        <div className="l-head">
          <p className="l-kicker">Meet Ikki</p>
          <h2 id="l-ikki">Fast over the surface. Deep when it counts.</h2>
          <p className="l-sub">
            Ikki is a razorbill, the North Atlantic seabird that skims low over the waves, then folds its wings and dives. Razorbills have been recorded 120 metres down. Kiai
            reads a position the same way: a quick look first, then as deep as the question needs.
          </p>
        </div>
      </section>

      <section className="l-cta" aria-labelledby="l-cta">
        <Logo size={64} tile />
        <h2 id="l-cta">Set up a position.</h2>
        <a className="l-btn" href="/" onClick={go}>
          Open Kiai
        </a>
      </section>

      <footer className="l-footer">
        <span>Kiai. Analysis by KataGo. Board, stones and Ikki are path-traced renders.</span>
        <span>
          <a href="https://github.com/lightvector/KataGo" target="_blank" rel="noreferrer">
            KataGo
          </a>
          <a href="https://github.com/PERILTHESKYWING/Dop/blob/main/THIRD_PARTY_NOTICES.md" target="_blank" rel="noreferrer">
            Notices
          </a>
          <a href="https://github.com/PERILTHESKYWING/Dop" target="_blank" rel="noreferrer">
            Source
          </a>
        </span>
      </footer>
    </div>
  );
}
