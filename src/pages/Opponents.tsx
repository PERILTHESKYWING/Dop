import { useState } from 'react';
import { LevelPanel } from '../components/Level';
import { opponentTargets } from '../state/level';
import { useStore } from '../state/store';
import { deleteOpponent, importOpponentFiles, renameOpponent, saveOpponent } from '../state/actions';
import { Board } from '../components/Board';
import { DropZone, fmtPct, gameTitle } from '../components/common';
import type { SequenceStat } from '../lib/opponents/profile';
import type { OpponentProfile } from '../lib/types';
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

function Profile({ o }: { o: OpponentProfile }) {
  const allGames = useStore((s) => s.games);
  const games = allGames.filter((g) => o.gameIds.includes(g.id));
  const analysed = games.filter((g) => g.status === 'done').length;
  const [name, setName] = useState(o.name);
  const s = o.stats;
  const size = games[0]?.size ?? 19;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <input className="title-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== o.name && void renameOpponent(o.id, name.trim())} />
          <p className="sub">
            {games.length} games · {analysed} analysed
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
      <DropZone compact label="Add games" onFiles={(f) => void importOpponentFiles(f, undefined, o)} />
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
        <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <DropZone
          compact
          label="Drop SGF files"
          onFiles={async (f) => {
            const p = await importOpponentFiles(f, name.trim() || undefined);
            if (p) go(`opponents/${p.id}`);
          }}
        />
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
