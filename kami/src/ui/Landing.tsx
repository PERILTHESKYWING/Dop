import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { markReady } from '../lib/ready';
import { ChanceBar, GameChart, LineDiagram, ReadingChart } from './landing/Charts';
import type { Box } from './landing/camera';
import type { Show } from './landing/Stage';
import { ASK, CHAPTERS, COLOPHON, LINE, PICK, READS } from './landing/story';
import { Calligraphy, Logo } from './Logo';
import './landing.css';

// three.js is large (about 140 kB gzipped): the words on their paper paint first, and it loads
// once the page is idle or the reader first moves
// (a failed download falls back to the flat board rather than a blank page)
const Stage = lazy(() => import('./landing/Stage').catch(() => import('./landing/FlatStage') as unknown as Promise<typeof import('./landing/Stage')>));
// no WebGL, or only a software one (it takes the main thread for many seconds): the flat board
const FlatStage = lazy(() => import('./landing/FlatStage'));

/** Runs `fn` once the browser is idle (or after `ms` at the latest). */
function whenIdle(fn: () => void, ms: number): () => void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: ms });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = window.setTimeout(fn, Math.min(ms, 200));
  return () => window.clearTimeout(t);
}

/**
 * Whether the live 3D board should run here: WebGL that a graphics card draws. A WebGL drawn on
 * the CPU (SwiftShader, llvmpipe) would take the main thread for seconds, so those get the flat
 * board; `?kiai3d` keeps the live board anyway (for testing it on such a machine).
 */
function liveGl(): boolean {
  if (/[?&]kiai3d\b/.test(location.search)) return true;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    let soft = false;
    try {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      soft = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER)));
    } catch {
      /* keep the live board */
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return !soft;
  } catch {
    return false;
  }
}

const reduced = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * Kiai's front door: one live picture (the kaya board lying on washi paper) that stays
 * put while the page scrolls through six short chapters. The scroll moves the camera; each
 * chapter's words appear only once the camera has arrived and are gone before the next ones come,
 * so nothing ever overlaps. The rail on the left shows where you are and jumps to a chapter.
 * Every number and answer is KataGo's own (landing/story.ts, checked by tests).
 */
export default function Landing({ onEnter }: { onEnter: () => void }) {
  const N = CHAPTERS.length;
  const [active, setActive] = useState(0);
  const [settled, setSettled] = useState(true);
  const [step, setStep] = useState(0);
  const [n, setN] = useState(0);
  const [auto, setAuto] = useState(true);
  const words = useRef<(HTMLElement | null)[]>([]);
  const anchors = useRef<(HTMLElement | null)[]>([]);
  const fill = useRef<HTMLSpanElement>(null);
  const camRef = useRef<((p: number) => void) | null>(null);
  // the words and paper are painted; three.js may load; the live board is in and shown
  const [painted, setPainted] = useState(false);
  const [flat] = useState(() => !liveGl());
  const [wantLive, setWantLive] = useState(false);
  const [live, setLive] = useState(false);
  // the chapters whose diagrams are drawn: the one in view and the next (the rest wait until near)
  const [near, setNear] = useState(1);
  const progress = useRef(0);
  // the room the board may take in a chapter: beside its words on a wide screen, above them on a
  // tall one, below the top bar either way (the words' own boxes, measured without their motion)
  const boxRef = useRef<(i: number, tall: boolean) => Box>(() => [0.5, 0.1, 0.97, 0.97]);
  boxRef.current = (i, tall) => {
    const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
    const sec = words.current[i];
    let t = H, r = 0;
    if (sec)
      for (const el of Array.from(sec.children) as HTMLElement[]) {
        const x = sec.offsetLeft + el.offsetLeft, y = sec.offsetTop + el.offsetTop;
        t = Math.min(t, y);
        r = Math.max(r, x + el.offsetWidth);
      }
    if (tall) {
      // above the sheet the words sit on
      const top = 118;
      // (the words' own top, less the sheet's padding: the last chapter's words have no sheet)
      const bottom = sec && r > 0 ? t - 36 : H * 0.56;
      return [12 / W, top / H, (W - 12) / W, Math.max(top + 140, bottom) / H];
    }
    return [(r > 0 ? r + 44 : W * 0.45) / W, 84 / H, (W - 28) / W, (H - 28) / H];
  };

  useEffect(() => {
    document.documentElement.classList.add('kiai-landing');
    const meta = document.querySelector('meta[name="theme-color"]');
    const was = meta?.getAttribute('content');
    meta?.setAttribute('content', '#f4efe4');
    return () => {
      document.documentElement.classList.remove('kiai-landing');
      if (meta && was) meta.setAttribute('content', was);
    };
  }, []);

  // the scroll, in chapters: moves the camera, fades each chapter's words in at rest and out
  // before the next ones come, and fills the rail
  useEffect(() => {
    let raf = 0;
    const on = () => {
      raf = 0;
      const a0 = anchors.current[0], a1 = anchors.current[1];
      const ch = a0 && a1 ? a1.offsetTop - a0.offsetTop : window.innerHeight;
      const p = Math.max(0, Math.min(N - 1, window.scrollY / Math.max(1, ch)));
      progress.current = p;
      camRef.current?.(p);
      words.current.forEach((el, i) => {
        if (!el) return;
        const d = p - i;
        const o = Math.max(0, Math.min(1, 1 - (Math.abs(d) - 0.14) / 0.16));
        el.style.opacity = o.toFixed(3);
        el.style.transform = `translateY(${(-d * 48).toFixed(1)}px)`;
        el.style.visibility = o > 0.01 ? 'visible' : 'hidden';
      });
      fill.current?.style.setProperty('--p', (p / (N - 1)).toFixed(4));
      const a = Math.round(p);
      setActive(a);
      setNear((k) => Math.max(k, Math.min(N - 1, Math.ceil(p) + 1)));
      setSettled(Math.abs(p - a) < 0.15);
    };
    const req = () => {
      if (!raf) raf = requestAnimationFrame(on);
    };
    on();
    window.addEventListener('scroll', req, { passive: true });
    window.addEventListener('resize', req);
    return () => {
      window.removeEventListener('scroll', req);
      window.removeEventListener('resize', req);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [N]);

  // Reading: KataGo's read grows, one step every 1.6 s, once the camera has arrived
  useEffect(() => {
    if (active !== 1) {
      setStep(0);
      return;
    }
    if (!settled) return;
    if (reduced()) {
      setStep(READS.length - 1);
      return;
    }
    const t = window.setInterval(() => setStep((s) => Math.min(READS.length - 1, s + 1)), 1600);
    return () => window.clearInterval(t);
  }, [active, settled]);

  // Next moves: the line goes down one stone a second, unless you step through it yourself
  useEffect(() => {
    if (active !== 2) {
      setN(0);
      setAuto(true);
      return;
    }
    if (!settled || !auto) return;
    if (reduced()) {
      setN(LINE.length);
      return;
    }
    const t = window.setInterval(() => setN((k) => Math.min(LINE.length, k + 1)), 1000);
    return () => window.clearInterval(t);
  }, [active, settled, auto]);

  const jump = (i: number) => {
    const a = anchors.current[i];
    window.scrollTo({ top: a ? a.offsetTop : i * window.innerHeight, behavior: reduced() ? 'auto' : 'smooth' });
  };
  const go = (e?: React.MouseEvent) => {
    e?.preventDefault();
    onEnter();
  };
  // the page is ready (the loading sheet may go) as soon as the words are on the paper: both are
  // plain CSS and paint with this first render
  useEffect(() => {
    setPainted(true);
    markReady();
  }, []);
  const shown = useCallback(() => setLive(true), []);
  // a chapter's diagram just mounted (the words' room changed): place the camera again
  useEffect(() => {
    camRef.current?.(progress.current);
  }, [near]);
  // three.js: when the page is idle after its first paint, or at once if the reader moves first
  useEffect(() => {
    if (wantLive) return;
    const go = () => setWantLive(true);
    const ev = ['scroll', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    ev.forEach((e) => window.addEventListener(e, go, { passive: true, once: true }));
    const cancel = painted ? whenIdle(go, 1500) : () => undefined;
    return () => {
      cancel();
      ev.forEach((e) => window.removeEventListener(e, go));
    };
  }, [painted, wantLive]);

  const show: Show =
    active === 1 ? { kind: 'reading', step } : active === 2 ? { kind: 'next', n } : active === 3 ? { kind: 'ahead' } : active === 4 ? { kind: 'review' } : active === 5 ? { kind: 'start' } : { kind: 'ask' };
  const ref = (i: number) => (el: HTMLElement | null) => {
    words.current[i] = el;
  };
  const [ask, reading, next, ahead, review, start] = CHAPTERS;

  return (
    <div className={`landing${flat ? ' flat' : ''}${live ? ' live' : ''}`}>
      <div className="l-paper" aria-hidden="true" />
      {wantLive && (
        <Suspense fallback={null}>
          {flat ? <FlatStage show={show} boxRef={boxRef} onReady={shown} /> : <Stage show={show} at={progress} camRef={camRef} boxRef={boxRef} onReady={shown} />}
        </Suspense>
      )}

      <header className={`l-nav${active === 0 || active === 5 ? ' quiet' : ''}`}>
        <a className="l-brand" href="#ask" onClick={(e) => (e.preventDefault(), jump(0))} aria-label="Kiai, back to the top">
          <Logo size={34} />
          <span>Kiai</span>
        </a>
        <a className="l-btn" href="/" onClick={go}>
          Open Kiai
        </a>
      </header>

      <nav className="l-rail" aria-label="Chapters">
        <span className="l-rail-track" aria-hidden="true">
          <span ref={fill} className="l-rail-fill" />
        </span>
        {CHAPTERS.map((c, i) => (
          <a key={c.id} href={`#${c.id}`} className={i === active ? 'on' : undefined} aria-current={i === active ? 'step' : undefined} onClick={(e) => (e.preventDefault(), jump(i))}>
            <i aria-hidden="true" />
            <span>{c.rail}</span>
          </a>
        ))}
      </nav>

      <main className="l-words">
        <section ref={ref(0)} className="l-ch l-ask" aria-labelledby="l-h-ask">
          {/* broken after the comma, so it never breaks after "in" */}
          <h1 id="l-h-ask">
            {ask.title.split(', ').map((part, i, all) => (
              <span key={i}>
                {part}
                {i < all.length - 1 && (
                  <>
                    ,<br />
                  </>
                )}
              </span>
            ))}
          </h1>
          <div className="l-qa">
            <p className="l-q">{ASK.q}</p>
            <p className="l-a">
              <Logo size={38} className="l-a-mark" />
              <span>
                Play at <b className="l-at">{PICK}.</b> {ASK.a.slice(`Play at ${PICK}. `.length)}
              </span>
            </p>
          </div>
          <div className="l-cta">
            <a className="l-btn big" href="/" onClick={go}>
              Open Kiai
            </a>
            <span>Free. No sign-up. Runs in your browser.</span>
          </div>
        </section>

        <section ref={ref(1)} className="l-ch" aria-labelledby="l-h-reading">
          <h2 id="l-h-reading">{reading.title}</h2>
          {near >= 1 && <ReadingChart step={step} />}
        </section>

        <section ref={ref(2)} className="l-ch" aria-labelledby="l-h-next">
          <h2 id="l-h-next">{next.title}</h2>
          {near >= 2 && <LineDiagram n={n} />}
          {near >= 2 && <div className="l-steps" role="group" aria-label="Step through the moves">
            <button type="button" aria-label="Back one move" disabled={n === 0} onClick={() => (setAuto(false), setN((k) => Math.max(0, k - 1)))}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
            <span>
              Move <b>{n}</b> of {LINE.length}
            </span>
            <button type="button" aria-label="Forward one move" disabled={n === LINE.length} onClick={() => (setAuto(false), setN((k) => Math.min(LINE.length, k + 1)))}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>}
        </section>

        <section ref={ref(3)} className="l-ch" aria-labelledby="l-h-ahead">
          <h2 id="l-h-ahead">{ahead.title}</h2>
          <p className="l-lead">{ahead.lead}</p>
          {near >= 3 && <ChanceBar on={active === 3 && settled} />}
          <p className="l-text">{ahead.text}</p>
        </section>

        <section ref={ref(4)} className="l-ch" aria-labelledby="l-h-review">
          <h2 id="l-h-review">{review.title}</h2>
          <p className="l-text">{review.text}</p>
          {near >= 4 && <GameChart on={active === 4 && settled} />}
        </section>

        <section ref={ref(5)} className="l-ch l-start" aria-labelledby="l-h-start">
          <div className="l-brush">{active === 5 && <Calligraphy height={220} layout="h" write />}</div>
          <h2 id="l-h-start">{start.title}</h2>
          <a className="l-btn big" href="/" onClick={go}>
            Open Kiai
          </a>
          <p className="l-text">{start.text}</p>
          <p className="l-text l-colophon">{COLOPHON}</p>
          <p className="l-links">
            <a href="https://github.com/lightvector/KataGo" target="_blank" rel="noreferrer">
              KataGo
            </a>
            <a href="https://github.com/PERILTHESKYWING/Dop/blob/main/THIRD_PARTY_NOTICES.md" target="_blank" rel="noreferrer">
              Notices
            </a>
            <a href="https://github.com/PERILTHESKYWING/Dop" target="_blank" rel="noreferrer">
              Source
            </a>
          </p>
        </section>
      </main>

      <div className="l-track" aria-hidden="true">
        {CHAPTERS.map((c, i) => (
          <div
            key={c.id}
            id={c.id}
            className="l-anchor"
            ref={(el) => {
              anchors.current[i] = el;
            }}
          />
        ))}
      </div>
    </div>
  );
}
