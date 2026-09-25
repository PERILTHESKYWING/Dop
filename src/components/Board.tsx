import { memo, useMemo, useState, type JSX, type PointerEvent } from 'react';
import { PASS, type Color, type Loc } from '../lib/go/types';

export type MarkKind = 'best' | 'played' | 'you' | 'doppel' | 'cand' | 'pv' | 'evidence';

export interface Mark {
  loc: Loc;
  kind: MarkKind;
  label?: string;
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
}

const COLS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';

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

function BoardImpl(p: BoardProps) {
  const { size, stones } = p;
  const [hover, setHover] = useState<Loc | null>(null);
  const crop = p.crop ?? { x0: 0, y0: 0, x1: size - 1, y1: size - 1 };
  const margin = p.coords ? 1.1 : 0.6;
  const vb = `${crop.x0 - margin} ${crop.y0 - margin} ${crop.x1 - crop.x0 + 2 * margin} ${crop.y1 - crop.y0 + 2 * margin}`;
  const interactive = !!p.onPlay;
  const star = useMemo(() => hoshi(size), [size]);

  const lines = [];
  for (let i = 0; i < size; i++) {
    lines.push(<line key={`h${i}`} x1={0} y1={i} x2={size - 1} y2={i} />);
    lines.push(<line key={`v${i}`} x1={i} y1={0} x2={i} y2={size - 1} />);
  }

  const cells: JSX.Element[] = [];
  if (p.ownership) {
    for (let i = 0; i < size * size; i++) {
      const o = p.ownership[i];
      if (Math.abs(o) < 0.15) continue;
      const x = i % size, y = Math.floor(i / size);
      cells.push(
        <rect
          key={`o${i}`}
          x={x - 0.5}
          y={y - 0.5}
          width={1}
          height={1}
          className={o > 0 ? 'own-b' : 'own-w'}
          opacity={Math.min(0.55, Math.abs(o) * 0.55)}
        />,
      );
    }
  }
  if (p.heat) {
    let max = 0;
    for (let i = 0; i < size * size; i++) max = Math.max(max, p.heat[i] ?? 0);
    for (let i = 0; i < size * size; i++) {
      const h = (p.heat[i] ?? 0) / (max || 1);
      if (h < 0.04 || stones[i]) continue;
      const x = i % size, y = Math.floor(i / size);
      cells.push(<circle key={`h${i}`} cx={x} cy={y} r={0.18 + 0.27 * Math.sqrt(h)} className="heat" opacity={0.25 + 0.6 * h} />);
    }
  }

  const stoneEls: JSX.Element[] = [];
  for (let i = 0; i < size * size; i++) {
    const c = stones[i];
    if (!c) continue;
    const x = i % size, y = Math.floor(i / size);
    if (x < crop.x0 || x > crop.x1 || y < crop.y0 || y > crop.y1) continue;
    stoneEls.push(<circle key={i} cx={x} cy={y} r={0.475} className={c === 1 ? 'stone-b' : 'stone-w'} />);
  }

  const markEls = (p.marks ?? []).map((m, k) => {
    if (m.loc === PASS || m.loc == null) return null;
    const x = m.loc % size, y = Math.floor(m.loc / size);
    const onStone = !!stones[m.loc];
    const cls = `mark mark-${m.kind}${onStone ? (stones[m.loc] === 1 ? ' on-b' : ' on-w') : ''}`;
    if (m.kind === 'cand' || m.kind === 'pv') {
      return (
        <g key={`m${k}`} className={cls}>
          <circle cx={x} cy={y} r={0.42} />
          {m.label && (
            <text x={x} y={y + 0.02} dominantBaseline="middle" textAnchor="middle">
              {m.label}
            </text>
          )}
        </g>
      );
    }
    if (m.kind === 'evidence') return <rect key={`m${k}`} className={cls} x={x - 0.3} y={y - 0.3} width={0.6} height={0.6} />;
    return (
      <g key={`m${k}`} className={cls}>
        <circle cx={x} cy={y} r={m.kind === 'best' ? 0.4 : 0.34} />
        {m.label && (
          <text x={x} y={y + 0.02} dominantBaseline="middle" textAnchor="middle">
            {m.label}
          </text>
        )}
      </g>
    );
  });

  const last = p.lastMove != null && p.lastMove !== PASS ? p.lastMove : null;
  const showGhost = interactive && hover !== null && !stones[hover] && p.toPlay;
  const pending = p.pending != null && p.pending !== PASS ? p.pending : null;

  const coordEls: JSX.Element[] = [];
  if (p.coords) {
    for (let i = crop.x0; i <= crop.x1; i++) {
      coordEls.push(
        <text key={`cx${i}`} x={i} y={crop.y0 - 0.85} className="coord" textAnchor="middle" dominantBaseline="middle">
          {COLS[i]}
        </text>,
      );
    }
    for (let j = crop.y0; j <= crop.y1; j++) {
      coordEls.push(
        <text key={`cy${j}`} x={crop.x0 - 0.85} y={j} className="coord" textAnchor="middle" dominantBaseline="middle">
          {size - j}
        </text>,
      );
    }
  }

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
    <svg className={`board ${p.className ?? ''}`} viewBox={vb} role="img" aria-label={p.ariaLabel ?? 'Go board'} preserveAspectRatio="xMidYMid meet">
      <rect className="board-bg" x={crop.x0 - margin} y={crop.y0 - margin} width={crop.x1 - crop.x0 + 2 * margin} height={crop.y1 - crop.y0 + 2 * margin} rx={0.15} />
      {cells}
      <g className="grid">{lines}</g>
      {star.map((s) => (
        <circle key={`s${s}`} className="hoshi" cx={s % size} cy={Math.floor(s / size)} r={0.1} />
      ))}
      {coordEls}
      {stoneEls}
      {last !== null && <circle className={`last ${stones[last] === 1 ? 'on-b' : 'on-w'}`} cx={last % size} cy={Math.floor(last / size)} r={0.17} />}
      {markEls}
      {showGhost && <circle className={`ghost ${p.toPlay === 1 ? 'stone-b' : 'stone-w'}`} cx={hover! % size} cy={Math.floor(hover! / size)} r={0.47} />}
      {pending !== null && p.toPlay && (
        <g>
          <circle className={`pending ${p.toPlay === 1 ? 'stone-b' : 'stone-w'}`} cx={pending % size} cy={Math.floor(pending / size)} r={0.475} />
          <circle className="pending-ring" cx={pending % size} cy={Math.floor(pending / size)} r={0.56} />
        </g>
      )}
      {interactive && (
        <rect
          x={-0.5}
          y={-0.5}
          width={size}
          height={size}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          onPointerMove={(e) => setHover(locFromEvent(e))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => {
            const l = locFromEvent(e as unknown as PointerEvent<SVGRectElement>);
            if (l !== null && !stones[l]) p.onPlay!(l);
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
