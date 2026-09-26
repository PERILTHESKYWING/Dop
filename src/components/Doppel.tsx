import { useMemo } from 'react';
import { useStore } from '../state/store';
import { corpus, usesDemoData } from '../state/actions';
import { fmtPct } from './common';
import { locToGtp } from '../lib/go/coords';
import { PASS, type Loc } from '../lib/go/types';
import { copyStatus, type CopyStatus, type DoppelModel, type DoppelPrediction } from '../lib/profile/doppel';

export interface CopyInfo extends CopyStatus {
  /** The copy to predict with: set only when it learned from the games the app studies now. */
  model: DoppelModel | null;
  /** Whatever copy is stored, even one learned from other games (e.g. the demo player's). */
  stored: DoppelModel | null;
  /** Only the demo player's games are studied (none of the user's own is analysed yet). */
  demoMode: boolean;
  /** "Your copy", or "Mira's copy" while the demo player is studied. */
  who: string;
  /** For sentences: "your", or "Mira's". */
  whose: string;
  /** The demo player's name, when there are demo games. */
  demoName: string | null;
}

/**
 * The player's copy (the Doppelgänger model) and whose it is. Use `model` for predictions:
 * it is null when the stored copy learned from other games than the ones studied now, so
 * the demo player's habits are never shown as the user's.
 */
export function useCopy(): CopyInfo {
  const stored = useStore((s) => s.doppel);
  const games = useStore((s) => s.games);
  const version = useStore((s) => s.corpusVersion);
  return useMemo(() => {
    const demoMode = usesDemoData();
    const byId = new Map(games.map((g) => [g.id, g]));
    let studiedGames: string[] = [];
    let playerMoves = 0;
    if (stored) {
      const recs = corpus().playerRecords();
      playerMoves = recs.length;
      studiedGames = [...new Set(recs.map((r) => r.gameId))];
    }
    const status = copyStatus(stored, { demoMode, sourceOf: (id) => byId.get(id)?.source, studiedGames, playerMoves });
    const demoGame = games.find((g) => g.source === 'demo' && g.playerColor);
    const demoName = demoGame ? (demoGame.playerColor === 1 ? demoGame.black : demoGame.white) || null : null;
    const demoCopy = status.state === 'ready' && status.owner === 'demo' && !!demoName;
    return {
      ...status,
      model: status.state === 'ready' ? stored : null,
      stored,
      demoMode,
      who: demoCopy ? `${demoName}'s copy` : 'Your copy',
      whose: demoCopy ? `${demoName}'s` : 'your',
      demoName,
    };
    // `version` changes whenever the studied games or their analyses do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, games, version]);
}

/**
 * One line with the copy's guess for a position: "Your copy: R14 · 46% likely (then Q13 20%,
 * R13 9%)". With `played`, it also says whether that move was the one it expected.
 */
export function DoppelLine({
  predictions,
  size,
  who = 'Your copy',
  played,
  compact,
  className,
}: {
  predictions: readonly DoppelPrediction[];
  size: number;
  who?: string;
  /** The move actually played here, if any. */
  played?: Loc | null;
  /** Only the most likely move. */
  compact?: boolean;
  className?: string;
}) {
  if (!predictions.length) return null;
  const [top, ...rest] = predictions;
  const playedP = played != null && played !== PASS ? predictions.find((p) => p.loc === played)?.p : undefined;
  return (
    <div className={`small ${className ?? ''}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 6 }}>
      {who && <span className="muted">{who}:</span>}
      <strong className="doppel">{locToGtp(top.loc, size)}</strong>
      <span className="dim">· {fmtPct(top.p)} likely</span>
      {!compact && rest.length > 0 && (
        <span className="tiny muted">
          (then {rest.map((p) => `${locToGtp(p.loc, size)} ${fmtPct(p.p)}`).join(', ')})
        </span>
      )}
      {played != null && played !== PASS && (
        <span className={`tiny ${played === top.loc ? 'doppel' : 'muted'}`}>
          {played === top.loc ? '· played to type' : playedP !== undefined ? `· played ${locToGtp(played, size)} (${fmtPct(playedP)} for the copy)` : `· played ${locToGtp(played, size)}, a surprise`}
        </span>
      )}
    </div>
  );
}
