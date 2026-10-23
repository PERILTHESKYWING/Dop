/**
 * The landing's one picture: Kiai's kaya board on a marble table above the cloud sea (a
 * path-traced 360° sky, tools/kiai-art/sky_pano.py), drawn live with three.js. It stays put while
 * the page scrolls; the scroll moves the camera between one view per chapter (`camAt`), so the
 * same sky is always behind it. What the board shows follows the chapter (`show`).
 */
import { useEffect, useRef, useState } from 'react';
import { KayaView, type PaleMark, type StoneColor } from '../../three/kaya';
import { webglOk } from '../../three/support';
import { DEMO, FINAL, GAME, loc, STONES } from './data';
import FlatStage from './FlatStage';
import { LINE, PICK, READS, TURN } from './story';
import { camAt, SKY_TURN, skyUrl, T, type Box, type Cam } from './camera';

/** What the board shows. */
export type Show =
  | { kind: 'ask' }
  | { kind: 'reading'; step: number }
  | { kind: 'next'; n: number }
  | { kind: 'ahead' }
  | { kind: 'review' }
  | { kind: 'start' };

export type { Box };

const SUN_ELEV = 34;
const SUN = 3.2;
const ENV = 0.75;
const EXPOSURE = 1.15;

let devCam: Partial<Cam> = {};

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
      skyUrl: skyUrl(),
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
      const cam = { ...camAt(p, w / Math.max(1, h), (i) => boxRef.current(i, tall)), ...devCam };
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
