import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { moveGamesToOpponent } from '../state/actions';
import { guessOpponentName, opponentSide } from '../lib/games';
import type { Color } from '../lib/go/types';
import type { GameRecord } from '../lib/types';
import { gameTitle } from './common';

/**
 * Move games uploaded as the user's to an opponent: an existing one or a new one, shown by
 * whatever name the user likes. Where the names don't say which side the opponent played,
 * the user picks it, so the game counts toward that opponent's style.
 */
export function MoveDialog({ games, onClose }: { games: GameRecord[]; onClose: () => void }) {
  const opponents = useStore((s) => s.opponents);
  const myNames = useStore((s) => s.settings.playerNames);
  const guess = useMemo(() => guessOpponentName(games, myNames) ?? '', [games, myNames]);
  const lower = guess.trim().toLowerCase();
  const match = opponents.find((o) => [o.name, ...o.aliases].some((n) => n.trim().toLowerCase() === lower));
  const [pick, setPick] = useState<string>(match?.id ?? 'new');
  const [name, setName] = useState(guess);
  const [sides, setSides] = useState<Record<string, Color>>({});
  const [busy, setBusy] = useState(false);
  const sorted = [...opponents].sort((a, b) => a.name.localeCompare(b.name));
  const target = pick === 'new' ? null : opponents.find((o) => o.id === pick);
  // The names the chosen opponent is known by; a new one is known by the guessed record name.
  const known = target ? [target.name, ...target.aliases] : [guess];
  const unsure = games.filter((g) => !opponentSide(g, known, myNames));
  const ok = (pick !== 'new' || name.trim().length > 0) && unsure.every((g) => sides[g.id]);
  const submit = async () => {
    if (!ok || busy) return;
    setBusy(true);
    // Pass every side the dialog settled on: a new shown name may match none of the games.
    const all: Record<string, Color> = {};
    for (const g of games) {
      const c = sides[g.id] ?? opponentSide(g, known, myNames);
      if (c) all[g.id] = c;
    }
    await moveGamesToOpponent(
      games.map((g) => g.id),
      pick === 'new' ? { name: name.trim() } : { id: pick },
      all,
    );
    onClose();
  };
  // On <body>: pages animate their children in, which would pin a fixed overlay to them.
  return createPortal(
    <div className="lib-dialog-wrap" onClick={onClose}>
      <div className="lib-dialog panel" role="dialog" aria-label="Move to an opponent" onClick={(e) => e.stopPropagation()}>
        <div className="lib-dialog-title">Move {games.length === 1 ? 'this game' : `${games.length} games`} to an opponent</div>
        <p className="small muted" style={{ marginTop: 0 }}>
          {games.length === 1 ? 'It stops' : 'They stop'} counting toward your own style and stats, and count toward the opponent's profile and copy instead.
        </p>
        <label className="small">Opponent</label>
        <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ width: '100%', margin: '4px 0 10px' }}>
          {sorted.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} ({o.gameIds.length} game{o.gameIds.length === 1 ? '' : 's'})
            </option>
          ))}
          <option value="new">New opponent…</option>
        </select>
        {pick === 'new' && (
          <>
            <label className="small">Shown as</label>
            <input
              value={name}
              autoFocus
              placeholder="Any name you like"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              style={{ width: '100%', margin: '4px 0 4px' }}
            />
            <p className="tiny muted" style={{ margin: '0 0 10px' }}>
              {guess && name.trim().toLowerCase() !== lower ? `Their games still match "${guess}" from the game records.` : 'You can rename them later on their opponent page.'}
            </p>
          </>
        )}
        {unsure.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <label className="small">Which side were they?</label>
            {unsure.map((g) => (
              <div key={g.id} className="move-side">
                {unsure.length > 1 && <div className="tiny muted">{gameTitle(g)}</div>}
                <div className="seg">
                  {([1, 2] as const).map((c) => (
                    <button key={c} className={`btn small${sides[g.id] === c ? ' primary' : ''}`} onClick={() => setSides((s) => ({ ...s, [g.id]: c }))}>
                      <i className={`stone-dot ${c === 1 ? 'b' : 'w'}`} /> {(c === 1 ? g.black : g.white) || (c === 1 ? 'Black' : 'White')}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!ok || busy} onClick={() => void submit()}>
            Move
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
