import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { corpus } from '../state/actions';
import { Board } from '../components/Board';
import { Legend, MoveThumb, fmtPts, gameTitle } from '../components/common';
import { fingerprintOf } from '../lib/forge/generator';
import { similarity } from '../lib/search/similarity';
import { locToGtp } from '../lib/go/coords';
import { replay } from '../lib/go/board';
import { PASS } from '../lib/go/types';
import type { MoveRecord } from '../lib/types';
import { go, href } from '../router';
import { BackLink } from '../components/ControlSheet';

type Scope = 'mistakes' | 'mine' | 'all';

export function Search({ query }: { query: URLSearchParams }) {
  const version = useStore((s) => s.corpusVersion);
  const weaknesses = useStore((s) => s.weaknesses);
  const [scope, setScope] = useState<Scope>('mine');
  const gameId = query.get('game');
  const move = Number(query.get('move') ?? NaN);
  const c = useMemo(() => corpus(), [version]);
  const q = gameId && Number.isFinite(move) ? c.byId.get(`${gameId}:${move - 1}`) : undefined;

  const results = useMemo(() => {
    if (!q) return [];
    const fq = fingerprintOf(c, q);
    const pool = c.records.filter((r) => {
      if (r.id === q.id || r.loc === PASS) return false;
      if (r.size !== q.size) return false;
      if (scope === 'all') return true;
      if (!r.isPlayer) return false;
      return scope === 'mine' || r.severity === 'mistake' || r.severity === 'blunder' || r.severity === 'inaccuracy';
    });
    const scored: { r: MoveRecord; s: number }[] = [];
    for (const r of pool) scored.push({ r, s: similarity(fq, fingerprintOf(c, r)) });
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, 24);
  }, [q, c, scope]);

  const weaknessOf = (r: MoveRecord) => weaknesses.find((w) => r.errors.includes(w.signature));

  if (!q) {
    const recent = c
      .playerRecords()
      .filter((r) => r.severity === 'blunder' || r.severity === 'mistake')
      .sort((a, b) => b.scoreLoss - a.scoreLoss)
      .slice(0, 12);
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <div className="eyebrow">Search</div>
            <h1>Position Search</h1>
            <p className="sub">Pick a position to find the ones most like it across your games. You can also use "Find similar" from any move in Game Review.</p>
          </div>
        </div>
        {recent.length ? (
          <>
            <h3 style={{ marginBottom: 8 }}>Your costliest moves</h3>
            <div className="card-list">
              {recent.map((r) => {
                const g = c.games.get(r.gameId)!;
                return (
                  <a key={r.id} className="poscard" href={href(`search?game=${r.gameId}&move=${r.index + 1}`)}>
                    <MoveThumb game={g} record={r} />
                    <div className="small">
                      {gameTitle(g)} · move {r.index + 1}
                    </div>
                    <div className="tiny muted">−{r.scoreLoss.toFixed(1)} points</div>
                  </a>
                );
              })}
            </div>
          </>
        ) : (
          <div className="empty">No analysed games yet.</div>
        )}
      </div>
    );
  }

  const qg = c.games.get(q.gameId)!;
  const qb = replay(qg.size, qg.setup, qg.moves, q.index);
  const qw = weaknessOf(q);
  return (
    <div className="page">
      <BackLink href={href(`review/${q.gameId}?move=${q.index + 1}`)} label="Back to the game" />
      <div className="page-head">
        <div>
          <div className="eyebrow">Search</div>
          <h1>Positions like this one</h1>
          <p className="sub">Similarity combines the local shape around the last move, the kind of decision (distance, safety, phase) and the whole-board layout.</p>
        </div>
        <div className="row">
          <Legend />
          <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
            <option value="mine">My moves</option>
            <option value="mistakes">My mistakes only</option>
            <option value="all">All moves (both sides)</option>
          </select>
        </div>
      </div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="panel stack">
          <Board
            size={qg.size}
            stones={qb.stones}
            lastMove={q.index > 0 ? qg.moves[q.index - 1].loc : null}
            marks={[
              ...(q.bestLoc !== PASS ? [{ loc: q.bestLoc, kind: 'best' as const }] : []),
              ...(q.loc !== q.bestLoc ? [{ loc: q.loc, kind: 'played' as const }] : []),
            ]}
            coords
          />
        </div>
        <div className="panel stack">
          <h3>Query</h3>
          <div className="kv">
            <dt>Game</dt>
            <dd>
              <a href={href(`review/${q.gameId}?move=${q.index + 1}`)}>{gameTitle(qg)}</a>, move {q.index + 1}
            </dd>
            <dt>Played</dt>
            <dd className="you">{locToGtp(q.loc, q.size)}</dd>
            <dt>KataGo</dt>
            <dd className="kata">{locToGtp(q.bestLoc, q.size)}</dd>
            <dt>Difference</dt>
            <dd className="mono">{q.scoreLoss < 0.05 ? 'none' : `−${q.scoreLoss.toFixed(1)} pts`}</dd>
            {qw && (
              <>
                <dt>Weakness</dt>
                <dd>
                  <a href={href(`forge/${qw.id}`)}>{qw.llm?.title ?? qw.title}</a>
                </dd>
              </>
            )}
          </div>
          <p className="small dim">{results.length} most similar positions below.</p>
        </div>
      </div>
      <div className="card-list" style={{ marginTop: 16 }}>
        {results.map(({ r, s }) => {
          const g = c.games.get(r.gameId)!;
          const w = weaknessOf(r);
          return (
            <div key={r.id} className="poscard click" onClick={() => go(`review/${r.gameId}?move=${r.index + 1}`)}>
              <MoveThumb game={g} record={r} />
              <div className="spread small">
                <span>
                  {gameTitle(g)} · {r.index + 1}
                </span>
                <span className="mono muted">{Math.round(s * 100)}%</span>
              </div>
              <div className="tiny">
                <span className={r.isPlayer ? 'you' : 'dim'}>{r.isPlayer ? 'you' : 'opponent'} {locToGtp(r.loc, r.size)}</span>
                {' · '}
                <span className="kata">KataGo {locToGtp(r.bestLoc, r.size)}</span>
                {' · '}
                <span className={r.scoreLoss >= 3 ? 'bad' : 'muted'}>{r.scoreLoss < 0.05 ? 'best' : fmtPts(-r.scoreLoss)}</span>
              </div>
              {w && <div className="tiny warn">{w.llm?.title ?? w.title}</div>}
              <a className="tiny muted" href={href(`search?game=${r.gameId}&move=${r.index + 1}`)} onClick={(e) => e.stopPropagation()}>
                search from here
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
