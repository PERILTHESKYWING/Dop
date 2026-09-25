import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board, type Mark } from './Board';
import { fmtPct } from './common';
import { getEngine, markInteractive, startEngine } from '../state/actions';
import { useStore } from '../state/store';
import { engineMoves, evaluateDeep, searchedValue } from '../lib/analysis/analyzer';
import { processRawOutput, topPolicy } from '../lib/engine/parse';
import { replay } from '../lib/go/board';
import { locToGtp } from '../lib/go/coords';
import { other, PASS, type Color, type Loc, type Move } from '../lib/go/types';
import type { Candidate, PositionEval } from '../lib/types';

/** The position the analysis board starts from. */
export interface AnalysisBase {
  size: number;
  komi: number;
  setup: Move[];
  /** Moves that led to the position (the network sees recent history). */
  moves: Move[];
  toPlay: Color;
}

export interface LiveEval {
  /** Black's winrate and lead: the network's at first, KataGo's searched value once `searched`. */
  bWin: number;
  bLead: number;
  /** Probabilities over size*size + 1 points (pass last). */
  policy: Float32Array;
  ownership: Float32Array | null;
  /** KataGo's top moves after a short search (winrate and lead from the mover's side). */
  candidates: Candidate[];
  pv: Loc[];
  searched: boolean;
}

const lineKey = (line: Move[]) => line.map((m) => `${m.color}${m.loc}`).join(',');

/**
 * A free-play board from any position: every move is evaluated live by KataGo (winrate,
 * score, policy heat map, territory) and refined with a short search for the top moves.
 * `rootEval`, the stored deep analysis of the starting position, is used for that position
 * so the board opens with the same numbers as the problem or game review.
 */
export function useAnalysis(base: AnalysisBase | null, active: boolean, rootEval?: PositionEval | null) {
  const [line, setLine] = useState<Move[]>([]);
  const [cursor, setCursor] = useState(0);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<'idle' | 'thinking' | 'searching' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const cache = useRef(new Map<string, LiveEval>());
  const baseKey = base ? `${base.size}|${base.komi}|${lineKey(base.setup)}|${lineKey(base.moves)}|${base.toPlay}` : '';

  useEffect(() => {
    setLine([]);
    setCursor(0);
    if (cache.current.size > 600) cache.current.clear();
  }, [baseKey]);

  const played = useMemo(() => line.slice(0, cursor), [line, cursor]);
  const board = useMemo(() => (base ? replay(base.size, base.setup, [...base.moves, ...played]) : null), [base, played]);
  const toPlay: Color = played.length ? other(played[played.length - 1].color) : base?.toPlay ?? 1;
  // Cache entries are per start position and line, so switching problems never mixes them up.
  const keyOf = (moves: Move[]) => `${baseKey}#${lineKey(moves)}`;
  const key = keyOf(played);

  useEffect(() => {
    if (!active || !base || !board) return;
    if (cache.current.get(key)?.searched) {
      setStatus('idle');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        markInteractive();
        const eng = getEngine() ?? (await startEngine());
        if (!eng) throw new Error('KataGo is not available. See Engine & Settings.');
        if (cancelled) return;
        const history = [...base.moves, ...played];
        const req = { size: base.size, komi: base.komi, moves: engineMoves(base.setup, history), toPlay };
        const legal = (l: Loc) => board.isLegal(l, toPlay);
        // The starting position keeps the numbers of its stored deep analysis (the ones the
        // problem was chosen and graded with); the network still supplies heat map and territory.
        const stored = played.length === 0 && rootEval?.depth === 'deep' && rootEval.toPlay === toPlay && rootEval.candidates?.some((c) => c.winrate !== undefined) ? rootEval : null;
        let ev = cache.current.get(key);
        if (!ev) {
          setStatus('thinking');
          markInteractive();
          const net = processRawOutput(await eng.evalRaw(req, true), toPlay, legal, eng.postProcess);
          ev = { bWin: net.bWin, bLead: net.bLead, policy: net.policy, ownership: net.ownership ?? null, candidates: [], pv: [], searched: false };
          if (!stored) {
            cache.current.set(key, ev);
            setVersion((v) => v + 1);
          }
        }
        if (stored) {
          const candidates = (stored.candidates ?? [])
            .filter((c) => c.winrate !== undefined)
            .sort((x, y) => (y.visits ?? 0) - (x.visits ?? 0) || (y.winrate ?? 0) - (x.winrate ?? 0))
            .slice(0, 6);
          cache.current.set(key, { ...ev, ...searchedValue(stored), candidates, pv: stored.pv, searched: true });
          setVersion((v) => v + 1);
          if (!cancelled) setStatus('idle');
          return;
        }
        if (cancelled) return;
        setStatus('searching');
        markInteractive(10_000);
        const cpu = eng.info.backend === 'cpu';
        const pol = topPolicy(ev.policy, 12);
        const fast: PositionEval = {
          key,
          toPlay,
          bWin: ev.bWin,
          bLead: ev.bLead,
          policy: pol,
          bestLoc: pol[0]?.loc ?? PASS,
          pv: [],
          visits: 1,
          depth: 'fast',
          engine: eng.info,
          analyzedAt: Date.now(),
        };
        const deep = await evaluateDeep(eng, { size: base.size, komi: base.komi, setup: base.setup, history, toPlay, board }, fast, {
          visits: cpu ? 10 : 64,
          maxMs: cpu ? 5000 : 4000,
          candidateCount: 5,
        });
        const value = searchedValue({ bWin: ev.bWin, bLead: ev.bLead, toPlay, candidates: deep.candidates });
        const withSearch: LiveEval = { ...ev, ...value, candidates: (deep.candidates ?? []).slice(0, 6), pv: deep.pv, searched: true };
        cache.current.set(key, withSearch);
        setVersion((v) => v + 1);
        if (!cancelled) setStatus('idle');
      } catch (e) {
        if (cancelled) return;
        setStatus('error');
        setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, retry]);

  const play = useCallback(
    (loc: Loc) => {
      if (!board) return;
      if (loc !== PASS && !board.isLegal(loc, toPlay)) return;
      const next = [...played, { color: toPlay, loc }];
      // Replaying the move that is next in the line keeps the rest of it (redo).
      if (line[cursor] && line[cursor].loc === loc && line[cursor].color === toPlay) setCursor(cursor + 1);
      else {
        setLine(next);
        setCursor(next.length);
      }
    },
    [board, toPlay, played, line, cursor],
  );

  const history = useMemo(() => {
    const out: (number | null)[] = [];
    for (let i = 0; i <= line.length; i++) out.push(cache.current.get(keyOf(line.slice(0, i)))?.bWin ?? null);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, version, baseKey]);

  return {
    base,
    board,
    toPlay,
    line,
    cursor,
    played,
    eval: cache.current.get(key) ?? null,
    history,
    status,
    error,
    play,
    undo: () => setCursor((c) => Math.max(0, c - 1)),
    redo: () => setCursor((c) => Math.min(line.length, c + 1)),
    reset: () => setCursor(0),
    goTo: (n: number) => setCursor(Math.max(0, Math.min(line.length, n))),
    retry: () => setRetry((r) => r + 1),
  };
}

export type AnalysisState = ReturnType<typeof useAnalysis>;

export interface AnalysisView {
  heat: boolean;
  territory: boolean;
  best: boolean;
}

export function useAnalysisView() {
  const [view, setView] = useState<AnalysisView>(() => {
    try {
      return { heat: true, territory: false, best: true, ...JSON.parse(localStorage.getItem('dop.analysisView') ?? '{}') };
    } catch {
      return { heat: true, territory: false, best: true };
    }
  });
  const toggle = (k: keyof AnalysisView) =>
    setView((v) => {
      const next = { ...v, [k]: !v[k] };
      try {
        localStorage.setItem('dop.analysisView', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  return [view, toggle] as const;
}

/** The board half of the analysis board. */
export function AnalysisBoard({ a, view, hoverPv }: { a: AnalysisState; view: AnalysisView; hoverPv?: Loc[] | null }) {
  if (!a.base || !a.board) return null;
  const ev = a.eval;
  const marks: Mark[] = [];
  if (hoverPv?.length) {
    hoverPv.slice(0, 12).forEach((l, i) => l !== PASS && marks.push({ loc: l, kind: 'pv', label: String(i + 1) }));
  } else if (ev && view.best) {
    const cands = ev.candidates.length ? ev.candidates : topPolicy(ev.policy, 5).map((p) => ({ loc: p.loc, prior: p.p }) as Candidate);
    cands.slice(0, 6).forEach((c, i) => {
      if (c.loc === PASS) return;
      const label = c.winrate !== undefined ? String(Math.round(c.winrate * 100)) : String(i + 1);
      marks.push({ loc: c.loc, kind: i === 0 ? 'best' : 'cand', label });
    });
  }
  const last = a.played.length ? a.played[a.played.length - 1].loc : a.base.moves.length ? a.base.moves[a.base.moves.length - 1].loc : null;
  return (
    <Board
      size={a.base.size}
      stones={a.board.stones}
      lastMove={last}
      toPlay={a.toPlay}
      onPlay={(l) => a.play(l)}
      marks={marks}
      heat={ev && view.heat && !hoverPv?.length ? ev.policy : null}
      ownership={ev && view.territory ? ev.ownership : null}
      coords
      ariaLabel="Analysis board"
    />
  );
}

/** Black/white winrate bar with the score lead. */
export function WinBar({ bWin, bLead, pending }: { bWin: number | null; bLead: number | null; pending?: boolean }) {
  const b = bWin ?? 0.5;
  return (
    <div className={`winbar ${pending ? 'pending' : ''}`} aria-label={bWin === null ? 'Winrate unknown' : `Black ${fmtPct(b, 1)}, White ${fmtPct(1 - b, 1)}`}>
      <div className="winbar-track">
        <span className="winbar-b" style={{ width: `${b * 100}%` }} />
      </div>
      <div className="winbar-labels">
        <span>
          <i className="stone-dot b" /> Black {bWin === null ? '…' : fmtPct(b, 1)}
        </span>
        <span className="winbar-lead">{bLead === null ? '' : `${bLead >= 0 ? 'B' : 'W'}+${Math.abs(bLead).toFixed(1)}`}</span>
        <span>
          White {bWin === null ? '…' : fmtPct(1 - b, 1)} <i className="stone-dot w" />
        </span>
      </div>
    </div>
  );
}

/** Small line chart of Black's winrate along the moves tried on the analysis board. */
export function LineGraph({ values, cursor, onPick }: { values: (number | null)[]; cursor: number; onPick?: (i: number) => void }) {
  const W = 300, H = 64;
  const n = Math.max(values.length - 1, 1);
  const pts = values.map((v, i) => (v === null ? null : ([(i / n) * W, H - v * H] as const)));
  let d = '';
  pts.forEach((p) => {
    if (p) d += `${d ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  });
  return (
    <svg className="linegraph" viewBox={`-6 -6 ${W + 12} ${H + 12}`} preserveAspectRatio="none" role="img" aria-label="Winrate along the tested moves">
      <line className="mid" x1={0} x2={W} y1={H / 2} y2={H / 2} />
      {d && <path className="line" d={d} />}
      {pts.map((p, i) =>
        p ? (
          <circle key={i} className={`pt ${i === cursor ? 'cur' : ''}`} cx={p[0]} cy={p[1]} r={i === cursor ? 5 : 3} onClick={() => onPick?.(i)} style={{ cursor: onPick ? 'pointer' : undefined }} />
        ) : null,
      )}
    </svg>
  );
}

/** The controls and numbers of the analysis board. */
export function AnalysisPanel({
  a,
  view,
  onToggle,
  onClose,
  closeLabel = 'Back to the problem',
  onHoverPv,
  note,
}: {
  a: AnalysisState;
  view: AnalysisView;
  onToggle: (k: keyof AnalysisView) => void;
  onClose?: () => void;
  closeLabel?: string;
  onHoverPv?: (pv: Loc[] | null) => void;
  note?: string;
}) {
  const engine = useStore((s) => s.engine);
  const ev = a.eval;
  const size = a.base?.size ?? 19;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') a.undo();
      else if (e.key === 'ArrowRight') a.redo();
      else if (e.key === 'Home') a.reset();
      else if (e.key === 'Escape' && onClose) onClose();
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    // Capture phase: the practice pages' own keys (Enter to commit) must not fire underneath.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [a, onClose]);

  const thinking = a.status === 'thinking' || a.status === 'searching';
  const loadingEngine = engine.status === 'loading' || engine.status === 'detecting';
  return (
    <div className="panel analysis-panel stack">
      <div className="spread">
        <h3 className="with-icon">
          <span className="live-dot" data-on={thinking || loadingEngine ? '1' : '0'} /> Analysis board
        </h3>
        {onClose && (
          <button className="btn small" onClick={onClose}>
            {closeLabel}
          </button>
        )}
      </div>
      <WinBar bWin={ev?.bWin ?? null} bLead={ev?.bLead ?? null} pending={!ev?.searched} />
      <div className="small dim">
        {a.status === 'error' ? (
          <span className="bad">
            {a.error}{' '}
            <button className="btn small" onClick={a.retry}>
              Try again
            </button>
          </span>
        ) : loadingEngine ? (
          engine.progress?.stage === 'download' ? (
            `Downloading KataGo's network… ${engine.progress.total ? Math.round((engine.progress.loaded / engine.progress.total) * 100) + '%' : Math.round(engine.progress.loaded / 1e6) + ' MB'}`
          ) : (
            'Starting KataGo…'
          )
        ) : a.status === 'thinking' ? (
          'KataGo is reading the position…'
        ) : a.status === 'searching' ? (
          'Searching the best moves…'
        ) : (
          <>
            {a.toPlay === 1 ? 'Black' : 'White'} to play. Tap the board to try a move; both colours alternate.
          </>
        )}
      </div>

      {ev && ev.candidates.length > 0 && (
        <table className="data cands">
          <thead>
            <tr>
              <th>Move</th>
              <th>Win</th>
              <th>Score</th>
              <th>Visits</th>
            </tr>
          </thead>
          <tbody>
            {ev.candidates.map((c, i) => (
              <tr
                key={c.loc}
                className="click"
                onClick={() => a.play(c.loc)}
                onMouseEnter={() => onHoverPv?.(c.pv?.length ? c.pv : [c.loc])}
                onMouseLeave={() => onHoverPv?.(null)}
              >
                <td className={i === 0 ? 'kata strong' : ''}>{locToGtp(c.loc, size)}</td>
                <td className="mono">{c.winrate !== undefined ? fmtPct(c.winrate, 1) : '—'}</td>
                <td className="mono">{c.scoreLead !== undefined ? `${c.scoreLead >= 0 ? '+' : ''}${c.scoreLead.toFixed(1)}` : '—'}</td>
                <td className="mono muted">{c.visits ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {a.line.length > 0 && (
        <div className="stack tight">
          <div className="tiny muted">Black's winrate along your test moves</div>
          <LineGraph values={a.history} cursor={a.cursor} onPick={a.goTo} />
          <div className="line-moves">
            <button className={`chip click ${a.cursor === 0 ? 'on' : ''}`} onClick={a.reset}>
              start
            </button>
            {a.line.map((m, i) => (
              <button key={i} className={`chip click ${m.color === 1 ? 'b' : 'w'} ${i + 1 === a.cursor ? 'on' : ''} ${i >= a.cursor ? 'ahead' : ''}`} onClick={() => a.goTo(i + 1)}>
                {i + 1}. {m.loc === PASS ? 'pass' : locToGtp(m.loc, size)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="row wrap">
        <button className="btn small" onClick={a.undo} disabled={a.cursor === 0} title="Undo (←)">
          ◀ Undo
        </button>
        <button className="btn small" onClick={a.redo} disabled={a.cursor >= a.line.length} title="Redo (→)">
          Redo ▶
        </button>
        <button className="btn small" onClick={a.reset} disabled={a.cursor === 0} title="Back to the start (Home)">
          ⟲ Reset
        </button>
        <button className="btn small ghost" onClick={() => a.play(PASS)}>
          Pass
        </button>
      </div>
      <div className="row wrap toggles">
        <label className="toggle">
          <input type="checkbox" checked={view.heat} onChange={() => onToggle('heat')} /> Heat map
        </label>
        <label className="toggle">
          <input type="checkbox" checked={view.territory} onChange={() => onToggle('territory')} /> Territory
        </label>
        <label className="toggle">
          <input type="checkbox" checked={view.best} onChange={() => onToggle('best')} /> Best moves
        </label>
      </div>
      {note && <p className="tiny muted">{note}</p>}
    </div>
  );
}
