/**
 * The app's board in 3D: KayaView seen from straight above (so a tap lands exactly where it
 * looks), with the same props as the flat Board. Words and numbers (winrates, move numbers,
 * coordinates, marks) are HTML laid over the canvas at each point's projected position, so
 * they stay sharp. After a while without the pointer, the board leans back a little; it
 * straightens when the pointer comes back.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CandidateMark, Mark } from '../../../src/components/Board';
import { shortCount } from '../../../src/components/Board';
import { PASS, type Color, type Loc, type Move } from '../../../src/lib/go/types';
import { KayaView, type StoneColor } from './kaya';
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
  onCandidateHover?: (loc: Loc | null) => void;
  onCandidateClick?: (loc: Loc) => void;
  variation?: Move[] | null;
  /** Lean back after this long without the pointer (0 = never). */
  idleTiltMs?: number;
  ariaLabel?: string;
}

const COLS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
const STONE_TOP = 0.0088;

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
  const [ready, setReady] = useState(false);
  const lite = useRef(false);
  const size = p.size;

  // the view lives as long as the board size does
  useEffect(() => {
    const c = canvas.current!;
    lite.current = window.matchMedia('(pointer: coarse)').matches;
    const v = new KayaView({ canvas: c, size, toneMapping: 'aces', exposure: 0.9, lite: lite.current });
    viewRef.current = v;
    const ro = new ResizeObserver(() => v.setSize(c.clientWidth, c.clientHeight));
    ro.observe(c);
    v.setSize(c.clientWidth, c.clientHeight);
    setReady(true);
    const vis = new IntersectionObserver(([e]) => v.setActive(e.isIntersecting));
    vis.observe(c);
    return () => {
      ro.disconnect();
      vis.disconnect();
      v.dispose();
      viewRef.current = null;
      setReady(false);
    };
  }, [size]);

  // straight down, fitted to the board or its crop, leaving room for the coordinates
  const cropKey = p.crop ? `${p.crop.x0},${p.crop.y0},${p.crop.x1},${p.crop.y1}` : '';
  const [tilted, setTilted] = useState(false);
  useEffect(() => {
    viewRef.current?.setView({ kind: 'top', crop: p.crop ?? null, pad: p.coords ? 0.75 : 0.1, tilt: tilted ? 22 : 0 }, tilted ? 1600 : 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, cropKey, p.coords, tilted]);

  // lean back when left alone; come back upright as soon as the pointer returns
  const idle = p.idleTiltMs ?? 0;
  useEffect(() => {
    if (!idle || !ready) return;
    const el = wrap.current!;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      setTilted(false);
      timer = window.setTimeout(() => setTilted(true), idle);
    };
    arm();
    el.addEventListener('pointerenter', arm);
    el.addEventListener('pointermove', arm);
    el.addEventListener('pointerdown', arm);
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener('pointerenter', arm);
      el.removeEventListener('pointermove', arm);
      el.removeEventListener('pointerdown', arm);
    };
  }, [idle, ready]);

  useEffect(() => {
    viewRef.current?.setStones(p.stones);
  }, [ready, p.stones]);

  const candKey = (p.candidates ?? []).map((c) => c.loc).join(',');
  const lastCand = useRef('');
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const fresh = candKey !== lastCand.current && lastCand.current === '';
    lastCand.current = candKey;
    const shown = p.variation?.length ? null : (p.candidates ?? null);
    v.setCandidates(shown, fresh);
    // a new read lights up the grid; on a computer the best move keeps pulsing while it shows
    if (fresh && shown?.length) v.ping(shown.find((c) => c.rank === 0)?.loc ?? null, 1300);
    v.setAmbient(!!shown?.length && !lite.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, p.candidates, p.variation]);

  const hadOwn = useRef(false);
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.setOwnership(p.ownership ?? null, !hadOwn.current);
    hadOwn.current = !!p.ownership;
  }, [ready, p.ownership, p.stones]);

  useEffect(() => {
    viewRef.current?.setVariation(p.variation?.filter((m) => m.loc !== PASS).map((m) => ({ loc: m.loc, color: m.color as StoneColor })) ?? null, 0);
  }, [ready, p.variation]);

  // ------------------------------------------------------------- labels over the canvas

  const labels = useMemo(() => {
    const out: Label[] = [];
    const st = p.stones;
    if (p.variation?.length) {
      const seen = new Set<Loc>();
      const last = p.variation.length - 1;
      p.variation.forEach((m, i) => {
        if (m.loc === PASS || seen.has(m.loc)) return;
        seen.add(m.loc);
        out.push({ key: `v${m.loc}`, loc: m.loc, lift: st[m.loc] ? STONE_TOP + 0.0095 : STONE_TOP + 0.0012, cls: `k3-var ${m.color === 1 ? 'b' : 'w'}${i === last ? ' cur' : ''}`, text: String(i + 1) });
      });
    } else if (p.candidates?.length) {
      for (const c of p.candidates) {
        if (c.loc === PASS || st[c.loc]) continue;
        const wr = c.winrate * 100;
        out.push({ key: `c${c.loc}`, loc: c.loc, lift: 0.0004, cls: `k3-cand${c.rank === 0 ? ' best' : ''}`, text: wr >= 99.5 ? '100' : wr < 0.5 ? '0' : wr.toFixed(0), sub: shortCount(c.visits) });
      }
    }
    if (p.lastMove != null && p.lastMove !== PASS && st[p.lastMove] && !p.variation?.length) out.push({ key: `last${p.lastMove}`, loc: p.lastMove, lift: STONE_TOP, cls: `k3-last ${st[p.lastMove] === 1 ? 'on-b' : 'on-w'}` });
    for (const [k, m] of (p.marks ?? []).entries()) {
      if (m.loc === PASS || m.loc == null) continue;
      out.push({ key: `m${k}`, loc: m.loc, lift: st[m.loc] ? STONE_TOP : 0.0004, cls: `k3-mark k3-${m.kind}`, text: m.label });
    }
    if (p.coords) {
      const c = p.crop ?? { x0: 0, y0: 0, x1: size - 1, y1: size - 1 };
      const whole = !p.crop;
      const off = whole ? 1.05 : 0.95;
      for (let x = c.x0; x <= c.x1; x++) {
        out.push({ key: `cx${x}`, loc: c.y1 * size + x, lift: 0, cls: 'k3-coord', text: COLS[x], dy: off });
        out.push({ key: `cxt${x}`, loc: c.y0 * size + x, lift: 0, cls: 'k3-coord', text: COLS[x], dy: -off });
      }
      for (let y = c.y0; y <= c.y1; y++) {
        out.push({ key: `cy${y}`, loc: y * size + c.x0, lift: 0, cls: 'k3-coord', text: String(size - y), dx: -off });
        out.push({ key: `cyr${y}`, loc: y * size + c.x1, lift: 0, cls: 'k3-coord', text: String(size - y), dx: off });
      }
    }
    return out;
  }, [p.stones, p.variation, p.candidates, p.lastMove, p.marks, p.coords, p.crop, size]);

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
    v.invalidate();
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

