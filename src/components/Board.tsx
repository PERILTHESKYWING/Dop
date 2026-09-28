import { memo, useEffect, useId, useMemo, useRef, useState, type JSX, type PointerEvent } from 'react';
import { BadgeShape } from './MoveBadge';
import type { MoveClass } from '../lib/coach/classify';
import { PASS, type Color, type Loc, type Move } from '../lib/go/types';
import './board.css';

export type MarkKind = 'best' | 'played' | 'you' | 'doppel' | 'cand' | 'pv' | 'evidence' | 'num' | 'var';

export interface Mark {
  loc: Loc;
  kind: MarkKind;
  label?: string;
}

/** A candidate move drawn Lizzie-style: winrate, visits and score on a coloured disc. */
export interface CandidateMark {
  loc: Loc;
  /** 0 = KataGo's choice (most visits). */
  rank: number;
  /** Winrate and score lead for the side to move after this move. */
  winrate: number;
  scoreLead: number;
  visits: number;
  /** Visits relative to the most visited move (0..1): fainter when less explored. */
  share: number;
  /** 0 = as good as the best move, 1 = clearly worse (colour runs green, yellow, red). */
  badness: number;
}

export interface BoardProps {
  size: number;
  stones: ArrayLike<number>;
  lastMove?: Loc | null;
  toPlay?: Color;
  onPlay?: (loc: Loc) => void;
  marks?: Mark[];
  heat?: ArrayLike<number> | null;
  ownership?: ArrayLike<number> | null;
  pending?: Loc | null;
  coords?: boolean;
  /** Crop to a window of the board (mini boards). */
  crop?: { x0: number; y0: number; x1: number; y1: number };
  className?: string;
  ariaLabel?: string;
  /**
   * How much of the physical set to draw. 'full' adds the board's front edge, its drop shadow
   * and the shell stripes of white stones; 'lite' leaves them out for thumbnails.
   * Default: 'full' for an uncropped board with coordinates, 'lite' otherwise.
   */
  detail?: 'full' | 'lite';
  /** Animate stones being placed and captured and the last-move marker (default true). */
  animate?: boolean;
  /** Candidate moves with their numbers (live analysis). */
  candidates?: CandidateMark[] | null;
  onCandidateHover?: (loc: Loc | null) => void;
  onCandidateClick?: (loc: Loc) => void;
  /** A line of play drawn as numbered see-through stones (a candidate's variation). */
  variation?: Move[] | null;
  /** A move classification badge on a stone (usually the last move). */
  badge?: { loc: Loc; cls: MoveClass } | null;
}

const CAND_BEST = '#2fc4e4';
const CAND_STOPS: [number, [number, number, number]][] = [
  [0, [120, 214, 104]],
  [0.5, [244, 197, 66]],
  [1, [236, 104, 72]],
];
function candColor(bad: number): string {
  const b = Math.max(0, Math.min(1, bad));
  for (let i = 1; i < CAND_STOPS.length; i++) {
    const [t1, c1] = CAND_STOPS[i];
    const [t0, c0] = CAND_STOPS[i - 1];
    if (b <= t1) {
      const f = (b - t0) / (t1 - t0);
      return `rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * f)).join(',')})`;
    }
  }
  return 'rgb(236,104,72)';
}

/** 1234 -> "1.2k", 56789 -> "57k". */
export function shortCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1e6) return `${Math.round(n / 1000)}k`;
  return `${(n / 1e6).toFixed(1)}m`;
}

type Crop = NonNullable<BoardProps['crop']>;

const COLS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
const KAYA = `${import.meta.env.BASE_URL}art/kaya.webp`;
/** Stone radii: black stones are cut a hair larger than white ones, as in real sets. */
const R_B = 0.483;
const R_W = 0.476;
/** Cast shadow of a stone: offset down-right, a little larger than the stone. */
const SH_DX = 0.06;
const SH_DY = 0.09;
const SH_R = 0.52;
const STRIPE_VARIANTS = 6;
const WHITE_VARIANTS = 3;

/** Integer hash, used to give each point its own shell stripes. */
function hash(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function hoshi(size: number): number[] {
  if (size < 9) return [];
  const e = size >= 13 ? 3 : 2;
  const pts = [e, size - 1 - e];
  const mid = (size - 1) / 2;
  const out: number[] = [];
  const list = size % 2 === 1 && size >= 13 ? [...pts, mid] : pts;
  for (const y of list) for (const x of list) out.push(y * size + x);
  if (size % 2 === 1 && size < 13) out.push(mid * size + mid);
  return out;
}

// ------------------------------------------------------------------ stone motion bookkeeping

interface Motion {
  /** Stones placed since the previous position, when that was a single step (1–2 stones). */
  added: ReadonlySet<number> | null;
  /** Stones captured by that step, drawn briefly while they fade out. */
  removed: { loc: number; color: number }[];
}
const STILL: Motion = { added: null, removed: [] };

interface Track {
  size: number;
  stones: Int8Array;
  motion: Motion;
}

function snapshot(stones: ArrayLike<number>, n: number): Int8Array {
  const out = new Int8Array(n);
  for (let i = 0; i < n; i++) out[i] = stones[i] ?? 0;
  return out;
}

function sameStones(a: Int8Array, b: ArrayLike<number>, n: number): boolean {
  if (a.length !== n) return false;
  for (let i = 0; i < n; i++) if (a[i] !== (b[i] ?? 0)) return false;
  return true;
}

/** Only a one- or two-stone step animates; a jump to another position just appears. */
function motionBetween(prev: Int8Array, next: ArrayLike<number>, n: number, lastMove: Loc | null | undefined): Motion {
  const added: number[] = [];
  const removed: Motion['removed'] = [];
  for (let i = 0; i < n; i++) {
    const a = prev[i];
    const b = next[i] ?? 0;
    if (a === b) continue;
    if (!a) {
      added.push(i);
      if (added.length > 2) return STILL;
    } else if (!b) removed.push({ loc: i, color: a });
    else return STILL;
  }
  if (!added.length || removed.length > 60) return STILL;
  // Stepping back re-adds captured stones; only animate when the last move is among the new stones.
  if (lastMove != null && lastMove !== PASS && !added.includes(lastMove)) return STILL;
  return { added: new Set(added), removed };
}

// ------------------------------------------------------------------ defs

function Defs({ id, full, heat, interactive }: { id: string; full: boolean; heat: boolean; interactive: boolean }) {
  const stripes: JSX.Element[] = [];
  if (full) {
    for (let k = 0; k < STRIPE_VARIANTS; k++) {
      // Growth lines of the shell: rings of a distant centre cross the stone as gentle arcs.
      const a = (k * Math.PI) / STRIPE_VARIANTS + 0.35;
      const d = 1.6 + 0.3 * (k % 3);
      const period = 0.13 + 0.025 * ((k * 7) % 4);
      stripes.push(
        <radialGradient
          key={k}
          id={`${id}-ss${k}`}
          cx={0.5 + d * Math.cos(a)}
          cy={0.5 + d * Math.sin(a)}
          fx={0.5 + d * Math.cos(a)}
          fy={0.5 + d * Math.sin(a)}
          r={period}
          spreadMethod="repeat"
        >
          <stop offset="0" stopColor="#9a8f7c" stopOpacity="0" />
          <stop offset="0.12" stopColor="#9a8f7c" stopOpacity="0.085" />
          <stop offset="0.26" stopColor="#9a8f7c" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.6" stopColor="#ffffff" stopOpacity="0.3" />
          <stop offset="0.7" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.82" stopColor="#9a8f7c" stopOpacity="0" />
          <stop offset="0.88" stopColor="#9a8f7c" stopOpacity="0.05" />
          <stop offset="0.95" stopColor="#9a8f7c" stopOpacity="0" />
        </radialGradient>,
      );
    }
  }
  return (
    <defs>
      {/* slate: near-black, a soft off-centre sheen and a faint cool rim */}
      <radialGradient id={`${id}-sb`} cx="0.5" cy="0.5" r="0.5" fx="0.36" fy="0.3">
        <stop offset="0" stopColor="#70747b" />
        <stop offset="0.13" stopColor="#4a4e55" />
        <stop offset="0.36" stopColor="#26292e" />
        <stop offset="0.68" stopColor="#141619" />
        <stop offset="0.9" stopColor="#0b0c0e" />
        <stop offset="0.965" stopColor="#171a1f" />
        <stop offset="1" stopColor="#272d36" />
      </radialGradient>
      {/* clamshell: warm white, gentle shading, a faint bluish-grey edge (three slight tints) */}
      {[
        ['#fdfbf6', '#f4efe5', '#e7e1d5', '#d9d6cf'],
        ['#fcf9f2', '#f2ece0', '#e5ded0', '#d8d4cb'],
        ['#fcfbf8', '#f2f0ea', '#e4e2db', '#d5d5d1'],
      ]
        .slice(0, full ? WHITE_VARIANTS : 1)
        .map(([a, b, c, d], k) => (
          <radialGradient key={k} id={`${id}-sw${k}`} cx="0.5" cy="0.5" r="0.5" fx={0.37 + 0.02 * k} fy={0.31 - 0.01 * k}>
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.22" stopColor={a} />
            <stop offset="0.52" stopColor={b} />
            <stop offset="0.8" stopColor={c} />
            <stop offset="0.93" stopColor={d} />
            <stop offset="0.98" stopColor="#c6cad0" />
            <stop offset="1" stopColor="#b2b9c3" />
          </radialGradient>
        ))}
      {stripes}
      <radialGradient id={`${id}-sh`}>
        <stop offset="0" stopColor="#2a1605" stopOpacity="0.52" />
        <stop offset="0.72" stopColor="#2a1605" stopOpacity="0.4" />
        <stop offset="0.88" stopColor="#2a1605" stopOpacity="0.15" />
        <stop offset="1" stopColor="#2a1605" stopOpacity="0" />
      </radialGradient>
      {heat && (
        <>
          <radialGradient id={`${id}-h0`}>
            <stop offset="0" stopColor="#ffa030" stopOpacity="0.95" />
            <stop offset="0.55" stopColor="#ff7a14" stopOpacity="0.7" />
            <stop offset="1" stopColor="#ff6a0a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-h1`}>
            <stop offset="0" stopColor="#ffc35c" stopOpacity="1" />
            <stop offset="0.5" stopColor="#ff6418" stopOpacity="0.88" />
            <stop offset="1" stopColor="#f04212" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-h2`}>
            <stop offset="0" stopColor="#ffe29c" stopOpacity="1" />
            <stop offset="0.36" stopColor="#ff4e28" stopOpacity="1" />
            <stop offset="0.72" stopColor="#e6263b" stopOpacity="0.62" />
            <stop offset="1" stopColor="#d61b3d" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-h3`}>
            <stop offset="0" stopColor="#fff7dc" stopOpacity="1" />
            <stop offset="0.26" stopColor="#ff5230" stopOpacity="1" />
            <stop offset="0.66" stopColor="#df0f40" stopOpacity="0.82" />
            <stop offset="1" stopColor="#b50a57" stopOpacity="0" />
          </radialGradient>
        </>
      )}
      {full && (
        <>
          <radialGradient id={`${id}-gl-b`}>
            <stop offset="0.3" stopColor="#fff1d6" stopOpacity="0" />
            <stop offset="0.56" stopColor="#fff1d6" stopOpacity="0.75" />
            <stop offset="0.9" stopColor="#fff1d6" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-gl-w`}>
            <stop offset="0.36" stopColor="#4a3320" stopOpacity="0" />
            <stop offset="0.56" stopColor="#4a3320" stopOpacity="0.22" />
            <stop offset="0.8" stopColor="#4a3320" stopOpacity="0" />
          </radialGradient>
        </>
      )}
      {interactive && (
        <radialGradient id={`${id}-pg`}>
          <stop offset="0.6" stopColor="#ff9a2e" stopOpacity="0" />
          <stop offset="0.8" stopColor="#ff9a2e" stopOpacity="0.45" />
          <stop offset="1" stopColor="#ff9a2e" stopOpacity="0" />
        </radialGradient>
      )}
    </defs>
  );
}

// ------------------------------------------------------------------ board body (wood, edges, grid)

interface Geometry {
  /** Horizontal margin from the outer lines to the board edge. */
  m: number;
  /** Vertical margin (smaller by half the front edge, so a full board still fits a square). */
  mv: number;
  /** Board width, and height of surface + front edge. */
  W: number;
  /** Height of the front edge (board thickness), 0 when not drawn. */
  t: number;
}

function geometry(size: number, coords: boolean, edge: boolean): Geometry {
  const m = coords ? 1.24 : 0.6;
  const W = size - 1 + 2 * m;
  const t = edge ? W * 0.018 : 0;
  return { m, mv: m - t / 2, W, t };
}

/**
 * Soft shadow of a rectangle without filters: a solid core, four edge strips fading outwards
 * (linear gradients) and four corner squares (radial gradients). Static and cheap to raster.
 */
function SoftShadow({ id, L, T, R, B, F, color, alpha }: { id: string; L: number; T: number; R: number; B: number; F: number; color: string; alpha: number }) {
  const profile = [1, 0.74, 0.42, 0.17, 0.05, 0];
  const stops = profile.map((f, i) => <stop key={i} offset={i / (profile.length - 1)} stopColor={color} stopOpacity={alpha * f} />);
  const lin = (k: string, x1: number, y1: number, x2: number, y2: number) => (
    <linearGradient id={`${id}-${k}`} x1={x1} y1={y1} x2={x2} y2={y2}>
      {stops}
    </linearGradient>
  );
  const rad = (k: string, cx: number, cy: number) => (
    <radialGradient id={`${id}-${k}`} cx={cx} cy={cy} r={1}>
      {stops}
    </radialGradient>
  );
  const w = R - L, h = B - T;
  return (
    <>
      <defs>
        {lin('t', 0, 1, 0, 0)}
        {lin('b', 0, 0, 0, 1)}
        {lin('l', 1, 0, 0, 0)}
        {lin('r', 0, 0, 1, 0)}
        {rad('tl', 1, 1)}
        {rad('tr', 0, 1)}
        {rad('bl', 1, 0)}
        {rad('br', 0, 0)}
      </defs>
      <g className="bd-drop">
        <rect x={L} y={T} width={w} height={h} fill={color} fillOpacity={alpha} />
        <rect x={L} y={T - F} width={w} height={F} fill={`url(#${id}-t)`} />
        <rect x={L} y={B} width={w} height={F} fill={`url(#${id}-b)`} />
        <rect x={L - F} y={T} width={F} height={h} fill={`url(#${id}-l)`} />
        <rect x={R} y={T} width={F} height={h} fill={`url(#${id}-r)`} />
        <rect x={L - F} y={T - F} width={F} height={F} fill={`url(#${id}-tl)`} />
        <rect x={R} y={T - F} width={F} height={F} fill={`url(#${id}-tr)`} />
        <rect x={L - F} y={B} width={F} height={F} fill={`url(#${id}-bl)`} />
        <rect x={R} y={B} width={F} height={F} fill={`url(#${id}-br)`} />
      </g>
    </>
  );
}

/** The physical board: shadow, kaya surface, sheen, bevel and front edge. */
function Wood({ id, size, g, full }: { id: string; size: number; g: Geometry; full: boolean }) {
  const { m, mv, W, t } = g;
  const top = -mv;
  const surface = W - t; // height of the playing surface
  const base = top + surface; // where the surface meets the front edge
  const rx = W * 0.0095;

  return (
    <>
      {t > 0 && (
        <>
          {/* the board rests on the page: a wide soft ambient shadow and a tight contact shadow */}
          <SoftShadow id={`${id}-amb`} L={-m + W * 0.012} T={top + W * 0.03} R={W - m - W * 0.012} B={top + W + W * 0.016} F={W * 0.05} color="#70400f" alpha={0.3} />
          <SoftShadow id={`${id}-con`} L={-m + W * 0.002} T={top + W * 0.01} R={W - m - W * 0.002} B={top + W + W * 0.002} F={W * 0.009} color="#3a2006" alpha={0.42} />
        </>
      )}
      <clipPath id={`${id}-clip`}>
        <rect x={-m} y={top} width={W} height={W} rx={rx} />
      </clipPath>
      {full && (
        <>
          <linearGradient id={`${id}-sheen`} gradientUnits="userSpaceOnUse" x1={-m} y1={top} x2={W - m} y2={base}>
            <stop offset="0" stopColor="#fff6e2" stopOpacity="0.22" />
            <stop offset="0.38" stopColor="#fff6e2" stopOpacity="0" />
            <stop offset="0.7" stopColor="#6b3a0c" stopOpacity="0" />
            <stop offset="1" stopColor="#6b3a0c" stopOpacity="0.12" />
          </linearGradient>
          <radialGradient id={`${id}-vig`} gradientUnits="userSpaceOnUse" cx={(size - 1) / 2} cy={(size - 1) / 2} r={W * 0.72}>
            <stop offset="0.55" stopColor="#7a430f" stopOpacity="0" />
            <stop offset="1" stopColor="#7a430f" stopOpacity="0.16" />
          </radialGradient>
        </>
      )}
      <linearGradient id={`${id}-bevel`} gradientUnits="userSpaceOnUse" x1={-m} y1={top} x2={W - m} y2={base}>
        <stop offset="0" stopColor="#fff3d8" stopOpacity="0.85" />
        <stop offset="0.4" stopColor="#fff3d8" stopOpacity="0.32" />
        <stop offset="0.6" stopColor="#6e3d10" stopOpacity="0.1" />
        <stop offset="1" stopColor="#6e3d10" stopOpacity="0.45" />
      </linearGradient>
      {t > 0 && (
        <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8a4d14" stopOpacity="0.42" />
          <stop offset="0.35" stopColor="#6a3708" stopOpacity="0.5" />
          <stop offset="1" stopColor="#3e1f04" stopOpacity="0.72" />
        </linearGradient>
      )}
      <g className="bd-wood" clipPath={`url(#${id}-clip)`}>
        <rect className="bd-wood-base" x={-m} y={top} width={W} height={W} />
        {t > 0 && (
          <>
            <image href={KAYA} x={-m} y={base} width={W} height={t} preserveAspectRatio="none" />
            <rect x={-m} y={base} width={W} height={t} fill={`url(#${id}-edge)`} />
          </>
        )}
        <image href={KAYA} x={-m} y={top} width={W} height={surface} preserveAspectRatio="none" />
        {full && <rect x={-m} y={top} width={W} height={surface} fill={`url(#${id}-vig)`} />}
        {full && <rect x={-m} y={top} width={W} height={surface} fill={`url(#${id}-sheen)`} />}
        {t > 0 && <rect className="bd-lip" x={-m} y={base - 0.02} width={W} height={0.045} />}
        <rect className="bd-bevel" x={-m + 0.04} y={top + 0.04} width={W - 0.08} height={surface - 0.08} rx={Math.max(0, rx - 0.04)} stroke={`url(#${id}-bevel)`} />
        <rect className="bd-rim" x={-m} y={top} width={W} height={W} rx={rx} />
      </g>
    </>
  );
}

/** Lacquered grid, star points and coordinates. */
function Lines({ size, g, crop, cropped, coords }: { size: number; g: Geometry; crop: Crop; cropped: boolean; coords: boolean }) {
  const { m, mv } = g;
  let grid = '';
  for (let i = 1; i < size - 1; i++) grid += `M0 ${i}H${size - 1}M${i} 0V${size - 1}`;

  const star = hoshi(size).filter((s) => {
    const x = s % size, y = (s - x) / size;
    return x >= crop.x0 - 1 && x <= crop.x1 + 1 && y >= crop.y0 - 1 && y <= crop.y1 + 1;
  });

  const coordEls: JSX.Element[] = [];
  if (coords) {
    // centred in the margin between an edge stone and the edge of the board
    const offX = (m + R_B) / 2;
    const offY = (mv + R_B) / 2;
    for (let i = crop.x0; i <= crop.x1; i++) {
      coordEls.push(
        <text key={`t${i}`} x={i} y={crop.y0 - offY}>
          {COLS[i]}
        </text>,
      );
      if (!cropped)
        coordEls.push(
          <text key={`b${i}`} x={i} y={crop.y1 + offY}>
            {COLS[i]}
          </text>,
        );
    }
    for (let j = crop.y0; j <= crop.y1; j++) {
      coordEls.push(
        <text key={`l${j}`} x={crop.x0 - offX} y={j}>
          {size - j}
        </text>,
      );
      if (!cropped)
        coordEls.push(
          <text key={`r${j}`} x={crop.x1 + offX} y={j}>
            {size - j}
          </text>,
        );
    }
  }

  return (
    <>
      <path className="bd-grid" d={grid} />
      <rect className="bd-border" x={0} y={0} width={size - 1} height={size - 1} />
      {star.map((s) => (
        <circle key={s} className="bd-hoshi" cx={s % size} cy={Math.floor(s / size)} r={size >= 13 ? 0.105 : 0.09} />
      ))}
      {coords && <g className="bd-coords">{coordEls}</g>}
    </>
  );
}

// ------------------------------------------------------------------ the board

function BoardImpl(p: BoardProps) {
  const { size, stones } = p;
  const n = size * size;
  const [hover, setHover] = useState<Loc | null>(null);
  const id = 'bd' + useId().replace(/[^A-Za-z0-9_-]/g, '');
  // Rendered size, so candidate numbers can drop to the winrate alone when the board is small.
  const svgRef = useRef<SVGSVGElement>(null);
  const [px, setPx] = useState(0);
  const wantsSize = !!p.candidates;
  useEffect(() => {
    const el = svgRef.current;
    if (!wantsSize || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setPx(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [wantsSize]);
  const crop = p.crop ?? { x0: 0, y0: 0, x1: size - 1, y1: size - 1 };
  const coords = !!p.coords;
  const full = (p.detail ?? (p.crop || !coords ? 'lite' : 'full')) === 'full';
  const cropped = !!p.crop;
  const g = useMemo(() => geometry(size, coords, full && !cropped), [size, coords, full, cropped]);
  // A full board fills a square exactly (surface + front edge), so a square box has no letterboxing.
  const vb = cropped
    ? `${crop.x0 - g.m} ${crop.y0 - g.m} ${crop.x1 - crop.x0 + 2 * g.m} ${crop.y1 - crop.y0 + 2 * g.m}`
    : `${-g.m} ${-g.mv} ${g.W} ${g.W}`;
  const interactive = !!p.onPlay;
  const tracksPointer = interactive || !!p.onCandidateHover || !!p.onCandidateClick;
  const hoveredCand = useRef<Loc | null>(null);
  const animate = p.animate !== false;
  const { x0, y0, x1, y1 } = crop;
  const inWin = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

  // Remember the previous position so a single move can drop in and captures can fade out.
  // (Adjusting state during render: React re-renders at once with the new snapshot, which the
  // memos below then key on, so a new array with the same stones costs nothing.)
  const [track, setTrack] = useState<Track>(() => ({ size, stones: snapshot(stones, n), motion: STILL }));
  let board = track.stones;
  let motion = track.motion;
  if (track.size !== size || !sameStones(track.stones, stones, n)) {
    board = snapshot(stones, n);
    motion = track.size === size && animate ? motionBetween(track.stones, stones, n, p.lastMove) : STILL;
    setTrack({ size, stones: board, motion });
  }

  const hasHeat = !!p.heat;
  const hasPending = interactive || p.pending != null;
  const defs = useMemo(() => <Defs id={id} full={full} heat={hasHeat} interactive={hasPending} />, [id, full, hasHeat, hasPending]);
  const wood = useMemo(() => <Wood id={id} size={size} g={g} full={full} />, [id, size, g, full]);
  const lines = useMemo(
    () => <Lines size={size} g={g} crop={crop} cropped={cropped} coords={coords} />,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [size, g, cropped, x0, y0, x1, y1, coords],
  );

  // Territory tint sits on the wood under the lacquered lines; the policy glow sits above them.
  const ownership = useMemo(() => {
    const cells: JSX.Element[] = [];
    if (p.ownership) {
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = y * size + x;
          const o = p.ownership[i] ?? 0;
          const a = Math.abs(o);
          if (a < 0.12) continue;
          cells.push(
            <rect
              key={`o${i}`}
              className={o > 0 ? 'bd-own-b' : 'bd-own-w'}
              x={x - 0.5}
              y={y - 0.5}
              width={1}
              height={1}
              fillOpacity={(o > 0 ? 0.4 : 0.6) * Math.min(1, (a - 0.12) / 0.78)}
            />,
          );
        }
    }
    return cells.length > 0 ? <g className="bd-own">{cells}</g> : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.ownership, size, x0, y0, x1, y1]);

  const heat = useMemo(() => {
    const glows: JSX.Element[] = [];
    if (p.heat) {
      let max = 0;
      for (let i = 0; i < n; i++) max = Math.max(max, p.heat[i] ?? 0);
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = y * size + x;
          const h = (p.heat[i] ?? 0) / (max || 1);
          if (h < 0.04 || board[i]) continue;
          const lvl = h > 0.6 ? 3 : h > 0.3 ? 2 : h > 0.12 ? 1 : 0;
          glows.push(<circle key={`h${i}`} cx={x} cy={y} r={0.25 + 0.36 * Math.sqrt(h)} fill={`url(#${id}-h${lvl})`} opacity={0.8 + 0.2 * h} />);
        }
    }
    return glows.length > 0 ? <g className="bd-heat">{glows}</g> : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.heat, board, size, id, x0, y0, x1, y1]);

  const stoneLayer = useMemo(() => {
    const shadows: JSX.Element[] = [];
    const bodies: JSX.Element[] = [];
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * size + x;
        const c = board[i];
        if (!c) continue;
        const drop = motion.added?.has(i) ? ' drop' : '';
        shadows.push(<circle key={i} className={`bd-sh${drop}`} cx={x + SH_DX} cy={y + SH_DY} r={SH_R} fill={`url(#${id}-sh)`} />);
        if (c === 1) {
          bodies.push(<circle key={i} className={`bd-st${drop}`} cx={x} cy={y} r={R_B} fill={`url(#${id}-sb)`} />);
        } else {
          const h = hash(i);
          bodies.push(<circle key={i} className={`bd-st${drop}`} cx={x} cy={y} r={R_W} fill={`url(#${id}-sw${full ? h % WHITE_VARIANTS : 0})`} />);
          if (full) bodies.push(<circle key={`t${i}`} className={`bd-stripe${drop}`} cx={x} cy={y} r={R_W} fill={`url(#${id}-ss${(h >>> 4) % STRIPE_VARIANTS})`} />);
        }
      }
    const gone = motion.removed
      .filter(({ loc }) => inWin(loc % size, Math.floor(loc / size)))
      .map(({ loc, color }) => {
        const x = loc % size, y = Math.floor(loc / size);
        return (
          <g key={`x${loc}`} className="bd-captured">
            <circle cx={x + SH_DX} cy={y + SH_DY} r={SH_R} fill={`url(#${id}-sh)`} />
            <circle cx={x} cy={y} r={color === 1 ? R_B : R_W} fill={`url(#${id}-${color === 1 ? 'sb' : 'sw0'})`} />
          </g>
        );
      });
    return (
      <>
        <g className="bd-shadows">{shadows}</g>
        <g className="bd-stones">{bodies}</g>
        {gone.length > 0 && <g className="bd-gone">{gone}</g>}
      </>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, motion, size, id, full, x0, y0, x1, y1]);

  const markEls = (p.marks ?? []).map((m, k) => {
    if (m.loc === PASS || m.loc == null) return null;
    const x = m.loc % size, y = Math.floor(m.loc / size);
    if (!inWin(x, y)) return null;
    const on = board[m.loc] === 1 ? ' on-b' : board[m.loc] === 2 ? ' on-w' : '';
    const cls = `mark mark-${m.kind}${on}`;
    const label = m.label ? (
      <text className={m.label.length > 1 ? 'mk-long' : undefined} x={x} y={y + 0.015}>
        {m.label}
      </text>
    ) : null;
    if (m.kind === 'evidence') {
      return (
        <g key={`m${k}`} className={cls}>
          <rect className="mk-halo" x={x - 0.3} y={y - 0.3} width={0.6} height={0.6} rx={0.04} />
          <rect className="mk-body" x={x - 0.3} y={y - 0.3} width={0.6} height={0.6} rx={0.04} />
          {label}
        </g>
      );
    }
    const r = m.kind === 'best' ? 0.34 : m.kind === 'played' || m.kind === 'you' ? 0.3 : m.kind === 'pv' ? 0.31 : 0.34;
    return (
      <g key={`m${k}`} className={cls}>
        <circle className="mk-halo" cx={x} cy={y} r={r} />
        <circle className="mk-body" cx={x} cy={y} r={r} />
        {label}
      </g>
    );
  });

  // Candidate discs (Lizzie style), under the marks. Best move cyan; the others coloured by how much worse they are.
  const unitPx = px ? px / (cropped ? crop.x1 - crop.x0 + 2 * g.m : g.W) : 40;
  const compact = unitPx < 27;
  const candEls = (p.candidates ?? [])
    .filter((c) => c.loc !== PASS && !board[c.loc] && inWin(c.loc % size, Math.floor(c.loc / size)))
    .sort((a, b) => b.rank - a.rank)
    .map((c) => {
      const x = c.loc % size, y = Math.floor(c.loc / size);
      const wr = c.winrate * 100;
      const wrText = wr >= 99.95 ? '100' : wr < 0.05 ? '0' : wr >= 10 ? wr.toFixed(1) : wr.toFixed(1);
      return (
        <g
          key={`c${c.loc}`}
          className={`cand${c.rank === 0 ? ' cand-best' : ''}${compact ? ' compact' : ''}`}
          style={{ opacity: c.rank === 0 ? 1 : 0.5 + 0.5 * Math.sqrt(Math.max(0, Math.min(1, c.share))) }}
        >
          <circle className="cand-disc" cx={x} cy={y} r={0.47} fill={c.rank === 0 ? CAND_BEST : candColor(c.badness)} />
          {compact ? (
            <text className="cand-wr" x={x} y={y + 0.02}>
              {Math.round(wr)}
            </text>
          ) : (
            <>
              <text className="cand-wr" x={x} y={y - 0.2}>
                {wrText}
              </text>
              <text className="cand-v" x={x} y={y + 0.04}>
                {shortCount(c.visits)}
              </text>
              <text className="cand-s" x={x} y={y + 0.25}>
                {c.scoreLead >= 0 ? '' : '−'}
                {Math.abs(c.scoreLead).toFixed(1)}
              </text>
            </>
          )}
          {c.rank < 9 && !compact && (
            <text className="cand-rank" x={x + 0.37} y={y - 0.36}>
              {c.rank + 1}
            </text>
          )}
        </g>
      );
    });

  // A variation: numbered see-through stones (the first move of the line at a point wins).
  const varEls: JSX.Element[] = [];
  if (p.variation?.length) {
    const seen = new Set<Loc>();
    p.variation.forEach((m, i) => {
      if (m.loc === PASS || seen.has(m.loc)) return;
      seen.add(m.loc);
      const x = m.loc % size, y = Math.floor(m.loc / size);
      if (!inWin(x, y)) return;
      varEls.push(
        <g key={`v${i}`} className={`bd-var ${m.color === 1 ? 'b' : 'w'}${board[m.loc] ? ' over' : ''}`}>
          <circle cx={x} cy={y} r={m.color === 1 ? R_B : R_W} fill={`url(#${id}-${m.color === 1 ? 'sb' : 'sw0'})`} />
          <text x={x} y={y + 0.015} className={i + 1 >= 10 ? 'long' : undefined}>
            {i + 1}
          </text>
        </g>,
      );
    });
  }

  const last = p.lastMove != null && p.lastMove !== PASS && inWin(p.lastMove % size, Math.floor(p.lastMove / size)) ? p.lastMove : null;
  const pending = p.pending != null && p.pending !== PASS ? p.pending : null;
  const showGhost = interactive && hover !== null && hover !== pending && !board[hover] && !!p.toPlay;

  const stoneFill = (c: Color, i: number) => `url(#${id}-${c === 1 ? 'sb' : `sw${full ? hash(i) % WHITE_VARIANTS : 0}`})`;

  const locFromEvent = (e: PointerEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = svg.getScreenCTM();
    if (!m) return null;
    const q = pt.matrixTransform(m.inverse());
    const x = Math.round(q.x), y = Math.round(q.y);
    if (x < 0 || y < 0 || x >= size || y >= size) return null;
    return y * size + x;
  };

  return (
    <svg
      ref={svgRef}
      className={`board ${full ? 'bd-full' : 'bd-lite'}${animate ? '' : ' bd-still'} ${p.className ?? ''}`}
      viewBox={vb}
      role="img"
      aria-label={p.ariaLabel ?? 'Go board'}
      preserveAspectRatio="xMidYMid meet"
    >
      {defs}
      {wood}
      {ownership}
      {lines}
      {heat}
      {stoneLayer}
      {last !== null && (
        <g key={`last${last}`} className={`bd-last ${board[last] === 1 ? 'on-b' : 'on-w'}`}>
          {full && <circle className="bd-last-glow" cx={last % size} cy={Math.floor(last / size)} r={0.36} fill={`url(#${id}-gl-${board[last] === 1 ? 'b' : 'w'})`} />}
          <circle className="bd-last-ring" cx={last % size} cy={Math.floor(last / size)} r={0.19} />
        </g>
      )}
      {varEls.length === 0 && candEls.length > 0 && <g className="bd-cands">{candEls}</g>}
      {varEls.length > 0 && <g className="bd-vars">{varEls}</g>}
      {markEls}
      {p.badge && p.badge.loc !== PASS && inWin(p.badge.loc % size, Math.floor(p.badge.loc / size)) && (
        <g
          key={`badge${p.badge.loc}${p.badge.cls}`}
          className="bd-badge"
          transform={`translate(${Math.min(p.badge.loc % size + 0.38, size - 0.62)} ${Math.max(Math.floor(p.badge.loc / size) - 0.38, -0.2)}) scale(0.34)`}
        >
          <BadgeShape cls={p.badge.cls} />
        </g>
      )}
      {showGhost && <circle className={`bd-ghost ${p.toPlay === 1 ? 'bd-ghost-b' : 'bd-ghost-w'}`} cx={hover! % size} cy={Math.floor(hover! / size)} r={p.toPlay === 1 ? R_B : R_W} fill={stoneFill(p.toPlay!, hover!)} />}
      {pending !== null && p.toPlay && (
        <g key={`p${pending}`} className="bd-pending">
          <circle className="bd-pending-glow" cx={pending % size} cy={Math.floor(pending / size)} r={0.78} fill={`url(#${id}-pg)`} />
          <circle cx={pending % size + SH_DX} cy={Math.floor(pending / size) + SH_DY} r={SH_R} fill={`url(#${id}-sh)`} />
          <circle className="bd-pending-stone" cx={pending % size} cy={Math.floor(pending / size)} r={p.toPlay === 1 ? R_B : R_W} fill={stoneFill(p.toPlay, pending)} />
          <circle className="bd-pending-case" cx={pending % size} cy={Math.floor(pending / size)} r={0.6} />
          <circle className="bd-pending-ring" cx={pending % size} cy={Math.floor(pending / size)} r={0.6} />
        </g>
      )}
      {tracksPointer && (
        <rect
          className={`bd-hit${interactive ? '' : ' passive'}`}
          x={-0.5}
          y={-0.5}
          width={size}
          height={size}
          fill="transparent"
          onPointerMove={(e) => {
            const l = locFromEvent(e);
            setHover(l);
            // Distance-based hit test with hysteresis, not exact-cell match: a candidate disc
            // is wider than one grid cell, and a hover exactly at the cell boundary otherwise
            // flickers on and off on every tiny pointer move. Once a candidate is hovered, the
            // pointer has to move clearly past it (keepR) before it lets go.
            if (p.candidates?.length) {
              const svg = e.currentTarget.ownerSVGElement;
              const m = svg?.getScreenCTM();
              const cur = hoveredCand.current;
              let next: Loc | null = null;
              if (m) {
                const pt = svg!.createSVGPoint();
                pt.x = e.clientX;
                pt.y = e.clientY;
                const q = pt.matrixTransform(m.inverse());
                let best: Loc | null = null;
                let bestD = Infinity;
                for (const c of p.candidates) {
                  const d = Math.hypot(q.x - (c.loc % size), q.y - Math.floor(c.loc / size));
                  if (d < bestD) {
                    bestD = d;
                    best = c.loc;
                  }
                }
                const hitR = 0.62, keepR = 0.85;
                next = cur !== null && best === cur && bestD <= keepR ? cur : bestD <= hitR ? best : null;
              }
              if (next !== cur) {
                hoveredCand.current = next;
                p.onCandidateHover?.(next);
              }
            } else if (hoveredCand.current !== null) {
              hoveredCand.current = null;
              p.onCandidateHover?.(null);
            }
          }}
          onPointerLeave={() => {
            setHover(null);
            if (hoveredCand.current !== null) {
              hoveredCand.current = null;
              p.onCandidateHover?.(null);
            }
          }}
          onClick={(e) => {
            const l = locFromEvent(e as unknown as PointerEvent<SVGRectElement>);
            if (l === null || stones[l]) return;
            if (interactive) p.onPlay!(l);
            else if (p.candidates?.some((x) => x.loc === l)) p.onCandidateClick?.(l);
          }}
        />
      )}
    </svg>
  );
}

export const Board = memo(BoardImpl);

/** Crop window around some points, for thumbnails. */
export function cropAround(locs: Loc[], size: number, half = 5) {
  const pts = locs.filter((l) => l !== PASS && l != null);
  if (!pts.length) return undefined;
  const xs = pts.map((l) => l % size), ys = pts.map((l) => Math.floor(l / size));
  const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
  const cy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2);
  const span = Math.max(half, Math.ceil((Math.max(...xs) - Math.min(...xs)) / 2) + 2, Math.ceil((Math.max(...ys) - Math.min(...ys)) / 2) + 2);
  const clamp = (v: number) => Math.max(0, Math.min(size - 1, v));
  let x0 = clamp(cx - span), x1 = clamp(cx + span), y0 = clamp(cy - span), y1 = clamp(cy + span);
  // keep it square
  const w = Math.max(x1 - x0, y1 - y0);
  if (x1 - x0 < w) (x0 === 0 ? (x1 = clamp(x0 + w)) : (x0 = clamp(x1 - w)));
  if (y1 - y0 < w) (y0 === 0 ? (y1 = clamp(y0 + w)) : (y0 = clamp(y1 - w)));
  return { x0, y0, x1, y1 };
}
