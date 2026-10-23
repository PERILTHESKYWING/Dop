/**
 * The landing's one picture: Kiai's kaya board resting on a sheet of washi, drawn live with
 * three.js on a transparent canvas over the paper (`.l-paper` in landing.css), as a product shot
 * on a paper sweep. A soft shadow drawn under it (`paperShadow`) lays the board on the page; no
 * sky, no pedestal. It stays put while the page scrolls; the scroll moves the camera between one
 * view per chapter (`camAt`). What the board shows follows the chapter (`show`).
 */
import { useEffect, useRef, useState } from 'react';
import { CanvasTexture, DefaultLoadingManager, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';
import { KayaView, type PaleMark, type StoneColor } from '../../three/kaya';
import { webglOk } from '../../three/support';
import { DEMO, FINAL, GAME, loc, STONES } from './data';
import FlatStage from './FlatStage';
import { LINE, PICK, READS, TURN } from './story';
import { camAt, T, type Box, type Cam } from './camera';

/** What the board shows. */
export type Show =
  | { kind: 'ask' }
  | { kind: 'reading'; step: number }
  | { kind: 'next'; n: number }
  | { kind: 'ahead' }
  | { kind: 'review' }
  | { kind: 'start' };

export type { Box };

// a soft window light from the upper left, as on a studio paper sweep
const SUN_ELEV = 42;
const SUN_AZIM = 135;
const SUN = 2.8;
const ENV = 0.8;
const EXPOSURE = 1.1;
/** The live board shows once its textures are in, or after this long at the latest. */
const READY_MAX = 1500;

let devCam: Partial<Cam> = {};

/**
 * The board's shadow on the paper, as under a large soft window light: a wide, faint penumbra
 * thrown away from the light, and a tight dark line where the wood meets the paper. A shadow map
 * would give one hard-edged slab, so it is painted once on a 2D canvas (blurred with shadowBlur,
 * which every browser has) and laid flat under the board.
 */
function paperShadow(T: number): Mesh<PlaneGeometry, MeshBasicMaterial> {
  // the 19×19 board's footprint (kaya.ts: 18 lines of 0.022 × 0.0237 plus margins), in metres
  const W = 0.424, L = 0.454;
  // where the shadow falls: away from the sun, as far as the board's thickness throws it
  const se = (SUN_ELEV * Math.PI) / 180, sa = (SUN_AZIM * Math.PI) / 180;
  const len = T / Math.tan(se);
  const dx = -Math.cos(sa) * len, dz = Math.sin(sa) * len;
  const P = 1.1; // the painted square's side, in metres
  const N = 1024;
  const px = N / P;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const X = (x: number) => (x + P / 2) * px, Z = (z: number) => (z + P / 2) * px;
  const far = 4 * N; // the shapes are drawn off the canvas; only their blurred shadows land on it
  const shape = (pts: [number, number][], blur: number, alpha: number) => {
    g.save();
    g.shadowColor = `rgba(58, 40, 18, ${alpha})`;
    g.shadowBlur = blur * px;
    g.shadowOffsetX = far;
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(X(x) - far, Z(z)) : g.moveTo(X(x) - far, Z(z))));
    g.closePath();
    g.fillStyle = '#000';
    g.fill();
    g.restore();
  };
  const w = W / 2, l = L / 2;
  // the board's outline swept along the shadow's direction (both offsets point the same way)
  shape([[-w, -l], [w, -l], [w + dx, -l + dz], [w + dx, l + dz], [-w + dx, l + dz], [-w, l]], 0.05, 0.36);
  shape([[-w, -l], [w, -l], [w + dx * 0.5, -l + dz * 0.5], [w + dx * 0.5, l + dz * 0.5], [-w + dx * 0.5, l + dz * 0.5], [-w, l]], 0.016, 0.38);
  shape([[-w, -l], [w, -l], [w, l], [-w, l]], 0.004, 0.5);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  const m = new Mesh(new PlaneGeometry(P, P).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
  m.position.y = 0.0001;
  m.renderOrder = -1;
  return m;
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
      table: false,
      // the paper under the canvas shows through; only the board's shadow is drawn on it
      fill: 0.9,
      sun: { elev: SUN_ELEV, azim: SUN_AZIM },
      sunStrength: SUN,
      envIntensity: ENV,
      toneMapping: 'aces',
      exposure: EXPOSURE,
      ripples: false,
      lite,
    });
    view.current = v;
    const shade = paperShadow(T);
    v.scene.add(shade);
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
    // the board's woods and the stones' shell load through three's default manager
    const prevLoad = DefaultLoadingManager.onLoad;
    DefaultLoadingManager.onLoad = () => {
      prevLoad?.();
      requestAnimationFrame(ready);
    };
    const t = window.setTimeout(ready, READY_MAX);
    return () => {
      window.clearTimeout(t);
      DefaultLoadingManager.onLoad = prevLoad;
      v.scene.remove(shade);
      shade.geometry.dispose();
      shade.material.map?.dispose();
      shade.material.dispose();
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
