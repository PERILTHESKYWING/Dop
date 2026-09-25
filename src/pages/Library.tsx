import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { corpus, importFiles, pauseQueue, removeGames, resumeQueue, retryGame, setGameColor } from '../state/actions';
import { DropZone, gameTitle } from '../components/common';
import { go } from '../router';
import type { GameRecord } from '../lib/types';

function StatusCell({ g, current }: { g: GameRecord; current: boolean }) {
  if (g.status === 'done') return <span className="chip good">analysed</span>;
  if (g.status === 'error')
    return (
      <span className="row">
        <span className="chip bad" title={g.error}>
          failed
        </span>
        <button className="btn small ghost" onClick={(e) => (e.stopPropagation(), void retryGame(g.id))}>
          retry
        </button>
      </span>
    );
  if (current) {
    const p = g.status === 'deep' ? g.progress.deep / Math.max(1, g.progress.deepTotal) : g.progress.fast / Math.max(1, g.progress.total);
    return (
      <div style={{ minWidth: 120 }}>
        <div className="tiny muted">{g.status === 'deep' ? `deep ${g.progress.deep}/${g.progress.deepTotal}` : `fast ${g.progress.fast}/${g.progress.total}`}</div>
        <div className="progress">
          <span style={{ width: `${p * 100}%` }} />
        </div>
      </div>
    );
  }
  return <span className="chip">{g.progress.fast > 0 ? 'paused' : 'queued'}</span>;
}

export function Library() {
  const games = useStore((s) => s.games);
  const queue = useStore((s) => s.queue);
  const version = useStore((s) => s.corpusVersion);
  const [filter, setFilter] = useState<'mine' | 'opponents' | 'all'>('mine');
  const mistakes = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of corpus().playerRecords()) if (r.severity === 'mistake' || r.severity === 'blunder') m.set(r.gameId, (m.get(r.gameId) ?? 0) + 1);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  const shown = games
    .filter((g) => (filter === 'all' ? true : filter === 'mine' ? g.source === 'user' || g.source === 'demo' : g.source === 'opponent' || g.source === 'demo-opponent'))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.importedAt - a.importedAt);
  const pending = games.filter((g) => g.status !== 'done' && g.status !== 'error' && g.status !== 'skipped').length;
  const unknownColor = games.filter((g) => g.source === 'user' && g.playerColor === null).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Game Library</h1>
          <p className="sub">
            {games.length} games · {pending ? `${pending} waiting for analysis` : 'all analysed'}
          </p>
        </div>
        <div className="row">
          {queue.running ? (
            <button className="btn" onClick={pauseQueue}>
              Pause analysis
            </button>
          ) : (
            pending > 0 && (
              <button className="btn" onClick={resumeQueue}>
                Resume analysis
              </button>
            )
          )}
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="mine">My games</option>
            <option value="opponents">Opponents' games</option>
            <option value="all">All games</option>
          </select>
        </div>
      </div>
      <DropZone compact onFiles={(f) => void importFiles(f)} />
      {unknownColor > 0 && (
        <div className="callout" style={{ marginTop: 12 }}>
          <span className="small">
            {unknownColor} game{unknownColor > 1 ? 's do' : ' does'} not say which side you played. Click the side in the "You" column, or set your player names in Engine & Settings.
          </span>
        </div>
      )}
      <div className="panel" style={{ marginTop: 12, padding: 0 }}>
        {shown.length ? (
          <table className="data">
            <thead>
              <tr>
                <th>Game</th>
                <th>Date</th>
                <th>You</th>
                <th>Result</th>
                <th>Moves</th>
                <th>Costly moves</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((g) => (
                <tr key={g.id} className="click" onClick={() => go(`review/${g.id}`)}>
                  <td>
                    <div>{gameTitle(g)}</div>
                    <div className="tiny muted">
                      {g.event ?? g.fileName}
                      {g.size !== 19 && ` · ${g.size}×${g.size}`}
                      {g.handicap > 1 && ` · H${g.handicap}`}
                    </div>
                  </td>
                  <td className="small dim">{g.date ?? '—'}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {g.source === 'user' || g.source === 'demo' ? (
                      <select
                        value={g.playerColor ?? 0}
                        onChange={(e) => void setGameColor(g.id, (Number(e.target.value) || null) as 1 | 2 | null)}
                        style={{ padding: '2px 4px', fontSize: 12 }}
                      >
                        <option value={0}>?</option>
                        <option value={1}>Black</option>
                        <option value={2}>White</option>
                      </select>
                    ) : (
                      <span className="muted small">opponent</span>
                    )}
                  </td>
                  <td className="small">{g.result ?? '—'}</td>
                  <td className="small mono">{g.moves.length}</td>
                  <td className="small mono">{g.status === 'done' && g.playerColor ? mistakes.get(g.id) ?? 0 : '—'}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <StatusCell g={g} current={queue.currentGameId === g.id} />
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn small ghost"
                      title="Remove from library"
                      onClick={() => {
                        if (confirm(`Remove ${gameTitle(g)} and its analysis?`)) void removeGames([g.id]);
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty" style={{ margin: 16 }}>
            No games here yet.
          </div>
        )}
      </div>
    </div>
  );
}
