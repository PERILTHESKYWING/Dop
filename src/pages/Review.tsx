import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useWheelSteps } from '../components/MoveNav';
import { BoardScreen, HeadButton, Notice, PlayersBar, REPORT_TABS, type ScreenTool } from '../components/BoardScreen';
import { BlunderPanel, PerformancePanel, TrendPanel } from '../components/Report';
import type { PosValue } from '../lib/analysis/lineStats';
import { kifuFromMoves } from '../lib/kifu/kifu';
import { saveKifu } from '../lib/kifu/store';
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
import { toast, useStore } from '../state/store';
import { commitLiveAnalysis, corpus, renameGamePlayers, retryGame, runQueue, setGameKomi } from '../state/actions';
import { ActionTile, FieldTile, PlayerNames, SheetSection } from '../components/ControlSheet';
import { Icon } from '../components/Icons';
import type { LiveTarget } from '../state/live';
import { Board, type Mark } from '../components/Board';
import { AnalysisBoard, AnalysisPanel, useAnalysis, useAnalysisView } from '../components/Analysis';
import { candidateMarks, CandidateTable, fromSnapshot, fromStored, LiveHeader, lineOf, useLiveAnalysis, type ShownCandidate } from '../components/Live';
import { fmtPct, gameTitle, Legend } from '../components/common';
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
  const [tab, setTab] = useState<string | null>('data');
  const [pane, setPane] = useState<'info' | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  // A candidate clicked on the game board: open the analysis board with that move played.
  const [pendingPlay, setPendingPlay] = useState<Loc | null>(null);
  const [aView, toggleView, setCandidateCount] = useAnalysisView();
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

  // Scroll over the board to step through the game (the analysis board keeps its own controls).
  const boardWrap = useWheelSteps((d) => setCur((c) => Math.max(0, Math.min(n, c + d))), !explore);

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

  const view = value ? moverView(value.bWin, value.bLead, toPlay) : null;
  const sigs = (rec?.errors ?? []).map((id: string) => signatureById.get(id)).filter((s) => s !== undefined);
  const linked = weaknesses.filter((w) => w.evidence.some((e) => e.moveId === rec?.id));
  const komiNote = engineKomi(game.komi, game.rules) !== game.komi ? ` (scored as area ${engineKomi(game.komi, game.rules)})` : '';
  const hoverShown = (loc: Loc | null) => setHoverPv(loc === null ? null : shown.find((c) => c.loc === loc)?.pv ?? null);

  const goTo = (i: number) => setCur(Math.max(0, Math.min(n, i)));
  const values: (PosValue | null)[] = (analysis?.evals ?? []).map((e, i) => {
    if (i === cur && useLive) return { bWin: snap!.bWin, bLead: snap!.bLead, best: snap!.candidates[0]?.loc ?? null };
    if (!e) return null;
    const v = searchedValue(e);
    return { bWin: v.bWin, bLead: v.bLead, best: e.bestLoc };
  });
  const report = { values, moves: game.moves, size: game.size, black: game.black, white: game.white, cursor: cur, onPick: goTo };
  const downloadSgf = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([game.sgf], { type: 'application/x-go-sgf' }));
    a.download = `${gameTitle(game).replace(/[\\/:*?"<>|]+/g, ' ')}.sgf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const saveCopy = async (title: string) => {
    const k = kifuFromMoves(
      { size: game.size, komi: game.komi, rules: game.rules && /jap|kor|territory/i.test(game.rules) ? 'japanese' : 'chinese', black: game.black, white: game.white, title: title.trim() || gameTitle(game), result: game.result, date: game.date, event: game.event },
      game.setup,
      game.moves,
      cur,
    );
    await saveKifu({ ...k, source: 'review', saved: true });
    toast(`Saved "${k.title}" to Your kifu.`, 'ok');
  };

  let panel: ReactNode = null;
  if (explore)
    panel = (
      <AnalysisPanel
        a={analysisBoard}
        view={aView}
        onToggle={toggleView}
        onCandidateCount={setCandidateCount}
        onHoverPv={setHoverPv}
        copyColor={game.playerColor}
        onClose={() => {
          setExplore(false);
          setHoverPv(null);
        }}
        closeLabel="Back to the game"
      />
    );
  else if (pane === 'info')
    panel = (
      <>
        <h3>Game</h3>
        <PlayerNames black={game.black} white={game.white} onSave={(b, w) => void renameGamePlayers(game.id, b, w)} />
        <div className="tiny muted">
          {[game.date, game.event, game.result].filter(Boolean).join(' · ')}
          {game.date || game.event || game.result ? ' · ' : ''}komi {game.komi}
        </div>
        {game.warnings.some((w) => w.startsWith('komi')) && <div className="tiny warn-text">{game.warnings.find((w) => w.startsWith('komi'))}</div>}
        <SheetSection title="Game">
          {games.length > 1 && (
            <FieldTile label="Switch game">
              <select value={game.id} onChange={(e) => go(`review/${e.target.value}`)} aria-label="Switch game">
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {gameTitle(g)} {g.date ?? ''}
                  </option>
                ))}
              </select>
            </FieldTile>
          )}
          <FieldTile label={`Komi${game.rules ? ` · ${game.rules} rules` : ''}`}>
            <select value={game.komi} onChange={(e) => void setGameKomi(game.id, Number(e.target.value))} aria-label="Komi" title={`Komi KataGo scores with: ${engineKomi(game.komi, game.rules)}${isTerritoryScoring(game.rules, game.komi) ? ' (territory scoring counted by area)' : ''}`}>
              {[...new Set([game.komi, ...KOMI_CHOICES])].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            {komiNote && <span className="tiny muted">{komiNote.trim()}</span>}
          </FieldTile>
          <FieldTile label={`Candidate list: top ${aView.candidateCount} moves`}>
            <input type="range" min={3} max={20} value={aView.candidateCount} onChange={(e) => setCandidateCount(Number(e.target.value))} aria-label="Candidate moves shown" />
          </FieldTile>
        </SheetSection>
        <SheetSection title="Take it further">
          <ActionTile onClick={() => go(`search?game=${game.id}&move=${cur + 1}`)} icon={<Icon name="search" />} label="Similar positions" sub="From your games" />
          <ActionTile onClick={() => go(`chat?game=${encodeURIComponent(game.id)}&move=${cur}`)} icon={<Icon name="chat" />} label="Ask the coach" sub="About this position" />
          <ActionTile onClick={downloadSgf} icon={<Icon name="download" />} label="Download SGF" sub="To your own files" />
          <ActionTile href={href('library')} icon={<Icon name="library" />} label="Game library" sub="All your games" />
        </SheetSection>
      </>
    );
  else if (tab === 'data')
    panel = (
      <>
        <LiveHeader snap={snap} />
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
        <CandidateTable cands={shown} size={game.size} played={next?.loc} onHover={(c) => setHoverPv(c ? c.pv : null)} max={aView.candidateCount} resetKey={`${game.id}:${cur}`} />
        {!shown.length && <div className="tiny muted">KataGo's candidate moves appear here as it reads. Tap one to see its line.</div>}
        <p className="tiny muted">
          {useLive ? 'Live' : ev?.searched ? 'Stored analysis' : ev ? 'Network only' : 'Not analysed'} · {visits ? `${visits} visits` : ''}{' '}
          {ev ? `· ${ev.engine.modelName} · ${ev.engine.backend === 'webgpu' ? 'WebGPU' : 'CPU'}` : ''}
        </p>
        {next && (
          <div className="stack">
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
            <Legend />
          </div>
        )}
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
      </>
    );
  else if (tab === 'trend')
    panel = (
      <>
        <TrendPanel {...report} />
        {moments.length > 0 && (
          <div className="stack tight">
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
        <div className="stack tight">
          <h3>Moves</h3>
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
      </>
    );
  else if (tab === 'blunder') panel = <BlunderPanel {...report} />;
  else if (tab === 'performance')
    panel = (
      <>
        <PerformancePanel {...report} />
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
      </>
    );

  const tools: ScreenTool[] = [
    { id: 'try', label: 'Try moves', icon: 'play', on: explore, onClick: () => (setExplore(!explore), setHoverPv(null)) },
    { id: 'territory', label: 'Territory', icon: 'territory', on: showOwn, onClick: () => setShowOwn(!showOwn) },
    { id: 'policy', label: 'Heat map', icon: 'spark', on: showPolicy, onClick: () => setShowPolicy(!showPolicy) },
    { id: 'study', label: 'Study board', icon: 'kifu', onClick: () => go(`study?game=${encodeURIComponent(game.id)}&move=${cur}`) },
    { id: 'info', label: 'Game info', icon: 'info', on: pane === 'info', onClick: () => setPane(pane === 'info' ? null : 'info') },
  ];
  const you = (c: 1 | 2) => (game.playerColor === c ? 'you' : undefined);

  return (
    <BoardScreen
      className="review"
      title={gameTitle(game)}
      sub={[game.date, game.result, `komi ${game.komi}`].filter(Boolean).join(' · ')}
      head={<HeadButton icon="save" label="Save" onClick={() => (setSaveTitle(gameTitle(game)), setSaving(true))} title="Save a copy to Your kifu" />}
      players={
        <PlayersBar
          black={game.black}
          white={game.white}
          black2={you(1)}
          white2={you(2)}
          captures={explore ? undefined : board.captures}
          showEval
          bWin={explore ? (analysisBoard.eval?.bWin ?? null) : (value?.bWin ?? null)}
          bLead={explore ? (analysisBoard.eval?.bLead ?? null) : (value?.bLead ?? null)}
          pending={explore ? !analysisBoard.eval?.searched : !useLive && !ev?.searched}
        />
      }
      boardRef={boardWrap}
      board={
        explore ? (
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
        )
      }
      steps={explore ? { pos: analysisBoard.cursor, total: analysisBoard.line.length, onGo: analysisBoard.goTo } : { pos: cur, total: n, onGo: goTo }}
      tabs={explore ? null : REPORT_TABS}
      tab={pane ? null : tab}
      onTab={(t) => (setPane(null), setTab(t))}
      panel={panel}
      tools={tools}
      notice={
        saving ? (
          <Notice
            title="Save a copy to Your kifu"
            onClose={() => setSaving(false)}
            actions={
              <>
                <button className="btn ghost" onClick={() => setSaving(false)}>
                  Cancel
                </button>
                <button className="btn primary" onClick={() => (setSaving(false), void saveCopy(saveTitle))}>
                  Save
                </button>
              </>
            }
          >
            <label>
              Name
              <input value={saveTitle} onChange={(e) => setSaveTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (setSaving(false), void saveCopy(saveTitle))} />
            </label>
            <span className="small">The game itself stays in your library; the copy opens in the study board for variations and notes.</span>
          </Notice>
        ) : null
      }
    />
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
