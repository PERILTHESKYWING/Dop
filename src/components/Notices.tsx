import { useState } from 'react';
import { useStore } from '../state/store';
import { chooseSide, removeDemo, restartEngine, usesDemoData } from '../state/actions';
import { gameTitle } from './common';
import { Icon } from './Icons';
import { href } from '../router';

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
          {unknown.length === 1 ? '1 game needs' : `${unknown.length} games need`} your side to count.
        </span>
        <div>
          {unknown.slice(0, limit).map((g) => (
            <div key={g.id} className="side-game">
              <div className="small" style={{ minWidth: 0 }}>
                <strong>{gameTitle(g)}</strong>
                <div className="tiny muted">{[g.date, g.result, g.fileName].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="side-pick">
                <button className="btn small" onClick={() => void chooseSide(g.id, 1, remember)} title="Black">
                  <i className="stone-dot b" /> {g.black || 'Black'}
                </button>
                <button className="btn small" onClick={() => void chooseSide(g.id, 2, remember)} title="White">
                  <i className="stone-dot w" /> {g.white || 'White'}
                </button>
              </div>
            </div>
          ))}
        </div>
        {unknown.length > limit && <span className="tiny muted">+{unknown.length - limit} more in Library.</span>}
        <label className="check small">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember name
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
          <strong>KataGo failed to start</strong>
          <span className="small dim">
            {engine.status === 'unsupported'
              ? engine.error
              : 'The built-in CPU network works in any modern browser.'}
          </span>
          {engine.error && engine.status === 'error' && (
            <button className="btn small ghost" style={{ justifySelf: 'start' }} onClick={() => setOpen(!open)}>
              {open ? 'Hide details' : 'Details'}
            </button>
          )}
          {open && <pre className="tiny muted" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{engine.error}</pre>}
        </div>
        {engine.status === 'error' && (
          <div className="row wrap">
            <button className="btn" onClick={() => void restartEngine()}>
              Retry
            </button>
            <button className="btn primary" onClick={() => void restartEngine({ safe: true })}>
              Use built-in
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
  // A slim strip (styled in pages/dashboard.css): what is shown, and the two ways out of the demo.
  return (
    <div className="banner info demo-strip">
      <span className="demo-strip-ico" aria-hidden>
        <Icon name="stones" />
      </span>
      <div className="grow">
        <strong>{showing ? 'Demo player: Mira' : 'Demo games hidden'}</strong>
        <span className="small dim">
          {showing
            ? own
              ? 'Switches to you once a game is analysed.'
              : 'Import SGFs to switch to you.'
            : 'Profile uses your games only.'}
        </span>
      </div>
      <div className="demo-strip-actions">
        {showing && !own && (
          <a className="btn small" href={href('library')}>
            <Icon name="upload" /> Import
          </a>
        )}
        <button className="btn small ghost" onClick={() => void removeDemo()}>
          Remove demo
        </button>
      </div>
    </div>
  );
}
