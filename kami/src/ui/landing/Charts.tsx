/**
 * The landing's diagrams, drawn from the recorded engine data: KataGo's read growing (a count,
 * a bar per move, and its pick changing), the line of play as a book diagram, who is likely to
 * win, and a whole game's chance to win with the move where it turned. Their words are as large
 * as the page's.
 */
import { useEffect, useRef, useState } from 'react';
import { Board } from '../../../../src/components/Board';
import { BOOK_SKIN } from '../skin';
import { DEMO, loc, STONES } from './data';
import { BLACK_WINS, LINE, PICKS, READ_ROWS, READS, TURN, TURN_FROM, TURN_TO } from './story';

const fmt = (n: number) => n.toLocaleString('en-US');

/** A number that counts up (or down) to `to` over `ms`. */
function useCount(to: number, ms = 900) {
  const [v, setV] = useState(to);
  const from = useRef(to);
  useEffect(() => {
    const a = from.current;
    if (a === to) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - (1 - k) ** 3;
      const x = Math.round(a + (to - a) * e);
      setV(x);
      from.current = x;
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return v;
}

/** The read growing: how many positions KataGo has read, how long it looked at each move, and its pick. */
export function ReadingChart({ step }: { step: number }) {
  const r = READS[Math.min(step, READS.length - 1)];
  const best = r.cands[0]?.at;
  const count = useCount(r.visits);
  const changed = best === PICKS.then.at;
  return (
    <div className="l-chart l-reading">
      <p className="l-count" aria-label={`${fmt(r.visits)} positions read`}>
        <b>{fmt(count)}</b>
        <span>positions read</span>
      </p>
      <p className="l-chart-head">How long it looked at each point</p>
      <ul aria-label="How long KataGo looked at each point">
        {READ_ROWS.map((at) => {
          const share = r.cands.find((x) => x.at === at)?.share ?? 0;
          return (
            <li key={at} className={at === best ? 'best' : undefined}>
              <span className="l-row-at">{at}</span>
              <span className="l-bar">
                <i style={{ transform: `scaleX(${share.toFixed(3)})` }} />
              </span>
            </li>
          );
        })}
      </ul>
      <div className={`l-pick${changed ? ' changed' : ''}`}>
        <span className="l-pick-a">
          <small>{PICKS.first.label}</small>
          <b>{PICKS.first.at}</b>
        </span>
        <svg className="l-arrow" viewBox="0 0 48 24" aria-hidden="true">
          <path d="M2 12h40M32 4l10 8-10 8" />
        </svg>
        <span className="l-pick-b">
          <small>{PICKS.then.label}</small>
          <b>{PICKS.then.at}</b>
        </span>
      </div>
    </div>
  );
}

/**
 * The line of play as a Go book prints it: the corner of the board it happens in, flat on paper,
 * with each move's number on its stone (the newest in seal red). It grows with the 3D board.
 */
export function LineDiagram({ n }: { n: number }) {
  const moves = LINE.slice(0, n).map((g, i) => ({ loc: loc(g), color: (i % 2 === 0 ? DEMO.toPlay : 3 - DEMO.toPlay) as 1 | 2 }));
  return (
    <div className="l-diagram" aria-label={`The first ${n} of ${LINE.length} moves, numbered`}>
      <Board size={19} stones={STONES} crop={LINE_CROP} coords={false} variation={moves} skin={BOOK_SKIN} detail="lite" className="book" animate={false} />
    </div>
  );
}

/** The part of the board the line is played in: its moves plus a point round them, made square. */
const LINE_CROP = (() => {
  const xs = LINE.map((g) => loc(g) % 19), ys = LINE.map((g) => Math.floor(loc(g) / 19));
  let x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, y0 = Math.min(...ys) - 1, y1 = Math.max(...ys) + 1;
  while (x1 - x0 < y1 - y0) if (x1 < 18) x1++; else x0--;
  while (y1 - y0 < x1 - x0) if (y1 < 18) y1++; else y0--;
  return { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(18, x1), y1: Math.min(18, y1) };
})();

/** Each side's chance to win, out of 100, as two big numbers and one bar that settles from even. */
export function ChanceBar({ on }: { on: boolean }) {
  const b = BLACK_WINS;
  const bn = useCount(on ? b : 50, 1400);
  return (
    <div className="l-chart l-chance" aria-label={`Black wins ${b} times out of 100, White ${100 - b}.`}>
      <div className="l-chance-nums" aria-hidden="true">
        <span>
          <b>{bn}</b> Black
        </span>
        <span>
          White <b>{100 - bn}</b>
        </span>
      </div>
      <span className="l-chance-bar" aria-hidden="true">
        <i style={{ transform: `scaleX(${on ? b / 100 : 0.5})` }} />
      </span>
      <p className="l-chart-head">Chance to win, out of 100</p>
    </div>
  );
}

const W = 520, H = 230, PAD = 8;

/** Black's chance to win across a whole game, the line drawing itself in; the turning move marked. */
export function GameChart({ on }: { on: boolean }) {
  const w = DEMO.review.bWin;
  const n = w.length - 1;
  const x = (i: number) => PAD + (i / n) * (W - 2 * PAD);
  const y = (v: number) => PAD + (1 - v) * (H - 2 * PAD);
  const d = w.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const i0 = TURN.n - 1, i1 = TURN.n;
  return (
    <figure className={`l-chart l-game${on ? ' on' : ''}`} aria-label={`Black's chance to win over the ${n} moves of the game. At move ${TURN.n} it falls from ${TURN_FROM} to ${TURN_TO}.`}>
      <figcaption className="l-chart-head">Black’s chance to win, move by move</figcaption>
      <p className="l-game-note" aria-hidden="true">
        <b>Move {TURN.n}:</b> {TURN_FROM}% → {TURN_TO}%
      </p>
      <div className="l-game-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="presentation">
          <rect className="l-frame" x={0} y={0} width={W} height={H} rx={10} />
          <line className="l-mid" x1={PAD} x2={W - PAD} y1={y(0.5)} y2={y(0.5)} />
          <path className="l-under" d={d} pathLength={1} />
          <path className="l-line" d={d} pathLength={1} />
          <line className="l-drop" x1={x(i0)} x2={x(i1)} y1={y(w[i0])} y2={y(w[i1])} />
          <circle className="l-dot" cx={x(i0)} cy={y(w[i0])} r={7} />
          <circle className="l-dot" cx={x(i1)} cy={y(w[i1])} r={7} />
        </svg>
        <span className="l-axis top" aria-hidden="true">
          100%
        </span>
        <span className="l-axis bottom" aria-hidden="true">
          0%
        </span>

      </div>
      <div className="l-axis-x" aria-hidden="true">
        <span>Move 1</span>
        <span>Move {n}</span>
      </div>
    </figure>
  );
}
