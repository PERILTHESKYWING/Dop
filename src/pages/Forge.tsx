import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { addReason, generateVariations, submitAnswer } from '../state/actions';
import { Board, type Mark } from '../components/Board';
import { AnalysisBoard, AnalysisPanel, useAnalysis, useAnalysisView } from '../components/Analysis';
import { fmtPct } from '../components/common';
import { itemBoard, lastOpponentMove, type GradeResult } from '../lib/forge/grading';
import { newMastery, pickItem, pickWeakness } from '../lib/forge/scheduler';
import { assessItem, describeSkipped, practiceItems, summarizePractice } from '../lib/forge/worth';
import { buildContext } from '../lib/go/features';
import { locToGtp } from '../lib/go/coords';
import { decodeOwnership } from '../lib/engine/parse';
import { buildExample, predict } from '../lib/profile/doppel';
import { useCopy } from '../components/Doppel';
import { signatureById } from '../lib/profile/signatures';
import { PASS, type Loc } from '../lib/go/types';
import type { Attempt, TrainingItem, TrainingKind, Weakness } from '../lib/types';
import { uid } from '../lib/util/hash';
import { go, href } from '../router';

export const KIND_TEXT: Record<TrainingKind, { label: string; explain: string }> = {
  original: { label: 'From your game', explain: 'You played this position in a real game and made the error here.' },
  similar: { label: 'Similar position', explain: 'Same kind of decision, from your games.' },
  counterexample: { label: 'Counterexample', explain: 'Looks like the usual pattern, but here the opposite decision is right.' },
  boundary: { label: 'Boundary case', explain: 'Both decisions are close. Precision matters here.' },
};

const REASONS = ['Looked urgent', 'Biggest point', 'Safety first', 'Attack', 'Shape', 'Instinct'];

export function usePrediction(item: TrainingItem | null) {
  const doppel = useCopy().model;
  return useMemo(() => {
    if (!item || !doppel) return null;
    const ctx = buildContext(itemBoard(item), decodeOwnership(item.eval.ownership));
    const ex = buildExample(ctx, item.eval.policy, item.toPlay, lastOpponentMove(item), null);
    return ex ? predict(doppel, ex)[0] : null;
  }, [item, doppel]);
}

export function Reveal({ item, grade, attempt, predicted }: { item: TrainingItem; grade: GradeResult; attempt: Attempt; predicted: { loc: Loc; p: number } | null }) {
  const sig = signatureById.get(item.signature);
  const [reason, setReason] = useState(attempt.reason);
  const kind = KIND_TEXT[item.kind];
  const cands = item.eval.candidates ?? [];
  return (
    <div className="stack">
      <div className="spread">
        <span className={`reveal-grade grade-${grade.grade}`}>{grade.grade}</span>
        <span className={`chip ${grade.conceptCorrect ? 'good' : 'bad'}`}>{grade.conceptCorrect ? 'right decision' : 'wrong decision'}</span>
      </div>
      <div className="kv">
        <dt>Your move</dt>
        <dd className="you">
          {locToGtp(attempt.loc, item.size)} · {grade.scoreLoss < 0.05 ? 'best' : `−${grade.scoreLoss.toFixed(1)} pts`}
          {grade.estimated && <span className="muted"> (estimated)</span>}
        </dd>
        <dt>KataGo</dt>
        <dd className="kata">{locToGtp(grade.bestLoc, item.size)}</dd>
        {predicted && (
          <>
            <dt>Your copy</dt>
            <dd className="doppel">
              expected {locToGtp(predicted.loc, item.size)} ({fmtPct(predicted.p)})
              {predicted.loc === attempt.loc ? ' · you played to type' : ' · you broke your pattern'}
            </dd>
          </>
        )}
        <dt>Time</dt>
        <dd>{(attempt.timeMs / 1000).toFixed(1)} s</dd>
      </div>
      {grade.bestLabel && grade.playedLabel && (
        <div className={`callout ${grade.conceptCorrect ? 'kata' : 'bad'} small`}>
          The position called for <strong>{grade.bestLabel}</strong>; you chose <strong>{grade.playedLabel}</strong>.
          {grade.repeatedError && ' This is the same error as in your games.'}
        </div>
      )}
      {sig && <p className="small dim">{sig.focus}</p>}
      <div className="small">
        <span className="chip">{kind.label}</span> <span className="muted">{kind.explain}</span>
      </div>
      {item.modification && <p className="tiny muted">Variation: {item.modification.note}. Re-analysed by KataGo.</p>}
      {cands.length > 0 && (
        <table className="data">
          <tbody>
            {cands.slice(0, 5).map((c) => (
              <tr key={c.loc}>
                <td className={c.loc === grade.bestLoc ? 'kata' : c.loc === attempt.loc ? 'you' : ''}>{locToGtp(c.loc, item.size)}</td>
                <td className="mono small">{c.winrate !== undefined ? fmtPct(c.winrate, 1) : ''}</td>
                <td className="mono small">{c.scoreLead !== undefined ? `${c.scoreLead >= 0 ? '+' : ''}${c.scoreLead.toFixed(1)}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div>
        <div className="tiny muted" style={{ marginBottom: 4 }}>
          Why did you play it? (optional, one tap)
        </div>
        <div className="row wrap">
          {REASONS.map((r) => (
            <button
              key={r}
              className={`btn small ${reason === r ? 'primary' : ''}`}
              onClick={() => {
                setReason(r);
                void addReason(attempt.id, r);
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <a className="tiny muted" href={href(`review/${item.gameId}?move=${item.index + 1}`)}>
        Open the source game at move {item.index + 1} →
      </a>
    </div>
  );
}

export function Forge({ weaknessId }: { weaknessId?: string }) {
  const weaknesses = useStore((s) => s.weaknesses);
  const itemsByW = useStore((s) => s.items);
  const attempts = useStore((s) => s.attempts);
  const mastery = useStore((s) => s.mastery);
  const engine = useStore((s) => s.engine);
  const sessionId = useRef(uid('s')).current;
  const masteryMap = useMemo(() => new Map(Object.entries(mastery)), [mastery]);
  const minWin = useStore((s) => s.settings.minLosingWinrate);
  // With no weakness asked for, train one that has positions worth drilling.
  const trainable = useMemo(() => weaknesses.filter((w) => practiceItems(itemsByW[w.id] ?? [], minWin).length > 0), [weaknesses, itemsByW, minWin]);
  const weakness: Weakness | null =
    weaknesses.find((w) => w.id === weaknessId) ?? pickWeakness(trainable, masteryMap) ?? pickWeakness(weaknesses, masteryMap) ?? null;
  // Only positions worth drilling are asked (lib/forge/worth.ts), items saved before those rules included.
  const stored = weakness ? itemsByW[weakness.id] : undefined;
  const items = useMemo(() => practiceItems(stored ?? [], minWin), [stored, minWin]);
  const m = weakness ? mastery[weakness.id] ?? newMastery(weakness.id) : null;

  const [item, setItem] = useState<TrainingItem | null>(null);
  const [pending, setPending] = useState<Loc | null>(null);
  const [result, setResult] = useState<{ grade: GradeResult; attempt: Attempt } | null>(null);
  const [started, setStarted] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [varBusy, setVarBusy] = useState(false);
  const [explore, setExplore] = useState(false);
  const [assistedFor, setAssistedFor] = useState<string | null>(null);
  const [hoverPv, setHoverPv] = useState<Loc[] | null>(null);
  const [view, toggleView, setCandidateCount] = useAnalysisView();
  const predicted = usePrediction(item);
  const base = useMemo(() => (item ? { size: item.size, komi: item.komi, rules: item.rules, setup: item.setup, moves: item.moves, toPlay: item.toPlay } : null), [item]);
  const analysis = useAnalysis(base, explore, item?.eval);

  const next = useCallback(() => {
    if (!weakness) return;
    const history = useStore.getState().attempts.filter((a) => a.weaknessId === weakness.id && a.mode === 'forge');
    const lvl = useStore.getState().mastery[weakness.id]?.level ?? 1;
    setItem(pickItem(items, history, lvl));
    setPending(null);
    setResult(null);
    setExplore(false);
    setHoverPv(null);
    setStarted(Date.now());
  }, [weakness, items]);

  useEffect(() => {
    next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weakness?.id, items.length]);

  const commit = useCallback(async () => {
    if (!item || pending === null || result || busy) return;
    setBusy(true);
    try {
      const r = await submitAnswer(item, pending, Date.now() - started, 'forge', sessionId, { assisted: assistedFor === item.id });
      setResult(r);
    } finally {
      setBusy(false);
    }
  }, [item, pending, result, busy, started, sessionId, assistedFor]);

  const openAnalysis = () => {
    // Seeing KataGo's answer before committing makes the attempt "assisted".
    if (item && !result) setAssistedFor(item.id);
    setExplore(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (explore) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (result) next();
        else void commit();
      } else if (e.key === 'Escape') setPending(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commit, next, result, explore]);

  const board = useMemo(() => (item ? itemBoard(item) : null), [item]);
  const session = attempts.filter((a) => a.sessionId === sessionId);

  if (!weaknesses.length)
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <div className="eyebrow">Training</div>
            <h1>Forge</h1>
          </div>
        </div>
        <div className="empty">
          Forge trains your recurring weaknesses. None are confirmed yet: analyse more of your games, or <a href={href('dashboard')}>load the demo data</a>.
        </div>
      </div>
    );
  if (!weakness || !item || !board) {
    // Positions are there and the first one is being chosen.
    if (weakness && items.length) return <div className="page" />;
    const title = weakness ? <strong>{weakness.llm?.title ?? weakness.title}</strong> : 'this weakness';
    const skipped = stored?.length ? summarizePractice(stored, minWin) : null;
    return (
      <div className="page">
        <div className="empty stack" style={{ justifyItems: 'center' }}>
          {skipped ? (
            <span>
              None of the {skipped.total} positions found for {title} are worth drilling: {describeSkipped(skipped)}. Forge only asks about positions where
              a wrong move costs real points and one answer stands out, so early-opening choices and small differences are left out. Analyse more of
              your games to find more.
            </span>
          ) : (
            <span>
              No training positions for {title} yet. Practice only uses positions where a wrong move costs real points and the side that is behind still
              has at least {Math.round(minWin * 100)}% to win, so early-opening choices and decided games give none.
            </span>
          )}
          <span className="row wrap" style={{ justifyContent: 'center' }}>
            <a className="btn small" href={href('library')}>
              Analyse more games
            </a>
            <a className="btn small" href={href('settings')}>
              Change the winrate limit
            </a>
          </span>
        </div>
      </div>
    );
  }

  const marks: Mark[] = [];
  if (result) {
    marks.push({ loc: result.grade.bestLoc, kind: 'best' });
    if (predicted && predicted.loc !== result.attempt.loc && predicted.loc !== result.grade.bestLoc) marks.push({ loc: predicted.loc, kind: 'doppel', label: 'D' });
    if (result.attempt.loc !== result.grade.bestLoc) marks.push({ loc: result.attempt.loc, kind: 'you' });
  }
  const last = item.moves.length ? item.moves[item.moves.length - 1].loc : null;

  const assisted = assistedFor === item.id;
  return (
    <div className="stage">
      <div className="board-wrap">
        {explore ? (
          <AnalysisBoard a={analysis} view={view} hoverPv={hoverPv} onHoverPv={setHoverPv} />
        ) : (
        <Board
          size={item.size}
          stones={result && result.attempt.loc !== PASS ? withStone(board, result.attempt.loc, item.toPlay) : board.stones}
          lastMove={result ? result.attempt.loc : last}
          toPlay={item.toPlay}
          onPlay={result ? undefined : (l) => (pending === l ? void commit() : setPending(l))}
          pending={result ? null : pending}
          marks={marks}
          coords
        />
        )}
      </div>
      <div className="side">
        {explore && (
          <AnalysisPanel
            a={analysis}
            view={view}
            onToggle={toggleView}
            onCandidateCount={setCandidateCount}
            onHoverPv={setHoverPv}
            copyColor={item?.toPlay}
            onClose={() => {
              setExplore(false);
              setHoverPv(null);
            }}
            closeLabel={result ? 'Back to the result' : 'Back to the problem'}
            note={assisted && !result ? 'You opened the analysis board, so your answer to this position will not count toward mastery.' : undefined}
          />
        )}
        <div className="panel stack">
          <div className="spread">
            <h3>Forge</h3>
            <select value={weakness.id} onChange={(e) => go(`forge/${e.target.value}`)} style={{ maxWidth: 220 }}>
              {weaknesses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.llm?.title ?? w.title}
                </option>
              ))}
            </select>
          </div>
          <h2>{weakness.llm?.title ?? weakness.title}</h2>
          <div className="row wrap small">
            <span className="chip you">level {m?.level ?? 1}/5</span>
            <span className="chip">mastery {fmtPct(m?.mastery ?? 0)}</span>
            <span className="chip">{items.length} positions</span>
          </div>
        </div>

        <div className="panel stack">
          {!result ? (
            <>
              <div className="spread">
                <strong>{item.toPlay === 1 ? 'Black' : 'White'} to play</strong>
                <span className="chip">{item.kind === 'original' ? 'from your game' : 'blind position'}</span>
              </div>
              <p className="tiny muted" title="Why this position is worth drilling">
                {assessItem(item).reason}
              </p>
              <p className="small dim">Find the best move. Tap a point to select it, tap again (or press Enter) to commit.</p>
              {assisted && <p className="tiny warn">Analysis board used: this answer will not count toward mastery.</p>}
              <div className="row wrap">
                <button className="btn primary big" disabled={pending === null || busy || explore} onClick={() => void commit()}>
                  {busy ? 'Checking…' : pending === null ? 'Select a move' : `Commit ${locToGtp(pending, item.size)}`}
                </button>
                {pending !== null && (
                  <button className="btn ghost" onClick={() => setPending(null)}>
                    Clear
                  </button>
                )}
                {!explore && (
                  <button className="btn" onClick={openAnalysis} title="Try moves with live KataGo winrates and heat map">
                    Analysis board
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <Reveal item={item} grade={result.grade} attempt={result.attempt} predicted={predicted} />
              {result.attempt.assisted && <p className="tiny warn">Answered with the analysis board open: not counted toward mastery.</p>}
              <div className="row wrap">
                <button className="btn primary big" onClick={next}>
                  Next position <span className="kbd">Enter</span>
                </button>
                {!explore && (
                  <button className="btn" onClick={openAnalysis}>
                    Explore on the analysis board
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="panel stack">
          <h3>This session</h3>
          <div className="row wrap small">
            <span className="chip">{session.length} positions</span>
            {session.length > 0 && (
              <>
                <span className="chip good">{fmtPct(session.filter((a) => a.conceptCorrect).length / session.length)} right decision</span>
                <span className="chip">{(session.reduce((a, x) => a + x.timeMs, 0) / session.length / 1000).toFixed(1)} s avg</span>
                <span className="chip bad">{session.filter((a) => a.repeatedError).length} repeated errors</span>
              </>
            )}
          </div>
          <div className="row wrap">
            <a className="btn small" href={href(`blind/${weakness.id}`)}>
              Do I really know this?
            </a>
            <button
              className="btn small"
              disabled={varBusy || engine.status === 'loading'}
              title="KataGo re-analyses shifted versions of your positions"
              onClick={async () => {
                setVarBusy(true);
                try {
                  await generateVariations(weakness.id);
                } finally {
                  setVarBusy(false);
                }
              }}
            >
              {varBusy ? 'KataGo is building variations…' : 'Generate engine variations'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function withStone(board: ReturnType<typeof itemBoard>, loc: Loc, color: 1 | 2) {
  const b = board.clone();
  b.play(loc, color, true);
  return b.stones;
}
