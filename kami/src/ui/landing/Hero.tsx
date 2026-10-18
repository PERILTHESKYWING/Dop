/**
 * The front of the landing: the sky-and-table plate (a path-traced render) with the live 3D
 * board standing on its table, drawn with the plate's own camera. Above the board, a question
 * pops up, Kiai reads (the board lights up as KataGo's real read grows from 8 to 2,048 visits)
 * and the answer streams in; the move it names flashes on its column of light.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KayaView, ViewMode } from '../../three/kaya';
import { coverCrop, HERO_CAM, PHONE_W, PHONE_X0 } from '../../three/plate';
import { webglOk } from '../../three/support';
import { Logo } from '../Logo';
import { answer, DEMO, FINAL, fmt, glows, loc, pct, PLAY_ORDER, STONES, words, type Read } from './data';
import { LiveBoard, reducedMotion, sleep, useScene, type Label } from './live';

const ART = '/kiai';
const COORD = /\b([A-HJ-T](?:1[0-9]|[1-9]))\b/;
const PILLAR = 0.13;
/** How many of KataGo's candidates rise as columns. */
const CANDS = 4;

interface Scene {
  q: string;
  kind: 'play' | 'score';
  /** The move the line of light points at. */
  point: string | null;
  text: string;
  foot: string;
}

const PLAY = answer('What should Black play here?', 'Abyss');
const SCORE = answer('Who is ahead, and why?', 'Abyss');
/** The score answer's own numbers (its read, which its words round), so the foot and the answer agree. */
function scoreFoot(): string {
  const m = /White leads by ([\d.]+) points \(Black.s winrate (\d+)%\)/.exec(SCORE.sections[0]?.text ?? '');
  const lead = m ? m[1] : (-FINAL.bLead).toFixed(1), win = m ? `${m[2]}%` : pct(FINAL.bWin);
  return `KataGo’s Abyss read: White leads by ${lead} points\nBlack’s win rate: ${win} · ${fmt(SCORE.visits)} visits`;
}
// The board shows KataGo's 2,048-visit read of the position, so the numbers under each answer
// are that read's; the words are Kiai's Abyss answers to the same position (no depth badge here,
// since Abyss's own read is longer than the one on the board).
const best = FINAL.cands[0];
const SCENES: Scene[] = [
  { q: PLAY.question, kind: 'play', point: best.at, text: words(PLAY.summary), foot: `KataGo’s pick: ${best.at} · Black’s win rate if played: ${pct(best.win)}\n${fmt(FINAL.visits)} visits, read in your browser` },
  { q: SCORE.question, kind: 'score', point: null, text: words(SCORE.summary, 3), foot: scoreFoot() },
];

interface Card {
  id: number;
  scene: Scene;
  phase: 'ask' | 'read' | 'answer' | 'leave';
  typed: number;
  visits: number;
  shown: number;
}

const wide = (w: number) => w > 720;
function heroFit(w: number, h: number): ViewMode {
  const crop = wide(w) ? coverCrop(w, h, { x0: 0, pw: HERO_CAM.width, ph: HERO_CAM.height }, [0.66, 0.5]) : coverCrop(w, h, { x0: PHONE_X0, pw: PHONE_W, ph: HERO_CAM.height }, [0.5, 1]);
  return { kind: 'plate', cam: HERO_CAM, crop };
}

/**
 * The answer so far: words up to `shown`, coordinates as chips; the pointed one is marked. Words
 * not yet shown keep their place, so the card is its final size from the start and nothing above
 * it moves; while Kiai reads, a shimmering line stands in for them.
 */
function Answer({ text, shown, point, wait }: { text: string; shown: number; point: string | null; wait?: boolean }) {
  const ws = text.split(' ');
  return (
    <p className={`l-ask-text${wait ? ' wait' : ''}`}>
      {wait && (
        <span className="l-skel" aria-hidden="true">
          <i />
        </span>
      )}
      {ws.map((w, i) => {
        const m = w.match(COORD);
        const vis = i < shown;
        const inner = m ? (
          <>
            {w.slice(0, m.index)}
            <span className={`l-chip-c${m[1] === point ? ' point' : ''}`} data-at={m[1]}>
              {m[1]}
            </span>
            {w.slice((m.index ?? 0) + m[1].length)}
          </>
        ) : (
          w
        );
        return (
          <Fragment key={i}>
            <span className={`l-w${vis ? ' on' : ''}`}>{inner}</span>
            {i < ws.length - 1 ? ' ' : ''}
          </Fragment>
        );
      })}
    </p>
  );
}

export function Hero({ onEnter }: { onEnter: (e?: React.MouseEvent) => void }) {
  const gl = useMemo(() => webglOk(), []);
  // ?pose=read|answer|score (development builds only) holds one moment still, for screenshots
  const pose = useMemo(() => (import.meta.env.DEV ? new URLSearchParams(location.search).get('pose') : null), []);
  const still = useMemo(() => reducedMotion() || !!pose, [pose]);
  const hero = useRef<HTMLElement>(null);
  const [view, setView] = useState<KayaView | null>(null);
  const [visible, setVisible] = useState(true);
  const [ready, setReady] = useState(false);
  const [card, setCard] = useState<Card | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [paused, setPaused] = useState(false);

  const onView = useCallback((v: KayaView | null) => {
    if (v) v.set.rotation.y = (HERO_CAM.board_rot_z * Math.PI) / 180;
    setView(v);
  }, []);

  // where the board's far edge is, so the card can sit just above it
  const edge = useRef({ top: 0, left: 0, right: 0 });
  const follow = useCallback((v: KayaView) => {
    const el = hero.current;
    if (!el) return;
    const a = v.project(0, 0), b = v.project(18, 0), c = v.project(18 * 19 + 18, 0);
    const cell = Math.hypot(b.x - a.x, b.y - a.y) / 18;
    // the card clears the board's far edge and the tallest column of light, with its tag and the coordinate over it
    const col = v.project(loc(best.at), PILLAR + 0.05);
    const top = Math.min(a.y - cell * 1.2, b.y - cell * 1.2, col.y), left = Math.min(a.x, b.x), right = Math.max(b.x, c.x);
    if (!Number.isFinite(top + left + right)) return;
    const e = edge.current;
    if (Math.abs(e.top - top) > 1 || Math.abs(e.left - left) > 1 || Math.abs(e.right - right) > 1) {
      edge.current = { top, left, right };
      el.style.setProperty('--board-top', `${top.toFixed(0)}px`);
      el.style.setProperty('--board-left', `${left.toFixed(0)}px`);
      el.style.setProperty('--board-right', `${right.toFixed(0)}px`);
    }
  }, []);

  // the board arrives: it fades in, a spark runs round its edge, and the game's stones drop in order
  useEffect(() => {
    if (!view) return;
    if (still) {
      view.setStones(STONES, false);
      setReady(true);
      return;
    }
    view.setStones(new Array(361).fill(0), false);
    let alive = true;
    const t1 = window.setTimeout(() => alive && view.edgeSweep(1600), 350);
    const t2 = window.setTimeout(() => {
      if (!alive) return;
      view.setStones(STONES, false);
      view.cascade(PLAY_ORDER, 42);
    }, 700);
    const t3 = window.setTimeout(() => alive && setReady(true), 700 + PLAY_ORDER.length * 42 + 500);
    return () => {
      alive = false;
      [t1, t2, t3].forEach(window.clearTimeout);
    };
  }, [view, still]);

  useEffect(() => {
    view?.setAmbient(visible && !still);
  }, [view, visible, still]);

  // reduced motion: the first answer, complete and still
  useEffect(() => {
    if (!still || !view) return;
    const s = SCENES[pose === 'score' ? 1 : 0];
    if (pose === 'score') view.setOwnership(FINAL.own, false);
    else {
      const r = pose === 'read' ? DEMO.reads[3] : FINAL;
      view.setCandidates(glows(r, CANDS), false);
      setLabels(cand(r, pose !== 'read'));
    }
    setCard({ id: 0, scene: s, phase: pose === 'read' ? 'read' : 'answer', typed: s.q.length, visits: pose === 'read' ? DEMO.reads[3].visits : FINAL.visits, shown: 999 });
    view.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still, view]);

  // the win rates float on top of the columns; once the answer names the favourite, its tag says which move it is
  const cand = (r: Read, named = false): Label[] =>
    r.cands.slice(0, CANDS).map((c, i) => ({ key: `c${c.at}`, loc: loc(c.at), lift: PILLAR * Math.max(0.05, c.visits / r.cands[0].visits) + 0.012, cls: `k3-cand tag${i === 0 ? ' best' : ''}${i === 0 && named ? ' hit' : ''}`, text: `${(c.win * 100).toFixed(0)}%`, sub: i === 0 && named ? c.at : undefined }));

  // the first time round the page opens on a finished answer (the question, the answer and the
  // columns of light all up at once); the loop after that shows each read growing from its question
  const opened = useRef(false);
  const run = useCallback(
    async (signal: AbortSignal) => {
      const v = view!;
      let id = 0;
      for (const s of SCENES) {
        id++;
        if (!opened.current && s.kind === 'play' && s.point) {
          opened.current = true;
          const ws = s.text.split(' ');
          const c: Card = { id, scene: s, phase: 'answer', typed: s.q.length, visits: FINAL.visits, shown: 0 };
          setCard({ ...c });
          v.setCandidates(glows(FINAL, CANDS));
          setLabels(cand(FINAL));
          await sleep(450, signal);
          for (let k = 1; k <= ws.length; k++) {
            c.shown = k;
            setCard({ ...c });
            await sleep(16, signal);
          }
          v.ripple(loc(s.point), undefined, 3.2, 1100, 0.8);
          setLabels(cand(FINAL, true));
          await sleep(5600, signal);
          c.phase = 'leave';
          setCard({ ...c });
          v.fadeOut(600);
          setLabels([]);
          await sleep(900, signal);
          continue;
        }
        // the question pops up and types itself
        const c: Card = { id, scene: s, phase: 'ask', typed: 0, visits: 0, shown: 0 };
        setCard({ ...c });
        await sleep(380, signal);
        for (let k = 1; k <= s.q.length; k += 2) {
          setCard({ ...c, typed: k });
          await sleep(22, signal);
        }
        c.typed = s.q.length;
        await sleep(350, signal);
        // Kiai reads: KataGo's real read, growing
        c.phase = 'read';
        setCard({ ...c });
        v.ping(null, 1600);
        const reads = s.kind === 'play' ? DEMO.reads : DEMO.reads.slice(2);
        for (const r of reads) {
          c.visits = r.visits;
          setCard({ ...c });
          if (s.kind === 'play') {
            v.setCandidates(glows(r, CANDS));
            setLabels(cand(r));
          }
          await sleep(s.kind === 'play' ? 560 : 380, signal);
        }
        if (s.kind === 'score') v.setOwnership(FINAL.own, true);
        await sleep(300, signal);
        // the answer streams in
        c.phase = 'answer';
        setCard({ ...c });
        const ws = s.text.split(' ');
        let named = false;
        for (let k = 1; k <= ws.length; k++) {
          c.shown = k;
          setCard({ ...c });
          // the move the answer names flashes on the board: a ripple from its point, its tag lights up
          if (s.point && !named && ws[k - 1].startsWith(s.point)) {
            named = true;
            v.ripple(loc(s.point), undefined, 3.2, 1100, 0.8);
            setLabels(cand(FINAL, true));
          }
          await sleep(48, signal);
        }
        // the columns stay up beside the answer (the line of play is shown close up further down)
        await sleep(4200, signal);
        // and away, for the next question
        c.phase = 'leave';
        setCard({ ...c });
        v.fadeOut(600);
        setLabels([]);
        await sleep(900, signal);
      }
    },
    [view],
  );
  useScene(!!view && ready && visible && !still && !paused, view ? run : null, [view]);
  // a scene stopped half way (scrolled off, or paused) starts clean when it comes back
  useEffect(() => {
    if ((visible && !paused) || !view || still) return;
    view.fadeOut(0);
    setLabels([]);
    setCard(null);
  }, [visible, paused, view, still]);

  const s = card?.scene;
  return (
    <section ref={hero} className={`l-hero${gl ? ' live' : ''}`} data-tone="light" aria-labelledby="l-title">
      <picture className="l-hero-art">
        {!gl && <source media="(max-width: 720px)" srcSet={`${ART}/hero-tall.webp`} />}
        <img src={gl ? `${ART}/3d/plate.webp` : `${ART}/hero.webp`} alt="" />
      </picture>
      {gl && <LiveBoard className={`l-hero-board${view ? ' on' : ''}`} options={{ bowls: true, shadowCatcher: true, sun: HERO_CAM.sun, toneMapping: 'aces', exposure: 0.9, fx: 2.1, pillars: PILLAR, lite: typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches }} fit={heroFit} labels={labels} onView={onView} onVisible={setVisible} onFrame={follow} />}
      <div className="l-hero-copy">
        <p className="l-hero-kicker">
          For Go players<span className="l-wide"> · KataGo’s analysis in plain words</span>
        </p>
        <h1 id="l-title" aria-label="Ask what to play in any Go position.">
          <span className="l-line">
            <span>Ask what to play</span>
          </span>{' '}
          <span className="l-line">
            <span>in any Go position.</span>
          </span>
        </h1>
        <p className="l-lead">KataGo, the open-source Go AI, reads the position in your browser. Kiai puts what it found into plain words, whether you ask what to play or who is ahead. Free, no sign‑up.</p>
        <p className="l-lead short">KataGo, the open-source Go AI, reads it in your browser. Kiai puts what it found into plain words. Free, no sign‑up.</p>
        <div className="l-actions">
          <a className="l-btn" href="/" onClick={onEnter}>
            Ask about a position
          </a>
          <a className="l-btn ghost" href="#dive">
            Watch KataGo read
          </a>
        </div>
      </div>

      {card && s && (
        <figure key={card.id} className={`l-ask ${card.phase}`} aria-live="polite">
          <p className="l-ask-q">
            {s.q.slice(0, card.typed)}
            {card.typed < s.q.length && <span className="l-caret" />}
          </p>
          <div className={`l-ask-a${card.phase === 'ask' ? ' hold' : ''}`} aria-hidden={card.phase === 'ask'}>
              <div className="l-ask-who">
                <Logo size={22} tile thinking={card.phase === 'read'} />
                <b>Kiai</b>
                {card.phase === 'read' && (
                  <span className="l-ask-reading">
                    KataGo · <b>{fmt(card.visits)}</b> visits
                  </span>
                )}
              </div>
              <div className={`l-ask-meter${card.phase === 'read' ? '' : ' done'}`} aria-hidden="true">
                <i style={{ transform: `scaleX(${card.phase === 'read' ? card.visits / FINAL.visits : 1})` }} />
              </div>
              <Answer text={s.text} shown={card.phase === 'read' ? 0 : card.shown} point={s.point} wait={card.phase === 'read'} />
              {/* both lines hold their place, so the card keeps its size as one gives way to the other */}
              <p className="l-ask-foot">
                <span className={card.phase === 'read' ? 'on' : ''}>KataGo is reading this position in your browser…</span>
                <span className={card.phase !== 'read' && card.shown >= s.text.split(' ').length ? 'on' : ''}>{s.foot}</span>
              </p>
          </div>
        </figure>
      )}
      <div className="l-hero-foot">
      {gl && (
        <p className="l-legend" aria-hidden="true">
          <i className="col" /> a move KataGo is considering: the taller the column, the more KataGo checked it <i className="tag">20%</i> Black’s win rate if played
        </p>
      )}
      {gl && !still && (
        <button type="button" className="l-pause" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Play the demo' : 'Pause the demo'} aria-pressed={paused}>
          {paused ? (
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M5 3.5v9l7.5-4.5z" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4.5 3h2.4v10H4.5zM9.1 3h2.4v10H9.1z" />
            </svg>
          )}
        </button>
      )}
      </div>
    </section>
  );
}
