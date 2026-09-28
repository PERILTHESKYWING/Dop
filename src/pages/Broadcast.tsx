import { memo, useEffect, useMemo, useState } from 'react';
import { Board } from '../components/Board';
import { WinBar } from '../components/Analysis';
import { candidateMarks, CandidateTable, type ShownCandidate } from '../components/Live';
import { EvalToggle, fmtPct, FocusEval, FocusToggle, useEvalPref, useFocusMode, WinrateGraph } from '../components/common';
import { BrandSpinner } from '../components/Brand';
import { ClassPill } from '../components/MoveBadge';
import { replay } from '../lib/go/board';
import { locToGtp } from '../lib/go/coords';
import { PASS } from '../lib/go/types';
import { BROADCAST_FLOORS, DEFAULT_FLOOR, loadBroadcast, type BroadcastFile } from '../lib/broadcast/data';
import {
  allTables,
  makeSchedule,
  MOVE_MS,
  PHASE_LABEL,
  showingCandidates,
  showingMoves,
  moveClassAt,
  TABLES,
  tableAt,
  valueAt,
  type LiveGame,
  type Phase,
  type Schedule,
} from '../lib/broadcast/schedule';
import { go, href } from '../router';
import './broadcast.css';
import { BackLink } from '../components/ControlSheet';

const SPEEDS = [0.5, 1, 2, 4];

/** Playback speed for this viewer only: 1x tracks the real wall clock (what everyone else
 * sees); any other speed runs a private virtual clock, so it never desyncs other viewers. */
function useSpeed() {
  const [speed, setSpeed] = useState(() => {
    const n = Number(localStorage.getItem('dop.broadcastSpeed'));
    return SPEEDS.includes(n) ? n : 1;
  });
  const set = (n: number) => {
    setSpeed(n);
    try {
      localStorage.setItem('dop.broadcastSpeed', String(n));
    } catch {
      /* ignore */
    }
  };
  return [speed, set] as const;
}

/** The floor (minimum losing-side winrate, percent) this viewer wants. */
function useFloor() {
  const [floor, setFloor] = useState(() => {
    const v = localStorage.getItem('dop.broadcastFloor');
    const n = v === null ? NaN : Number(v);
    return (BROADCAST_FLOORS as readonly number[]).includes(n) ? n : DEFAULT_FLOOR;
  });
  const set = (n: number) => {
    setFloor(n);
    try {
      localStorage.setItem('dop.broadcastFloor', String(n));
    } catch {
      /* ignore */
    }
  };
  return [floor, set] as const;
}

/** The broadcast pool and a clock that ticks with it, at the viewer's chosen speed and floor. */
function useBroadcast(speed: number, floor: number) {
  const [pool, setPool] = useState<BroadcastFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true;
    loadBroadcast()
      .then((p) => alive && setPool(p))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (speed === 1) {
      // Track the real clock exactly, so every viewer at 1x sees the same move at once.
      const t = setInterval(() => setNow(Date.now()), 250);
      return () => clearInterval(t);
    }
    let last = performance.now();
    const t = setInterval(() => {
      const p = performance.now();
      const dt = p - last;
      last = p;
      setNow((n) => n + dt * speed);
    }, 100);
    return () => clearInterval(t);
  }, [speed]);
  // The floor is applied here, in the schedule: every viewer at the same floor sees the same tables.
  const sched = useMemo(() => (pool ? makeSchedule(pool, floor) : null), [pool, floor]);
  return { pool, sched, error, now };
}

export function Broadcast({ table }: { table?: string }) {
  const [speed, setSpeed] = useSpeed();
  const [floor, setFloor] = useFloor();
  const { pool, sched, error, now } = useBroadcast(speed, floor);
  const t = table !== undefined && table !== '' ? Number(table) : NaN;
  if (error)
    return (
      <div className="page">
        <div className="empty">The live games could not be loaded ({error}).</div>
      </div>
    );
  if (!sched || !pool)
    return (
      <div className="page">
        <div className="empty">
          <BrandSpinner /> Tuning in…
        </div>
      </div>
    );
  if (!sched.order.length)
    return (
      <div className="page bc-page">
        <div className="page-head">
          <div>
            <h1>Live AI games</h1>
          </div>
          <FloorControl floor={floor} onFloor={setFloor} />
        </div>
        <div className="empty">No game keeps the losing side above {floor}% past the opening. Pick a lower minimum.</div>
      </div>
    );
  if (Number.isInteger(t) && t >= 0 && t < TABLES) return <Watch sched={sched} table={t} now={now} speed={speed} onSpeed={setSpeed} floor={floor} onFloor={setFloor} />;
  return <Lobby sched={sched} now={now} engine={pool.engine} speed={speed} onSpeed={setSpeed} floor={floor} onFloor={setFloor} />;
}

/** 0.5x/1x/2x/4x playback for this viewer; 1x is the shared, real-time broadcast. */
function SpeedControl({ speed, onSpeed }: { speed: number; onSpeed: (n: number) => void }) {
  return (
    <div className="segmented bc-speed" role="tablist" aria-label="Playback speed">
      {SPEEDS.map((s) => (
        <button key={s} role="tab" aria-selected={speed === s} className={speed === s ? 'on' : ''} onClick={() => onSpeed(s)} title={s === 1 ? 'Real time, same as everyone else' : `${s}x, just for you`}>
          {s}×
        </button>
      ))}
    </div>
  );
}

/** The minimum winrate the losing side is held to: a game leaves its table 10 seconds after
 * the losing side drops under it, and the next game takes its place. */
function FloorControl({ floor, onFloor }: { floor: number; onFloor: (n: number) => void }) {
  return (
    <label className="small bc-floor-label" title="A game leaves its table 10 seconds after the losing side drops under this">
      Losing side keeps at least{' '}
      <select value={floor} onChange={(e) => onFloor(Number(e.target.value))} aria-label="Minimum losing-side winrate">
        {BROADCAST_FLOORS.map((f) => (
          <option key={f} value={f}>
            {f ? `${f}%` : 'no minimum'}
          </option>
        ))}
      </select>
    </label>
  );
}

/** "White dropped under 30%, leaving in 7s" once the losing side is under the floor. */
function Leaving({ g, floor, big }: { g: LiveGame; floor: number; big?: boolean }) {
  if (!g.leaving) return null;
  const who = g.leaving.side === 1 ? g.black : g.white;
  return (
    <div className={`bc-result bc-leaving ${big ? 'big' : ''}`}>
      <strong>
        {who} fell under {floor}%
      </strong>
      <span>Next game in {Math.max(0, Math.ceil(g.leaving.in / 1000))}s</span>
    </div>
  );
}

// ------------------------------------------------------------------ the lobby: every table at once

const FILTERS: { id: Phase | 'all'; label: string }[] = [
  { id: 'all', label: 'All tables' },
  { id: 'opening', label: 'Opening' },
  { id: 'middle', label: 'Middle game' },
  { id: 'endgame', label: 'Endgame' },
];

function Lobby({
  sched,
  now,
  engine,
  speed,
  onSpeed,
  floor,
  onFloor,
}: {
  sched: Schedule;
  now: number;
  engine: string;
  speed: number;
  onSpeed: (n: number) => void;
  floor: number;
  onFloor: (n: number) => void;
}) {
  const [filter, setFilter] = useState<Phase | 'all'>('all');
  const tables = allTables(sched, now);
  const shown = tables.filter((g) => filter === 'all' || g.phase === filter || (filter === 'endgame' && g.phase === 'finished'));
  return (
    <div className="page bc-page">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <span className="bc-onair" /> Live broadcast
          </div>
          <h1>Live AI games</h1>
          <p className="sub">
            KataGo plays itself on {TABLES} tables, a move every {MOVE_MS / 1000} seconds. Both sides choose only among KataGo's own top moves, so no two games are alike and neither side ends up
            with an overwhelming position. For self-improvement, not betting; a leaderboard may come later.
          </p>
        </div>
        <div className="stack tight" style={{ alignItems: 'flex-end' }}>
          <SpeedControl speed={speed} onSpeed={onSpeed} />
          <FloorControl floor={floor} onFloor={onFloor} />
        </div>
      </div>
      <div className="panel bc-filter-wrap">
      <div className="segmented bc-filter" role="tablist" aria-label="Game phase">
        {FILTERS.map((f) => {
          const n = f.id === 'all' ? tables.length : tables.filter((g) => g.phase === f.id || (f.id === 'endgame' && g.phase === 'finished')).length;
          return (
            <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
              <strong>{f.label}</strong>
              <span>
                {n} table{n === 1 ? '' : 's'}
              </span>
            </button>
          );
        })}
      </div>
      </div>
      <div className="bc-grid">
        {shown.map((g) => (
          <TableCard key={g.table} g={g} floor={sched.floor} />
        ))}
        {!shown.length && <div className="empty">No table is in that phase right now.</div>}
      </div>
      <p className="tiny muted">
        {engine}. Games are played by KataGo ahead of time; at 1x everyone watching sees the same move at the same moment, and each game comes round again later in another orientation between
        other players. Pick a faster or slower speed above to watch at your own pace instead.
      </p>
    </div>
  );
}

function useStones(g: LiveGame) {
  const moves = useMemo(() => showingMoves(g), [g.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = g.shown;
  return useMemo(() => {
    const b = replay(g.game.size, [], moves.map((loc, i) => ({ color: (i % 2 === 0 ? 1 : 2) as 1 | 2, loc })).slice(0, n));
    return { moves, stones: b.stones, last: n > 0 ? moves[n - 1] : null, captures: b.captures };
  }, [moves, n, g.game.size]);
}

const TableCard = memo(function TableCard({ g, floor }: { g: LiveGame; floor: number }) {
  const { stones, last } = useStones(g);
  const v = valueAt(g.game, g.shown);
  const done = g.shown >= g.total;
  return (
    <a className={`bc-card panel click ${done ? 'done' : ''} ${g.leaving ? 'leaving' : ''}`} href={href(`live/${g.table}`)} aria-label={`Table ${g.table + 1}: ${g.black} against ${g.white}`}>
      <div className="bc-card-head">
        <span className="bc-table">Table {g.table + 1}</span>
        <span className={`chip bc-phase ${g.phase}`}>{PHASE_LABEL[g.phase]}</span>
      </div>
      <div className="bc-card-board">
        <Board size={g.game.size} stones={stones} lastMove={last === PASS ? null : last} detail="lite" ariaLabel={`Table ${g.table + 1}`} />
        {done && !g.leaving && (
          <div className="bc-result">
            <strong>{resultText(g)}</strong>
            <span>Next game in {Math.ceil(g.nextIn / 1000)}s</span>
          </div>
        )}
        <Leaving g={g} floor={floor} />
      </div>
      <div className="bc-mini-bar" aria-hidden>
        <i style={{ width: `${v.bWin * 100}%` }} />
      </div>
      <div className="bc-card-players">
        {([1, 2] as const).map((c) => (
          <div key={c} className={!done && (g.shown % 2 === 0 ? 1 : 2) === c ? 'turn' : ''}>
            <i className={`stone-dot ${c === 1 ? 'b' : 'w'}`} />
            <span className="name">{c === 1 ? g.black : g.white}</span>
            <span className="mono">{fmtPct(c === 1 ? v.bWin : 1 - v.bWin)}</span>
          </div>
        ))}
      </div>
      <div className="bc-card-foot tiny muted">
        <span>Move {g.shown}</span>
        {!done && <MoveTimer g={g} />}
      </div>
    </a>
  );
});

function resultText(g: LiveGame) {
  const r = g.game.result;
  const who = r.startsWith('B') ? g.black : g.white;
  return r.endsWith('+R') ? `${who} wins by resignation` : `${who} wins by ${r.slice(2)} points`;
}

function Players({ g }: { g: LiveGame }) {
  const toPlay = g.shown % 2 === 0 ? 1 : 2;
  const done = g.shown >= g.total;
  return (
    <div className="bc-players">
      <span className={!done && toPlay === 1 ? 'turn' : ''}>
        <i className="stone-dot b" /> {g.black}
      </span>
      <span className="muted tiny">vs</span>
      <span className={!done && toPlay === 2 ? 'turn' : ''}>
        {g.white} <i className="stone-dot w" />
      </span>
    </div>
  );
}

/** A bar that fills until the next move lands (restarted by the move number). */
function MoveTimer({ g }: { g: LiveGame }) {
  return (
    <span className="bc-timer" aria-hidden>
      <i key={g.shown} style={{ animationDuration: `${MOVE_MS}ms`, animationDelay: `-${MOVE_MS - g.nextIn}ms` }} />
    </span>
  );
}

// ------------------------------------------------------------------ one table

function Watch({
  sched,
  table,
  now,
  speed,
  onSpeed,
  floor,
  onFloor,
}: {
  sched: Schedule;
  table: number;
  now: number;
  speed: number;
  onSpeed: (n: number) => void;
  floor: number;
  onFloor: (n: number) => void;
}) {
  const g = tableAt(sched, table, now);
  const { moves, stones, last, captures } = useStones(g);
  const [showCands, setShowCands] = useState(true);
  const done = g.shown >= g.total;
  const toPlay = g.shown % 2 === 0 ? 1 : 2;
  const v = valueAt(g.game, g.shown);
  const cands: ShownCandidate[] = done ? [] : showingCandidates(g, g.shown).map((c) => ({ ...c, prior: 0, pv: [c.loc] }));
  const wr = g.game.wr.slice(0, g.shown + 1).map((x) => x / 1000);
  const leads = g.game.lead.slice(0, g.shown + 1).map((x) => x / 10);
  const size = g.game.size;
  const lastClass = g.shown > 0 ? moveClassAt(g, moves, g.shown - 1) : null;
  const [focused, setFocused] = useFocusMode();
  const [evalOn, setEvalOn] = useEvalPref();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') go(`live/${(table + 1) % TABLES}`);
      else if (e.key === 'ArrowLeft') go(`live/${(table + TABLES - 1) % TABLES}`);
      else if (e.key === 'Escape') {
        if (focused) setFocused(false);
        else go('live');
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [table, focused, setFocused]);

  return (
    <div className={`stage bc-watch ${focused ? 'focused' : ''}`}>
      <FocusToggle focused={focused} onChange={setFocused} />
      {focused && <EvalToggle on={evalOn} onChange={setEvalOn} />}
      {focused && evalOn && (
        <FocusEval>
          <WinBar bWin={v.bWin} bLead={v.bLead} />
          <WinrateGraph values={wr} scores={leads} cursor={g.shown} />
        </FocusEval>
      )}
      <div className="board-wrap">
        <div className="bc-board-frame">
          <Board
            size={size}
            stones={stones}
            lastMove={last === PASS ? null : last}
            badge={last !== null && last !== PASS && lastClass ? { loc: last, cls: lastClass } : null}
            candidates={showCands && cands.length ? candidateMarks(cands, 4) : null}
            coords
            ariaLabel={`Table ${table + 1}`}
          />
          <Leaving g={g} floor={floor} big />
          {done && !g.leaving && (
            <div className="bc-result big">
              <strong>{resultText(g)}</strong>
              <span>{g.game.result}</span>
              <span className="tiny">Next game in {Math.max(0, Math.ceil(g.nextIn / 1000))}s</span>
            </div>
          )}
        </div>
      </div>
      <div className="side">
        <div className="panel stack">
          <div className="spread bc-watch-head">
            <BackLink href={href('live')} label="All tables" />
            <span className="bc-watch-title">
              <span className="bc-onair" />
              <strong>Table {table + 1}</strong>
              <span className={`chip bc-phase ${g.phase}`}>{PHASE_LABEL[g.phase]}</span>
            </span>
            <div className="row">
              <button className="btn small" onClick={() => go(`live/${(table + TABLES - 1) % TABLES}`)} aria-label="Previous table">
                ◀
              </button>
              <button className="btn small" onClick={() => go(`live/${(table + 1) % TABLES}`)} aria-label="Next table">
                ▶
              </button>
            </div>
          </div>
          <div className="spread wrap">
            <FloorControl floor={floor} onFloor={onFloor} />
            <SpeedControl speed={speed} onSpeed={onSpeed} />
          </div>
          <Players g={g} />
          <WinBar bWin={v.bWin} bLead={v.bLead} />
          <div className="spread tiny muted">
            <span>
              Move {g.shown}
              {g.shown > 0 && moves[g.shown - 1] !== undefined && ` · ${g.shown % 2 === 1 ? 'Black' : 'White'} ${locToGtp(moves[g.shown - 1], size)}`}
            </span>
            <span>
              captures ● {captures[1]} · ○ {captures[2]}
            </span>
          </div>
          {lastClass && (
            <div className="row small">
              <span className="dim">Last move</span>
              <ClassPill cls={lastClass} />
            </div>
          )}
          {!done && <MoveTimer g={g} />}
          <WinrateGraph values={wr} scores={leads} cursor={g.shown} />
          <div className="row wrap">
            <a className="btn small primary" href={href(`study?live=${encodeURIComponent(g.key)}&g=${encodeURIComponent(g.game.id)}&n=${g.shown}`)}>
              Study this position
            </a>
            <label className="toggle">
              <input type="checkbox" checked={showCands} onChange={(e) => setShowCands(e.target.checked)} /> Show what KataGo is weighing
            </label>
          </div>
        </div>

        {!done && cands.length > 0 && (
          <div className="panel stack">
            <h3>{toPlay === 1 ? g.black : g.white} is weighing</h3>
            <CandidateTable cands={cands} size={size} max={4} />
            <p className="tiny muted">Every move listed loses almost nothing; the players choose among them, so the most visited one is not always played.</p>
          </div>
        )}
        <p className="tiny muted">Komi {g.game.komi} · area scoring · ← → switch tables</p>
      </div>
    </div>
  );
}
