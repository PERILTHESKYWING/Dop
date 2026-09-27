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
            {games.length} games · {analysed} analysed by KataGo
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
      <div className="callout small">
        This profile describes tendencies in the games you gave it, and the copy imitates how {o.name} chooses moves in them. Neither reads {o.name}'s mind, and small samples can mislead.
      </div>
      <div className="panel">
        <h3 style={{ marginBottom: 8 }}>{o.name}'s level</h3>
        <LevelPanel targets={opponentTargets(o, games)} who={`${o.name}'s`} auto />
      </div>
      <div className="panel stack">
        <div className="spread">
          <h3>{o.name}'s copy</h3>
          {o.copy && (
            <a className="btn small primary" href={href(`doppel/play?opp=${o.id}`)}>
              Play against it
            </a>
          )}
        </div>
        {o.copy ? (
          <>
            <p className="small">
              Predicts {o.name}'s exact move <strong className="doppel">{fmtPct(o.copy.metrics.top1)}</strong> of the time on games it did not learn from (KataGo's policy alone: {fmtPct(o.copy.metrics.baselineTop1)}), and has it in its top three{' '}
              {fmtPct(o.copy.metrics.top3)} of the time. Learned from {o.copy.moves ?? o.copy.trainedOn} moves in {o.copy.gameIds?.length ?? '?'} games.
            </p>
            <p className="tiny muted">It gets more accurate as you add games. When you play it you can set its strength, and it keeps choosing the moves {o.name} tends to choose.</p>
          </>
        ) : (
          <p className="small dim">The copy is learned once KataGo has analysed at least 30 of {o.name}'s moves ({analysed} of {games.length} games analysed so far).</p>
        )}
      </div>
      <DropZone compact label={`Add more of ${o.name}'s games`} onFiles={(f) => void importOpponentFiles(f, undefined, o)} />
      {!s ? (
        <div className="empty">No statistics yet.</div>
      ) : (
        <>
          <div className="grid cols-4">
            <div className="stat">
              <div className="v">{s.games}</div>
              <div className="l">games ({s.asBlack} as Black)</div>
            </div>
            <div className="stat">
              <div className="v">{s.games ? fmtPct(s.wins / s.games) : '—'}</div>
              <div className="l">won</div>
            </div>
            <div className="stat">
              <div className="v">{Math.round(s.avgLength)}</div>
              <div className="l">moves per game</div>
            </div>
            <div className="stat">
              <div className="v">{s.accuracy ? s.accuracy.avgScoreLoss.toFixed(1) : '—'}</div>
              <div className="l">points lost per move</div>
            </div>
          </div>
          {s.notes.length > 0 && (
            <div className="panel">
              <h3>What stands out</h3>
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
                <dt>Captures per game</dt>
                <dd>{s.fighting.capturesPerGame.toFixed(1)}</dd>
                <dt>Answers locally</dt>
                <dd>{fmtPct(s.fighting.localResponseRate)}</dd>
              </div>
            </div>
            <div className="panel stack">
              <h3>Invasions</h3>
              <div className="kv small">
                <dt>Invasions per game</dt>
                <dd>{s.invasions.perGame.toFixed(1)}</dd>
                <dt>Reductions per game</dt>
                <dd>{s.invasions.reductionsPerGame.toFixed(1)}</dd>
                <dt>First invasion</dt>
                <dd>{s.invasions.firstInvasionMove ? `move ${s.invasions.firstInvasionMove}` : '—'}</dd>
                <dt>Early 3-3 per game</dt>
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
              <h3 style={{ marginBottom: 8 }}>Openings they repeat</h3>
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
              <h3 style={{ marginBottom: 8 }}>Corner sequences (joseki)</h3>
              <div className="card-list">
                {s.joseki.slice(0, 8).map((q) => (
                  <div key={q.key} className="poscard">
                    <SeqBoard seq={q} size={size} crop />
                    <div className="tiny muted">
                      {q.count}× · black = whoever started the corner
                    </div>
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
        <a className="small muted" href={href('opponents')}>
          ← All opponents
        </a>
        <Profile o={o} />
      </div>
    );
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Prepare</div>
          <h1>Opponent Profiles</h1>
          <p className="sub">Import a rival's games to see their openings, corner sequences, fighting style and invasion habits before you play them.</p>
        </div>
      </div>
      <div className="panel stack">
        <input placeholder="Opponent name (optional, guessed from the SGFs)" value={name} onChange={(e) => setName(e.target.value)} />
        <DropZone
          compact
          label="Drop an opponent's SGF files"
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
