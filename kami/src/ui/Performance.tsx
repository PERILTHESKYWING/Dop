import type { MoveClass } from '../../../src/lib/coach/classify';
import type { Phase } from '../../../src/lib/analysis/lineStats';
import type { Color } from '../../../src/lib/go/types';
import { rankLabel, rankRangeLabel, rankTier } from '../../../src/lib/level/ranks';
import type { GameRating } from '../lib/rating';
import { accuracy, phaseClass, type MoveReview } from '../lib/review';
import { CLASS_LOOK, ClassIcon } from './ClassIcon';

/** The rows chess.com's review shows, in its order. */
const ROWS: MoveClass[] = ['brilliant', 'great', 'best', 'mistake', 'miss', 'blunder'];
const PHASES: { id: Phase; rated: 'opening' | 'middlegame' | 'endgame'; label: string }[] = [
  { id: 'opening', rated: 'opening', label: 'Opening' },
  { id: 'middle', rated: 'middlegame', label: 'Middlegame' },
  { id: 'endgame', rated: 'endgame', label: 'Endgame' },
];
const SIDES = [1, 2] as const;

interface Props {
  black: string;
  white: string;
  moves: MoveReview[];
  rating: GameRating | null;
  cursor: number;
  onPick: (pos: number) => void;
  /** Shown while the game is still being read. */
  progress?: React.ReactNode;
}

const rated = (r: number) => rankTier(r) ?? rankLabel(r);

/**
 * The Performance tab, laid out like chess.com's game review: accuracy, the count of each
 * kind of move, the game rating ("5.7d", by Dop's level system) and an icon per phase.
 */
export function Performance({ black, white, moves, rating, cursor, onPick, progress }: Props) {
  const hits = (c: MoveClass, color: Color) => moves.filter((m) => m.cls === c && m.color === color).map((m) => m.index);
  const acc = (color: Color) => accuracy(moves, color);
  const sides = rating?.state === 'done' ? rating.sides : null;

  return (
    <div className="perf">
      <div className="perf-row perf-head">
        <span />
        {SIDES.map((c) => (
          <span key={c} className={`perf-player c${c}`} title={c === 1 ? black : white}>
            <i className={`stone ${c === 1 ? 'b' : 'w'}`} />
            <span>{c === 1 ? black : white}</span>
          </span>
        ))}
      </div>

      <div className="perf-row">
        <span className="perf-label">Accuracy</span>
        {SIDES.map((c) => {
          const a = acc(c);
          return (
            <span key={c} className={`perf-box c${c} ${c === 1 ? 'dark' : 'light'}`} title="chess.com's formula on the winning chance each move gave away">
              {a === null ? '–' : a.toFixed(1)}
            </span>
          );
        })}
      </div>

      <hr />

      {ROWS.map((cls) => (
        <div key={cls} className="perf-row perf-class">
          <span className="perf-label">{CLASS_LOOK[cls].name}</span>
          {SIDES.map((c) => {
            const h = hits(cls, c);
            return (
              <button
                key={c}
                type="button"
                className={`perf-count c${c}`}
                style={h.length ? { color: CLASS_LOOK[cls].color } : undefined}
                disabled={!h.length}
                title={h.length ? `Go to the next ${CLASS_LOOK[cls].name.toLowerCase()} move` : undefined}
                onClick={() => {
                  const next = h.find((i) => i + 1 > cursor) ?? h[0];
                  if (next !== undefined) onPick(next + 1);
                }}
              >
                {h.length}
              </button>
            );
          })}
          <span className="perf-icon">
            <ClassIcon cls={cls} size={22} />
          </span>
        </div>
      ))}

      <hr />

      <div className="perf-row">
        <span className="perf-label">Game Rating</span>
        {SIDES.map((c) => {
          const s = sides?.[c];
          const text = rating?.state === 'measuring' ? '…' : rating?.state === 'failed' ? '–' : s ? rated(s.rank) : '–';
          const title =
            rating?.state === 'measuring'
              ? `Measuring the game ${rating.done}/${rating.total}`
              : rating?.state === 'failed'
                ? `Could not rate the game: ${rating.error}`
                : s
                  ? `Likely between ${rankRangeLabel(s.low, s.high)} (one game, ${s.moves} moves counted)`
                  : sides
                    ? 'Too few moves to rate'
                    : undefined;
          return (
            <span key={c} className={`perf-box c${c} ${c === 1 ? 'dark' : 'light'}${rating?.state === 'measuring' ? ' pending' : ''}`} title={title}>
              {text}
            </span>
          );
        })}
      </div>

      <hr />

      {PHASES.map((p) => (
        <div key={p.id} className="perf-row perf-phase">
          <span className="perf-label">{p.label}</span>
          {SIDES.map((c) => {
            const a = accuracy(moves, c, p.id);
            const cls = phaseClass(a);
            const r = sides?.[c]?.phases[p.rated];
            return (
              <span key={c} className={`perf-phase-icon c${c}`} title={a === null ? 'Not played yet' : `Accuracy ${a.toFixed(1)}${r !== undefined ? ` · plays like ${rated(r)}` : ''}`}>
                {cls ? <ClassIcon cls={cls} size={22} /> : <span className="muted">–</span>}
              </span>
            );
          })}
        </div>
      ))}

      {progress && <div className="perf-foot">{progress}</div>}
    </div>
  );
}
