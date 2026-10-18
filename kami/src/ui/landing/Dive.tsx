/**
 * "Watch KataGo read": one 3D board held on screen while the steps scroll past it, each step a real
 * feature replayed on it (the read growing, the three depths changing their minds, territory, a
 * whole-game review, the engine waking up on your device). The page darkens as the reading goes
 * deeper. The numbers live on the board and in the open stage, not in boxed panels.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CandGlow, KayaView, ViewMode } from '../../three/kaya';
import { Depth } from '../Depth';
import { Logo } from '../Logo';
import { answer, DEMO, FINAL, fmt, GAME, glows, line, loc, pct, STONES, SWINGS, words, type Read } from './data';
import { LiveBoard, reducedMotion, sleep, useScene, useTween, type Label } from './live';

type StepId = 'read' | 'skim' | 'dive' | 'abyss' | 'own' | 'review' | 'device';
type DepthId = 'skim' | 'dive' | 'abyss';
const Q = 'What should Black play here?';
const ANS = { skim: answer(Q, 'Skim'), dive: answer(Q, 'Dive'), abyss: answer(Q, 'Abyss') };
const WHO = answer('Who is ahead, and why?', 'Abyss');
const PICK = { skim: ANS.skim.variations[0].moves, dive: ANS.dive.variations[0].moves, abyss: ANS.abyss.variations[0].moves };
const DEPTHS: DepthId[] = ['skim', 'dive', 'abyss'];

/** How deep the page is at each step: 0 the surface, 3 the abyss. */
const DEPTH: Record<StepId, number> = { read: 0, skim: 1, dive: 2, abyss: 3, own: 3, review: 3, device: 3 };

/**
 * The board seen from above and a little in front. On a wide screen the stage fills the width
 * and the board sits right of centre, beside the text; on a phone it is centred above the text.
 */
const BOARD_X = 0.21;
function orbit(elev: number, azim: number, w: number, h: number, o: { zoom?: number; at?: [number, number]; spin?: number } = {}): ViewMode {
  const wide = w > 900;
  const shift = wide ? 0.21 : 0;
  const aspect = (w / Math.max(1, h)) * (wide ? 0.56 : 1);
  const fov = 26;
  const fit = (BOARD_X * 1.25) / Math.tan((fov * Math.PI) / 360) / Math.min(1, aspect);
  const [x, z] = o.at ?? [0, 0];
  // a phone's close views stand a little further back, so the board's corner reads as a corner
  const zoom = (o.zoom ?? 1) * (wide || (o.zoom ?? 1) >= 1 ? 1 : 1.22);
  return { kind: 'orbit', elev, azim, fov, dist: fit * zoom, target: [x, 0.06, z], spin: o.spin, shift };
}
// the reading happens on the right side (Q9 to R12), so the close views look there
const VIEWS: Record<StepId, (w: number, h: number) => ViewMode> = {
  read: (w, h) => orbit(40, -26, w, h, { zoom: 0.6, at: [0.1, -0.05], spin: 0.5 }),
  skim: (w, h) => orbit(44, -20, w, h, { zoom: 0.58, at: [0.1, -0.05] }),
  dive: (w, h) => orbit(42, -30, w, h, { zoom: 0.58, at: [0.1, -0.06] }),
  abyss: (w, h) => orbit(40, -38, w, h, { zoom: 0.58, at: [0.1, -0.05] }),
  own: (w, h) => orbit(58, -6, w, h, { zoom: 1.08, at: [0, -0.07] }),
  review: (w, h) => orbit(64, -8, w, h, { zoom: 1.2, at: [0, -0.02] }),
  device: (w, h) => orbit(30, -30, w, h, { zoom: 1.22, at: [0, -0.03], spin: 6 }),
};

interface Live {
  read: Read | null;
  /** The favourite move in the read so far. */
  fav: string;
  move: number;
  swings: number;
  done: boolean;
  /** The network loading (0..1) on the device step; 1 once it reads. */
  load: number;
}
const BLANK: Live = { read: null, fav: '', move: 0, swings: 0, done: false, load: 0 };

const PILLAR = 0.085;
const lift = (share: number) => PILLAR * Math.max(0.05, share) + 0.01;
function candLabels(r: Read, n = 3): Label[] {
  return r.cands.slice(0, n).map((c, i) => ({ key: `c${c.at}`, loc: loc(c.at), lift: lift(c.visits / r.cands[0].visits), cls: `k3-cand tag${i === 0 ? ' best' : ''}`, text: pct(c.win, 0), sub: c.at }));
}
function lineLabels(moves: { loc: number; color: number }[]): Label[] {
  const seen = new Set<number>();
  return moves.flatMap((m, i) => (seen.has(m.loc) ? [] : (seen.add(m.loc), [{ key: `v${m.loc}`, loc: m.loc, lift: 0.0098, cls: `k3-var ${m.color === 1 ? 'b' : 'w'} rise`, text: String(i + 1) }])));
}

/** Each depth's pick as a column: this depth's tall and lit, the shallower ones short and pale. */
function depthPicks(upto: DepthId, current: boolean): { cands: CandGlow[]; labels: Label[] } {
  const k = DEPTHS.indexOf(upto);
  const cands: CandGlow[] = [];
  const labels: Label[] = [];
  DEPTHS.slice(0, k + 1).forEach((d, i) => {
    const at = PICK[d][0];
    const lead = current && i === k;
    const share = lead ? 1 : 0.32;
    cands.push({ loc: loc(at), rank: lead ? 0 : i + 1, share, badness: lead ? 0 : 0.45 });
    labels.push({ key: `p${d}`, loc: loc(at), lift: lift(share), cls: `k3-cand tag pick${lead ? ' best' : ''}`, text: at, sub: ANS[d].depth });
  });
  return { cands, labels };
}

/**
 * On a wide screen a depth's answer stands on the board, beside the top of its pick's column; once
 * the depths stand side by side it moves left of them, so it covers none of their tags.
 */
function say(id: DepthId, aside = false): Label {
  return { key: `q${id}`, loc: loc(aside ? 'O13' : PICK[id][0]), lift: lift(1), cls: 'k3-say', text: `“${words(ANS[id].summary, id === 'skim' ? 2 : 1)}”`, sub: `Kiai, ${ANS[id].depth}` };
}
/** The territory answer, standing beside the upper right it talks about (clear of its blocks). */
const SAY_OWN: Label = { key: 'qown', loc: loc('N17'), lift: 0.03, cls: 'k3-say', text: `“${words(WHO.summary, 2)}”`, sub: `Kiai, ${WHO.depth}` };

/** Plays one step on the board once, then holds its last frame (the board keeps breathing) until the step is left. */
function scene(id: StepId, v: KayaView, set: (l: Partial<Live>) => void, setLabels: (l: Label[]) => void, still: boolean) {
  return async (sig: AbortSignal) => {
    switch (id) {
      case 'read': {
        v.ping(null, 1700);
        for (const r of still ? [FINAL] : DEMO.reads) {
          v.setCandidates(glows(r, 4), !still);
          setLabels(candLabels(r));
          set({ read: r, fav: r.cands[0].at });
          if (!still) await sleep(1300, sig);
        }
        return sleep(1e9, sig);
      }
      case 'skim':
      case 'dive':
      case 'abyss': {
        const k = DEPTHS.indexOf(id);
        const pv = line(PICK[id].slice(0, id === 'abyss' ? 9 : 7));
        if (still) {
          const p = depthPicks(id, true);
          v.setCandidates(p.cands, false);
          if (k === 0) v.setVariation(pv, 0);
          setLabels(k === 0 ? [p.labels[p.labels.length - 1], ...lineLabels(pv).slice(1), say(id)] : [...p.labels, say(id, true)]);
          return sleep(1e9, sig);
        }
        // the shallower depth's pick stands first; then this depth reads on and changes its mind
        if (k > 0) {
          const before = depthPicks(DEPTHS[k - 1], true);
          v.setCandidates(before.cands);
          setLabels(before.labels);
          await sleep(1100, sig);
        }
        v.ping(loc(PICK[id][0]), 1300);
        const now = depthPicks(id, true);
        v.setCandidates(now.cands);
        setLabels([...now.labels, say(id)]);
        await sleep(1300, sig);
        v.setVariation(pv, 420);
        // while the line is drawn, only this depth's pick keeps its tag (the line's numbers need the room)
        setLabels([now.labels[now.labels.length - 1], ...lineLabels(pv).slice(1), say(id)]);
        if (k === 0) return sleep(1e9, sig);
        // then the line clears and the depths stand side by side: the shallower picks pale, this one lit
        await sleep(420 * pv.length + 2200, sig);
        v.setVariation(null, 0);
        setLabels([...now.labels, say(id, true)]);
        return sleep(1e9, sig);
      }
      case 'own': {
        set({ done: false });
        if (!still) await sleep(300, sig);
        v.setOwnership(FINAL.own, !still);
        set({ done: true });
        if (!still) await sleep(900, sig);
        setLabels([SAY_OWN]);
        return sleep(1e9, sig);
      }
      case 'review': {
        if (still) {
          v.setStones(GAME.boards[GAME.boards.length - 1], false);
          set({ move: GAME.moves.length, swings: SWINGS.length, done: true });
          setLabels(swingLabels(SWINGS.length));
          return sleep(1e9, sig);
        }
        set({ move: 0, swings: 0, done: false });
        setLabels([]);
        v.setStones(GAME.boards[0], false);
        await sleep(600, sig);
        let k = 0;
        for (let i = 1; i <= GAME.moves.length; i++) {
          v.setStones(GAME.boards[i], true);
          set({ move: i });
          const sw = SWINGS[k];
          if (sw && sw.n === i) {
            k++;
            set({ swings: k });
            setLabels(swingLabels(k));
            const at = GAME.moves[i - 1].loc;
            if (at >= 0) {
              v.ripple(at, 0xff9a4d, 3.4, 1200, 0.95);
              v.setHighlights([at], 0xffa95e);
            }
            await sleep(1000, sig);
            v.setHighlights([]);
          } else await sleep(i < 60 ? 70 : 34, sig);
        }
        set({ done: true });
        return sleep(1e9, sig);
      }
      case 'device': {
        // the engine arrives: its network downloads onto the board (a spark runs round the edge),
        // then it reads, with the badge saying it now works offline
        if (still) {
          v.setCandidates(glows(FINAL, 4), false);
          setLabels([...candLabels(FINAL, 1), download(1)]);
          set({ load: 1, read: FINAL, fav: FINAL.cands[0].at });
          return sleep(1e9, sig);
        }
        set({ load: 0, read: null, fav: '' });
        setLabels([download(0)]);
        await sleep(400, sig);
        v.edgeSweep(1800);
        for (let i = 1; i <= 16; i++) {
          setLabels([download(i / 16)]);
          await sleep(110, sig);
        }
        set({ load: 1 });
        v.ping(null, 1500);
        for (const r of DEMO.reads) {
          v.setCandidates(glows(r, 4));
          setLabels([...candLabels(r, 1), download(1)]);
          set({ read: r, fav: r.cands[0].at });
          await sleep(520, sig);
        }
        return sleep(1e9, sig);
      }
    }
  };
}

/** The network's download, as a badge standing on the board's near edge; once in, it says the board works offline. */
function download(p: number): Label {
  const done = p >= 1;
  return {
    key: 'dl',
    loc: 18 * 19 + 9,
    lift: 0.004,
    cls: `k3-dl${done ? ' done' : ''}`,
    text: done ? 'Ready, even offline' : `${(p * 11).toFixed(1)} of 11 MB`,
    sub: done ? '11 MB, now on this device' : 'KataGo’s network, downloading',
    style: { '--p': p.toFixed(3) } as React.CSSProperties,
  };
}

/** The turning points the replay has reached, pinned to their stones. */
function swingLabels(n: number): Label[] {
  return SWINGS.slice(0, n).map((s) => ({ key: `s${s.n}`, loc: loc(s.at), lift: 0.012, cls: 'k3-swing', text: String(s.n), sub: `−${Math.round(s.drop * 100)}%` }));
}

const STEPS: { id: StepId; kicker: ReactNode; title: string; body: ReactNode; anchor?: string }[] = [
  {
    id: 'read',
    kicker: 'Reading',
    title: 'Watch KataGo’s search grow.',
    body: (
      <>
        <p>Each column is a move KataGo is weighing, as tall as its share of the search. A visit is one simulated line of play from the position.</p>
        <p className="l-step-note">At 128 visits its favourite is the hane at Q10; by 512, Q9 has taken over. This is the real read of this position, replayed.</p>
      </>
    ),
  },
  {
    id: 'skim',
    anchor: 'depths',
    kicker: (
      <>
        <Depth id="hane" size={14} /> Skim · {fmt(ANS.skim.visits)} visits
      </>
    ),
    title: 'Skim picks Q10.',
    body: (
      <>
        <p>You pick how deep KataGo reads: Skim is quick, Dive reads deeper, Abyss reads deepest. The same question at each:</p>
        <Quote a={ANS.skim} n={2} phone />
      </>
    ),
  },
  {
    id: 'dive',
    kicker: (
      <>
        <Depth id="tesuji" size={14} /> Dive · {fmt(ANS.dive.visits)} visits
      </>
    ),
    title: 'Dive changes its pick: R12.',
    body: <Quote a={ANS.dive} n={1} phone />,
  },
  {
    id: 'abyss',
    kicker: (
      <>
        <Depth id="myoshu" size={14} /> Abyss · {fmt(ANS.abyss.visits)} visits
      </>
    ),
    title: 'Abyss settles on Q9.',
    body: (
      <>
        <Quote a={ANS.abyss} n={1} phone />
        <p className="l-step-note">Three depths, three answers. The deeper the read, the slower it is and the more you can trust it.</p>
      </>
    ),
  },
  {
    id: 'own',
    kicker: 'Territory',
    title: 'Who is ahead, and where.',
    body: (
      <>
        <p>Black’s points are blue blocks, White’s are white. The taller the block, the more certain KataGo is that the point is theirs.</p>
        <Quote a={WHO} n={2} phone />
      </>
    ),
  },
  {
    id: 'review',
    anchor: 'review',
    kicker: 'Game review',
    title: 'A whole game, graded.',
    body: (
      <p>
        KataGo reads every move. Kiai graphs Black’s win rate, marks each turning point on its stone and scores each side’s accuracy: how little win rate its moves gave away.
        This game: {GAME.moves.length} moves, {DEMO.review.visits} visits per move.
      </p>
    ),
  },
  {
    id: 'device',
    anchor: 'device',
    kicker: 'On your device',
    title: 'KataGo runs in your browser.',
    body: (
      <p>Its 11 MB neural network downloads once; after that it analyses even offline. Kiai’s written answers come from a server, so they need a connection.</p>
    ),
  },
];

function Quote({ a, n, phone }: { a: ReturnType<typeof answer>; n: number; phone?: boolean }) {
  return (
    <blockquote className={`l-quote${phone ? ' phone' : ''}`}>
      <p>“{words(a.summary, n)}”</p>
      <cite>
        <Logo size={18} tile /> Kiai, {a.depth}
      </cite>
    </blockquote>
  );
}

/** The win-rate graph of the review, drawn across the stage up to the move the board has reached. */
function Graph({ move, swings, acc }: { move: number; swings: number; acc: [number, number] | null }) {
  const w = DEMO.review.bWin;
  const W = 1000, H = 120;
  const x = (i: number) => (i / (w.length - 1)) * W;
  const y = (p: number) => H - p * H;
  const d = w.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(' ');
  const area = `${d} L${W} ${H} L0 ${H} Z`;
  // turning points a few moves apart share one mark ("23–25") instead of covering each other
  const marks: { first: number; n: string; x: number; y: number }[] = [];
  for (const s of SWINGS.slice(0, swings)) {
    const x = (s.n / (w.length - 1)) * 100;
    const p = marks[marks.length - 1];
    if (p && x - p.x < 4) p.n = `${p.first}–${s.n}`;
    else marks.push({ first: s.n, n: String(s.n), x, y: Math.min(1 - w[s.n], 0.85) * 100 });
  }
  return (
    <div className="l-graph-wrap">
      <div className="l-graph-cap">
        <span>Black’s win rate</span>
        <span className={`l-acc${acc ? ' on' : ''}`}>
          <span className="l-acc-cap">Accuracy</span>
          <span>
            <i className="st b" /> Black <b>{(acc?.[0] ?? 0).toFixed(1)}%</b>
          </span>
          <span>
            <i className="st w" /> White <b>{(acc?.[1] ?? 0).toFixed(1)}%</b>
          </span>
        </span>
      </div>
      <svg className="l-graph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Black's win rate over the game">
        <defs>
          <clipPath id="l-graph-clip">
            <rect width={x(move)} height={H} />
          </clipPath>
        </defs>
        <line className="l-graph-mid" x1="0" x2={W} y1={H / 2} y2={H / 2} />
        <line className="l-graph-mid" x1="0" x2={W} y1="0" y2="0" />
        <g clipPath="url(#l-graph-clip)">
          <path className="l-graph-area" d={area} />
          <path className="l-graph-line" d={d} />
        </g>
        <line className="l-graph-head" x1={x(move)} x2={x(move)} y1="0" y2={H} />
      </svg>
      {['100%', '50%', '0%'].map((t, i) => (
        <span key={t} className="l-graph-y" style={{ top: `${i * 50}%` }}>
          {t}
        </span>
      ))}
      {[1, 50, 100, 150, w.length - 1].map((n, i, a) => (
        <span key={n} className={`l-graph-x${i === 0 ? ' start' : i === a.length - 1 ? ' end' : ''}`} style={{ left: `${(n / (w.length - 1)) * 100}%` }}>
          {i === 0 ? 'move 1' : n}
        </span>
      ))}
      {move > 0 && move < w.length - 1 && <span className="l-graph-dot" style={{ left: `${(move / (w.length - 1)) * 100}%`, top: `${(1 - w[move]) * 100}%` }} />}
      {marks.map((m) => (
        <span key={m.first} className="l-graph-mark" style={{ left: `${m.x}%`, top: `${m.y}%` }}>
          <b>{m.n}</b>
        </span>
      ))}
      <p className="l-graph-key">
        <b>{SWINGS[0]?.n ?? 1}</b> a turning point: its move number; on the board, the win rate it cost
      </p>
    </div>
  );
}

/** The step's numbers, set in the open stage: big figures, no panel. */
function Stats({ step, live }: { step: StepId; live: Live }) {
  const r = live.read;
  const visits = useTween(r?.visits ?? 0, 700);
  const lead = useTween(step === 'own' && live.done ? -FINAL.bLead : 0, 1100);
  const accB = useTween(live.done ? DEMO.review.accuracy.black : 0, 1400);
  const accW = useTween(live.done ? DEMO.review.accuracy.white : 0, 1400);
  if (step === 'read' || (step === 'device' && live.load >= 1))
    return (
      <div className="l-stats">
        <div className="l-stat">
          <b>{fmt(Math.round(visits))}</b>
          <span>{step === 'device' ? 'visits, read on this device' : 'visits'}</span>
        </div>
        {live.fav && (
          <div className="l-stat small" key={live.fav}>
            <b className="glow">{live.fav}</b>
            <span>KataGo’s favourite</span>
          </div>
        )}
      </div>
    );
  if (step === 'skim' || step === 'dive' || step === 'abyss')
    return (
      <div className="l-stats l-stats-path">
        <ol className="l-path" aria-label="Each depth's pick">
          {DEPTHS.map((d, i) => (
            <li key={d} className={d === step ? 'on' : DEPTHS.indexOf(step) > i ? 'past' : ''}>
              <span>{ANS[d].depth}</span>
              <b>{PICK[d][0]}</b>
              <i>{fmt(ANS[d].visits)} visits</i>
            </li>
          ))}
        </ol>
      </div>
    );
  if (step === 'own')
    return (
      <div className="l-stats">
        <div className="l-stat">
          <b>W+{lead.toFixed(1)}</b>
          <span>White’s lead in points · Black’s win rate {pct(FINAL.bWin)}</span>
        </div>
      </div>
    );
  if (step === 'review')
    return (
      <>
        <div className="l-stats l-stats-moves">
          <div className="l-stat small">
            <b>{live.move}</b>
            <span>moves replayed, of {GAME.moves.length}</span>
          </div>
        </div>
        <Graph move={live.move} swings={live.swings} acc={live.done ? [accB, accW] : null} />
      </>
    );
  return null;
}

export function Dive() {
  const still = useMemo(() => reducedMotion(), []);
  const [view, setView] = useState<KayaView | null>(null);
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<StepId>('read');
  const [labels, setLabels] = useState<Label[]>([]);
  const [live, setLiveState] = useState<Live>(BLANK);
  const setLive = useCallback((l: Partial<Live>) => setLiveState((s) => ({ ...s, ...l })), []);
  const stepsRef = useRef<HTMLOListElement>(null);
  const size = useRef({ w: 1, h: 1 });

  // the step in the middle of the screen (lower down on phones, under the board) is the live one
  useEffect(() => {
    const el = stepsRef.current;
    if (!el) return;
    const phone = window.matchMedia('(max-width: 900px)').matches;
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) if (e.isIntersecting) setStep((e.target as HTMLElement).dataset.step as StepId);
      },
      { rootMargin: phone ? '-62% 0px -18% 0px' : '-48% 0px -48% 0px' },
    );
    for (const li of el.children) io.observe(li);
    return () => io.disconnect();
  }, []);

  const fit = useCallback((w: number, h: number) => {
    size.current = { w, h };
    return VIEWS[step](w, h);
    // the camera follows the step through setView below; the fit only matters on resize
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // each step: its camera, its stones, then its scene on a loop
  useEffect(() => {
    if (!view) return;
    view.fadeOut(still ? 0 : 400);
    setLabels([]);
    setLive(BLANK);
    if (step !== 'review') view.setStones(STONES, false);
    view.setView(VIEWS[step](size.current.w, size.current.h), still ? 0 : 1500);
  }, [view, step, still, setLive]);
  useEffect(() => {
    view?.setAmbient(visible && !still);
  }, [view, visible, still]);
  // the glow under the board only shows once the page has gone dark; the bar on top follows
  useEffect(() => {
    view?.setUnderglow(DEPTH[step] >= 2 ? 1 : 0, still ? 0 : 1200);
    window.dispatchEvent(new Event('kiai-tone'));
  }, [view, step, still]);
  useScene(!!view && visible, view ? scene(step, view, setLive, setLabels, still) : null, [view, step]);

  const depth = DEPTH[step];
  const at = STEPS.findIndex((s) => s.id === step);
  return (
    <section className={`l-dive d${depth} s-${step}`} id="dive" data-tone={depth >= 2 ? 'dark' : 'light'} aria-labelledby="l-dive-title">
      <h2 id="l-dive-title" className="l-visually-hidden">
        Watch KataGo read
      </h2>
      <div className="l-stage">
        <LiveBoard
          className="l-stage-board"
          options={{ stage: 'void', toneMapping: 'aces', exposure: 0.95, fx: 1.2, pillars: PILLAR, lite: window.matchMedia('(pointer: coarse)').matches }}
          fit={fit}
          labels={labels}
          onView={setView}
          onVisible={setVisible}
        />
        <div className="l-rail" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s.id} className={`l-rail-tick${i <= at ? ' past' : ''}`} style={{ top: `${(i / (STEPS.length - 1)) * 100}%` }} />
          ))}
          <span className="l-rail-fill" style={{ transform: `scaleY(${at / (STEPS.length - 1)})` }} />
          <span className="l-rail-ikki" style={{ top: `${(at / (STEPS.length - 1)) * 100}%` }}>
            <Logo size={26} tile thinking={step === 'read' || step === 'skim' || step === 'dive' || step === 'abyss' || step === 'device'} />
          </span>
        </div>
        <Stats key={step} step={step} live={live} />
      </div>
      <ol className="l-steps" ref={stepsRef}>
        {STEPS.map((s) => (
          <li key={s.id} id={s.anchor} data-step={s.id} className={`l-step${s.id === step ? ' on' : ''}`}>
            <div className="l-step-in">
              <p className="l-kicker">{s.kicker}</p>
              <h3>{s.title}</h3>
              {s.body}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
