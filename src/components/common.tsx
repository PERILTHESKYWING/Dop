import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { Board, cropAround, type Mark } from './Board';
import { Icon } from './Icons';
import type { GameRecord, MoveRecord } from '../lib/types';
import { replay } from '../lib/go/board';
import { PASS } from '../lib/go/types';

export function DropZone({ onFiles, label, compact }: { onFiles: (f: File[]) => void; label?: ReactNode; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`dropzone ${over ? 'over' : ''}`}
      style={compact ? { padding: 14 } : undefined}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        // Any file: the SGF parser decides, and phones often give SGFs odd names or types.
        const files = [...e.dataTransfer.files];
        if (files.length) onFiles(files);
      }}
      role="button"
      tabIndex={0}
    >
      {label ?? (
        <>
          {!compact && <Icon name="upload" className="dz-icon" />}
          <strong>Drop your SGF files here</strong> <span className="muted">or tap to choose them (many at once is fine)</span>
        </>
      )}
      {/* No accept filter: iOS and many Android pickers grey out .sgf files when one is set. */}
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}

/** A board-enlarge/focus toggle for the board-dominant `.stage` layouts (Study, Review, …):
 * hides the side panel and lets the board fill the space. Esc also leaves focus mode. */
export function useFocusMode() {
  const [focused, setFocused] = useState(false);
  return [focused, setFocused] as const;
}

export function FocusToggle({ focused, onChange }: { focused: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className="btn small ghost focus-toggle" onClick={() => onChange(!focused)} title={focused ? 'Show the side panel back (Esc)' : 'Enlarge the board, hide everything else'}>
      {focused ? '⤡ Exit focus' : '⤢ Focus'}
    </button>
  );
}

export function Stat({ value, label, hint, tone }: { value: ReactNode; label: string; hint?: ReactNode; tone?: string }) {
  return (
    <div className="stat">
      <div className={`v ${tone ?? ''}`}>{value}</div>
      <div className="l">{label}</div>
      {hint && <div className="small muted">{hint}</div>}
    </div>
  );
}

export function Bar({ value, tone }: { value: number; tone?: 'kata' }) {
  return (
    <div className={`bar ${tone ?? ''}`}>
      <span style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** Winrate graph (black's winrate) with the current move and flagged errors. */
/**
 * Black's winrate along a game (dark line and area), Black's score lead (magenta, scaled
 * to the largest lead, at least 10 points), mistakes (red ticks) and the current move.
 */
export function WinrateGraph({
  values,
  scores,
  cursor,
  errors,
  onPick,
}: {
  values: (number | null)[];
  scores?: (number | null)[];
  cursor: number;
  errors?: number[];
  onPick?: (i: number) => void;
}) {
  const W = 600, H = 90;
  const n = Math.max(values.length - 1, 1);
  const path = (pts: (readonly [number, number] | null)[]) => {
    let d = '';
    let started = false;
    pts.forEach((p) => {
      if (!p) return;
      d += `${started ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
      started = true;
    });
    return d;
  };
  const pts = values.map((v, i) => (v === null ? null : ([(i / n) * W, H - v * H] as const)));
  const d = path(pts);
  let area = '';
  const valid = pts.filter((p): p is readonly [number, number] => !!p);
  if (valid.length) area = `M${valid[0][0]},${H} ` + valid.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ` L${valid[valid.length - 1][0]},${H} Z`;
  let sd = '';
  if (scores?.some((v) => v !== null)) {
    const span = Math.max(10, ...scores.map((v) => (v === null ? 0 : Math.abs(v))));
    sd = path(scores.map((v, i) => (v === null ? null : ([(i / n) * W, H / 2 - (v / span) * (H / 2 - 3)] as const))));
  }
  return (
    <svg
      className="graph"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onClick={(e) => {
        if (!onPick) return;
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        onPick(Math.round(((e.clientX - r.left) / r.width) * n));
      }}
      style={{ cursor: onPick ? 'pointer' : undefined }}
    >
      <line className="mid" x1={0} x2={W} y1={H / 2} y2={H / 2} />
      {area && <path className="area" d={area} />}
      {sd && <path className="score" d={sd} />}
      {d && <path className="line" d={d} />}
      {(errors ?? []).map((i) => (
        <rect key={i} className="err" x={(i / n) * W - 1.5} y={H - 6} width={3} height={6} />
      ))}
      <line className="cursor" x1={(cursor / n) * W} x2={(cursor / n) * W} y1={0} y2={H} />
    </svg>
  );
}

export function gameTitle(g: GameRecord) {
  return `${g.black} vs ${g.white}`;
}

export function PlayerSide({ g }: { g: GameRecord }) {
  if (!g.playerColor) return <span className="muted">—</span>;
  return <span className="you">{g.playerColor === 1 ? 'Black' : 'White'}</span>;
}

/** Thumbnail of a recorded move: board before the move, played (amber) vs KataGo (teal). */
export function MoveThumb({ game, record, extra, full }: { game: GameRecord; record: MoveRecord; extra?: Mark[]; full?: boolean }) {
  const board = useMemo(() => replay(game.size, game.setup, game.moves, record.index), [game, record.index]);
  const marks: Mark[] = [
    ...(record.bestLoc !== PASS ? [{ loc: record.bestLoc, kind: 'best' as const }] : []),
    ...(record.loc !== PASS ? [{ loc: record.loc, kind: 'played' as const }] : []),
    ...(extra ?? []),
  ];
  const prev = record.index > 0 ? game.moves[record.index - 1].loc : null;
  const crop = full ? undefined : cropAround([record.loc, record.bestLoc, ...(prev !== null ? [prev] : [])], game.size, 5);
  return (
    <div className="thumb">
      <Board size={game.size} stones={board.stones} lastMove={prev} marks={marks} crop={crop} />
    </div>
  );
}

export const fmtPts = (x: number) => `${x >= 0 ? '' : '−'}${Math.abs(x).toFixed(1)}`;
export const fmtPct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

export function Legend() {
  return (
    <div className="row wrap small">
      <span className="chip you">● your move</span>
      <span className="chip kata">● KataGo</span>
      <span className="chip doppel">◌ Doppelgänger</span>
    </div>
  );
}
