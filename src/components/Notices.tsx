import { useState } from 'react';
import { useStore } from '../state/store';
import { chooseSide, removeDemo, restartEngine, usesDemoData } from '../state/actions';
import { gameTitle } from './common';

/** "Which side did you play?" for games whose SGF doesn't say (no player name matched). */
export function SideChooser({ limit = 4 }: { limit?: number }) {
  const games = useStore((s) => s.games);
  const [remember, setRemember] = useState(true);
  const unknown = games.filter((g) => g.source === 'user' && g.playerColor === null);
  if (!unknown.length) return null;
  return (
    <div className="banner warn">
      <div className="grow stack tight">
        <strong>Which side did you play?</strong>
        <span className="small dim">
          {unknown.length === 1 ? 'This game does' : `${unknown.length} games do`} not say which player is you. Your profile and training use only games where your side is known.
        </span>
        <div>
          {unknown.slice(0, limit).map((g) => (
            <div key={g.id} className="side-game">
              <div className="small" style={{ minWidth: 0 }}>
                <strong>{gameTitle(g)}</strong>
                <div className="tiny muted">{[g.date, g.result, g.fileName].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="side-pick">
                <button className="btn small" onClick={() => void chooseSide(g.id, 1, remember)} title="I played Black">
                  <i className="stone-dot b" /> {g.black || 'Black'}
                </button>
                <button className="btn small" onClick={() => void chooseSide(g.id, 2, remember)} title="I played White">
                  <i className="stone-dot w" /> {g.white || 'White'}
                </button>
              </div>
            </div>
          ))}
        </div>
        {unknown.length > limit && <span className="tiny muted">and {unknown.length - limit} more (use the "You" column in the Game Library).</span>}
        <label className="check small">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember that name, so future games are matched automatically
        </label>
      </div>
    </div>
  );
}

/** Tells the user when KataGo could not start or had to fall back, with the fixes. */
export function EngineNotice() {
  const engine = useStore((s) => s.engine);
  const [open, setOpen] = useState(false);
  if (engine.status === 'error' || engine.status === 'unsupported')
    return (
      <div className="banner bad">
        <div className="grow stack tight">
          <strong>KataGo could not start on this device</strong>
          <span className="small dim">
            {engine.status === 'unsupported'
              ? engine.error
              : 'Game analysis needs it. The built-in network on the CPU works in every modern browser, even when downloads are blocked.'}
          </span>
          {engine.error && engine.status === 'error' && (
            <button className="btn small ghost" style={{ justifySelf: 'start' }} onClick={() => setOpen(!open)}>
              {open ? 'Hide details' : 'Show details'}
            </button>
          )}
          {open && <pre className="tiny muted" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{engine.error}</pre>}
        </div>
        {engine.status === 'error' && (
          <div className="row wrap">
            <button className="btn" onClick={() => void restartEngine()}>
              Try again
            </button>
            <button className="btn primary" onClick={() => void restartEngine({ safe: true })}>
              Use the built-in network
            </button>
          </div>
        )}
      </div>
    );
  if (engine.status === 'off' && engine.note)
    return (
      <div className="banner info">
        <div className="grow small">{engine.note}</div>
      </div>
    );
  return null;
}

/** Demo data is shown only until the user's own games are analysed; offer to remove it. */
export function DemoNotice() {
  const games = useStore((s) => s.games);
  useStore((s) => s.analyses);
  const hasDemo = games.some((g) => g.source === 'demo');
  if (!hasDemo) return null;
  const showing = usesDemoData();
  const own = games.some((g) => g.source === 'user');
  return (
    <div className="banner info">
      <div className="grow stack tight">
        <strong>{showing ? 'You are looking at the demo player, Mira' : 'Demo games are hidden from your profile'}</strong>
        <span className="small dim">
          {showing
            ? own
              ? 'Your own games take over as soon as one of them is analysed and your side is known.'
              : 'Import your own SGF games and the lab switches to you once they are analysed.'
            : 'Your profile, weaknesses and training now come from your own games only.'}
        </span>
      </div>
      <button className="btn" onClick={() => void removeDemo()}>
        Remove demo data
      </button>
    </div>
  );
}
