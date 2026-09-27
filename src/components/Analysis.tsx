import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board, type Mark } from './Board';
import { fmtPct } from './common';
import { DoppelLine, useCopy } from './Doppel';
import { candidateMarks, CandidateTable, fromSnapshot, fromStored, LiveHeader, lineOf, useLiveAnalysis, type ShownCandidate } from './Live';
import { searchedValue } from '../lib/analysis/analyzer';
import { topPolicy } from '../lib/engine/parse';
import { predictForPosition } from '../lib/profile/doppel';
import { replay } from '../lib/go/board';
import { locToGtp } from '../lib/go/coords';
import { engineKomi } from '../lib/go/rules';
import { other, PASS, type Color, type Loc, type Move } from '../lib/go/types';
import type { Candidate, PositionEval } from '../lib/types';
import type { LiveTarget } from '../state/live';
import { remember } from '../state/evalMemory';
import { useLiveMoveClass } from './LiveClass';
import { ClassPill } from './MoveBadge';

/** The position the analysis board starts from. */
export interface AnalysisBase {
  size: number;
  /** The game's komi; with `rules` it decides the komi KataGo scores with (go/rules.ts). */
  komi: number;
  rules?: string;
  setup: Move[];
  /** Moves that led to the position (the network sees recent history). */
  moves: Move[];
  toPlay: Color;
}

export interface LiveEval {
  /** Black's winrate and lead: the stored analysis at first, then KataGo's live search. */
  bWin: number;
  bLead: number;
  /** Probabilities over size*size + 1 points (pass last). */
  policy: Float32Array | null;
  ownership: Float32Array | null;
  /** KataGo's candidate moves (winrate and lead from the mover's side), most visits first. */
  candidates: Candidate[];
  shown: ShownCandidate[];
  pv: Loc[];
  visits: number;
  searched: boolean;
}

const lineKey = (line: Move[]) => line.map((m) => `${m.color}${m.loc}`).join(',');

function storedLive(e: PositionEval, size: number): LiveEval {
  const policy = new Float32Array(size * size + 1);
  for (const p of e.policy) policy[p.loc === PASS ? size * size : p.loc] = p.p;
  const shown = fromStored(e.candidates);
  return {
    ...searchedValue(e),
    policy,
    ownership: null,
    candidates: e.candidates ?? [],
    shown,
    pv: e.pv,
    visits: e.visits,
    searched: e.depth === 'deep',
  };
}

/**
 * A free-play board from any position, analysed live: KataGo keeps searching the position
 * on the board (winrate, score, candidates, heat map and territory refine as it reads),
 * and the tree follows the moves you try. `rootEval`, the stored analysis of the starting
 * position, is shown until the live search has read further than it, so the board opens
 * with the numbers the problem or game review showed.
 */
export function useAnalysis(base: AnalysisBase | null, active: boolean, rootEval?: PositionEval | null) {
  const [line, setLine] = useState<Move[]>([]);
  const [cursor, setCursor] = useState(0);
  const values = useRef(new Map<string, number>());
  const baseKey = base ? `${base.size}|${base.komi}|${base.rules ?? ''}|${lineKey(base.setup)}|${lineKey(base.moves)}|${base.toPlay}` : '';

  useEffect(() => {
    setLine([]);
    setCursor(0);
    if (values.current.size > 2000) values.current.clear();
  }, [baseKey]);

  const played = useMemo(() => line.slice(0, cursor), [line, cursor]);
  const board = useMemo(() => (base ? replay(base.size, base.setup, [...base.moves, ...played]) : null), [base, played]);
  const toPlay: Color = played.length ? other(played[played.length - 1].color) : base?.toPlay ?? 1;
  const keyOf = (moves: Move[]) => `an|${baseKey}#${lineKey(moves)}`;
  const key = keyOf(played);

  const target = useMemo<LiveTarget | null>(
    () =>
      base
        ? { key, size: base.size, komi: engineKomi(base.komi, base.rules), setup: base.setup, moves: [...base.moves, ...played], toPlay }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const live = useLiveAnalysis(active ? target : null, active);
  const snap = live.snap;
  const stored = base && played.length === 0 && rootEval && rootEval.toPlay === toPlay ? rootEval : null;

  let ev: LiveEval | null = null;
  if (snap && (!stored || snap.visits > stored.visits)) {
    const shown = fromSnapshot(snap);
    ev = {
      bWin: snap.bWin,
      bLead: snap.bLead,
      policy: snap.policy,
      ownership: snap.ownership,
      candidates: shown.map((c) => ({ loc: c.loc, prior: c.prior, winrate: c.winrate, scoreLead: c.scoreLead, visits: c.visits, pv: c.pv })),
      shown,
      pv: shown[0]?.pv ?? [],
      visits: snap.visits,
      searched: snap.visits > 1,
    };
  } else if (stored) {
    ev = storedLive(stored, base!.size);
    if (snap?.ownership) ev.ownership = snap.ownership;
  }
  if (ev) {
    values.current.set(key, ev.bWin);
    if (ev.visits > 1) remember(key, { toPlay, bWin: ev.bWin, bLead: ev.bLead, visits: ev.visits, cands: ev.shown.map((c) => ({ loc: c.loc, winrate: c.winrate, scoreLead: c.scoreLead, visits: c.visits })) });
  }

  // The class of the last move tried (Brilliant ... Blunder), from what KataGo read around it.
  const lastMove = played.length ? played[played.length - 1] : null;
  const lastClass = useLiveMoveClass(
    base && lastMove
      ? {
          parentKey: keyOf(played.slice(0, -1)),
          childKey: key,
          grandKey: played.length >= 2 ? keyOf(played.slice(0, -2)) : null,
          move: lastMove,
          prevMove: played.length >= 2 ? played[played.length - 2] : null,
          moveIndex: base.moves.length + played.length - 1,
          spec: () => ({
            size: base.size,
            komi: engineKomi(base.komi, base.rules),
            setup: base.setup,
            history: [...base.moves, ...played.slice(0, -1)],
            toPlay: lastMove.color,
            board: replay(base.size, base.setup, [...base.moves, ...played.slice(0, -1)]),
          }),
        }
      : null,
  );

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

  const history: (number | null)[] = [];
  for (let i = 0; i <= line.length; i++) history.push(values.current.get(keyOf(line.slice(0, i))) ?? null);

  const status: 'idle' | 'thinking' | 'searching' | 'error' =
    live.status === 'error' ? 'error' : !live.on ? 'idle' : live.status === 'starting' || !snap ? 'thinking' : live.status === 'thinking' ? 'searching' : 'idle';

  return {
    base,
    board,
    toPlay,
    line,
    cursor,
    played,
    eval: ev,
    snap,
    history,
    lastClass,
    status,
    error: live.error ?? null,
    play,
    undo: () => setCursor((c) => Math.max(0, c - 1)),
    redo: () => setCursor((c) => Math.min(line.length, c + 1)),
    reset: () => setCursor(0),
    goTo: (n: number) => setCursor(Math.max(0, Math.min(line.length, n))),
    retry: () => setCursor((c) => c),
  };
}

export type AnalysisState = ReturnType<typeof useAnalysis>;

export interface AnalysisView {
  heat: boolean;
  territory: boolean;
  best: boolean;
  /** How many rows the candidate-move list shows, user-set (see AnalysisPanel). */
  candidateCount: number;
}

const DEFAULT_VIEW: AnalysisView = { heat: true, territory: false, best: true, candidateCount: 8 };

export function useAnalysisView() {
  const [view, setView] = useState<AnalysisView>(() => {
    try {
      return { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem('dop.analysisView') ?? '{}') };
    } catch {
      return DEFAULT_VIEW;
    }
  });
  const setCandidateCount = (n: number) =>
    setView((v) => {
      const next = { ...v, candidateCount: Math.max(3, Math.min(20, n)) };
      try {
        localStorage.setItem('dop.analysisView', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  const toggle = (k: keyof Pick<AnalysisView, 'heat' | 'territory' | 'best'>) =>
    setView((v) => {
      const next = { ...v, [k]: !v[k] };
      try {
        localStorage.setItem('dop.analysisView', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  return [view, toggle, setCandidateCount] as const;
}

/** The board half of the analysis board. */
export function AnalysisBoard({ a, view, hoverPv, onHoverPv }: { a: AnalysisState; view: AnalysisView; hoverPv?: Loc[] | null; onHoverPv?: (pv: Loc[] | null) => void }) {
  if (!a.base || !a.board) return null;
  const ev = a.eval;
  const marks: Mark[] = [];
  let candidates = null;
  if (ev && view.best && !hoverPv?.length) {
    if (ev.shown.length) candidates = candidateMarks(ev.shown);
    else if (ev.policy) topPolicy(ev.policy, 5).forEach((p, i) => p.loc !== PASS && marks.push({ loc: p.loc, kind: i === 0 ? 'best' : 'cand', label: String(i + 1) }));
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
      candidates={candidates}
      onCandidateHover={onHoverPv ? (l) => onHoverPv(l === null ? null : ev?.shown.find((c) => c.loc === l)?.pv ?? null) : undefined}
      variation={hoverPv?.length ? lineOf(hoverPv, a.toPlay) : null}
      heat={ev && view.heat && !hoverPv?.length && !candidates ? ev.policy : null}
      ownership={ev && view.territory ? ev.ownership : null}
      badge={a.lastClass && a.played.length ? { loc: a.played[a.played.length - 1].loc, cls: a.lastClass } : null}
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
  onCandidateCount,
  onClose,
  closeLabel = 'Back to the problem',
  onHoverPv,
  note,
  copyColor,
}: {
  a: AnalysisState;
  view: AnalysisView;
  onToggle: (k: keyof Pick<AnalysisView, 'heat' | 'territory' | 'best'>) => void;
  /** Lets the user pick how many candidate moves the list below shows. */
  onCandidateCount?: (n: number) => void;
  onClose?: () => void;
  closeLabel?: string;
  onHoverPv?: (pv: Loc[] | null) => void;
  note?: string;
  /** The studied player's colour: on their turns the panel shows what their copy expects. */
  copyColor?: Color | null;
}) {
  const ev = a.eval;
  const size = a.base?.size ?? 19;
  const copy = useCopy();
  const copyTurn = !!copy.model && !!a.base && !!a.board && !!ev?.policy && copyColor === a.toPlay;
  const guess = useMemo(
    () =>
      copyTurn
        ? predictForPosition(copy.model, { size, setup: a.base!.setup, history: [...a.base!.moves, ...a.played], toPlay: a.toPlay, policy: ev!.policy!, board: a.board! })
        : [],
    // The network's policy for a position does not change while the search runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [copyTurn, copy.model, a.board, a.toPlay, !!ev?.policy],
  );

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

  return (
    <div className="panel analysis-panel stack">
      <div className="spread">
        <h3 className="with-icon">Analysis board</h3>
        {onClose && (
          <button className="btn small" onClick={onClose}>
            {closeLabel}
          </button>
        )}
      </div>
      <LiveHeader snap={a.snap} />
      <WinBar bWin={ev?.bWin ?? null} bLead={ev?.bLead ?? null} pending={!ev?.searched} />
      <div className="small dim">
        {a.toPlay === 1 ? 'Black' : 'White'} to play. Tap the board to try a move; both colours alternate.
      </div>
      {a.lastClass && a.played.length > 0 && (
        <div className="row small">
          <span className="dim">
            Last move {a.played[a.played.length - 1].color === 1 ? 'Black' : 'White'} {locToGtp(a.played[a.played.length - 1].loc, size)}
          </span>
          <ClassPill cls={a.lastClass} />
        </div>
      )}

      {ev && ev.shown.length > 0 && (
        <CandidateTable cands={ev.shown} size={size} onPick={(l) => a.play(l)} onHover={(c) => onHoverPv?.(c ? c.pv : null)} max={view.candidateCount} />
      )}
      {guess.length > 0 && <DoppelLine predictions={guess} size={size} who={copy.who} />}

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
        {onCandidateCount && (
          <label className="toggle">
            Top
            <input
              className="candidate-count"
              type="number"
              min={3}
              max={20}
              value={view.candidateCount}
              onChange={(e) => onCandidateCount(Number(e.target.value) || view.candidateCount)}
            />
            moves
          </label>
        )}
      </div>
      {note && <p className="tiny muted">{note}</p>}
    </div>
  );
}
