/** The flat board, without three.js: for browsers with no WebGL or only a software one. */
import { useEffect, useState } from 'react';
import { Board, type CandidateMark } from '../../../../src/components/Board';
import { xy } from '../../../../src/lib/go/coords';
import { KIAI_SKIN } from '../skin';
import type { Box } from './camera';
import { DEMO, FINAL, GAME, loc, STONES } from './data';
import type { Show } from './Stage';
import { LINE, PICK, READS, TURN } from './story';

const SHOW_INDEX: Record<Show['kind'], number> = { ask: 0, reading: 1, next: 2, ahead: 3, review: 4, start: 5 };

/** Without WebGL: the flat board, in the same room the 3D one would take, showing the same things. */
export default function FlatStage({ show, boxRef, onReady }: { show: Show; boxRef: React.MutableRefObject<(i: number, tall: boolean) => Box>; onReady: () => void }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    onReady();
    const on = () => setTick((t) => t + 1);
    // measured again once the words are laid out and their font is in
    const raf = requestAnimationFrame(on);
    document.fonts?.ready.then(on, () => undefined);
    window.addEventListener('resize', on);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', on);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (show.kind === 'start') return null;
  const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
  const b = boxRef.current(SHOW_INDEX[show.kind], W / Math.max(1, H) < 0.9);
  const side = Math.min((b[2] - b[0]) * W, (b[3] - b[1]) * H);
  const left = ((b[0] + b[2]) / 2) * W - side / 2, top = ((b[1] + b[3]) / 2) * H - side / 2;
  const cand = (at: string, rank: number, winrate: number): CandidateMark => ({ loc: loc(at), rank, winrate, scoreLead: 0, visits: 0, share: 1, badness: 0 });
  let stones: ArrayLike<number> = STONES;
  let candidates: CandidateMark[] | null = null;
  let marks: { loc: number; kind: 'num'; label: string }[] | undefined;
  // the point the words name, flagged as on the 3D board (a seal-red label on a short line)
  let flag: string | null = null;
  if (show.kind === 'ask') flag = PICK;
  else if (show.kind === 'reading') candidates = READS[Math.min(show.step, READS.length - 1)].cands.map((c, i) => cand(c.at, i, c.win));
  else if (show.kind === 'next') {
    // the stones go down as played, without numbers: the book diagram beside the board has them
    const s = Array.from(STONES);
    LINE.slice(0, show.n).forEach((g, i) => (s[loc(g)] = i % 2 === 0 ? DEMO.toPlay : 3 - DEMO.toPlay));
    stones = s;
  } else if (show.kind === 'review') {
    stones = GAME.boards[TURN.n];
    marks = [{ loc: loc(TURN.at), kind: 'num', label: String(TURN.n) }];
  }
  return (
    <div className="l-flat" style={{ left, top, width: side, height: side }} aria-hidden="true">
      <Board size={19} stones={stones} candidates={candidates} candStyle="plain" marks={marks} ownership={show.kind === 'ahead' ? FINAL.own : null} skin={KIAI_SKIN} coords={false} animate={false} />
      {flag && <Flag at={flag} side={side} />}
    </div>
  );
}

/** A label over one point of the flat board (Board without coordinates: 0.6 of a line's margin). */
function Flag({ at, side }: { at: string; side: number }) {
  const [x, y] = xy(loc(at), 19);
  const px = ((x + 0.6) / 19.2) * side, py = ((y + 0.6) / 19.2) * side;
  return (
    <div className="l-callout" style={{ transform: `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`, visibility: 'visible' }}>
      <span>
        <b>{at}</b>
        <i />
      </span>
    </div>
  );
}
