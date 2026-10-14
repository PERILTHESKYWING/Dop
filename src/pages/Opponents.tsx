import { useState } from 'react';
import { LevelPanel } from '../components/Level';
import { opponentTargets } from '../state/level';
import { useStore } from '../state/store';
import { addOpponentGames, deleteOpponent, playersIn, readOpponentFiles, renameOpponent, saveOpponent, setOpponentColor } from '../state/actions';
import { opponentColorOf } from '../lib/games';
import { Board } from '../components/Board';
import { DropZone, fmtPct, gameTitle } from '../components/common';
import type { SequenceStat } from '../lib/opponents/profile';
import type { GameRecord, OpponentProfile } from '../lib/types';
import { go, href } from '../router';
import { BackLink } from '../components/ControlSheet';

function SeqBoard({ seq, size, crop }: { seq: SequenceStat; size: number; crop?: boolean }) {
  const stones = new Int8Array(size * size);
  const marks = seq.moves.map((m, i) => {
    stones[m.loc] = m.color;
    return { loc: m.loc, kind: 'pv' as const, label: String(i + 1) };
  });
  const lim = Math.min(size - 1, 9);
  return (
    <div className="thumb">
      <Board size={size} stones={stones} marks={marks} crop={crop ? { x0: 0, y0: 0, x1: lim, y1: lim } : undefined} />
    </div>
  );
}

/**
 * After SGFs are dropped: who in them is the opponent? Nothing is picked for the user unless
 * one name clearly recurs (or already belongs to this opponent), never just "Black".
 */
function WhoIsIt({ games, existing, shown: shown0, onDone }: { games: GameRecord[]; existing?: OpponentProfile; shown?: string; onDone: (o: OpponentProfile | null) => void }) {
  const players = playersIn(games);
  const mine = existing ? players.find((p) => [existing.name, ...existing.aliases].some((n) => n.trim().toLowerCase() === p.name.toLowerCase())) : undefined;
  const clear = players.length > 1 && players[0].games >= 2 && players[0].games > players[1].games ? players[0] : undefined;
  const [pick, setPick] = useState(mine?.name ?? clear?.name ?? '');
  const [shown, setShown] = useState(shown0 ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!pick || busy) return;
    setBusy(true);
    onDone(await addOpponentGames(games, pick, { shown: shown.trim() || undefined, existing }));
  };
  return (
    <div className="panel stack who-is-it">
      <strong>
        Who is the opponent in {games.length === 1 ? 'this game' : `these ${games.length} games`}?
      </strong>
      <div className="who-list">
        {players.map((p) => (
          <label key={p.name} className={`who-opt${pick === p.name ? ' on' : ''}`}>
            <input type="radio" name="who" checked={pick === p.name} onChange={() => setPick(p.name)} />
            <span>{p.name}</span>
            {games.length > 1 && <span className="tiny muted">{p.games} game{p.games === 1 ? '' : 's'}</span>}
          </label>
        ))}
      </div>
      {!existing && (
        <label className="small stack tight">
          Shown as
          <input value={shown} placeholder={pick || 'Any name you like'} onChange={(e) => setShown(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
        </label>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button className="btn primary" disabled={!pick || busy} onClick={() => void save()}>
          Add {games.length === 1 ? 'game' : `${games.length} games`}
        </button>
      </div>
    </div>
  );
}

/** Which side the opponent played in one game; the user can change it. */
function SideCell({ g, o }: { g: GameRecord; o: OpponentProfile }) {
  const byName = opponentColorOf({ black: g.black, white: g.white }, new Set([o.name, ...o.aliases].map((n) => n.trim().toLowerCase())));
  const value = g.opponentColor ?? byName ?? 0;
  return (
    <select value={value} onClick={(e) => e.stopPropagation()} onChange={(e) => void setOpponentColor(g.id, (Number(e.target.value) || null) as 1 | 2 | null)} style={{ padding: '2px 4px', fontSize: 12, maxWidth: 150 }} aria-label={`${o.name}'s side`}>
      {!value && <option value={0}>Not counted: pick</option>}
      <option value={1}>● {g.black || 'Black'}</option>
      <option value={2}>○ {g.white || 'White'}</option>
    </select>
  );
}

function Profile({ o }: { o: OpponentProfile }) {
  const allGames = useStore((s) => s.games);
  const games = allGames.filter((g) => o.gameIds.includes(g.id));
  const analysed = games.filter((g) => g.status === 'done').length;
  const [name, setName] = useState(o.name);
  const [adding, setAdding] = useState<GameRecord[] | null>(null);
  const s = o.stats;
  const size = games[0]?.size ?? 19;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <input
            className="title-input"
            value={name}
            aria-label="Shown name"
            title="Shown name: tap to rename"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            onBlur={() => (name.trim() && name !== o.name ? void renameOpponent(o.id, name.trim()) : setName(o.name))}
          />
          <p className="sub">
            {games.length} games · {analysed} analysed
          </p>
          <p className="tiny muted" style={{ margin: 0 }}>
            Tap the name to rename them.{o.aliases.length > 0 && ` Their games match ${o.aliases.map((a) => `"${a}"`).join(', ')} in the game records.`}
          </p>
        </div>
        <div className="row">
          <button className="btn small" onClick={() => void saveOpponent(o)}>
            Recompute
          </button>
          <button
            className="btn small ghost"
            onClick={() => {
              if (confirm(`Delete ${o.name}'s profile and games?`)) void deleteOpponent(o.id).then(() => go('opponents'));
            }}
          >
            Delete
          </button>
        </div>
      </div>
      <div className="callout small">Based only on the games you added. Small samples mislead.</div>
      <div className="panel">
        <h3 style={{ marginBottom: 8 }}>Level</h3>
        <LevelPanel targets={opponentTargets(o, games)} who={`${o.name}'s`} auto />
      </div>
      <div className="panel stack">
        <div className="spread">
          <h3>Copy</h3>
          {o.copy && (
            <a className="btn small primary" href={href(`doppel/play?opp=${o.id}`)}>
              Play it
            </a>
          )}
        </div>
        {o.copy ? (
          <>
            <p className="small">
              Exact move <strong className="doppel">{fmtPct(o.copy.metrics.top1)}</strong> (KataGo {fmtPct(o.copy.metrics.baselineTop1)}) · top 3 {fmtPct(o.copy.metrics.top3)} · {o.copy.moves ?? o.copy.trainedOn} moves, {o.copy.gameIds?.length ?? '?'} games
            </p>
            <p className="tiny muted">More games, better copy.</p>
          </>
        ) : (
          <p className="small dim">Needs 30 analysed moves ({analysed}/{games.length} games done).</p>
        )}
      </div>
      {adding ? (
        <WhoIsIt games={adding} existing={o} onDone={() => setAdding(null)} />
      ) : (
        <DropZone compact label="Add games" onFiles={async (f) => {
            const games = await readOpponentFiles(f);
            if (games.length) setAdding(games);
          }}
        />
      )}
      {!s ? (
        <div className="empty">No stats yet.</div>
      ) : (
        <>
          <div className="grid cols-4">
            <div className="stat">
              <div className="v">{s.games}</div>
              <div className="l">games ({s.asBlack} B)</div>
            </div>
            <div className="stat">
              <div className="v">{s.games ? fmtPct(s.wins / s.games) : '—'}</div>
              <div className="l">won</div>
            </div>
            <div className="stat">
              <div className="v">{Math.round(s.avgLength)}</div>
              <div className="l">moves/game</div>
            </div>
            <div className="stat">
              <div className="v">{s.accuracy ? s.accuracy.avgScoreLoss.toFixed(1) : '—'}</div>
              <div className="l">pts lost/move</div>
            </div>
          </div>
          {s.notes.length > 0 && (
            <div className="panel">
              <h3>Notes</h3>
              <ul className="notes">
                {s.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid cols-3">
            <div className="panel stack">
              <h3>Fighting</h3>
              <div className="kv small">
                <dt>Contact moves</dt>
                <dd>{fmtPct(s.fighting.contactRate)}</dd>
                <dt>Ataris</dt>
                <dd>{fmtPct(s.fighting.atariRate)}</dd>
                <dt>Captures/game</dt>
                <dd>{s.fighting.capturesPerGame.toFixed(1)}</dd>
                <dt>Answers locally</dt>
                <dd>{fmtPct(s.fighting.localResponseRate)}</dd>
              </div>
            </div>
            <div className="panel stack">
              <h3>Invasions</h3>
              <div className="kv small">
                <dt>Invasions/game</dt>
                <dd>{s.invasions.perGame.toFixed(1)}</dd>
                <dt>Reductions/game</dt>
                <dd>{s.invasions.reductionsPerGame.toFixed(1)}</dd>
                <dt>First invasion</dt>
                <dd>{s.invasions.firstInvasionMove ? `move ${s.invasions.firstInvasionMove}` : '—'}</dd>
                <dt>Early 3-3/game</dt>
                <dd>{s.invasions.threeThreeRate.toFixed(1)}</dd>
              </div>
            </div>
            <div className="panel stack">
              <h3>Strategy</h3>
              <div className="kv small">
                <dt>Low moves</dt>
                <dd>{fmtPct(s.strategy.lowRate)}</dd>
                <dt>High moves</dt>
                <dd>{fmtPct(s.strategy.highRate)}</dd>
                <dt>Tenuki</dt>
                <dd>{fmtPct(s.strategy.tenukiRate)}</dd>
                <dt>Corner moves</dt>
                <dd>{fmtPct(s.strategy.cornerRate)}</dd>
              </div>
            </div>
          </div>
          {s.firstMoves.length > 0 && (
            <div className="panel">
              <h3>First moves</h3>
              <div className="row wrap small" style={{ marginTop: 8 }}>
                {s.firstMoves.slice(0, 6).map((f) => (
                  <span key={f.label} className="chip">
                    {f.label} × {f.count}
                  </span>
                ))}
              </div>
            </div>
          )}
          {s.openingSequences.length > 0 && (
            <div>
              <h3 style={{ marginBottom: 8 }}>Openings</h3>
              <div className="card-list">
                {s.openingSequences.slice(0, 6).map((q) => (
                  <div key={q.key} className="poscard">
                    <SeqBoard seq={q} size={size} />
                    <div className="tiny muted">played {q.count}×</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {s.joseki.length > 0 && (
            <div>
              <h3 style={{ marginBottom: 8 }}>Joseki</h3>
              <div className="card-list">
                {s.joseki.slice(0, 8).map((q) => (
                  <div key={q.key} className="poscard">
                    <SeqBoard seq={q} size={size} crop />
                    <div className="tiny muted">{q.count}×</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="panel" style={{ padding: 0 }}>
            <div className="table-scroll">
              <table className="data">
                <tbody>
                  {games.map((g) => (
                    <tr key={g.id} className="click" onClick={() => go(`review/${g.id}`)}>
                      <td>{gameTitle(g)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <SideCell g={g} o={o} />
                      </td>
                      <td className="small dim">{g.date ?? ''}</td>
                      <td className="small">{g.result ?? ''}</td>
                      <td className="small muted">{g.status === 'done' ? 'analysed' : g.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function Opponents({ id }: { id?: string }) {
  const opponents = useStore((s) => s.opponents);
  const [name, setName] = useState('');
  const [pending, setPending] = useState<GameRecord[] | null>(null);
  const o = opponents.find((x) => x.id === id);
  if (o)
    return (
      <div className="page">
        <BackLink href={href('opponents')} label="Opponents" />
        <Profile o={o} />
      </div>
    );
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Opponents</h1>
          <p className="sub">Scout a rival from their SGFs.</p>
        </div>
      </div>
      <div className="panel stack">
        {pending ? (
          <WhoIsIt
            games={pending}
            shown={name}
            onDone={(p) => {
              setPending(null);
              if (p) go(`opponents/${p.id}`);
            }}
          />
        ) : (
          <>
            <input placeholder="Shown name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
            <DropZone
              compact
              label="Drop SGF files"
              onFiles={async (f) => {
                const games = await readOpponentFiles(f);
                if (games.length) setPending(games);
              }}
            />
          </>
        )}
      </div>
      <div className="card-list" style={{ marginTop: 16 }}>
        {opponents.map((p) => (
          <a key={p.id} className="panel click" href={href(`opponents/${p.id}`)}>
            <h3>{p.name}</h3>
            <div className="small muted">{p.gameIds.length} games</div>
            {p.stats?.notes.slice(0, 2).map((n) => (
              <p key={n} className="small dim">
                {n}
              </p>
            ))}
          </a>
        ))}
        {!opponents.length && <div className="empty">No opponents yet.</div>}
      </div>
    </div>
  );
}
