import { useMemo, useState, type ReactNode } from 'react';
import { biggestDrops, moveLosses, performance, phaseBounds, type MoveLoss, type Phase, type PosValue } from '../lib/analysis/lineStats';
import { locToGtp } from '../lib/go/coords';
import type { Color, Move } from '../lib/go/types';
import { fmtPct } from './common';

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

/** Each player's accuracy, KataGo match, average loss and mistakes, overall and by phase. */
export function PerformancePanel({ values, moves, size, black, white, progress }: ReportInput) {
  const losses = useLosses(values, moves, size);
  const [phase, setPhase] = useState<Phase | 'all'>('all');
  const p = phase === 'all' ? undefined : phase;
  const b = performance(losses, 1, p);
  const w = performance(losses, 2, p);
  const [a, m] = phaseBounds(size);
  const pct = (v: number | null) => (v === null ? '—' : fmtPct(v, 0));
  const rows: { label: string; hint?: string; b: string; w: string; better?: 'high' | 'low'; bv?: number | null; wv?: number | null }[] = [
    { label: 'Moves read', b: String(b.moves), w: String(w.moves) },
    { label: 'Accuracy', hint: 'moves losing under 2% and under a point', b: pct(b.accuracy), w: pct(w.accuracy), better: 'high', bv: b.accuracy, wv: w.accuracy },
    { label: "KataGo's choice", hint: 'played its first choice', b: pct(b.match), w: pct(w.match), better: 'high', bv: b.match, wv: w.match },
    { label: 'Average loss', hint: 'winrate per move', b: b.avgWinLoss === null ? '—' : fmtPct(b.avgWinLoss, 1), w: w.avgWinLoss === null ? '—' : fmtPct(w.avgWinLoss, 1), better: 'low', bv: b.avgWinLoss, wv: w.avgWinLoss },
    { label: 'Points lost', hint: 'per move', b: b.avgScoreLoss === null ? '—' : b.avgScoreLoss.toFixed(2), w: w.avgScoreLoss === null ? '—' : w.avgScoreLoss.toFixed(2), better: 'low', bv: b.avgScoreLoss, wv: w.avgScoreLoss },
    { label: 'Mistakes', hint: 'lost 10% or 3 points', b: String(b.mistakes), w: String(w.mistakes), better: 'low', bv: b.mistakes, wv: w.mistakes },
    { label: 'Blunders', hint: 'lost 20% or 6 points', b: String(b.blunders), w: String(w.blunders), better: 'low', bv: b.blunders, wv: w.blunders },
  ];
  const win = (r: (typeof rows)[number], side: 'b' | 'w') => {
    if (!r.better || r.bv == null || r.wv == null || r.bv === r.wv) return false;
    const mine = side === 'b' ? r.bv : r.wv;
    const theirs = side === 'b' ? r.wv : r.bv;
    return r.better === 'high' ? mine > theirs : mine < theirs;
  };
  return (
    <div className="rp">
      <div className="rp-filters">
        <div className="rp-seg" role="radiogroup" aria-label="Phase">
          {PHASES.map((ph) => (
            <button key={ph.id} role="radio" aria-checked={phase === ph.id} className={phase === ph.id ? 'on' : ''} onClick={() => setPhase(ph.id)}>
              {ph.label}
            </button>
          ))}
        </div>
      </div>
      <table className="rp-perf">
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
          {rows.map((r) => (
            <tr key={r.label}>
              <th>
                {r.label}
                {r.hint && <small>{r.hint}</small>}
              </th>
              <td className={`mono ${win(r, 'b') ? 'good-text strong' : ''}`}>{r.b}</td>
              <td className={`mono ${win(r, 'w') ? 'good-text strong' : ''}`}>{r.w}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="rp-foot tiny muted">
        <span>
          Opening: moves 1–{a} · middle game: {a + 1}–{m} · endgame: after {m}
        </span>
        {progress}
      </div>
    </div>
  );
}
