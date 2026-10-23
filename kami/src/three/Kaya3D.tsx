/**
 * The app's board in 3D: KayaView seen from a little in front, as a board on a table looks
 * (or straight down), with the same props as the flat Board. Taps are ray-cast onto the board,
 * so they land on the point under the finger at any angle. Words and numbers (winrates, move
 * numbers, coordinates, marks) are HTML laid over the canvas at each point's projected
 * position, so they stay sharp. Nothing pulses or ripples.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CandidateMark, Mark } from '../../../src/components/Board';
import { PASS, type Color, type Loc, type Move } from '../../../src/lib/go/types';
import { KayaView, type BoardWood, type PaleMark, type StoneColor } from './kaya';
import './kaya3d.css';

export interface Kaya3DProps {
  size: number;
  stones: ArrayLike<number>;
  lastMove?: Loc | null;
  toPlay?: Color;
  onPlay?: (loc: Loc) => void;
  marks?: Mark[];
  ownership?: ArrayLike<number> | null;
  coords?: boolean;
  crop?: { x0: number; y0: number; x1: number; y1: number };
  candidates?: CandidateMark[] | null;
  /** The figure on a pale stone in place of the win chance (e.g. the lead once a game is decided). */
  candLabel?: (c: CandidateMark) => string;
  onCandidateHover?: (loc: Loc | null) => void;
  onCandidateClick?: (loc: Loc) => void;
  variation?: Move[] | null;
  /** Degrees the view leans back from straight down (0 = straight down). */
  tilt?: number;
  wood?: BoardWood;
  ariaLabel?: string;
  /** Shown until the first 3D frame is drawn (its shaders compile in the background first). */
  placeholder?: ReactNode;
}

const COLS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
/** A win chance as a whole number out of 100. */
const winText = (w: number) => {
  const p = w * 100;
  return p >= 99.5 ? '100' : p < 0.5 ? '0' : p.toFixed(0);
};
const STONE_TOP = 0.0088;
/** The board's thickness in metres (KayaView's default). */
const BOARD_T = 0.06;

interface Label {
  key: string;
  loc: Loc;
  lift: number;
  cls: string;
  text?: string;
  sub?: string;
  /** Offset in board cells (coordinates sit outside the grid). */
  dx?: number;
  dy?: number;
}

export default function Kaya3D(p: Kaya3DProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const viewRef = useRef<KayaView | null>(null);
  // bumped each time a view is made (board size or wood changed), so everything is set on the new one
  const [ready, setReady] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const lite = useRef(false);
  const size = p.size;

  // the view lives as long as the board size does
  useEffect(() => {
    const c = canvas.current!;
    lite.current = window.matchMedia('(pointer: coarse)').matches;
    const v = new KayaView({ canvas: c, size, toneMapping: 'aces', exposure: 0.9, lite: lite.current, wood: p.wood ?? 'kaya', ripples: false, sun: { elev: 36, azim: 150 }, sunStrength: 3.4, envIntensity: 0.5 });
    viewRef.current = v;
    // development builds only: the view, for checking marks from the console or a test browser
    if (import.meta.env.DEV) (window as unknown as { __kaya3d?: KayaView }).__kaya3d = v;
    const ro = new ResizeObserver(() => v.setSize(c.clientWidth, c.clientHeight));
    ro.observe(c);
    v.setSize(c.clientWidth, c.clientHeight);
    setReady((r) => r + 1);
    v.drawn.then(() => setDrawn(true));
    // draw only while the board is on screen and the tab is showing; it catches up with one frame
    let onScreen = true;
    const sync = () => v.setActive(onScreen && !document.hidden);
    const vis = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      sync();
    });
    vis.observe(c);
    document.addEventListener('visibilitychange', sync);
    return () => {
      ro.disconnect();
      vis.disconnect();
      document.removeEventListener('visibilitychange', sync);
      v.dispose();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, p.wood]);

  // fitted to the board or its crop, leaving room for the coordinates; a crop is always seen straight down
  const cropKey = p.crop ? `${p.crop.x0},${p.crop.y0},${p.crop.x1},${p.crop.y1}` : '';
  const tilt = p.crop ? 0 : (p.tilt ?? 0);
  useEffect(() => {
    viewRef.current?.setView({ kind: 'top', crop: p.crop ?? null, pad: p.coords ? 0.95 : 0.1, tilt }, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, cropKey, p.coords, tilt]);

  useEffect(() => {
    viewRef.current?.setStones(p.stones);
  }, [ready, p.stones]);

  // KataGo's best moves as pale cream stones, each with its win chance printed on it in dark ink
  // (see-through, and numbered, so they never pass for real stones); a line of play (hovering a
  // move) as numbered stones of each colour. Nothing glows or pulses.
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    if (p.variation?.length) {
      const seen = new Set<Loc>();
      const marks: PaleMark[] = [];
      p.variation.forEach((m, i) => {
        if (m.loc === PASS || seen.has(m.loc)) return;
        seen.add(m.loc);
        marks.push({ loc: m.loc, color: m.color as StoneColor, text: String(i + 1), alpha: 0.88 });
      });
      v.setPale(marks);
      return;
    }
    const side = (p.toPlay ?? 1) as StoneColor;
    const light = p.wood === 'shinkaya';
    const marks = (p.candidates ?? [])
      .filter((c) => c.loc !== PASS && !p.stones[c.loc])
      // on the pale shin-kaya a see-through cream stone would vanish, so it is nearly solid there
      .map((c) => ({ loc: c.loc, color: side, text: p.candLabel ? p.candLabel(c) : winText(c.winrate), alpha: light ? (c.rank === 0 ? 0.97 : 0.9) : c.rank === 0 ? 0.86 : 0.72, cream: true }));
    v.setPale(marks.length ? marks : null);
  }, [ready, p.candidates, p.candLabel, p.variation, p.toPlay, p.stones, p.wood]);

  const hadOwn = useRef(false);
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.setOwnership(p.ownership ?? null, !hadOwn.current);
    hadOwn.current = !!p.ownership;
  }, [ready, p.ownership, p.stones]);


  // ------------------------------------------------------------- labels over the canvas

  const labels = useMemo(() => {
    const out: Label[] = [];
    const st = p.stones;
    if (p.lastMove != null && p.lastMove !== PASS && st[p.lastMove] && !p.variation?.length) out.push({ key: `last${p.lastMove}`, loc: p.lastMove, lift: STONE_TOP, cls: `k3-last ${st[p.lastMove] === 1 ? 'on-b' : 'on-w'}` });
    for (const [k, m] of (p.marks ?? []).entries()) {
      if (m.loc === PASS || m.loc == null) continue;
      out.push({ key: `m${k}`, loc: m.loc, lift: st[m.loc] ? STONE_TOP : 0.0004, cls: `k3-mark k3-${m.kind}`, text: m.label });
    }
    if (p.coords) {
      const c = p.crop ?? { x0: 0, y0: 0, x1: size - 1, y1: size - 1 };
      const whole = !p.crop;
      const off = whole ? 1.22 : 0.95;
      // seen at an angle, the bottom letters sit on the table just in front of the board, below its front face
      const front = whole && tilt > 0 ? -BOARD_T : 0;
      for (let x = c.x0; x <= c.x1; x++) {
        out.push({ key: `cx${x}`, loc: c.y1 * size + x, lift: front, cls: 'k3-coord', text: COLS[x], dy: front ? 1.3 : off });
        out.push({ key: `cxt${x}`, loc: c.y0 * size + x, lift: 0, cls: 'k3-coord', text: COLS[x], dy: -off });
      }
      for (let y = c.y0; y <= c.y1; y++) {
        out.push({ key: `cy${y}`, loc: y * size + c.x0, lift: 0, cls: 'k3-coord', text: String(size - y), dx: -off });
        out.push({ key: `cyr${y}`, loc: y * size + c.x1, lift: 0, cls: 'k3-coord', text: String(size - y), dx: off });
      }
    }
    return out;
  }, [p.stones, p.variation, p.candidates, p.lastMove, p.marks, p.coords, p.crop, size, tilt]);

  // place them after every frame the view draws (the camera may be easing)
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const place = () => {
      const el = layer.current;
      if (!el) return;
      const kids = el.children;
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i] as HTMLElement;
        const L = labels[i];
        if (!L) continue;
        const pt = v.project(L.loc, L.lift, L.dx ?? 0, L.dy ?? 0);
        k.style.transform = `translate(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px)`;
      }
      // text scales with the board: one grid cell in CSS px
      const a = v.project(0, 0), b = v.project(1, 0);
      el.style.setProperty('--cell', `${Math.hypot(b.x - a.x, b.y - a.y).toFixed(2)}px`);
    };
    v.onFrame = place;
    // the labels moved, not anything that casts a shadow
    v.invalidate(false);
    return () => {
      if (v.onFrame === place) v.onFrame = null;
    };
  }, [labels, ready]);

  // ------------------------------------------------------------- pointer

  const hoverCand = useRef<Loc | null>(null);
  const locAt = (e: React.PointerEvent) => {
    const v = viewRef.current;
    if (!v) return null;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return v.gridAt(e.clientX - r.left, e.clientY - r.top);
  };
  const toLoc = (g: { gx: number; gy: number } | null) => {
    if (!g) return null;
    const x = Math.round(g.gx), y = Math.round(g.gy);
    if (x < 0 || y < 0 || x >= size || y >= size) return null;
    if (p.crop && (x < p.crop.x0 || x > p.crop.x1 || y < p.crop.y0 || y > p.crop.y1)) return null;
    return y * size + x;
  };
  const onMove = (e: React.PointerEvent) => {
    const g = locAt(e);
    const l = toLoc(g);
    const v = viewRef.current;
    if (v && p.onPlay) v.setHover(l, l !== null && !p.stones[l] ? ((p.toPlay ?? null) as StoneColor | null) : null);
    // a candidate keeps the hover until the pointer is clearly past it (no flicker at cell edges)
    if (p.candidates?.length && g) {
      let best: Loc | null = null, bestD = Infinity;
      for (const c of p.candidates) {
        const d = Math.hypot(g.gx - (c.loc % size), g.gy - Math.floor(c.loc / size));
        if (d < bestD) {
          bestD = d;
          best = c.loc;
        }
      }
      const cur = hoverCand.current;
      const next = cur !== null && best === cur && bestD <= 0.85 ? cur : bestD <= 0.62 ? best : null;
      if (next !== cur) {
        hoverCand.current = next;
        p.onCandidateHover?.(next);
      }
    }
  };
  const onLeave = () => {
    viewRef.current?.setHover(null, null);
    if (hoverCand.current !== null) {
      hoverCand.current = null;
      p.onCandidateHover?.(null);
    }
  };
  const onClick = (e: React.PointerEvent) => {
    const l = toLoc(locAt(e));
    if (l === null || p.stones[l]) return;
    if (p.onPlay) p.onPlay(l);
    else if (p.candidates?.some((c) => c.loc === l)) p.onCandidateClick?.(l);
  };

  return (
    <div ref={wrap} className={`k3${p.onPlay ? ' playable' : ''}`} role="img" aria-label={p.ariaLabel ?? 'Go board'}>
      {!drawn && p.placeholder && <div className="k3-wait">{p.placeholder}</div>}
      <canvas ref={canvas} className="k3-canvas" onPointerMove={onMove} onPointerLeave={onLeave} onClick={onClick as unknown as React.MouseEventHandler} />
      <div ref={layer} className="k3-layer" aria-hidden="true">
        {labels.map((L) => (
          <span key={L.key} className={`k3-l ${L.cls}`}>
            {L.text !== undefined && <b>{L.text}</b>}
            {L.sub && <i>{L.sub}</i>}
          </span>
        ))}
      </div>
    </div>
  );
}

