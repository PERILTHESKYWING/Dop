import { useEffect, useMemo, useState } from 'react';
import type { MoveRecord } from '../lib/types';
import { useStore } from '../state/store';
import { corpus, retryGame, runQueue } from '../state/actions';
import { Board, type Mark } from '../components/Board';
import { AnalysisBoard, AnalysisPanel, useAnalysis, useAnalysisView } from '../components/Analysis';
import { fmtPct, gameTitle, Legend, WinrateGraph } from '../components/common';
import { allPositions } from '../lib/go/board';
import { locToGtp } from '../lib/go/coords';
import { buildContext } from '../lib/go/features';
import { PASS, type Loc } from '../lib/go/types';
import { decodeOwnership, moverView } from '../lib/engine/parse';
import { buildExample, predict } from '../lib/profile/doppel';
import { signatureById } from '../lib/profile/signatures';
import { go, href } from '../router';

export function Review({ gameId, move }: { gameId?: string; move?: number }) {
  const games = useStore((s) => s.games);
  const analyses = useStore((s) => s.analyses);
  const doppel = useStore((s) => s.doppel);
  const version = useStore((s) => s.corpusVersion);
  const weaknesses = useStore((s) => s.weaknesses);
  const game = games.find((g) => g.id === gameId) ?? games.find((g) => g.source === 'user' || g.source === 'demo');
  const analysis = game ? analyses[game.id] : undefined;
  const n = game?.moves.length ?? 0;
  const [cur, setCur] = useState(0);
  const [showOwn, setShowOwn] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  const [showPv, setShowPv] = useState(false);
  const [explore, setExplore] = useState(false);
  const [hoverPv, setHoverPv] = useState<Loc[] | null>(null);
  const [aView, toggleView] = useAnalysisView();
  const exploreBase = useMemo(() => {
    if (!game || !explore) return null;
    const toPlay = game.moves[cur]?.color ?? (game.moves.length ? (game.moves[game.moves.length - 1].color === 1 ? 2 : 1) : 1);
    return { size: game.size, komi: game.komi, setup: game.setup, moves: game.moves.slice(0, cur), toPlay: toPlay as 1 | 2 };
  }, [game, cur, explore]);
  const analysisBoard = useAnalysis(exploreBase, explore);

  useEffect(() => {
    if (!game) return;
    if (Number.isFinite(move) && move! > 0) setCur(Math.min(n, Math.max(0, move! - 1)));
    else {
      // Start at the player's first costly move.
      const first = corpus()
        .playerRecords()
        .find((r) => r.gameId === game.id && (r.severity === 'mistake' || r.severity === 'blunder'));
      setCur(first ? first.index : 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id, move]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (explore) return; // the analysis board has its own keys
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
      if (e.key === 'ArrowRight') setCur((c) => Math.min(n, c + 1));
      else if (e.key === 'ArrowLeft') setCur((c) => Math.max(0, c - 1));
      else if (e.key === 'ArrowUp') setCur((c) => Math.max(0, c - 10));
      else if (e.key === 'ArrowDown') setCur((c) => Math.min(n, c + 10));
      else if (e.key === 'Home') setCur(0);
      else if (e.key === 'End') setCur(n);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [n, explore]);

  const boards = useMemo(() => (game ? allPositions(game.size, game.setup, game.moves) : []), [game]);
  const records = useMemo(() => {
    if (!game) return new Map<number, MoveRecord>();
    return new Map<number, MoveRecord>(corpus().records.filter((r) => r.gameId === game.id).map((r) => [r.index, r]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id, version]);

  const heat = useMemoHeat(showPolicy && game ? (analysis?.evals[cur] ?? null) : null, game?.size ?? 19);

  if (!game)
    return (
      <div className="page">
        <div className="empty">
          No games yet. <a href={href('library')}>Import some</a> or load the demo from the dashboard.
        </div>
      </div>
    );

  const ev = analysis?.evals[cur] ?? null;
  const next = game.moves[cur];
  const rec = records.get(cur);
  const board = boards[cur];
  const toPlay = next?.color ?? (game.moves.length ? (game.moves[game.moves.length - 1].color === 1 ? 2 : 1) : 1);
  const own = showOwn ? decodeOwnership(ev?.ownership) : null;

  // Doppelgänger prediction for the studied player's turns.
  let dop: { loc: number; p: number }[] = [];
  if (doppel && ev && game.playerColor === toPlay) {
    const ctx = buildContext(board, decodeOwnership(ev.ownership));
    const prev = cur > 0 ? game.moves[cur - 1] : null;
    const ex = buildExample(ctx, ev.policy, toPlay, prev && prev.color !== toPlay ? prev.loc : null, null);
    if (ex) dop = predict(doppel, ex);
  }

  const marks: Mark[] = [];
  if (ev) {
    if (showPv && ev.pv.length) {
      ev.pv.slice(0, 10).forEach((l, i) => marks.push({ loc: l, kind: 'pv', label: String(i + 1) }));
    } else {
      (ev.candidates ?? ev.policy.slice(0, 5).map((p) => ({ loc: p.loc, prior: p.p })))
        .slice(0, 6)
        .forEach((c, i) => c.loc !== ev.bestLoc && marks.push({ loc: c.loc, kind: 'cand', label: String(i + 1) }));
      if (dop[0] && dop[0].loc !== ev.bestLoc) marks.push({ loc: dop[0].loc, kind: 'doppel', label: 'D' });
      marks.push({ loc: ev.bestLoc, kind: 'best' });
    }
  }
  if (next && next.loc !== PASS && !showPv) marks.push({ loc: next.loc, kind: 'played' });

  const wr = (analysis?.evals ?? []).map((e) => (e ? e.bWin : null));
  const errs = [...records.values()].filter((r) => r.isPlayer && (r.severity === 'mistake' || r.severity === 'blunder')).map((r) => r.index);
  const view = ev ? moverView(ev.bWin, ev.bLead, toPlay) : null;
  const sigs = (rec?.errors ?? []).map((id: string) => signatureById.get(id)).filter((s) => s !== undefined);
  const linked = weaknesses.filter((w) => w.evidence.some((e) => e.moveId === rec?.id));

  return (
    <div className="stage">
      <div className="board-wrap">
        {explore ? (
          <AnalysisBoard a={analysisBoard} view={aView} hoverPv={hoverPv} />
        ) : (
          <Board size={game.size} stones={board.stones} lastMove={cur > 0 ? game.moves[cur - 1].loc : null} marks={marks} ownership={own} heat={heat} coords />
        )}
      </div>
      <div className="side">
        {explore && (
          <AnalysisPanel
            a={analysisBoard}
            view={aView}
            onToggle={toggleView}
            onHoverPv={setHoverPv}
            onClose={() => {
              setExplore(false);
              setHoverPv(null);
            }}
            closeLabel="Back to the game"
          />
        )}
        <div className="panel stack">
          <div className="spread">
            <div>
              <h2>{gameTitle(game)}</h2>
              <div className="tiny muted">
                {[game.date, game.event, game.result, `komi ${game.komi}`].filter(Boolean).join(' · ')}
              </div>
            </div>
            <select value={game.id} onChange={(e) => go(`review/${e.target.value}`)} style={{ maxWidth: 130 }}>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {gameTitle(g)} {g.date ?? ''}
                </option>
              ))}
            </select>
          </div>
          <WinrateGraph values={wr} cursor={cur} errors={errs} onPick={(i) => setCur(Math.max(0, Math.min(n, i)))} />
          <div className="spread">
            <div className="row">
              <button className="btn small" onClick={() => setCur(0)}>
                ⏮
              </button>
              <button className="btn small" onClick={() => setCur((c) => Math.max(0, c - 1))}>
                ◀
              </button>
              <button className="btn small" onClick={() => setCur((c) => Math.min(n, c + 1))}>
                ▶
              </button>
              <button className="btn small" onClick={() => setCur(n)}>
                ⏭
              </button>
            </div>
            <span className="small mono">
              {cur}/{n}
            </span>
          </div>
          {analysis === undefined && (
            <div className="callout small">
              {game.status === 'error' ? (
                <>
                  Analysis failed: {game.error}{' '}
                  <button className="btn small" onClick={() => void retryGame(game.id)}>
                    Retry
                  </button>
                </>
              ) : (
                <>
                  Not analysed yet.{' '}
                  <button className="btn small" onClick={() => void runQueue()}>
                    Analyse now
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {next && (
          <div className="panel stack">
            <div className="spread">
              <h3>
                Move {cur + 1} · {next.color === 1 ? 'Black' : 'White'}
                {game.playerColor === next.color && <span className="you"> (you)</span>}
              </h3>
              {rec && <span className={`chip ${rec.severity === 'blunder' || rec.severity === 'mistake' ? 'bad' : rec.severity === 'inaccuracy' ? 'warn' : 'good'}`}>{rec.severity}</span>}
            </div>
            {view && (
              <div className="kv">
                <dt>Winrate</dt>
                <dd>{fmtPct(view.win, 1)} for {toPlay === 1 ? 'Black' : 'White'}</dd>
                <dt>Score</dt>
                <dd>
                  {view.lead >= 0 ? '+' : ''}
                  {view.lead.toFixed(1)}
                </dd>
                <dt>Played</dt>
                <dd className="you">
                  {locToGtp(next.loc, game.size)}
                  {rec && (
                    <span className="dim">
                      {' '}
                      · −{rec.scoreLoss.toFixed(1)} pts · −{fmtPct(rec.winrateLoss, 1)} · policy {fmtPct(rec.playedPolicy, 1)}
                    </span>
                  )}
                </dd>
                <dt>KataGo</dt>
                <dd className="kata">
                  {ev ? locToGtp(ev.bestLoc, game.size) : '—'}
                  {ev && <span className="dim"> · {ev.depth === 'deep' ? `${ev.visits} visits` : 'network only'}</span>}
                </dd>
                {dop[0] && (
                  <>
                    <dt>Doppelgänger</dt>
                    <dd className="doppel">
                      {locToGtp(dop[0].loc, game.size)} <span className="dim">· {fmtPct(dop[0].p)} likely for you</span>
                    </dd>
                  </>
                )}
              </div>
            )}
            {sigs.length > 0 && (
              <div className="callout bad small">
                {sigs.map((s) => (
                  <div key={s.id}>{s.title}</div>
                ))}
              </div>
            )}
            {linked.length > 0 && (
              <div className="row wrap">
                {linked.map((w) => (
                  <a key={w.id} className="chip bad" href={href(`forge/${w.id}`)}>
                    evidence for: {w.llm?.title ?? w.title}
                  </a>
                ))}
              </div>
            )}
            <div className="row wrap">
              <label className="check small">
                <input type="checkbox" checked={showPv} onChange={(e) => setShowPv(e.target.checked)} /> PV
              </label>
              <label className="check small">
                <input type="checkbox" checked={showOwn} onChange={(e) => setShowOwn(e.target.checked)} /> Ownership
              </label>
              <label className="check small">
                <input type="checkbox" checked={showPolicy} onChange={(e) => setShowPolicy(e.target.checked)} /> Policy
              </label>
              <button className="btn small" onClick={() => go(`search?game=${game.id}&move=${cur + 1}`)}>
                Find similar positions
              </button>
              {!explore && (
                <button className="btn small" onClick={() => setExplore(true)}>
                  Try moves here
                </button>
              )}
            </div>
            <Legend />
          </div>
        )}

        {ev?.candidates && (
          <div className="panel">
            <h3 style={{ marginBottom: 6 }}>Candidates</h3>
            <table className="data">
              <thead>
                <tr>
                  <th>Move</th>
                  <th>Winrate</th>
                  <th>Score</th>
                  <th>Visits</th>
                  <th>Prior</th>
                </tr>
              </thead>
              <tbody>
                {ev.candidates.map((c) => (
                  <tr key={c.loc}>
                    <td className={c.loc === ev.bestLoc ? 'kata' : c.loc === next?.loc ? 'you' : ''}>{locToGtp(c.loc, game.size)}</td>
                    <td className="mono">{c.winrate !== undefined ? fmtPct(c.winrate, 1) : '—'}</td>
                    <td className="mono">{c.scoreLead !== undefined ? c.scoreLead.toFixed(1) : '—'}</td>
                    <td className="mono">{c.visits ?? '—'}</td>
                    <td className="mono">{fmtPct(c.prior, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="tiny muted" style={{ marginTop: 6 }}>
              {ev.engine.modelName} · {ev.engine.backend === 'webgpu' ? 'WebGPU' : 'CPU'} · {ev.visits} visits
            </p>
          </div>
        )}

        <div className="panel">
          <h3 style={{ marginBottom: 6 }}>Moves</h3>
          <div className="movelist">
            {game.moves.map((m, i) => {
              const r = records.get(i);
              return (
                <button key={i} className={`${i === cur ? 'cur' : ''} ${r?.isPlayer ? `sev-${r.severity}` : ''}`} onClick={() => setCur(i)} title={r ? `${r.severity} −${r.scoreLoss.toFixed(1)}` : ''}>
                  {i + 1}
                  {m.color === game.playerColor ? '•' : ''}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function useMemoHeat(ev: { policy: { loc: number; p: number }[] } | null, size: number) {
  return useMemo(() => {
    if (!ev) return null;
    const h = new Float32Array(size * size);
    for (const p of ev.policy) if (p.loc >= 0) h[p.loc] = p.p;
    return h;
  }, [ev, size]);
}
