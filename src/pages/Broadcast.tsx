import { memo, useEffect, useMemo, useState } from 'react';
import { Board } from '../components/Board';
import { WinBar } from '../components/Analysis';
import { candidateMarks, CandidateTable, type ShownCandidate } from '../components/Live';
import { fmtPct, WinrateGraph } from '../components/common';
import { BrandSpinner } from '../components/Brand';
import { replay } from '../lib/go/board';
import { locToGtp } from '../lib/go/coords';
import { PASS } from '../lib/go/types';
import { loadBroadcast, type BroadcastFile } from '../lib/broadcast/data';
import {
  allTables,
  makeSchedule,
  MOVE_MS,
  PHASE_LABEL,
  showingCandidates,
  showingMoves,
  TABLES,
  tableAt,
  valueAt,
  type LiveGame,
  type Phase,
  type Schedule,
} from '../lib/broadcast/schedule';
import { canClaimBonus, claimBonus, DAILY_BONUS, loadWallet, oddsFor, placeBet, refill, settleBets, useWallet, type Bet } from '../state/bets';
import { toast } from '../state/store';
import { go, href } from '../router';
import './broadcast.css';

/** The broadcast pool and a clock that ticks with it; open bets settle as their games end. */
function useBroadcast() {
  const [pool, setPool] = useState<BroadcastFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true;
    loadBroadcast()
      .then((p) => alive && setPool(p))
      .catch((e) => alive && setError((e as Error).message));
    void loadWallet();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const sched = useMemo(() => (pool && pool.games.length ? makeSchedule(pool) : null), [pool]);
  const loaded = useWallet((s) => s.loaded);
  const tick = Math.floor(now / 1000);
  useEffect(() => {
    if (!sched || !loaded) return;
    for (const b of settleBets(sched)) {
      const vs = `${b.black} vs ${b.white}`;
      if (b.status === 'won') toast(`Bet won: +${(b.payout ?? 0) - b.stake} coins on ${vs} (${b.result}).`, 'info');
      else if (b.status === 'lost') toast(`Bet lost: −${b.stake} coins on ${vs} (${b.result}).`, 'info');
      else toast(`The broadcast was refreshed; your ${b.stake} coins on ${vs} were returned.`, 'info');
    }
  }, [sched, loaded, tick]);
  return { pool, sched, error, now };
}

export function Broadcast({ table }: { table?: string }) {
  const { pool, sched, error, now } = useBroadcast();
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
  if (Number.isInteger(t) && t >= 0 && t < TABLES) return <Watch sched={sched} table={t} now={now} />;
  return <Lobby sched={sched} now={now} engine={pool.engine} />;
}

// ------------------------------------------------------------------ the lobby: every table at once

const FILTERS: { id: Phase | 'all'; label: string }[] = [
  { id: 'all', label: 'All tables' },
  { id: 'opening', label: 'Opening' },
  { id: 'middle', label: 'Middle game' },
  { id: 'endgame', label: 'Endgame' },
];

function Lobby({ sched, now, engine }: { sched: Schedule; now: number; engine: string }) {
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
            KataGo plays itself on {TABLES} tables, a move every {MOVE_MS / 1000} seconds. It picks freely among moves that lose nothing, so no two games are alike and none has a blunder. Everyone
            watching sees the same move at the same moment.
          </p>
        </div>
        <WalletChip />
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
          <TableCard key={g.table} g={g} />
        ))}
        {!shown.length && <div className="empty">No table is in that phase right now.</div>}
      </div>
      <BetsPanel />
      <p className="tiny muted">
        {engine}. Games are played by KataGo ahead of time and broadcast on a shared clock; each one comes round again later in another orientation between other players. Coins are virtual and
        stay in this browser.
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

const TableCard = memo(function TableCard({ g }: { g: LiveGame }) {
  const { stones, last } = useStones(g);
  const v = valueAt(g.game, g.shown);
  const done = g.shown >= g.total;
  return (
    <a className={`bc-card panel click ${done ? 'done' : ''}`} href={href(`live/${g.table}`)} aria-label={`Table ${g.table + 1}: ${g.black} against ${g.white}`}>
      <div className="bc-card-head">
        <span className="bc-table">Table {g.table + 1}</span>
        <span className={`chip bc-phase ${g.phase}`}>{PHASE_LABEL[g.phase]}</span>
      </div>
      <div className="bc-card-board">
        <Board size={g.game.size} stones={stones} lastMove={last === PASS ? null : last} detail="lite" ariaLabel={`Table ${g.table + 1}`} />
        {done && (
          <div className="bc-result">
            <strong>{resultText(g)}</strong>
            <span>Next game in {Math.ceil(g.nextIn / 1000)}s</span>
          </div>
        )}
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

function Watch({ sched, table, now }: { sched: Schedule; table: number; now: number }) {
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') go(`live/${(table + 1) % TABLES}`);
      else if (e.key === 'ArrowLeft') go(`live/${(table + TABLES - 1) % TABLES}`);
      else if (e.key === 'Escape') go('live');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [table]);

  return (
    <div className="stage bc-watch">
      <div className="board-wrap">
        <div className="bc-board-frame">
          <Board
            size={size}
            stones={stones}
            lastMove={last === PASS ? null : last}
            candidates={showCands && cands.length ? candidateMarks(cands, 4) : null}
            coords
            ariaLabel={`Table ${table + 1}`}
          />
          {done && (
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
            <a className="btn small ghost" href={href('live')}>
              ← All tables
            </a>
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

        <BetSlip g={g} />

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

// ------------------------------------------------------------------ betting

function WalletChip() {
  const w = useWallet((s) => s.wallet);
  const open = w.bets.filter((b) => b.status === 'open').reduce((a, b) => a + b.stake, 0);
  return (
    <div className="bc-wallet" title="Virtual coins, kept in this browser">
      <span className="bc-coin" aria-hidden />
      <strong className="mono">{w.coins.toLocaleString()}</strong>
      <span className="tiny muted">coins{open ? ` · ${open} riding` : ''}</span>
    </div>
  );
}

const STAKES = [10, 50, 100, 250];

function BetSlip({ g }: { g: LiveGame }) {
  const w = useWallet((s) => s.wallet);
  const [stake, setStake] = useState(50);
  const done = g.shown >= g.total;
  const v = valueAt(g.game, g.shown);
  const mine = w.bets.filter((b) => b.key === g.key);
  const bet = (side: 1 | 2) => {
    const err = placeBet(g, side, stake, side === 1 ? v.bWin : 1 - v.bWin);
    if (err) toast(err, 'error');
  };
  return (
    <div className="panel stack bc-slip">
      <div className="spread">
        <h3>Who will win?</h3>
        <WalletChip />
      </div>
      {done ? (
        <p className="small dim">Betting opens again when the next game starts.</p>
      ) : (
        <>
          <div className="bc-sides">
            {([1, 2] as const).map((side) => {
              const p = side === 1 ? v.bWin : 1 - v.bWin;
              return (
                <button key={side} className="bc-side" onClick={() => bet(side)} disabled={stake > w.coins || stake <= 0}>
                  <span>
                    <i className={`stone-dot ${side === 1 ? 'b' : 'w'}`} /> {side === 1 ? g.black : g.white}
                  </span>
                  <strong className="mono">×{oddsFor(p).toFixed(2)}</strong>
                  <span className="tiny muted">{fmtPct(p)} to win</span>
                </button>
              );
            })}
          </div>
          <div className="row wrap">
            <label className="small">
              Stake{' '}
              <input type="number" min={1} max={w.coins} value={stake} onChange={(e) => setStake(Math.max(0, Math.floor(Number(e.target.value) || 0)))} style={{ width: 90 }} />
            </label>
            {STAKES.map((s) => (
              <button key={s} className={`chip click ${stake === s ? 'on' : ''}`} onClick={() => setStake(s)} disabled={s > w.coins}>
                {s}
              </button>
            ))}
            <button className="chip click" onClick={() => setStake(w.coins)} disabled={!w.coins}>
              all in
            </button>
          </div>
          <p className="tiny muted">Odds are fixed when you bet, from KataGo's winrate at that move. A win pays the stake times the odds.</p>
        </>
      )}
      {mine.length > 0 && (
        <div className="stack tight">
          {mine.map((b) => (
            <BetRow key={b.id} b={b} />
          ))}
        </div>
      )}
      <Refills />
    </div>
  );
}

function BetRow({ b, showGame }: { b: Bet; showGame?: boolean }) {
  const side = b.side === 1 ? b.black : b.white;
  const tone = b.status === 'won' ? 'good' : b.status === 'lost' ? 'bad' : '';
  return (
    <div className="bc-bet">
      <span>
        <i className={`stone-dot ${b.side === 1 ? 'b' : 'w'}`} /> <strong>{side}</strong>
        {showGame && (
          <span className="muted">
            {' '}
            · <a href={href(`live/${b.table}`)}>table {b.table + 1}</a>
          </span>
        )}
        <span className="muted tiny">
          {' '}
          · {b.stake} at ×{b.odds.toFixed(2)} on move {b.atMove}
        </span>
      </span>
      <span className={`chip ${tone}`}>
        {b.status === 'open' ? `pays ${Math.floor(b.stake * b.odds)}` : b.status === 'won' ? `+${(b.payout ?? 0) - b.stake}` : b.status === 'lost' ? `−${b.stake}` : 'returned'}
      </span>
    </div>
  );
}

function Refills() {
  const w = useWallet((s) => s.wallet);
  const broke = w.coins < 10 && !w.bets.some((b) => b.status === 'open');
  if (!canClaimBonus(w) && !broke) return null;
  return (
    <div className="row wrap">
      {canClaimBonus(w) && (
        <button className="btn small" onClick={claimBonus}>
          Collect today's {DAILY_BONUS} coins
        </button>
      )}
      {broke && (
        <button className="btn small" onClick={refill}>
          Out of coins: start again with 500
        </button>
      )}
    </div>
  );
}

function BetsPanel() {
  const w = useWallet((s) => s.wallet);
  const open = w.bets.filter((b) => b.status === 'open');
  const settled = w.bets.filter((b) => b.status !== 'open').slice(0, 12);
  const wins = w.bets.filter((b) => b.status === 'won').length;
  const losses = w.bets.filter((b) => b.status === 'lost').length;
  return (
    <div className="panel stack">
      <div className="spread">
        <h3>Your bets</h3>
        <span className="small muted">
          {wins + losses ? `${wins} won · ${losses} lost · net ${w.won - w.lost >= 0 ? '+' : '−'}${Math.abs(w.won - w.lost)}` : 'Open a table to bet on who wins.'}
        </span>
      </div>
      {open.length > 0 && (
        <div className="stack tight">
          <div className="tiny muted">Riding</div>
          {open.map((b) => (
            <BetRow key={b.id} b={b} showGame />
          ))}
        </div>
      )}
      {settled.length > 0 && (
        <div className="stack tight">
          <div className="tiny muted">Settled</div>
          {settled.map((b) => (
            <BetRow key={b.id} b={b} showGame />
          ))}
        </div>
      )}
      <Refills />
    </div>
  );
}

