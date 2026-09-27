import { useEffect, useState } from 'react';
import type { PositionSpec } from '../lib/analysis/analyzer';
import type { ProStats } from '../lib/coach/pro';
import { PRO_RANK } from '../lib/coach/difficulty';
import { ClassPill } from './MoveBadge';
import { locToGtp } from '../lib/go/coords';
import { rankLabel } from '../lib/level/ranks';
import { gradeMoves, moveDifficulty, proAt, type MoveDifficulty, type MoveInsightResult, type MoveTarget } from '../state/insight';
import './insight.css';

export interface InsightState {
  insights: MoveInsightResult[] | null;
  pro: ProStats | null;
  busy: boolean;
  error: string | null;
}

/**
 * Insights for the position on screen. The difficulty is worked out once the viewer stays
 * on the position for a moment (stepping through a game quickly queues no work); the
 * grading follows the live analysis as it deepens.
 */
export function useMoveInsight(key: string | null, spec: () => PositionSpec | null, targets: readonly MoveTarget[], ownRank?: number): InsightState {
  const [diffs, setDiffs] = useState<MoveDifficulty[] | null>(null);
  const [pro, setPro] = useState<ProStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locs = [...new Set(targets.map((t) => t.loc))].sort((a, b) => a - b).join(',');
  const own = ownRank === undefined ? '' : String(Math.round(ownRank));
  useEffect(() => {
    setDiffs(null);
    setPro(null);
    setBusy(false);
    setError(null);
    const s = key ? spec() : null;
    if (!key || !s) return;
    let live = true;
    void proAt(s.board.stones, s.toPlay, s.size, targets.find((t) => t.role === 'played')?.loc).then((p) => live && setPro(p));
    if (!locs) return;
    const t = setTimeout(() => {
      setBusy(true);
      moveDifficulty(key, s, locs.split(',').map(Number), own ? [Number(own)] : [])
        .then((d) => live && setDiffs(d))
        .catch((e) => live && setError((e as Error).message))
        .finally(() => live && setBusy(false));
    }, 450);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, locs, own]);
  return { insights: diffs ? gradeMoves(targets, diffs) : null, pro, busy, error };
}

const pct = (x: number) => (x >= 0.995 ? '99%' : x < 0.005 ? '<1%' : `${Math.round(x * 100)}%`);

function Rates({ i, own }: { i: MoveInsightResult; own?: number }) {
  return (
    <span className="rates">
      {i.rates.map((r) => (
        <span key={r.rank} className={own !== undefined && r.rank === Math.round(own) && r.rank < PRO_RANK ? 'own' : ''} title={`${r.label} players play this here ${pct(r.rate)} of the time`}>
          {r.label} {pct(r.rate)}
        </span>
      ))}
    </span>
  );
}

/** Label, difficulty by level, pro games and game-file comments for the current move. */
export function InsightPanel({ state, size, ownRank, comments, playedLoc }: { state: InsightState; size: number; ownRank?: number; comments: { lastMove?: string; nextMove?: string }; playedLoc?: number }) {
  const { insights, pro, busy, error } = state;
  const played = insights?.find((i) => i.role === 'played');
  const best = insights?.find((i) => i.role === 'KataGo');
  return (
    <div className="insight stack tight">
      {insights?.map((i) => (
        <div key={i.role} className="insight-row">
          <div className="spread">
            <span>
              {i.role === 'played' ? 'Played' : 'KataGo'} <b className="mono">{locToGtp(i.loc, size)}</b>
            </span>
            <ClassPill cls={i.label} />
          </div>
          {(i.label === 'brilliant' || i.label === 'great') && i.gap && (
            <div className="tiny muted">
              Every other move KataGo read is at least {i.gap.points.toFixed(1)} points or {pct(i.gap.win)} worse.
            </div>
          )}
          <div className="tiny">
            <span className="muted">How often players find it here: </span>
            <Rates i={i} own={ownRank} />
          </div>
        </div>
      ))}
      {!insights && busy && <div className="tiny muted">Working out how hard these moves are to find…</div>}
      {error && <div className="tiny warn-text">Move difficulty unavailable: {error}</div>}
      {played && best && played.loc !== best.loc && best.label === 'brilliant' && <div className="tiny">KataGo’s move here was brilliant: missing it is normal below strong dan level.</div>}
      {pro && (
        <div className="tiny">
          <span className="muted">Pros from this position ({pro.games} games, 1940–2017): </span>
          {pro.moves.slice(0, 4).map((m, k) => (
            <span key={m.loc} className={m.loc === playedLoc ? 'you' : ''}>
              {k ? ' · ' : ''}
              <b className="mono">{locToGtp(m.loc, size)}</b> {Math.round((100 * m.count) / pro.games)}%
            </span>
          ))}
          {playedLoc !== undefined && !pro.moves.some((m) => m.loc === playedLoc) && <span className="muted"> · the move played is not among them</span>}
        </div>
      )}
      {comments.lastMove && (
        <div className="comment tiny">
          <span className="muted">Comment on the last move: </span>
          {comments.lastMove}
        </div>
      )}
      {comments.nextMove && (
        <div className="comment tiny">
          <span className="muted">Comment on this move: </span>
          {comments.nextMove}
        </div>
      )}
      {ownRank !== undefined && insights?.length ? <div className="tiny muted">Highlighted: players near your level (about {rankLabel(ownRank)}).</div> : null}
    </div>
  );
}
