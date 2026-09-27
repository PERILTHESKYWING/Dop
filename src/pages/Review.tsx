import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { AskPanel } from '../components/Ask';
import { InsightPanel, useMoveInsight } from '../components/Insight';
import { useLevelOf, usePlayerTargets } from '../components/Level';
import { nextBestGap } from '../lib/coach/difficulty';
import { keyMoments } from '../lib/coach/moments';
import { CLASS_INFO, CLASS_ORDER, type MoveClass } from '../lib/coach/classify';
import { ClassPill, MoveBadge } from '../components/MoveBadge';
import { classInputs, useGameClasses } from '../state/classes';
import { mainLineComments } from '../lib/go/sgf';
import { insightFacts, proFacts, type MoveTarget } from '../state/insight';
import type { GameRecord, MoveRecord } from '../lib/types';
import { useStore } from '../state/store';
import { commitLiveAnalysis, corpus, retryGame, runQueue, setGameKomi } from '../state/actions';
import type { LiveTarget } from '../state/live';
import { Board, type Mark } from '../components/Board';
import { AnalysisBoard, AnalysisPanel, useAnalysis, useAnalysisView, WinBar } from '../components/Analysis';
import { candidateMarks, CandidateTable, fromSnapshot, fromStored, LiveHeader, lineOf, useLiveAnalysis, type ShownCandidate } from '../components/Live';
import { fmtPct, gameTitle, Legend, WinrateGraph } from '../components/common';
import { allPositions } from '../lib/go/board';
import { locToGtp } from '../lib/go/coords';
import { engineKomi, isTerritoryScoring } from '../lib/go/rules';
import { PASS, type Loc } from '../lib/go/types';
import { decodeOwnership, moverView } from '../lib/engine/parse';
import { searchedValue } from '../lib/analysis/analyzer';
import type { SearchSnapshot } from '../lib/engine/mcts';
import { predictForPosition } from '../lib/profile/doppel';
import { DoppelLine, useCopy } from '../components/Doppel';
import { signatureById } from '../lib/profile/signatures';
import { go, href } from '../router';

const KOMI_CHOICES = [7.5, 7, 6.5, 5.5, 3.75, 0.5, 0];

export function Review({ gameId, move }: { gameId?: string; move?: number }) {
  const games = useStore((s) => s.games);
  const analyses = useStore((s) => s.analyses);
  const copy = useCopy();
  const version = useStore((s) => s.corpusVersion);
  const weaknesses = useStore((s) => s.weaknesses);
  const game = games.find((g) => g.id === gameId) ?? games.find((g) => g.source === 'user' || g.source === 'demo');
  const analysis = game ? analyses[game.id] : undefined;
  const n = game?.moves.length ?? 0;
  const [cur, setCur] = useState(0);
  const [showOwn, setShowOwn] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  const [explore, setExplore] = useState(false);
  const [hoverPv, setHoverPv] = useState<Loc[] | null>(null);
  // A candidate clicked on the game board: open the analysis board with that move played.
  const [pendingPlay, setPendingPlay] = useState<Loc | null>(null);
  const [aView, toggleView] = useAnalysisView();
  const exploreBase = useMemo(() => {
    if (!game || !explore) return null;
    const toPlay = game.moves[cur]?.color ?? (game.moves.length ? (game.moves[game.moves.length - 1].color === 1 ? 2 : 1) : 1);
    return { size: game.size, komi: game.komi, rules: game.rules, setup: game.setup, moves: game.moves.slice(0, cur), toPlay: toPlay as 1 | 2 };
  }, [game, cur, explore]);
  const analysisBoard = useAnalysis(exploreBase, explore, analysis?.evals[cur]);

  // Live analysis of the position on the board; a deeper result is kept in the game's analysis.
  const gid = game?.id;
  const onLeave = useCallback((snap: SearchSnapshot, index: number) => gid && void commitLiveAnalysis(gid, index, snap), [gid]);
  const liveTarget = useMemo<LiveTarget | null>(() => {
    if (!game || explore) return null;
    const toPlay = game.moves[cur]?.color ?? (game.moves.length ? (game.moves[game.moves.length - 1].color === 1 ? 2 : 1) : 1);
    const komi = engineKomi(game.komi, game.rules);
    return {
      key: `rv|${game.id}|${cur}|${komi}`,
      size: game.size,
      komi,
      setup: game.setup,
      moves: game.moves.slice(0, cur),
      toPlay: toPlay as 1 | 2,
      onLeave: (snap) => onLeave(snap, cur),
    };
  }, [game, cur, explore, onLeave]);
  const live = useLiveAnalysis(liveTarget, !explore);
  const playInAnalysis = analysisBoard.play;
  useEffect(() => {
    if (!explore || pendingPlay === null || !analysisBoard.board) return;
    playInAnalysis(pendingPlay);
    setPendingPlay(null);
  }, [explore, pendingPlay, analysisBoard.board, playInAnalysis]);

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
    setHoverPv(null);
  }, [cur, explore]);

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
  const sgfComments = useMemo(() => (game ? mainLineComments(game.sgf) : new Map<number, string>()), [game]);
  const { level: ownLevel } = useLevelOf(usePlayerTargets());
  const records = useMemo(() => {
    if (!game) return new Map<number, MoveRecord>();
    return new Map<number, MoveRecord>(corpus().records.filter((r) => r.gameId === game.id).map((r) => [r.index, r]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id, version]);

  const ev = analysis?.evals[cur] ?? null;
  const snap = live.snap;
  // The live search replaces the stored analysis once it has read further.
  const useLive = !!snap && snap.visits > 1 && (!ev || snap.visits >= ev.visits);
  const heat = useMemoHeat(showPolicy && game ? (analysis?.evals[cur] ?? null) : null, game?.size ?? 19);

  // Move insights: how good and how hard to find the played move and KataGo's move are.
  const insightCands = useLive ? fromSnapshot(snap!) : fromStored(ev?.candidates);
  const insightVisits = useLive ? snap!.visits : ev?.visits ?? 0;
  const classes = useGameClasses(game, records, analysis, boards);
  const insightTargets: MoveTarget[] = [];
  if (game && !explore) {
    const played = game.moves[cur];
    const best = insightCands[0];
    const gap = best ? nextBestGap(insightCands, insightVisits) : null;
    const input = classInputs(new Map([...records].filter(([i]) => i === cur || i === cur - 1)), analysis).get(cur);
    if (played && played.loc !== PASS && input)
      insightTargets.push({ loc: played.loc, role: 'played', input: { ...input, gap: input.gap ?? (best && best.loc === played.loc ? gap : null), book: classes.get(cur) === 'book' } });
    if (best && best.loc !== PASS && best.loc !== played?.loc) insightTargets.push({ loc: best.loc, role: 'KataGo', input: { scoreLoss: 0, winrateLoss: 0, isBest: true, gap } });
  }
  const insight = useMoveInsight(
    game && !explore ? `${game.id}|${cur}|${engineKomi(game.komi, game.rules)}` : null,
    () =>
      game
        ? {
            size: game.size,
            komi: engineKomi(game.komi, game.rules),
            setup: game.setup,
            history: game.moves.slice(0, cur),
            toPlay: game.moves[cur]?.color ?? (game.moves.length ? (game.moves[game.moves.length - 1].color === 1 ? 2 : 1) : 1),
            board: boards[cur],
          }
        : null,
    insightTargets,
    ownLevel?.overall.rank,
  );
  const moments = useMemo(() => keyMoments([...records.values()], analysis), [records, analysis]);
  const moveComments = { lastMove: cur > 0 ? sgfComments.get(cur) : undefined, nextMove: sgfComments.get(cur + 1) };

  if (!game)
    return (
      <div className="page">
        <div className="empty">
          No games yet. <a href={href('library')}>Import some</a> or load the demo from the dashboard.
        </div>
      </div>
    );

  const next = game.moves[cur];
  const rec = records.get(cur);
  const board = boards[cur];
  const toPlay = next?.color ?? (game.moves.length ? (game.moves[game.moves.length - 1].color === 1 ? 2 : 1) : 1);
  const own = showOwn ? (useLive && snap?.ownership ? snap.ownership : decodeOwnership(ev?.ownership)) : null;

  const shown: ShownCandidate[] = useLive ? fromSnapshot(snap!) : fromStored(ev?.candidates);
  const bestLoc = shown[0]?.loc ?? ev?.bestLoc ?? PASS;
  const value = useLive ? { bWin: snap!.bWin, bLead: snap!.bLead } : ev ? searchedValue(ev) : null;
  const visits = useLive ? snap!.visits : ev?.visits ?? 0;

  // What the player's copy expects on the studied player's turns.
  const dop =
    copy.model && ev && game.playerColor === toPlay
      ? predictForPosition(copy.model, { size: game.size, setup: game.setup, history: game.moves.slice(0, cur), toPlay, policy: ev.policy, ownership: ev.ownership, board })
      : [];

  const marks: Mark[] = [];
  const candidates = !hoverPv && !showPolicy ? candidateMarks(shown) : null;
  if (!hoverPv) {
    if (!candidates?.length && ev) {
      ev.policy.slice(0, 5).forEach((p, i) => p.loc !== ev.bestLoc && marks.push({ loc: p.loc, kind: 'cand', label: String(i + 1) }));
      marks.push({ loc: ev.bestLoc, kind: 'best' });
    }
    if (dop[0] && dop[0].loc !== bestLoc) marks.push({ loc: dop[0].loc, kind: 'doppel', label: 'D' });
    if (next && next.loc !== PASS) marks.push({ loc: next.loc, kind: 'played' });
  }

  const wr = (analysis?.evals ?? []).map((e, i) => (i === cur && useLive ? snap!.bWin : e ? searchedValue(e).bWin : null));
  const scores = (analysis?.evals ?? []).map((e, i) => (i === cur && useLive ? snap!.bLead : e ? searchedValue(e).bLead : null));
  const errs = [...records.values()].filter((r) => r.isPlayer && (r.severity === 'mistake' || r.severity === 'blunder')).map((r) => r.index);
  const view = value ? moverView(value.bWin, value.bLead, toPlay) : null;
  const sigs = (rec?.errors ?? []).map((id: string) => signatureById.get(id)).filter((s) => s !== undefined);
  const linked = weaknesses.filter((w) => w.evidence.some((e) => e.moveId === rec?.id));
  const komiNote = engineKomi(game.komi, game.rules) !== game.komi ? ` (scored as area ${engineKomi(game.komi, game.rules)})` : '';
  const hoverShown = (loc: Loc | null) => setHoverPv(loc === null ? null : shown.find((c) => c.loc === loc)?.pv ?? null);

  return (
    <div className="stage">
      <div className="board-wrap">
        {explore ? (
          <AnalysisBoard a={analysisBoard} view={aView} hoverPv={hoverPv} onHoverPv={setHoverPv} />
        ) : (
          <Board
            size={game.size}
            stones={board.stones}
            lastMove={cur > 0 ? game.moves[cur - 1].loc : null}
            marks={marks}
            ownership={own}
            heat={heat}
            candidates={candidates}
            onCandidateHover={hoverShown}
            onCandidateClick={(l) => {
              setPendingPlay(l);
              setExplore(true);
            }}
            variation={hoverPv ? lineOf(hoverPv, toPlay) : null}
            badge={cur > 0 && classes.get(cur - 1) ? { loc: game.moves[cur - 1].loc, cls: classes.get(cur - 1)! } : null}
            coords
          />
        )}
      </div>
      <div className="side">
        {explore && (
          <AnalysisPanel
            a={analysisBoard}
            view={aView}
            onToggle={toggleView}
            onHoverPv={setHoverPv}
            copyColor={game.playerColor}
            onClose={() => {
              setExplore(false);
              setHoverPv(null);
            }}
            closeLabel="Back to the game"
          />
        )}
        <div className="panel stack">
          <div className="stack tight">
            <h2 className="game-title">{gameTitle(game)}</h2>
            <div className="tiny muted row wrap" style={{ gap: 6 }}>
              <span>{[game.date, game.event, game.result, game.rules].filter(Boolean).join(' · ')}</span>
              <label className="komi-edit" title={`Komi KataGo scores with: ${engineKomi(game.komi, game.rules)}${isTerritoryScoring(game.rules, game.komi) ? ' (territory scoring counted by area)' : ''}`}>
                komi{' '}
                <select value={game.komi} onChange={(e) => void setGameKomi(game.id, Number(e.target.value))} aria-label="Komi">
                  {[...new Set([game.komi, ...KOMI_CHOICES])].map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                {komiNote}
              </label>
            </div>
            {game.warnings.some((w) => w.startsWith('komi')) && <div className="tiny warn-text">{game.warnings.find((w) => w.startsWith('komi'))}</div>}
            {games.length > 1 && (
              <select value={game.id} onChange={(e) => go(`review/${e.target.value}`)} aria-label="Switch game" style={{ width: '100%', marginTop: 4 }}>
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {gameTitle(g)} {g.date ?? ''}
                  </option>
                ))}
              </select>
            )}
          </div>
          <WinrateGraph values={wr} scores={scores} cursor={cur} errors={errs} onPick={(i) => setCur(Math.max(0, Math.min(n, i)))} />
          <div className="graph-legend">
            <span>
              <i /> Black's winrate
            </span>
            <span>
              <i className="score" /> Black's lead
            </span>
          </div>
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

        {!explore && (
          <div className="panel stack live-panel">
            <LiveHeader snap={snap} />
            <WinBar bWin={value?.bWin ?? null} bLead={value?.bLead ?? null} pending={!useLive && !ev?.searched} />
            <CandidateTable cands={shown} size={game.size} played={next?.loc} onHover={(c) => setHoverPv(c ? c.pv : null)} max={8} />
            {!shown.length && <div className="tiny muted">KataGo's candidate moves appear here as it reads.</div>}
            <p className="tiny muted">
              {useLive ? 'Live' : ev?.searched ? 'Stored analysis' : ev ? 'Network only' : 'Not analysed'} · {visits ? `${visits} visits` : ''}{' '}
              {ev ? `· ${ev.engine.modelName} · ${ev.engine.backend === 'webgpu' ? 'WebGPU' : 'CPU'}` : ''}
            </p>
          </div>
        )}

        {next && (
          <div className="panel stack">
            <div className="spread">
              <h3>
                Move {cur + 1} · {next.color === 1 ? 'Black' : 'White'}
                {game.playerColor === next.color && <span className="you"> (you)</span>}
              </h3>
              {classes.get(cur) ? <ClassPill cls={classes.get(cur)!} /> : rec && <span className="chip">{rec.severity}</span>}
            </div>
            {view && (
              <div className="kv">
                <dt>Winrate</dt>
                <dd>
                  {fmtPct(view.win, 1)} for {toPlay === 1 ? 'Black' : 'White'}
                </dd>
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
                  {bestLoc !== PASS ? locToGtp(bestLoc, game.size) : '—'}
                  <span className="dim"> · {visits > 1 ? `${visits} visits` : 'network only'}</span>
                </dd>
                {dop[0] && (
                  <>
                    <dt>{copy.who}</dt>
                    <dd>
                      <DoppelLine predictions={dop} size={game.size} who="" played={next?.loc} compact />
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
            <InsightPanel state={insight} size={game.size} ownRank={ownLevel?.overall.rank} comments={moveComments} playedLoc={next.loc} />
            <div className="row wrap">
              <label className="check small">
                <input type="checkbox" checked={showOwn} onChange={(e) => setShowOwn(e.target.checked)} /> Territory
              </label>
              <label className="check small">
                <input type="checkbox" checked={showPolicy} onChange={(e) => setShowPolicy(e.target.checked)} /> Policy
              </label>
              <button className="btn small" onClick={() => go(`search?game=${game.id}&move=${cur + 1}`)}>
                Find similar positions
              </button>
              <button className="btn small" onClick={() => go(`study?game=${encodeURIComponent(game.id)}&move=${cur}`)} title="Record variations and notes, and save them as a kifu">
                Open in study board
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

        {!explore && (
          <AskPanel
            positionKey={`${game.id}|${cur}`}
            chatHref={href(`chat?game=${encodeURIComponent(game.id)}&move=${cur}`)}
            hasPlayed={!!next && next.loc !== PASS}
            facts={() =>
              value
                ? {
                    board,
                    komi: engineKomi(game.komi, game.rules),
                    moveNumber: cur + 1,
                    toPlay,
                    lastMove: cur > 0 ? game.moves[cur - 1].loc : null,
                    bWin: value.bWin,
                    bLead: value.bLead,
                    visits,
                    candidates: shown,
                    ownership: useLive && snap?.ownership ? snap.ownership : decodeOwnership(ev?.ownership),
                    played: next && rec ? { loc: next.loc, winrateLoss: rec.winrateLoss, scoreLoss: rec.scoreLoss, bestLoc: rec.bestLoc } : null,
                  }
                : null
            }
            base={() => ({ size: game.size, komi: engineKomi(game.komi, game.rules), setup: game.setup, moves: game.moves.slice(0, cur), toPlay, board })}
            extra={async () => {
              const clip = (t?: string) => (t ? t.slice(0, 700) : undefined);
              return {
                insights: insight.insights ? insightFacts(insight.insights, game.size) : undefined,
                pro: insight.pro ? proFacts(insight.pro, game.size) : undefined,
                keyMoments: moments.map((k) => ({
                  move: k.index + 1,
                  player: k.color === 1 ? ('Black' as const) : ('White' as const),
                  kind: k.kind === 'only-move' ? ('only move' as const) : ('turning point' as const),
                  played: locToGtp(k.played, game.size),
                  kataGo: locToGtp(k.best, game.size),
                  found: k.found,
                  winrateLoss: Math.round(k.winrateLoss * 1000) / 10,
                  pointsLost: Math.round(k.scoreLoss * 10) / 10,
                  gap: k.gap ? { points: Math.round(k.gap.points * 10) / 10, winrate: Math.round(k.gap.win * 1000) / 10 } : undefined,
                })),
                comments: moveComments.lastMove || moveComments.nextMove ? { lastMove: clip(moveComments.lastMove), nextMove: clip(moveComments.nextMove) } : undefined,
              };
            }}
          />
        )}

        {classes.size > 0 && (
          <ClassReport
            classes={classes}
            game={game}
            onPick={(cls, color) => {
              const hits = [...classes].filter(([i, c]) => c === cls && game.moves[i].color === color).map(([i]) => i).sort((a, b) => a - b);
              const next = hits.find((i) => i > cur) ?? hits[0];
              if (next !== undefined) setCur(next);
            }}
          />
        )}

        {moments.length > 0 && (
          <div className="panel stack tight">
            <h3>Key moments</h3>
            <div className="moments">
              {moments.map((k) => (
                <button key={k.index} className={`moment ${k.index === cur ? 'cur' : ''}`} onClick={() => setCur(k.index)}>
                  <span className="mono">{k.index + 1}</span>
                  <span>
                    {k.color === 1 ? 'Black' : 'White'}
                    {game.playerColor === k.color ? ' (you)' : ''} ·{' '}
                    {k.kind === 'only-move' ? (
                      <>
                        only move <b className="mono">{locToGtp(k.best, game.size)}</b>{' '}
                        <span className={k.found ? 'good-text' : 'bad-text'}>{k.found ? 'found' : `missed (${locToGtp(k.played, game.size)})`}</span>
                      </>
                    ) : (
                      <>
                        turning point: <b className="mono">{locToGtp(k.played, game.size)}</b>, KataGo <b className="mono">{locToGtp(k.best, game.size)}</b>{' '}
                        <span className="bad-text">−{fmtPct(k.winrateLoss, 0)}</span>
                      </>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="panel">
          <h3 style={{ marginBottom: 6 }}>Moves</h3>
          <div className="movelist">
            {game.moves.map((m, i) => {
              const r = records.get(i);
              return (
                <button
                  key={i}
                  className={`${i === cur ? 'cur' : ''} ${r?.isPlayer ? `sev-${r.severity}` : ''}`}
                  onClick={() => setCur(i)}
                  title={r ? `${classes.get(i) ? CLASS_INFO[classes.get(i)!].name : r.severity} −${r.scoreLoss.toFixed(1)}` : ''}
                >
                  {i + 1}
                  {m.color === game.playerColor ? '•' : ''}
                  {NOTABLE.has(classes.get(i)!) && <MoveBadge cls={classes.get(i)!} size={11} />}
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

/** Classes worth a badge in the move list (the rest are the quiet majority). */
const NOTABLE = new Set<MoveClass>(['brilliant', 'great', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder']);

/** The game report: how many moves of each class each player made. */
function ClassReport({ classes, game, onPick }: { classes: Map<number, MoveClass>; game: GameRecord; onPick: (cls: MoveClass, color: 1 | 2) => void }) {
  const count = (cls: MoveClass, color: 1 | 2) => [...classes].filter(([i, c]) => c === cls && game.moves[i].color === color).length;
  return (
    <div className="panel stack tight">
      <h3>Move classifications</h3>
      <div className="class-report">
        <span />
        <span className="cr-head">{game.black}</span>
        <span className="cr-head">{game.white}</span>
        {CLASS_ORDER.map((cls) => (
          <Fragment key={cls}>
            <span className="cr-name" title={CLASS_INFO[cls].about}>
              <MoveBadge cls={cls} size={18} />
              {CLASS_INFO[cls].name}
            </span>
            {([1, 2] as const).map((color) => {
              const n = count(cls, color);
              return (
                <button key={color} className="cr-n linkish" disabled={!n} onClick={() => onPick(cls, color)} title={n ? `Go to the next ${CLASS_INFO[cls].name.toLowerCase()} move` : undefined}>
                  {n || '·'}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
