import { useEffect, useMemo } from 'react';
import { keyOf, loadLevel, measureLevel, levelOf, stopMeasuring, unmeasured, useLevel, type LevelTarget } from '../state/level';
import { useStore, toast } from '../state/store';
import { MAX_RANK, MIN_RANK, rankLabel, rankLabelWhole, rankRangeLabel, rankTier } from '../lib/level/ranks';
import type { LevelEstimate, PlayerLevel } from '../lib/level/model';
import type { LevelFeatures } from '../lib/level/stats';
import { fmtPct } from './common';
import { BrandSpinner } from './Brand';
import { corpus } from '../state/actions';
import './level.css';

const PHASE_LABEL = { opening: 'Opening', middlegame: 'Middle game', endgame: 'Endgame' } as const;

/** The studied player's analysed game sides (demo games while there are no own games). */
export function usePlayerTargets(): LevelTarget[] {
  const v = useStore((s) => s.corpusVersion);
  return useMemo(() => {
    const c = corpus();
    return c
      .gameOrder()
      .map((id) => c.games.get(id)!)
      .filter((g) => g.playerColor !== null)
      .map((g) => ({ game: g, color: g.playerColor! }));
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Level of whoever played these game sides: estimate, state, and a way to measure the rest. */
export function useLevelOf(targets: readonly LevelTarget[]) {
  const cal = useLevel((s) => s.calibration);
  const samples = useLevel((s) => s.samples);
  const measuring = useLevel((s) => s.measuring);
  const loaded = useLevel((s) => s.loaded);
  const analyses = useStore((s) => s.analyses);
  useEffect(() => void loadLevel(), []);
  const key = targets.map((t) => `${t.game.id}:${t.color}`).join(',');
  const level = useMemo(() => (cal ? levelOf(targets) : null), [cal, samples, analyses, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const todo = useMemo(() => (cal ? unmeasured(targets) : []), [cal, samples, analyses, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const measure = () =>
    measureLevel(targets).catch((e: Error) => toast(`Could not measure the level: ${e.message}`, 'error'));
  return { cal, loaded, level, todo, measuring, measure };
}

function Range({ e }: { e: LevelEstimate }) {
  // A strip from 18k to 12d (AI) with the estimate and its 80% range.
  const pos = (r: number) => ((r - MIN_RANK) / (MAX_RANK - MIN_RANK)) * 100;
  const ticks: [string, number][] = [['18k', -17], ['10k', -9], ['5k', -4], ['1k', 0], ['1d', 1], ['5d', 5], ['9d', 9], ['AI', 12]];
  return (
    <div className="lvl-strip" aria-hidden>
      <div className="lvl-strip-range" style={{ left: `${pos(e.low)}%`, width: `${Math.max(1.5, pos(e.high) - pos(e.low))}%` }} />
      <div className="lvl-strip-dot" style={{ left: `${pos(e.rank)}%` }} />
      <div className="lvl-strip-ticks">
        {ticks.map(([t, r]) => (
          <span key={t} style={{ left: `${pos(r)}%` }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function Trend({ values }: { values: number[] }) {
  if (values.length < 3) return null;
  const w = 160, h = 36;
  const lo = Math.min(...values) - 0.5, hi = Math.max(...values) + 0.5;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - lo) / (hi - lo)) * h}`).join(' ');
  return (
    <svg className="lvl-trend" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Level per game, oldest to newest">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Compare({ label, you, peers, fmt, lowerIsBetter }: { label: string; you: number; peers: number; fmt: (x: number) => string; lowerIsBetter?: boolean }) {
  const better = lowerIsBetter ? you < peers : you > peers;
  const close = Math.abs(you - peers) <= Math.abs(peers) * 0.08;
  return (
    <div className="lvl-cmp">
      <span className="tiny dim">{label}</span>
      <b className={close ? '' : better ? 'good' : 'bad'}>{fmt(you)}</b>
      <span className="tiny muted">peers {fmt(peers)}</span>
    </div>
  );
}

function PeerNumbers({ level }: { level: PlayerLevel }) {
  const p = level.peers?.features as LevelFeatures | undefined;
  if (!p) return null;
  const y = level.pooled;
  return (
    <div className="lvl-cmps">
      <Compare label="KataGo's first choice" you={y.top1} peers={p.top1} fmt={(x) => fmtPct(x)} />
      <Compare label="Points lost per move" you={y.loss} peers={p.loss} fmt={(x) => x.toFixed(2)} lowerIsBetter />
      <Compare label="Blunders (5+ pts)" you={y.blunders} peers={p.blunders} fmt={(x) => fmtPct(x, 1)} lowerIsBetter />
    </div>
  );
}

/**
 * The level card. `auto` starts measuring unmeasured games on its own (full pages); the
 * compact dashboard card asks first, since measuring loads a second engine.
 */
export function LevelPanel({ targets, who = 'your', auto = false, compact = false }: { targets: readonly LevelTarget[]; who?: string; auto?: boolean; compact?: boolean }) {
  const { cal, loaded, level, todo, measuring, measure } = useLevelOf(targets);
  useEffect(() => {
    if (auto && cal && todo.length && !measuring) void measure();
  }, [auto, cal, todo.length, !!measuring]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loaded) return <div className="lvl-empty tiny muted">Loading the rank calibration…</div>;
  if (!cal) return <div className="lvl-empty small dim">The rank calibration file is missing from this build, so levels can't be estimated.</div>;
  const e = level?.overall;
  const acc = cal.maeByGames;
  const mine = !!measuring && targets.some((t) => measuring.keys.includes(keyOf(t.game.id, t.color)));
  const progress = mine && measuring ? (
    <div className="lvl-measuring small">
      <BrandSpinner /> Measuring game {Math.min(measuring.done + 1, measuring.total)} of {measuring.total}
      {measuring.current ? ` · ${measuring.current}` : ''}
      <button className="btn small ghost" onClick={stopMeasuring}>
        Stop
      </button>
    </div>
  ) : todo.length ? (
    <div className="lvl-measuring small">
      <span className="dim">
        {todo.length} game{todo.length === 1 ? '' : 's'} not measured yet{e ? '' : ', so there is no estimate'}.
      </span>
      <button className="btn small primary" onClick={() => void measure()} disabled={!!measuring} title={measuring ? 'Another measurement is running' : undefined}>
        {measuring ? 'Waiting…' : `Measure ${todo.length === 1 ? 'it' : 'them'}`}
      </button>
    </div>
  ) : null;

  if (!e)
    return (
      <div className="lvl stack">
        {progress ?? <div className="small dim">No analysed games yet. The estimate appears after the first one.</div>}
      </div>
    );

  return (
    <div className={`lvl ${compact ? 'compact' : ''}`}>
      <div className="lvl-main">
        <div className="lvl-rank">
          <span className="lvl-eyebrow">Estimated level</span>
          <strong>
            {rankLabel(e.rank)}
            {rankTier(e.rank) && <small className="lvl-tier"> {rankTier(e.rank)}</small>}
          </strong>
          <span className="small dim">
            likely {rankRangeLabel(e.low, e.high)} · {e.games} game{e.games === 1 ? '' : 's'}
          </span>
        </div>
        <div className="lvl-side">
          <Range e={e} />
          <div className="lvl-phases">
            {(['opening', 'middlegame', 'endgame'] as const).map((p) => {
              const pe = level!.phases[p];
              if (!pe) return null;
              const diff = pe.rank - e.rank;
              return (
                <span key={p} className={`chip ${diff > 1 ? 'good' : diff < -1 ? 'bad' : ''}`} title={`likely ${rankRangeLabel(pe.low, pe.high)}`}>
                  {PHASE_LABEL[p]} {rankLabel(pe.rank)}
                </span>
              );
            })}
          </div>
        </div>
        {!compact && (
          <div className="lvl-trend-wrap">
            <Trend values={e.perGame} />
            {e.perGame.length >= 3 && <span className="tiny muted">per game, oldest → newest</span>}
          </div>
        )}
      </div>
      {!compact && level && (
        <>
          <p className="tiny muted">
            Compared with players around {rankLabelWhole(level.peers?.rank ?? e.rank)}, {who} numbers:
          </p>
          <PeerNumbers level={level} />
        </>
      )}
      {progress}
      <p className="tiny muted lvl-note">
        Fox scale from {cal.games.toLocaleString()} games (10d pro, 11d top pro, 12d AI). Typical error: {acc['1']?.toFixed(1)} ranks from one game
        {acc['10'] ? `, ${acc['10'].toFixed(1)} from ten` : ''}.
      </p>
    </div>
  );
}
