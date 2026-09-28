import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { saveBlindTest, submitAnswer } from '../state/actions';
import { Board } from '../components/Board';
import { AnalysisBoard, AnalysisPanel, useAnalysis, useAnalysisView } from '../components/Analysis';
import { fmtPct, FocusToggle, useFocusMode } from '../components/common';
import { itemBoard } from '../lib/forge/grading';
import { buildBlindSet } from '../lib/forge/scheduler';
import { practiceItems } from '../lib/forge/worth';
import { locToGtp } from '../lib/go/coords';
import type { Loc } from '../lib/go/types';
import type { BlindTest, TrainingItem } from '../lib/types';
import { uid } from '../lib/util/hash';
import { go, href } from '../router';

const VERDICT: Record<'learned' | 'partial' | 'not-yet', { text: string; tone: string; explain: string }> = {
  learned: { text: 'You know this', tone: 'good', explain: 'Your decisions were right well above what a fixed habit would score. The pattern is learned.' },
  partial: { text: 'Partly learned', tone: 'warn', explain: 'Better than chance, but not reliable yet. Keep training this in the Forge.' },
  'not-yet': { text: 'Not yet', tone: 'bad', explain: 'Your decisions are still close to your old habit. The Forge will keep bringing this back.' },
};

function Runner({ test, items, onDone }: { test: BlindTest; items: TrainingItem[]; onDone: (t: BlindTest) => void }) {
  const [i, setI] = useState(test.attempts.length);
  const [pending, setPending] = useState<Loc | null>(null);
  const [started, setStarted] = useState(Date.now());
  const [cur, setCur] = useState(test);
  const [busy, setBusy] = useState(false);
  const [explore, setExplore] = useState(false);
  const [assistedFor, setAssistedFor] = useState<string | null>(null);
  const [hoverPv, setHoverPv] = useState<Loc[] | null>(null);
  const [view, toggleView, setCandidateCount] = useAnalysisView();
  const [focused, setFocused] = useFocusMode();
  const item = items[i];
  const board = useMemo(() => (item ? itemBoard(item) : null), [item]);
  const base = useMemo(() => (item ? { size: item.size, komi: item.komi, rules: item.rules, setup: item.setup, moves: item.moves, toPlay: item.toPlay } : null), [item]);
  const analysis = useAnalysis(base, explore, item?.eval);

  const commit = async () => {
    if (!item || pending === null || busy || explore) return;
    setBusy(true);
    try {
      const { attempt } = await submitAnswer(item, pending, Date.now() - started, 'blind', test.id, { assisted: assistedFor === item.id });
      const next: BlindTest = { ...cur, attempts: [...cur.attempts, attempt.id] };
      const done = i + 1 >= items.length;
      const saved = await saveBlindTest(done ? { ...next, finishedAt: Date.now() } : next);
      setCur(saved);
      setPending(null);
      setExplore(false);
      setHoverPv(null);
      setStarted(Date.now());
      if (done) onDone(saved);
      else setI(i + 1);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') void commit();
      else if (e.key === 'Escape' && focused) setFocused(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!item || !board) return null;
  const last = item.moves.length ? item.moves[item.moves.length - 1].loc : null;
  const assisted = assistedFor === item.id;
  return (
    <div className={`stage ${focused ? 'focused' : ''}`}>
      <FocusToggle focused={focused} onChange={setFocused} />
      <div className="board-wrap">
        {explore ? (
          <AnalysisBoard a={analysis} view={view} hoverPv={hoverPv} onHoverPv={setHoverPv} />
        ) : (
          <Board size={item.size} stones={board.stones} lastMove={last} toPlay={item.toPlay} pending={pending} onPlay={(l) => (pending === l ? void commit() : setPending(l))} coords />
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
            note="Answers given after opening the analysis board are kept but do not count in the test result."
          />
        )}
        <div className="panel stack">
          <div className="spread">
            <h3>Blind test</h3>
            <span className="mono small">
              {i + 1} / {items.length}
            </span>
          </div>
          <div className="progress">
            <span style={{ width: `${(i / items.length) * 100}%` }} />
          </div>
          <strong>{item.toPlay === 1 ? 'Black' : 'White'} to play</strong>
          <p className="small dim">No hints and no feedback until the end. Some positions call for your usual instinct, some for the opposite.</p>
          {assisted && <p className="tiny warn">Analysis board used: this answer will not count in the result.</p>}
          <div className="row wrap">
            <button className="btn primary big" disabled={pending === null || busy || explore} onClick={() => void commit()}>
              {busy ? 'Saving…' : pending === null ? 'Select a move' : `Commit ${locToGtp(pending, item.size)}`}
            </button>
            {!explore && (
              <button
                className="btn"
                onClick={() => {
                  setAssistedFor(item.id);
                  setExplore(true);
                }}
              >
                Analysis board
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Results({ test, items }: { test: BlindTest; items: TrainingItem[] }) {
  const attempts = useStore((s) => s.attempts);
  const r = test.result;
  const byItem = new Map(items.map((x) => [x.id, x]));
  const mine = test.attempts.map((id) => attempts.find((a) => a.id === id)).filter((a) => !!a);
  if (!r) return null;
  const v = VERDICT[r.verdict];
  return (
    <div className="stack">
      <div className="panel stack">
        <div className="spread">
          <h2 className={v.tone}>{v.text}</h2>
          <span className={`chip ${v.tone}`}>p = {r.pValue < 0.001 ? '<0.001' : r.pValue.toFixed(3)}</span>
        </div>
        <p className="dim">{v.explain}</p>
        <div className="grid cols-3">
          <div className="stat">
            <div className="v">{fmtPct(r.conceptAccuracy)}</div>
            <div className="l">right decisions</div>
          </div>
          <div className="stat">
            <div className="v">{fmtPct(r.baseline)}</div>
            <div className="l">what a fixed habit scores</div>
          </div>
          <div className="stat">
            <div className="v">{fmtPct(r.accuracy)}</div>
            <div className="l">moves within 1.5 points of KataGo</div>
          </div>
        </div>
      </div>
      <div className="card-list">
        {mine.map((a) => {
          const it = byItem.get(a.itemId);
          if (!it) return null;
          const b = itemBoard(it);
          return (
            <div key={a.id} className="poscard">
              <div className="thumb">
                <Board
                  size={it.size}
                  stones={b.stones}
                  lastMove={it.moves.length ? it.moves[it.moves.length - 1].loc : null}
                  marks={[
                    { loc: it.eval.bestLoc, kind: 'best' },
                    ...(a.loc !== it.eval.bestLoc ? [{ loc: a.loc, kind: 'you' as const }] : []),
                  ]}
                />
              </div>
              <div className="small">
                <span className={`chip ${a.conceptCorrect ? 'good' : 'bad'}`}>{a.conceptCorrect ? 'right decision' : 'wrong decision'}</span>{' '}
                <span className={`grade-${a.grade}`}>{a.grade}</span>
                {a.assisted && <span className="chip warn">analysis board, not counted</span>}
              </div>
              <div className="tiny muted">
                you {locToGtp(a.loc, it.size)} · KataGo {locToGtp(it.eval.bestLoc, it.size)} · {(a.timeMs / 1000).toFixed(1)} s
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BlindTests({ weaknessId }: { weaknessId?: string }) {
  const weaknesses = useStore((s) => s.weaknesses);
  const itemsByW = useStore((s) => s.items);
  const tests = useStore((s) => s.blindTests);
  const attempts = useStore((s) => s.attempts);
  const [active, setActive] = useState<{ test: BlindTest; items: TrainingItem[] } | null>(null);
  const [finished, setFinished] = useState<{ test: BlindTest; items: TrainingItem[] } | null>(null);
  const weakness = weaknesses.find((w) => w.id === weaknessId);
  const minWin = useStore((s) => s.settings.minLosingWinrate);
  // Only positions worth drilling are asked (lib/forge/worth.ts), items saved before those rules included.
  const practice = useMemo(
    () => Object.fromEntries(weaknesses.map((w) => [w.id, practiceItems(itemsByW[w.id] ?? [], minWin)])),
    [weaknesses, itemsByW, minWin],
  );

  const start = async (wid: string) => {
    const items = practice[wid] ?? [];
    const set = buildBlindSet(items, attempts, 14);
    if (set.length < 6) {
      alert('Not enough positions worth drilling for a blind test on this weakness yet (early-opening choices and small losses are left out). Analyse more games first.');
      return;
    }
    const t: BlindTest = { id: uid('bt-'), weaknessId: wid, itemIds: set.map((x) => x.id), startedAt: Date.now(), attempts: [] };
    await saveBlindTest(t);
    setFinished(null);
    setActive({ test: t, items: set });
  };

  if (active)
    return (
      <Runner
        test={active.test}
        items={active.items}
        onDone={(t) => {
          setFinished({ test: t, items: active.items });
          setActive(null);
        }}
      />
    );

  const allItems = Object.values(itemsByW).flat();
  const done = tests.filter((t) => t.result);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Blind tests</div>
          <h1>Do I really know this?</h1>
          <p className="sub">10–20 blind positions per weakness. No hints, no feedback until the end, scored against what your old habit would get right by default.</p>
        </div>
      </div>
      {finished && (
        <div style={{ marginBottom: 20 }}>
          <Results test={finished.test} items={finished.items} />
        </div>
      )}
      {!weaknesses.length ? (
        <div className="empty">
          No confirmed weaknesses yet. <a href={href('library')}>Analyse your games</a> or <a href={href('dashboard')}>load the demo</a>.
        </div>
      ) : (
        <div className="panel" style={{ padding: 0 }}>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Weakness</th>
                  <th>Positions</th>
                  <th>Last result</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {weaknesses.map((w) => {
                  const last = done.find((t) => t.weaknessId === w.id);
                  const n = (practice[w.id] ?? []).length;
                  return (
                    <tr key={w.id} className={w.id === weakness?.id ? 'selected' : ''}>
                      <td>
                        <div>{w.llm?.title ?? w.title}</div>
                        <div className="tiny muted">{w.category}</div>
                      </td>
                      <td className="mono small">{n}</td>
                      <td>
                        {last?.result ? (
                          <span className={`chip ${VERDICT[last.result.verdict].tone}`}>
                            {VERDICT[last.result.verdict].text} · {fmtPct(last.result.conceptAccuracy)}
                          </span>
                        ) : (
                          <span className="muted small">never tested</span>
                        )}
                      </td>
                      <td className="row">
                        <button className="btn small primary" disabled={n < 6} onClick={() => void start(w.id)}>
                          Start test
                        </button>
                        <button className="btn small ghost" onClick={() => go(`forge/${w.id}`)}>
                          Train
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {done.length > 0 && (
        <>
          <h3 style={{ margin: '24px 0 8px' }}>History</h3>
          <div className="panel" style={{ padding: 0 }}>
            <div className="table-scroll">
              <table className="data">
                <tbody>
                  {done.slice(0, 20).map((t) => {
                    const w = weaknesses.find((x) => x.id === t.weaknessId);
                    return (
                      <tr key={t.id} className="click" onClick={() => setFinished({ test: t, items: allItems.filter((x) => t.itemIds.includes(x.id)) })}>
                        <td className="small dim">{new Date(t.startedAt).toLocaleDateString()}</td>
                        <td>{w?.llm?.title ?? w?.title ?? 'Removed weakness'}</td>
                        <td>
                          <span className={`chip ${VERDICT[t.result!.verdict].tone}`}>{VERDICT[t.result!.verdict].text}</span>
                        </td>
                        <td className="mono small">{fmtPct(t.result!.conceptAccuracy)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
