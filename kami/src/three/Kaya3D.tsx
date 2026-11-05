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
import { CHIP_H, CHIP_W, KayaView, WOOD_DX, WOOD_DY, type BoardWood, type PaleMark, type StoneColor } from './kaya';
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
  /**
   * A phone: larger coordinates, set further out from the wood, with the frame widened for them
   * (critics, 2026-11-03: A-T read as one squeezed string against the wood's edge).
   */
  bigCoords?: boolean;
  crop?: { x0: number; y0: number; x1: number; y1: number };
  candidates?: CandidateMark[] | null;
  /** The figure on a pale stone in place of the win chance (e.g. the lead once a game is decided). */
  candLabel?: (c: CandidateMark) => string;
  /** A phone: numbered marks larger than their point, the ones labelled '' small bare rings (as Board's candBig). */
  candBig?: boolean;
  /** With candBig: a numbered mark's place, moved off its point by (dx, dy) and its radius (points), as Board's. */
  candPlace?: (c: CandidateMark) => { dx: number; dy: number; r: number } | undefined;
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
  /** A frame's size in board cells (the focus frame round a chip). */
  w?: number;
  h?: number;
}

export default function Kaya3D(p: Kaya3DProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const edge = useRef<SVGPolygonElement>(null);
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
    viewRef.current?.setView({ kind: 'top', crop: p.crop ?? null, pad: p.coords ? (p.bigCoords ? 1.25 : 0.95) : 0.1, tilt }, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, cropKey, p.coords, p.bigCoords, tilt]);

  useEffect(() => {
    viewRef.current?.setStones(p.stones);
  }, [ready, p.stones]);

  // KataGo's best moves printed flat on the wood, each a ring in the colour to play with its
  // number in ink (cream stones read as White's stones with Black to play), as on the flat
  // board; a line of play (hovering a move) as numbered stones of each colour. Nothing glows
  // or pulses.
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
    const marks = (p.candidates ?? [])
      .filter((c) => c.loc !== PASS && !p.stones[c.loc])
      .map((c): PaleMark => {
        const text = p.candLabel ? p.candLabel(c) : winText(c.winrate);
        const place = text && p.candBig ? p.candPlace?.(c) : undefined;
        // the printed disc is 0.48 of the plane: scale = radius in points / 0.48
        const scale = !text ? 0.8 : p.candBig ? (place?.r ?? 0.76) / 0.477 : 1;
        return { loc: c.loc, color: side, text, alpha: 1, token: { best: c.rank === 0, scale, dx: place?.dx, dy: place?.dy } };
      });
    v.setPale(marks.length ? marks : null);
  }, [ready, p.candidates, p.candLabel, p.candBig, p.candPlace, p.variation, p.toPlay, p.stones]);

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
      const onStone = !!st[m.loc] || !!p.variation?.some((v) => v.loc === m.loc);
      // keyboard focus on one of KataGo's chips: a frame round the chip, where it is drawn, so its
      // number stays readable (critics, 2026-11-05: the round focus ring covered "1.3")
      const cand = m.kind === 'focus' && !onStone && !p.variation?.length ? p.candidates?.find((c) => c.loc === m.loc && c.rank !== 0) : undefined;
      const text = cand ? (p.candLabel ? p.candLabel(cand) : winText(cand.winrate)) : '';
      if (cand && text) {
        const place = p.candBig ? p.candPlace?.(cand) : undefined;
        const r = p.candBig ? (place?.r ?? 0.76) : 0.477;
        out.push({ key: `m${k}`, loc: m.loc, lift: 0.0004, cls: 'k3-mark k3-focus on-chip', dx: place?.dx, dy: place?.dy, w: (r * CHIP_W) / 61, h: (r * CHIP_H) / 61 });
        continue;
      }
      out.push({ key: `m${k}`, loc: m.loc, lift: onStone ? STONE_TOP : 0.0004, cls: `k3-mark k3-${m.kind}${onStone ? ' on-stone' : ''}`, text: m.label });
    }
    if (p.coords) {
      const c = p.crop ?? { x0: 0, y0: 0, x1: size - 1, y1: size - 1 };
      const whole = !p.crop;
      const off = whole ? (p.bigCoords ? 1.5 : 1.22) : p.bigCoords ? 1.1 : 0.95;
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
  }, [p.stones, p.variation, p.candidates, p.candLabel, p.candBig, p.candPlace, p.lastMove, p.marks, p.coords, p.bigCoords, p.crop, size, tilt]);

  // place them after every frame the view draws (the camera may be easing)
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const big = !!p.bigCoords;
    // a label's size is written only when its rounded value changes: place() runs on every
    // camera frame, and a style write each time restyled every label (performance critic)
    const setFont = (b: HTMLElement, v: string) => {
      if (b.dataset.fs !== v) {
        b.dataset.fs = v;
        b.style.fontSize = v;
      }
    };
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
        // a phone's side numbers: sized to their own row's height, which the lean shrinks toward
        // the far edge, so 19, 18, 17 keep about 3 px apart instead of touching (critics, 2026-11-03)
        if (big && L.dx) {
          const row = Math.floor(L.loc / size);
          const q = v.project(row < size - 1 ? L.loc + size : L.loc - size, L.lift, L.dx, 0);
          const pitch = Math.abs(q.y - pt.y);
          const b = k.firstElementChild as HTMLElement | null;
          if (b) setFont(b, `${Math.max(11, Math.min(16, (pitch - 3) / 0.66)).toFixed(1)}px`);
        } else if (big && L.dy && !L.dx) {
          // and its letters the same way, to their own column's width there: the far (top) row's
          // columns are about 12 px apart, so M and N keep 4 px between them instead of touching
          // (critics, 2026-11-03/04: the top row A-T read as one squeezed string). The widest
          // capital (M) is about 0.72 em at the 0.84 squeeze (kaya3d.css), two side by side 0.68.
          const col = L.loc % size;
          const q = v.project(col < size - 1 ? L.loc + 1 : L.loc - 1, L.lift, 0, L.dy);
          const pitch = Math.abs(q.x - pt.x);
          const b = k.firstElementChild as HTMLElement | null;
          if (b) setFont(b, `${Math.max(11, Math.min(16, (pitch - 4) / 0.68)).toFixed(1)}px`);
        }
      }
      // text scales with the board: one grid cell in CSS px
      const a = v.project(0, 0), b = v.project(1, 0);
      el.style.setProperty('--cell', `${Math.hypot(b.x - a.x, b.y - a.y).toFixed(2)}px`);
      // the keyboard focus ring's outline: just outside the wood's edge, and down its front face
      // when the board leans back (shown only while the board has keyboard focus, kaya3d.css)
      const e = edge.current;
      if (e) {
        const n = size - 1, mx = WOOD_DX + 0.1, my = WOOD_DY + 0.1;
        const tl = 0, tr = n, br = n * size + n, bl = n * size;
        const low = tilt > 0 ? -BOARD_T : 0;
        const pts = [v.project(tl, 0, -mx, -my), v.project(tr, 0, mx, -my), v.project(br, 0, mx, my)];
        if (low) pts.push(v.project(br, low, mx, my), v.project(bl, low, -mx, my));
        pts.push(v.project(bl, 0, -mx, my));
        e.setAttribute('points', pts.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' '));
      }
    };
    v.onFrame = place;
    // the labels moved, not anything that casts a shadow
    v.invalidate(false);
    return () => {
      if (v.onFrame === place) v.onFrame = null;
    };
  }, [labels, ready, size, tilt, p.bigCoords]);

  // ------------------------------------------------------------- pointer

  const hoverCand = useRef<Loc | null>(null);
  /** Hover and tap areas round a candidate reach at least this far (CSS px): 24 px across (WCAG 2.5.8). */
  const HIT_PX = 12;
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
  /**
   * The candidate whose mark (where it is drawn: a phone's may sit a little off its point) is
   * nearest the pointer, how far (points), and the reach of a hover or tap there: 0.62 of a point
   * and at least HIT_PX either way (24 px across on a phone, whose points are about 14 px apart).
   */
  const nearestCand = (e: React.PointerEvent | React.MouseEvent, g: { gx: number; gy: number }) => {
    if (!p.candidates?.length) return null;
    let best: Loc | null = null, bestD = Infinity;
    for (const c of p.candidates) {
      const at = p.candBig ? p.candPlace?.(c) : undefined;
      const d = Math.hypot(g.gx - (c.loc % size) - (at?.dx ?? 0), g.gy - Math.floor(c.loc / size) - (at?.dy ?? 0));
      if (d < bestD) {
        bestD = d;
        best = c.loc;
      }
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const g2 = viewRef.current?.gridAt(e.clientX - r.left + HIT_PX, e.clientY - r.top);
    const reach = Math.max(0.62, g2 ? Math.hypot(g2.gx - g.gx, g2.gy - g.gy) : 0);
    return best === null ? null : { loc: best, d: bestD, reach };
  };
  const onMove = (e: React.PointerEvent) => {
    const g = locAt(e);
    const l = toLoc(g);
    const v = viewRef.current;
    if (v && p.onPlay) v.setHover(l, l !== null && !p.stones[l] ? ((p.toPlay ?? null) as StoneColor | null) : null);
    // a candidate keeps the hover until the pointer is clearly past it (no flicker at cell edges)
    const near = g ? nearestCand(e, g) : null;
    if (near) {
      const cur = hoverCand.current;
      const next = cur !== null && near.loc === cur && near.d <= near.reach + 0.23 ? cur : near.d <= near.reach ? near.loc : null;
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
    const g = locAt(e);
    // a tap on a phone's mark (larger than its point, maybe moved off it) takes its move
    const near = p.candBig && g ? nearestCand(e, g) : null;
    const l = near && near.d <= near.reach ? near.loc : toLoc(g);
    if (l === null || p.stones[l]) return;
    if (p.onPlay) p.onPlay(l);
    else if (p.candidates?.some((c) => c.loc === l)) p.onCandidateClick?.(l);
  };

  return (
    <div ref={wrap} className={`k3${p.onPlay ? ' playable' : ''}${p.bigCoords ? ' big-coords' : ''}`} role="img" aria-label={p.ariaLabel ?? 'Go board'}>
      {!drawn && p.placeholder && <div className="k3-wait">{p.placeholder}</div>}
      <canvas ref={canvas} className="k3-canvas" onPointerMove={onMove} onPointerLeave={onLeave} onClick={onClick as unknown as React.MouseEventHandler} />
      <div ref={layer} className="k3-layer" aria-hidden="true">
        {labels.map((L) => (
          <span key={L.key} className={`k3-l ${L.cls}`} style={L.w ? ({ '--fw': L.w.toFixed(3), '--fh': (L.h ?? L.w).toFixed(3) } as React.CSSProperties) : undefined}>
            {L.text !== undefined && <b>{L.text}</b>}
            {L.sub && <i>{L.sub}</i>}
          </span>
        ))}
      </div>
      {!p.crop && (
        <svg className="k3-edge" aria-hidden="true">
          <polygon ref={edge} />
        </svg>
      )}
    </div>
  );
}

