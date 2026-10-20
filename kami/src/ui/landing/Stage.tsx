/**
 * The landing's one picture: Kiai's kaya board on a marble table above the cloud sea (a
 * path-traced 360° sky, tools/kiai-art/sky_pano.py), drawn live with three.js. It stays put while
 * the page scrolls; the scroll moves the camera between one view per chapter (`camAt`), so the
 * same sky is always behind it. What the board shows follows the chapter (`show`).
 */
import { useEffect, useRef, useState } from 'react';
import { Board, type CandidateMark } from '../../../../src/components/Board';
import type { Move } from '../../../../src/lib/go/types';
import { KIAI_SKIN } from '../skin';
import { KayaView, type PaleMark, type StoneColor } from '../../three/kaya';
import { webglOk } from '../../three/support';
import { DEMO, FINAL, GAME, loc, STONES } from './data';
import { LINE, PICK, READS, TURN } from './story';

/** What the board shows. */
export type Show =
  | { kind: 'ask' }
  | { kind: 'reading'; step: number }
  | { kind: 'next'; n: number }
  | { kind: 'ahead' }
  | { kind: 'review' }
  | { kind: 'start' };

interface Cam {
  elev: number;
  azim: number;
  dist: number;
  target: [number, number, number];
  fov: number;
  /** Board off centre: right (a fraction of the width) and up (of the height). */
  shift: number;
  shiftY: number;
}
/** Where the board may be drawn: left, top, right, bottom, as fractions of the screen. */
export type Box = [number, number, number, number];

/**
 * One view per chapter: the angle the camera looks from. The distance is worked out each time so
 * the whole board fills the room the words leave (`fitOrbit`), never under them and never cut
 * off. `low` keeps the board in the lower part of that room, so the sky shows above it. The last
 * view looks up from the table into the sky, past the board.
 */
interface Key {
  elev: number;
  azim: number;
  fov: number;
  low?: number;
  free?: { dist: number; shift: number; shiftY: number; target: [number, number, number] };
}
const T = 0.055; // the board's thickness: a thick table board
const SKY_TURN = 50;
const SUN_ELEV = 34;
const SUN = 3.2;
const ENV = 0.75;
const EXPOSURE = 1.15;
// from just left of the pillar, looking out over the cloud sea towards the low sun (30° to the
// left), so the last screen is the sky the page has been in all along
const SKY: Key['free'] = { dist: 2.0, shift: 0, shiftY: 0, target: [-2.6, 0.14, -0.59] };
// wide screens (the words on the left) and tall ones (the words below)
const WIDE: Key[] = [
  { elev: 26, azim: -16, fov: 44, low: 0.46 },
  { elev: 50, azim: 22, fov: 40 },
  { elev: 64, azim: 36, fov: 40 },
  { elev: 84, azim: 0, fov: 38 },
  { elev: 34, azim: 32, fov: 44 },
  { elev: 9, azim: 60, fov: 50, free: SKY },
];
const TALL: Key[] = [
  { elev: 30, azim: -14, fov: 42 },
  { elev: 50, azim: 18, fov: 46 },
  { elev: 64, azim: 30, fov: 46 },
  { elev: 84, azim: 0, fov: 44 },
  { elev: 38, azim: 30, fov: 48 },
  { elev: 9, azim: 60, fov: 60, free: SKY },
];

let devCam: Partial<Cam> = {};
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function resolve(v: KayaView, k: Key, box: Box): Cam {
  if (k.free) return { elev: k.elev, azim: k.azim, fov: k.fov, ...k.free };
  const target: [number, number, number] = [0, T, 0];
  const b: Box = k.low ? [box[0], Math.max(box[1], k.low), box[2], box[3]] : box;
  return { elev: k.elev, azim: k.azim, fov: k.fov, target, ...v.fitOrbit({ elev: k.elev, azim: k.azim, fov: k.fov, target }, b) };
}

/**
 * The camera at scroll position `p` (in chapters): it rests at each chapter's view for a while
 * on either side of it and glides between them.
 */
export function camAt(v: KayaView, p: number, tall: boolean, box: (i: number) => Box): Cam {
  const K = tall ? TALL : WIDE;
  const i = Math.max(0, Math.min(K.length - 1, Math.floor(p)));
  const j = Math.min(K.length - 1, i + 1);
  const t = smooth((p - i - 0.2) / 0.6);
  const a = resolve(v, K[i], box(i));
  const b = t > 0 ? resolve(v, K[j], box(j)) : a;
  return {
    elev: mix(a.elev, b.elev, t),
    azim: mix(a.azim, b.azim, t),
    dist: mix(a.dist, b.dist, t),
    target: [mix(a.target[0], b.target[0], t), mix(a.target[1], b.target[1], t), mix(a.target[2], b.target[2], t)],
    fov: mix(a.fov, b.fov, t),
    shift: mix(a.shift, b.shift, t),
    shiftY: mix(a.shiftY, b.shiftY, t),
  };
}

const cream = (at: string, alpha: number): PaleMark => ({ loc: loc(at), color: 1, alpha, cream: true });

/**
 * The point the words talk about, named beside it on the board: a seal-red label on a short line
 * standing up from the stone, so "Q9" in the answer and Q9 on the board are plainly the same.
 */
interface Callout {
  /** Stays the same while one label moves from stone to stone (so it does not pop in again). */
  id: string;
  at: string;
  label: string;
}
function callouts(show: Show): Callout[] {
  if (show.kind === 'ask') return [{ id: 'ask', at: PICK, label: PICK }];
  if (show.kind === 'reading') {
    const best = READS[Math.min(show.step, READS.length - 1)].cands[0].at;
    return [{ id: `read${best}`, at: best, label: best }];
  }
  if (show.kind === 'review') return [{ id: 'review', at: TURN.at, label: `Move ${TURN.n}` }];
  return [];
}

/** The board's stones and marks for what it shows. */
function apply(v: KayaView, show: Show) {
  if (show.kind === 'review') {
    // the review's game just before its biggest swing, and that move with its number on it
    v.setStones(GAME.boards[TURN.n - 1]);
    v.setOwnership(null);
    v.setPale([{ loc: loc(TURN.at), color: TURN.color as StoneColor, alpha: 1 }]);
    return;
  }
  v.setStones(STONES);
  // only the points KataGo is fairly sure of, so the picture stays calm
  v.setOwnership(show.kind === 'ahead' ? FINAL.own.map((o) => (Math.abs(o) < 0.45 ? 0 : o)) : null, true, 1.45);
  if (show.kind === 'ask' || show.kind === 'start') v.setPale([cream(PICK, 0.92)]);
  else if (show.kind === 'reading') {
    // only KataGo's current favourite, named above it: the bars beside the board show the rest
    const r = READS[Math.min(show.step, READS.length - 1)];
    v.setPale([cream(r.cands[0].at, 0.95)]);
  } else if (show.kind === 'next') {
    // the stones go down as played; their numbers are on the book diagram beside the board
    v.setPale(LINE.slice(0, show.n).map((g, i) => ({ loc: loc(g), color: (i % 2 === 0 ? DEMO.toPlay : 3 - DEMO.toPlay) as StoneColor, alpha: 1 })));
  } else v.setPale(null);
}

export default function Stage({ show, at, camRef, boxRef, onReady }: { show: Show; at: React.MutableRefObject<number>; camRef: React.MutableRefObject<((p: number) => void) | null>; boxRef: React.MutableRefObject<(i: number, tall: boolean) => Box>; onReady: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<KayaView | null>(null);
  const last = useRef(0);
  const showRef = useRef(show);
  showRef.current = show;
  const marks = useRef<HTMLDivElement>(null);
  const notes = callouts(show);
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const [gl] = useState(() => webglOk());
  useEffect(() => {
    const c = canvas.current;
    if (!c) {
      onReady();
      return;
    }
    const lite = window.matchMedia('(pointer: coarse)').matches;
    const v = new KayaView({
      canvas: c,
      size: 19,
      thickness: T,
      table: true,
      fill: 0.9,
      skyUrl: lite ? '/kiai/sky-1536.webp' : '/kiai/sky.webp',
      // the panorama's sun sits at azimuth 130 as rendered (tools/kiai-art/sky_pano.py); three.js
      // turns an equirectangular background the other way round, so turned by SKY_TURN the sun
      // stands to the left of the first view (azimuth 180): the clouds ahead are lit from the side
      // and show their shape, and the wrap seam is behind. The light is a little higher than the
      // disc, for the board.
      skyTurn: SKY_TURN,
      sun: { elev: SUN_ELEV, azim: 130 + SKY_TURN },
      sunStrength: SUN,
      envIntensity: ENV,
      toneMapping: 'aces',
      exposure: EXPOSURE,
      ripples: false,
      lite,
    });
    view.current = v;
    // the labels follow their stones as the camera moves
    v.onFrame = () => {
      const el = marks.current;
      if (!el) return;
      notesRef.current.forEach((n, i) => {
        const k = el.children[i] as HTMLElement | undefined;
        if (!k) return;
        const pt = v.project(loc(n.at), 0.009);
        k.style.transform = `translate(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px)`;
        k.style.visibility = 'visible';
      });
    };
    const place = (p: number) => {
      last.current = p;
      const w = c.clientWidth, h = c.clientHeight;
      const tall = w / Math.max(1, h) < 0.9;
      const cam = { ...camAt(v, p, tall, (i) => boxRef.current(i, tall)), ...devCam };
      v.setView({ kind: 'orbit', ...cam });
    };
    camRef.current = place;
    // development builds: try camera views from the console or a test browser
    if (import.meta.env.DEV) {
      const w = window as unknown as { __cam?: (c: Partial<Cam>) => void; __landing?: KayaView };
      w.__cam = (c) => {
        devCam = c;
        place(last.current);
      };
      w.__landing = v;
    }
    last.current = at.current;
    const ro = new ResizeObserver(() => {
      v.setSize(c.clientWidth, c.clientHeight);
      place(last.current);
    });
    ro.observe(c);
    v.setSize(c.clientWidth, c.clientHeight);
    place(last.current);
    // the words' size (and so the room left for the board) changes when their font arrives
    document.fonts?.ready.then(() => view.current === v && place(last.current), () => undefined);
    apply(v, showRef.current);
    let done = false;
    const ready = () => {
      if (done) return;
      done = true;
      onReady();
    };
    v.onSky = () => requestAnimationFrame(ready);
    const t = window.setTimeout(ready, 4000);
    return () => {
      window.clearTimeout(t);
      ro.disconnect();
      camRef.current = null;
      v.dispose();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const key = JSON.stringify(show);
  useEffect(() => {
    if (view.current) {
      apply(view.current, show);
      view.current.invalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!gl) return <FlatStage show={show} boxRef={boxRef} onReady={onReady} />;
  return (
    <>
      <canvas ref={canvas} className="l-stage" aria-hidden="true" />
      <div ref={marks} className="l-callouts" aria-hidden="true">
        {notes.map((n) => (
          <div key={n.id} className="l-callout">
            <span>
              <b>{n.label}</b>
              <i />
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

const SHOW_INDEX: Record<Show['kind'], number> = { ask: 0, reading: 1, next: 2, ahead: 3, review: 4, start: 5 };

/** Without WebGL: the flat board, in the same room the 3D one would take, showing the same things. */
function FlatStage({ show, boxRef, onReady }: { show: Show; boxRef: React.MutableRefObject<(i: number, tall: boolean) => Box>; onReady: () => void }) {
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
  let variation: Move[] | null = null;
  let marks: { loc: number; kind: 'num'; label: string }[] | undefined;
  if (show.kind === 'ask') candidates = [cand(PICK, 0, FINAL.cands.find((c) => c.at === PICK)?.win ?? FINAL.bWin)];
  else if (show.kind === 'reading') candidates = READS[Math.min(show.step, READS.length - 1)].cands.map((c, i) => cand(c.at, i, c.win));
  else if (show.kind === 'next') variation = LINE.slice(0, show.n).map((g, i) => ({ loc: loc(g), color: (i % 2 === 0 ? DEMO.toPlay : 3 - DEMO.toPlay) as 1 | 2 }));
  else if (show.kind === 'review') {
    stones = GAME.boards[TURN.n];
    marks = [{ loc: loc(TURN.at), kind: 'num', label: String(TURN.n) }];
  }
  return (
    <div className="l-flat" style={{ left, top, width: side, height: side }} aria-hidden="true">
      <Board size={19} stones={stones} candidates={candidates} candStyle="plain" variation={variation} marks={marks} ownership={show.kind === 'ahead' ? FINAL.own : null} skin={KIAI_SKIN} coords={false} animate={false} />
    </div>
  );
}
