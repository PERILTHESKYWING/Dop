import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { corpus, importFiles, pauseQueue, removeGames, resumeQueue, retryGame, setGameColor } from '../state/actions';
import { DropZone, gameTitle } from '../components/common';
import { EngineNotice, SideChooser } from '../components/Notices';
import { go } from '../router';
import type { GameRecord } from '../lib/types';
import { countMoves, kifuToSgf, type Kifu } from '../lib/kifu/kifu';
import { deleteKifu, listKifus } from '../lib/kifu/store';

function StatusCell({ g, current }: { g: GameRecord; current: boolean }) {
  if (g.status === 'done') return <span className="chip good">analysed</span>;
  if (g.status === 'error')
    return (
      <span className="row">
        <span className="chip bad" title={g.error}>
          failed
        </span>
        <button className="btn small" onClick={(e) => (e.stopPropagation(), void retryGame(g.id))} title={g.error}>
          Retry
        </button>
      </span>
    );
  if (current) {
    const p = g.status === 'deep' ? g.progress.deep / Math.max(1, g.progress.deepTotal) : g.progress.fast / Math.max(1, g.progress.total);
    return (
      <div style={{ minWidth: 120 }}>
        <div className="tiny muted">{g.status === 'deep' ? `searching ${g.progress.deep}/${g.progress.deepTotal}` : `first look ${g.progress.fast}/${g.progress.total}`}</div>
        <div className="progress">
          <span style={{ width: `${p * 100}%` }} />
        </div>
      </div>
    );
  }
  if (g.status === 'fast') return <span className="chip">{g.progress.deep > 0 ? 'search paused' : 'search queued'}</span>;
  return <span className="chip">{g.progress.fast > 0 ? 'paused' : 'queued'}</span>;
}

/** Downloads a kifu as a real .sgf file, via the browser's own save dialog where it offers one. */
function downloadKifu(k: Kifu) {
  const blob = new Blob([kifuToSgf(k)], { type: 'application/x-go-sgf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(k.title || 'kifu').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'kifu'}.sgf`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Saved kifu from the study board: they're kept in IndexedDB, not shown on this page's own
 * game table, so this section is the only place they're findable outside Study itself. */
function KifuSection() {
  const [items, setItems] = useState<Kifu[] | null>(null);
  const refresh = () => void listKifus().then(setItems).catch(() => setItems([]));
  useEffect(refresh, []);
  if (items === null) return null;
  if (!items.length)
    return (
      <div className="panel" style={{ marginTop: 14, padding: '10px 14px' }}>
        <div className="spread">
          <h3 style={{ margin: 0 }}>Your kifu</h3>
          <span className="small muted">Save a position from the study board to see it here.</span>
        </div>
      </div>
    );
  return (
    <div className="panel" style={{ marginTop: 14, padding: '6px 8px' }}>
      <div className="spread" style={{ padding: '8px 8px 0' }}>
        <h3 style={{ margin: 0 }}>Your kifu</h3>
        <span className="small muted">
          {items.length} saved · {items.reduce((a, k) => a + countMoves(k), 0)} moves total
        </span>
      </div>
      <div className="table-scroll">
        <table className="data lib-table">
          <thead>
            <tr>
              <th>Kifu</th>
              <th className="narrow-hide">Saved</th>
              <th className="narrow-hide">Moves</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((k) => (
              <tr key={k.id} className="click" onClick={() => go(`study/${k.id}`)}>
                <td>
                  <div>{k.title || 'Untitled'}</div>
                  <div className="tiny muted">
                    {k.size}×{k.size}
                    {k.black || k.white ? ` · ${k.black || '?'} vs ${k.white || '?'}` : ''}
                    {k.source === 'live' ? ' · from the live broadcast' : ''}
                  </div>
                </td>
                <td className="small dim narrow-hide">{new Date(k.updatedAt).toLocaleDateString()}</td>
                <td className="small mono narrow-hide">{countMoves(k)}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="row">
                    <button className="btn small ghost" title="Save to your own files as an .sgf" onClick={() => downloadKifu(k)}>
                      Export
                    </button>
                    <button
                      className="btn small ghost"
                      title="Remove from your kifu"
                      onClick={() => {
                        if (confirm(`Remove ${k.title || 'this kifu'}?`)) void deleteKifu(k.id).then(refresh);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Your games</div>
          <h1>Game Library</h1>
          <p className="sub">
            {games.length} game{games.length === 1 ? '' : 's'} · {pending ? `${pending} waiting for analysis` : 'all analysed'}
          </p>
        </div>
        <div className="row">
          {queue.running ? (
            <button className="btn" onClick={pauseQueue}>
              Pause analysis
            </button>
          ) : (
            pending > 0 && (
              <button className="btn primary" onClick={resumeQueue}>
                Analyse {pending} game{pending > 1 ? 's' : ''}
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
      <EngineNotice />
      <SideChooser limit={6} />
      <DropZone compact onFiles={(f) => void importFiles(f)} />
      <div className="panel" style={{ marginTop: 14, padding: '6px 8px' }}>
        {shown.length ? (
          <div className="table-scroll">
          <table className="data lib-table">
            <thead>
              <tr>
                <th>Game</th>
                <th className="narrow-hide">Date</th>
                <th>You</th>
                <th>Result</th>
                <th className="narrow-hide">Moves</th>
                <th className="narrow-hide">Costly moves</th>
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
                  <td className="small dim narrow-hide">{g.date ?? '—'}</td>
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
                  <td className="small mono narrow-hide">{g.moves.length}</td>
                  <td className="small mono narrow-hide">{g.status === 'done' && g.playerColor ? mistakes.get(g.id) ?? 0 : '—'}</td>
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
          </div>
        ) : (
          <div className="empty" style={{ margin: 16 }}>
            No games here yet.
          </div>
        )}
      </div>
      <KifuSection />
    </div>
  );
}
