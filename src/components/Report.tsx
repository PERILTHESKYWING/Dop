import { useMemo, useState, type ReactNode } from 'react';
import { biggestDrops, lineClasses, moveLosses, type MoveLoss, type Phase, type PosValue } from '../lib/analysis/lineStats';
import { locToGtp } from '../lib/go/coords';
import type { Color, Move } from '../lib/go/types';
import { fmtPct } from './common';
import { MoveBadge } from './MoveBadge';
import { CLASS_INFO, CLASS_ORDER, type MoveClass } from '../lib/coach/classify';

/**
 * The Trend, Blunder and Performance tabs, drawn from a game's position values (see
 * lib/analysis/lineStats). `values[i]` is the position after `i` moves; `null` where
 * KataGo hasn't read it yet.
 */

export interface ReportInput {
  values: (PosValue | null | undefined)[];
  moves: Move[];
  size: number;
  black: string;
  white: string;
  /** The position shown (moves from the start). */
  cursor: number;
  onPick: (pos: number) => void;
  /** Shown when too few positions have values yet (e.g. "Reading the game… 12/80"). */
  progress?: ReactNode;
}

export function useLosses(values: ReportInput['values'], moves: Move[], size: number) {
  return useMemo(() => moveLosses(values, moves, size), [values, moves, size]);
}

const W = 600;
const H = 200;

/** Black's winrate (blue) and Black's lead (orange) along the game, as on Fox's Trend tab. */
export function TrendPanel({ values, moves, cursor, onPick, progress }: ReportInput) {
  const n = Math.max(moves.length, 1);
  const known = values.filter((v) => v != null).length;
  const span = Math.max(10, ...values.map((v) => (v?.bLead != null ? Math.ceil(Math.abs(v.bLead)) : 0)));
  const x = (i: number) => (i / n) * W;
  const path = (pick: (v: PosValue) => number | null) => {
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      const y = v ? pick(v) : null;
      if (y === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y.toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const win = path((v) => H - v.bWin * H);
  const lead = path((v) => (v.bLead == null ? null : H / 2 - (v.bLead / span) * (H / 2)));
  return (
    <div className="rp">
      <div className="rp-legend">
        <span>
          <i className="rp-key win" /> Black's winrate
        </span>
        <span>
          <i className="rp-key lead" /> Black's lead (±{span} points)
        </span>
      </div>
      <div className="rp-chart">
        <div className="rp-axis left mono">
          <span>100</span>
          <span>50</span>
          <span>0</span>
        </div>
        <svg
          className="rp-trend"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Winrate and lead along the game"
          onClick={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            onPick(Math.round(((e.clientX - r.left) / r.width) * n));
          }}
        >
          <line className="rp-grid" x1={0} x2={W} y1={H / 2} y2={H / 2} />
          <line className="rp-grid faint" x1={0} x2={W} y1={H / 4} y2={H / 4} />
          <line className="rp-grid faint" x1={0} x2={W} y1={(3 * H) / 4} y2={(3 * H) / 4} />
          {lead && <path className="rp-lead" d={lead} />}
          {win && <path className="rp-win" d={win} />}
          <line className="rp-cursor" x1={x(cursor)} x2={x(cursor)} y1={0} y2={H} />
        </svg>
        <div className="rp-axis right mono">
          <span>+{span}</span>
          <span>0</span>
          <span>−{span}</span>
        </div>
      </div>
      <div className="rp-foot tiny muted">
        <span>Move {cursor}</span>
        {known < values.length && (progress ?? <span>{known ? 'Positions fill in as KataGo reads them.' : 'No positions read yet.'}</span>)}
        <span>Tap the chart to jump</span>
      </div>
    </div>
  );
}

const PHASES: { id: Phase | 'all'; label: string }[] = [
  { id: 'all', label: 'Overall' },
  { id: 'opening', label: 'Opening' },
  { id: 'middle', label: 'Middle' },
  { id: 'endgame', label: 'Endgame' },
];

/** Fox's "problematic moves" chart: the ten biggest drops, each a dot with its winrate loss. */
export function BlunderPanel({ values, moves, size, black, white, cursor, onPick, progress }: ReportInput) {
  const losses = useLosses(values, moves, size);
  const [phase, setPhase] = useState<Phase | 'all'>('all');
  const [side, setSide] = useState<Color | 0>(0);
  const drops = biggestDrops(losses, { phase: phase === 'all' ? undefined : phase, color: side || undefined });
  return (
    <div className="rp">
      <div className="rp-filters">
        <div className="rp-seg" role="radiogroup" aria-label="Phase">
          {PHASES.map((p) => (
            <button key={p.id} role="radio" aria-checked={phase === p.id} className={phase === p.id ? 'on' : ''} onClick={() => setPhase(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="rp-seg" role="radiogroup" aria-label="Player">
          {(
            [
              [0, 'Both'],
              [1, 'Black'],
              [2, 'White'],
            ] as const
          ).map(([c, label]) => (
            <button key={c} role="radio" aria-checked={side === c} className={side === c ? 'on' : ''} onClick={() => setSide(c)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {drops.length ? (
        <>
          <DropChart drops={drops} cursor={cursor} onPick={onPick} />
          <div className="rp-drops">
            {drops.map((d) => (
              <button key={d.index} className={`rp-drop ${d.index + 1 === cursor ? 'cur' : ''} ${d.winLoss >= 0.2 ? 'bad' : ''}`} onClick={() => onPick(d.index + 1)}>
                <span className="mono">{d.index + 1}</span>
                <i className={`stone-dot ${d.color === 1 ? 'b' : 'w'}`} />
                <span className="rp-drop-who">{d.color === 1 ? black || 'Black' : white || 'White'}</span>
                <span className="mono">{locToGtp(d.loc, size)}</span>
                <span className="mono rp-loss">−{fmtPct(d.winLoss, 1)}</span>
                {d.scoreLoss !== null && <span className="mono muted">−{d.scoreLoss.toFixed(1)} pts</span>}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="small muted rp-empty">{losses.length ? 'No move here lost more than 5% or 2 points.' : 'KataGo has not read enough of the game yet.'}</p>
      )}
      {progress && <div className="rp-foot tiny muted">{progress}</div>}
    </div>
  );
}

function DropChart({ drops, cursor, onPick }: { drops: MoveLoss[]; cursor: number; onPick: (pos: number) => void }) {
  const cw = 64;
  const w = Math.max(drops.length * cw, 320);
  const h = 170;
  const top = 26;
  const bottom = 26;
  const y = (after: number) => top + (1 - after) * (h - top - bottom);
  return (
    <div className="rp-dropchart">
      <svg viewBox={`0 0 ${w} ${h}`} style={{ minWidth: Math.min(w, 640) }} role="img" aria-label="The biggest drops in winrate">
        <line className="rp-grid" x1={0} x2={w} y1={y(0.5)} y2={y(0.5)} />
        {drops.map((d, i) => {
          const cx = i * cw + cw / 2;
          const before = Math.min(1, d.after + d.winLoss);
          return (
            <g key={d.index} className={`rp-dot ${d.winLoss >= 0.2 ? 'bad' : ''} ${d.index + 1 === cursor ? 'cur' : ''}`} onClick={() => onPick(d.index + 1)}>
              <text className="rp-dot-pct" x={cx} y={Math.max(12, y(before) - 8)} textAnchor="middle">
                {fmtPct(d.winLoss, 1)}
              </text>
              <line className="rp-arrow" x1={cx} x2={cx} y1={y(before)} y2={y(d.after) - 9} />
              <circle cx={cx} cy={y(d.after)} r={8} />
              <text className="rp-dot-move" x={cx} y={h - 6} textAnchor="middle">
                {d.index + 1}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** How many moves of each class, brilliant down to blunder, each player made. Tap a count to go to the next one. */
export function PerformancePanel({ values, moves, size, black, white, cursor, onPick, progress, classes }: ReportInput & { classes?: Map<number, MoveClass> }) {
  const losses = useLosses(values, moves, size);
  const cls = useMemo(() => (classes && classes.size ? classes : lineClasses(losses)), [classes, losses]);
  const hits = (c: MoveClass, color: Color) =>
    [...cls]
      .filter(([i, k]) => k === c && moves[i]?.color === color)
      .map(([i]) => i)
      .sort((a, b) => a - b);
  return (
    <div className="rp">
      <table className="rp-classes">
        <thead>
          <tr>
            <th />
            <th>
              <i className="stone-dot b" /> {black || 'Black'}
            </th>
            <th>
              <i className="stone-dot w" /> {white || 'White'}
            </th>
          </tr>
        </thead>
        <tbody>
          {CLASS_ORDER.map((c) => (
            <tr key={c} className={`rc-${c}`}>
              <th title={CLASS_INFO[c].about}>
                <span className="rc-name">
                  <MoveBadge cls={c} size={30} />
                  {CLASS_INFO[c].name}
                </span>
              </th>
              {([1, 2] as const).map((color) => {
                const h = hits(c, color);
                return (
                  <td key={color}>
                    <button
                      className="rc-n"
                      style={h.length ? { color: CLASS_INFO[c].color } : undefined}
                      disabled={!h.length}
                      onClick={() => {
                        const next = h.find((i) => i + 1 > cursor) ?? h[0];
                        if (next !== undefined) onPick(next + 1);
                      }}
                    >
                      {h.length || '–'}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {progress && <div className="rp-foot tiny muted">{progress}</div>}
    </div>
  );
}
