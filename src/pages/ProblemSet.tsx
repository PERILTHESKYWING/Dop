import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Board, type Mark } from '../components/Board';
import { BrandSpinner } from '../components/Brand';
import { Icon } from '../components/Icons';
import { dailySet, pickSet } from '../lib/problems/bank';
import { levelLabel, ratingToRank } from '../lib/problems/level';
import { colorOf, mainLine, playable, playLine, playMove, problemBoard, startSolve, viewOf, type SolveState } from '../lib/problems/play';
import { fanfare, rightSound, stoneSound, wrongSound } from '../lib/problems/sound';
import { taskLine } from '../lib/problems/text';
import { CATEGORY_TEXT, TAG_TEXT, type Problem } from '../lib/problems/types';
import { locToGtp, sgfToLoc } from '../lib/go/coords';
import { colorName, other, type Loc, type Move } from '../lib/go/types';
import { currentCombo, ensureTexts, historyOf, loadForge, playerRank, recordResult, textOf, useForge, type ProblemResult } from '../state/problems';
import { go, href } from '../router';
import '../components/forge.css';
import { BackLink } from '../components/ControlSheet';
import { FocusToggle, useFocusMode } from '../components/common';

/**
 * Solving a set of Forge problems, 101weiqi style: the task on top, the board, and the
 * opponent answering each right move with KataGo's strongest resistance until the problem
 * is settled. A wrong move shows how KataGo refutes it. Hints and explanations come from
 * the AI coach when it is set up (checked against KataGo's lines), otherwise from the app.
 */

type Phase = 'solving' | 'reply' | 'right' | 'wrong' | 'answer';

interface Slot {
  result: ProblemResult | null;
}

const REPLY_MS = 420;

export function ProblemSet({ daily }: { daily: boolean }) {
  const loaded = useForge((s) => s.loaded);
  const bank = useForge((s) => s.bank);
  const prefs = useForge((s) => s.prefs);
  const texts = useForge((s) => s.texts);
  useEffect(() => void loadForge(), []);

  // The set is chosen once, when the page opens.
  const [set, setSet] = useState<Problem[] | null>(null);
  useEffect(() => {
    if (!loaded || !bank || set) return;
    const s = useForge.getState();
    const hidden = new Set(s.progress.hidden);
    const usable = bank.filter((p) => !hidden.has(p.id));
    const rank = playerRank(s.progress);
    const chosen = daily
      ? dailySet(usable, rank)
      : pickSet(usable, { categories: s.prefs.categories, minLevel: s.prefs.minLevel, maxLevel: s.prefs.maxLevel, minLosingWinrate: s.prefs.minLosingWinrate, maxMoves: s.prefs.maxMoves }, s.prefs.count, historyOf(s.progress));
    setSet(chosen);
    void ensureTexts(chosen, rank);
  }, [loaded, bank, daily, set]);

  const [idx, setIdx] = useState(0);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    if (set) setSlots(set.map(() => ({ result: null })));
  }, [set]);

  if (!loaded || !bank || !set)
    return (
      <div className="page">
        <div className="empty">
          <BrandSpinner />
        </div>
      </div>
    );
  if (!set.length)
    return (
      <div className="page">
        <div className="empty stack" style={{ justifyItems: 'center' }}>
          <span>No problems match these settings yet. Widen the level range or pick more types.</span>
          <a className="btn" href={href('forge')}>
            Back to the settings
          </a>
        </div>
      </div>
    );
  if (finished) return <Summary set={set} slots={slots} daily={daily} />;
  const p = set[idx];
  return (
    <Solver
      key={p.id + ':' + idx}
      problem={p}
      index={idx}
      set={set}
      slots={slots}
      daily={daily}
      prefs={prefs}
      textReady={!!texts[p.id]}
      onDone={(r) => setSlots((s) => s.map((x, i) => (i === idx ? { result: r } : x)))}
      onNext={() => {
        if (idx + 1 >= set.length) setFinished(true);
        else setIdx(idx + 1);
      }}
    />
  );
}

function Solver({
  problem: p,
  index,
  set,
  slots,
  daily,
  prefs,
  textReady,
  onDone,
  onNext,
}: {
  problem: Problem;
  index: number;
  set: Problem[];
  slots: Slot[];
  daily: boolean;
  prefs: ReturnType<typeof useForge.getState>['prefs'];
  textReady: boolean;
  onDone: (r: ProblemResult) => void;
  onNext: () => void;
}) {
  const me = colorOf(p);
  const [solve, setSolve] = useState<SolveState>(() => startSolve(p));
  const [shown, setShown] = useState<{ stones: Int8Array; last: Loc | null } | null>(null);
  const [phase, setPhase] = useState<Phase>('solving');
  const [pending, setPending] = useState<Loc | null>(null);
  const [tries, setTries] = useState(0);
  const [hinted, setHinted] = useState(false);
  const [wrongAt, setWrongAt] = useState<Loc | null>(null);
  const [variation, setVariation] = useState<Move[] | null>(null);
  const [answerBoard, setAnswerBoard] = useState<Int8Array | null>(null);
  const [recorded, setRecorded] = useState<ProblemResult | null>(null);
  const [progressNote, setProgressNote] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(prefs.timeLimit);
  const [focused, setFocused] = useFocusMode();
  const startedAt = useRef(Date.now());
  const text = useMemo(() => textOf(p), [p, textReady]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = viewOf(p);
  const combo = currentCombo(useForge((s) => s.progress));

  const record = useCallback(
    async (ok: boolean, solved: boolean) => {
      if (recorded) return recorded;
      const r = await recordResult(p, { ok, solved, tries: tries + (ok ? 0 : 1), hint: hinted, ms: Date.now() - startedAt.current }, daily);
      setRecorded(r);
      onDone(r);
      return r;
    },
    [recorded, p, tries, hinted, daily, onDone],
  );

  const showAnswer = useCallback(() => {
    // The answer from the start, numbered on the board.
    const start = problemBoard(p);
    const line = mainLine(p.tree, p.size);
    setAnswerBoard(start.stones);
    setVariation(line.map((loc, i) => ({ color: i % 2 === 0 ? me : other(me), loc })));
    setPhase('answer');
    void record(false, false);
  }, [p, me, record]);

  const retry = () => {
    setSolve(startSolve(p));
    setShown(null);
    setVariation(null);
    setAnswerBoard(null);
    setWrongAt(null);
    setPhase('solving');
    setProgressNote(null);
  };

  const play = (loc: Loc) => {
    if (phase !== 'solving' || !playable(p, solve.board, loc)) return;
    if (prefs.confirmMove && pending !== loc) {
      setPending(loc);
      return;
    }
    setPending(null);
    if (prefs.sound) stoneSound();
    const { state, reply } = playMove(p, solve, loc);
    if (state.outcome === 'wrong') {
      setSolve(state);
      setWrongAt(loc);
      setShown(null);
      if (state.refutation?.length) setVariation(state.refutation.map((l, i) => ({ color: i % 2 === 0 ? other(me) : me, loc: l })));
      setPhase('wrong');
      if (prefs.sound) wrongSound();
      if (prefs.onWrong === 'answer') void record(false, false);
      else setTries((t) => t + 1);
      return;
    }
    const finish = () => {
      setSolve(state);
      setShown(null);
      if (state.outcome === 'solved') {
        setPhase('right');
        if (prefs.sound) rightSound();
        const ok = tries === 0 && !hinted;
        void record(ok, true).then(() => {
          if (ok && prefs.autoNext) setTimeout(onNext, 1600);
        });
      } else {
        setPhase('solving');
        setProgressNote(pick(['Good. Keep going.', 'Right so far. What now?', 'That works. Your move again.']));
      }
    };
    if (reply !== null) {
      // Show the player's stone, then the opponent's answer a moment later.
      setShown({ stones: playLine(solve.board, me, [loc]).stones, last: loc });
      setPhase('reply');
      setTimeout(() => {
        if (prefs.sound) stoneSound();
        finish();
      }, REPLY_MS);
    } else finish();
  };

  // Time limit per problem.
  useEffect(() => {
    if (!prefs.timeLimit || recorded || phase === 'right' || phase === 'answer') return;
    const t = setInterval(() => {
      const left = prefs.timeLimit - Math.floor((Date.now() - startedAt.current) / 1000);
      setTimeLeft(Math.max(0, left));
      if (left <= 0) {
        clearInterval(t);
        if (prefs.sound) wrongSound();
        showAnswer();
      }
    }, 250);
    return () => clearInterval(t);
  }, [prefs.timeLimit, prefs.sound, recorded, phase, showAnswer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.key === 'Enter' && recorded && phase !== 'solving') onNext();
      else if (e.key.toLowerCase() === 'h' && !hinted) setHinted(true);
      else if (e.key.toLowerCase() === 'r' && phase === 'wrong' && prefs.onWrong === 'retry') retry();
      else if (e.key === 'Escape') {
        if (focused) setFocused(false);
        else setPending(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const stones = answerBoard ?? shown?.stones ?? solve.board.stones;
  const lastMove = answerBoard ? null : shown ? shown.last : solve.moves.length ? solve.moves[solve.moves.length - 1].loc : p.last ? sgfToLoc(p.last, p.size) : null;
  const marks: Mark[] = [];
  if (phase === 'wrong' && wrongAt !== null) marks.push({ loc: wrongAt, kind: 'you', label: '✕' });
  if (phase === 'right' && solve.moves.length) marks.push({ loc: solve.moves[0].loc, kind: 'best', label: '✓' });
  const wrongNote = wrongAt !== null ? text.wrongNotes[locToGtp(wrongAt, p.size)] : undefined;
  const task = text.question || taskLine(p);
  const done = recorded !== null;
  const firstTry = recorded?.ok;
  const timePct = prefs.timeLimit ? timeLeft / prefs.timeLimit : 1;
  const margin = prefs.coords ? 2.48 : 1.2; // the board's own margin around a crop, both sides

  return (
    <div className={`stage forge-solve ${focused ? 'focused' : ''}`}>
      <FocusToggle focused={focused} onChange={setFocused} />
      <div className="board-wrap" style={view ? ({ '--arw': view.x1 - view.x0 + margin, '--arh': view.y1 - view.y0 + margin } as CSSProperties) : undefined}>
        <Board
          size={p.size}
          stones={stones}
          lastMove={lastMove}
          toPlay={me}
          onPlay={phase === 'solving' ? play : undefined}
          pending={pending}
          marks={marks}
          coords={prefs.coords}
          crop={view ?? undefined}
          variation={variation}
          detail={view ? 'full' : undefined}
        />
      </div>
      <div className="side">
        <div className="panel stack">
          <div className="spread">
            <BackLink href={href('forge')} label="Forge" />
            <span className="small muted">
              {index + 1} / {set.length}
              {daily ? ' · daily' : ''}
            </span>
          </div>
          <div className="fs-dots">
            {set.map((q, i) => {
              const r = slots[i]?.result;
              return <span key={q.id} className={`fs-dot ${i === index ? 'now' : ''} ${r ? (r.ok ? 'ok' : r.solved ? 'half' : 'bad') : ''}`} />;
            })}
          </div>
          <div className={`fs-task ${me === 1 ? 'b' : 'w'}`}>
            <span className={`stone-dot ${me === 1 ? 'b' : 'w'}`} />
            <strong>{task}</strong>
          </div>
          <div className="row wrap small">
            <span className="chip">{CATEGORY_TEXT[p.cat].label}</span>
            <span className="chip you">{levelLabel(p.level)}</span>
            {combo >= 2 && <span className="chip good fs-combo">{combo} in a row</span>}
          </div>
          {prefs.timeLimit > 0 && !done && (
            <div className={`fs-timer ${timePct < 0.25 ? 'low' : ''}`} aria-label={`${timeLeft} seconds left`}>
              <div style={{ width: `${timePct * 100}%` }} />
            </div>
          )}
        </div>

        <div className="panel stack fs-feedback">
          {phase === 'solving' && (
            <>
              <p className="small dim">
                {progressNote ?? (prefs.confirmMove ? 'Tap a point, then tap it again to play.' : `Play ${colorName(me)}'s move.`)}
                {view ? ' The rest of the board is settled.' : ''}
              </p>
              {hinted ? (
                <div className="callout kata small">
                  <strong>Hint:</strong> {text.hint}
                </div>
              ) : (
                <div className="row wrap">
                  <button className="btn small" onClick={() => setHinted(true)} title="A hint: solving afterwards counts as half">
                    Hint <span className="kbd">H</span>
                  </button>
                  <button className="btn small ghost" onClick={showAnswer}>
                    Show the answer
                  </button>
                </div>
              )}
              {hinted && (
                <button className="btn small ghost" onClick={showAnswer}>
                  Show the answer
                </button>
              )}
            </>
          )}
          {phase === 'reply' && <p className="small dim">…</p>}
          {phase === 'right' && (
            <>
              <div className="fs-verdict ok">
                <Icon name="check" /> {firstTry ? pick(['Right!', 'Correct!', 'Well read!', 'Exactly.']) : 'Solved.'}
              </div>
              {text.title && text.title !== CATEGORY_TEXT[p.cat].label && <strong>{text.title}</strong>}
              <p className="small">{text.explanation}</p>
              <Tags p={p} />
            </>
          )}
          {phase === 'wrong' && (
            <>
              <div className="fs-verdict bad">Not quite.</div>
              <p className="small">
                {wrongNote ?? (variation ? `${colorName(other(me))} answers at ${locToGtp(variation[0].loc, p.size)}; the numbered stones show how it goes.` : "KataGo's answer is different.")}
              </p>
              <div className="row wrap">
                {prefs.onWrong === 'retry' && !done && (
                  <button className="btn primary" onClick={retry}>
                    Try again <span className="kbd">R</span>
                  </button>
                )}
                <button className="btn" onClick={showAnswer}>
                  Show the answer
                </button>
              </div>
            </>
          )}
          {phase === 'answer' && (
            <>
              <div className="fs-verdict">The answer</div>
              {text.title && text.title !== CATEGORY_TEXT[p.cat].label && <strong>{text.title}</strong>}
              <p className="small">{text.explanation}</p>
              <p className="tiny muted">The numbered stones show KataGo's line from the start.</p>
              <Tags p={p} />
            </>
          )}
          {done && phase !== 'solving' && phase !== 'reply' && (
            <div className="row wrap">
              <button className="btn primary big" onClick={onNext}>
                {index + 1 >= set.length ? 'Finish' : 'Next problem'} <span className="kbd">Enter</span>
              </button>
              {phase === 'right' && variation === null && (
                <button className="btn small ghost" onClick={showAnswerAgain(p, me, setAnswerBoard, setVariation)}>
                  Replay the answer
                </button>
              )}
            </div>
          )}
          {done && recorded && (
            <p className="tiny muted">
              Problem level {levelLabel(ratingToRank(recorded.after))} ({recorded.after - recorded.before >= 0 ? '+' : ''}
              {Math.round(recorded.after - recorded.before)})
            </p>
          )}
        </div>
        <p className="tiny muted fs-source">
          From {p.src.kind === 'pro' ? 'a professional game' : p.src.rank !== undefined ? `a ${levelLabel(p.src.rank)} game on Fox` : 'a real game'}, move {p.src.move}. Answer
          proved by KataGo.
          {textReady ? ' Text written by the AI coach and checked against KataGo.' : ''}
        </p>
      </div>
    </div>
  );
}

function showAnswerAgain(p: Problem, me: 1 | 2, setBoard: (b: Int8Array) => void, setVar: (v: Move[]) => void) {
  return () => {
    setBoard(problemBoard(p).stones);
    setVar(mainLine(p.tree, p.size).map((loc, i) => ({ color: i % 2 === 0 ? me : other(me), loc })));
  };
}

function Tags({ p }: { p: Problem }) {
  const tags = p.tags.filter((t) => TAG_TEXT[t]);
  if (!tags.length) return null;
  return (
    <div className="row wrap">
      {tags.map((t) => (
        <span key={t} className="chip small">
          {TAG_TEXT[t]}
        </span>
      ))}
    </div>
  );
}

function Summary({ set, slots, daily }: { set: Problem[]; slots: Slot[]; daily: boolean }) {
  const results = slots.map((s) => s.result).filter((r): r is ProblemResult => !!r);
  const ok = results.filter((r) => r.ok).length;
  const first = results[0]?.before ?? 0;
  const last = results[results.length - 1]?.after ?? first;
  const perfect = ok === set.length && set.length > 0;
  const ms = results.reduce((a, r) => a + r.ms, 0);
  const sound = useForge((s) => s.prefs.sound);
  useEffect(() => {
    if (perfect && sound) fanfare();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="page forge-summary">
      {perfect && <Confetti />}
      <div className="panel stack fs-summary">
        <div className="eyebrow">{daily ? 'Daily eight' : 'Problem set'} finished</div>
        <h1>
          {ok} / {set.length}
        </h1>
        <p className="dim">{perfect ? 'A perfect set.' : ok >= set.length * 0.7 ? 'Strong set.' : ok >= set.length * 0.4 ? 'Good work. The misses come back later.' : 'Tough set. The misses come back later, so you can learn them.'}</p>
        <div className="row wrap">
          <span className="chip you">problem level {levelLabel(ratingToRank(last))}</span>
          <span className={`chip ${last >= first ? 'good' : 'bad'}`}>
            {last - first >= 0 ? '+' : ''}
            {Math.round(last - first)} rating
          </span>
          <span className="chip">{Math.round(ms / 1000 / Math.max(1, results.length))} s per problem</span>
        </div>
        <div className="fs-list">
          {set.map((p, i) => {
            const r = slots[i]?.result;
            return (
              <div key={p.id} className="fs-row">
                <span className={`fs-dot ${r ? (r.ok ? 'ok' : r.solved ? 'half' : 'bad') : ''}`} />
                <span className="small">{taskLine(p)}</span>
                <span className="tiny muted">
                  {CATEGORY_TEXT[p.cat].label} · {levelLabel(p.level)}
                </span>
              </div>
            );
          })}
        </div>
        <div className="row wrap">
          <button className="btn primary big" onClick={() => (daily ? go('forge') : location.reload())}>
            <Icon name="play" /> {daily ? 'Back to Forge' : 'Another set'}
          </button>
          <a className="btn" href={href('forge')}>
            Settings
          </a>
        </div>
      </div>
    </div>
  );
}

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        dur: 1.8 + Math.random() * 1.4,
        hue: [24, 42, 350, 160, 200][i % 5],
        rot: Math.random() * 360,
      })),
    [],
  );
  return (
    <div className="fs-confetti" aria-hidden>
      {pieces.map((c, i) => (
        <span key={i} style={{ left: `${c.left}%`, animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s`, background: `hsl(${c.hue} 85% 58%)`, transform: `rotate(${c.rot}deg)` }} />
      ))}
    </div>
  );
}

function pick<T>(xs: T[]): T {
  return xs[Math.floor(Math.random() * xs.length)];
}
