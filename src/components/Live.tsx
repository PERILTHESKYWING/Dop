import { useEffect, useRef } from 'react';
import { shortCount, type CandidateMark } from './Board';
import { fmtPct } from './common';
import { useStore } from '../state/store';
import { setLiveTarget, togglePondering, useLive, type LiveTarget } from '../state/live';
import { locToGtp } from '../lib/go/coords';
import { PASS, type Color, type Loc, type Move, other } from '../lib/go/types';
import type { SearchSnapshot } from '../lib/engine/mcts';
import type { Candidate } from '../lib/types';

/** A candidate as the live panel and board show it (winrate and score for the side to move). */
export interface ShownCandidate {
  loc: Loc;
  winrate: number;
  scoreLead: number;
  visits: number;
  prior: number;
  pv: Loc[];
}

export function fromSnapshot(s: SearchSnapshot): ShownCandidate[] {
  return s.candidates.map((c) => ({ loc: c.loc, winrate: c.winrate, scoreLead: c.scoreLead, visits: c.visits, prior: c.prior, pv: c.pv }));
}

/** Stored candidates (a finished analysis) in the same shape, most visits first. */
export function fromStored(cands: Candidate[] | undefined): ShownCandidate[] {
  return (cands ?? [])
    .filter((c) => c.winrate !== undefined && c.scoreLead !== undefined)
    .map((c) => ({ loc: c.loc, winrate: c.winrate!, scoreLead: c.scoreLead!, visits: c.visits ?? 0, prior: c.prior, pv: c.pv ?? [c.loc] }))
    .sort((a, b) => b.visits - a.visits || b.winrate - a.winrate);
}

/**
 * Candidate discs for the board, as Lizzie draws them: moves with a meaningful share of
 * the visits, the most visited one first. Colour says how much worse than the best a
 * move is (by winrate, or by score once the game is decided).
 */
export function candidateMarks(cands: ShownCandidate[], max = 10): CandidateMark[] {
  const list = cands.filter((c) => c.loc !== PASS);
  if (!list.length) return [];
  const best = list[0];
  const top = best.visits || 1;
  return list
    .filter((c, i) => i < 3 || c.visits >= Math.max(2, top * 0.02))
    .slice(0, max)
    .map((c, i) => ({
      loc: c.loc,
      rank: i,
      winrate: c.winrate,
      scoreLead: c.scoreLead,
      visits: c.visits,
      share: c.visits / top,
      badness: Math.max((best.winrate - c.winrate) / 0.12, (best.scoreLead - c.scoreLead) / 6, 0),
    }));
}

/** A candidate's line as moves (colours alternate from the side to move). */
export function lineOf(pv: Loc[], toPlay: Color): Move[] {
  let c = toPlay;
  return pv.map((loc) => {
    const m = { color: c, loc };
    c = other(c);
    return m;
  });
}

/**
 * Keep live analysis on `target` while `enabled`; Space switches pondering on and off.
 * Returns the live result for the target's position.
 */
export function useLiveAnalysis(target: LiveTarget | null, enabled = true) {
  const key = enabled && target ? target.key : null;
  const who = useRef(Symbol('live')).current;
  useEffect(() => {
    setLiveTarget(enabled ? target : null, who);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, target?.onLeave]);
  useEffect(() => () => setLiveTarget(null, who), [who]);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== ' ' || e.repeat || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.tagName === 'BUTTON' || t.isContentEditable) return;
      e.preventDefault();
      togglePondering();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
  const live = useLive();
  return { snap: key && live.key === key ? live.snap : null, on: live.on, status: live.status, error: live.error };
}

/** Status line and the pondering switch. */
export function LiveHeader({ snap, title = 'KataGo' }: { snap: SearchSnapshot | null; title?: string }) {
  const { on, status, error } = useLive();
  const engine = useStore((s) => s.engine);
  const thinking = on && status === 'thinking';
  let text: string;
  if (status === 'error') text = error ?? 'KataGo stopped';
  else if (status === 'starting' || engine.status === 'loading' || engine.status === 'detecting')
    text = engine.progress?.stage === 'download' && engine.progress.total ? `Downloading the network… ${Math.round((engine.progress.loaded / engine.progress.total) * 100)}%` : 'Starting KataGo…';
  else if (!on) text = snap ? `Paused at ${shortCount(snap.visits)} visits` : 'Paused';
  else if (status === 'limit') text = `${shortCount(snap?.visits ?? 0)} visits (limit reached)`;
  else if (snap) text = `${shortCount(snap.visits)} visits${snap.evalsPerSec ? ` · ${snap.evalsPerSec >= 10 ? Math.round(snap.evalsPerSec) : snap.evalsPerSec.toFixed(1)}/s` : ''}`;
  else text = 'Reading the position…';
  return (
    <div className="live-head">
      <span className="live-dot" data-on={thinking ? '1' : '0'} />
      <strong>{title}</strong>
      <span className="live-status mono">{text}</span>
      <button className={`btn small live-toggle ${on ? 'on' : ''}`} onClick={togglePondering} title="Space">
        {on ? 'Pondering on' : 'Pondering off'} <kbd>Space</kbd>
      </button>
    </div>
  );
}

/** The candidate list: winrate, score, visits and share of the visits, as in Lizzie. */
export function CandidateTable({
  cands,
  size,
  played,
  onHover,
  onPick,
  max = 10,
}: {
  cands: ShownCandidate[];
  size: number;
  played?: Loc | null;
  onHover?: (c: ShownCandidate | null) => void;
  onPick?: (loc: Loc) => void;
  max?: number;
}) {
  const total = cands.reduce((a, c) => a + c.visits, 0) || 1;
  let rows = cands.slice(0, max);
  const playedRow = played != null ? cands.find((c) => c.loc === played) : undefined;
  if (playedRow && !rows.includes(playedRow)) rows = [...rows, playedRow];
  if (!rows.length) return null;
  return (
    <table className="data cands live-cands">
      <thead>
        <tr>
          <th>#</th>
          <th>Move</th>
          <th>Win</th>
          <th>Score</th>
          <th>Visits</th>
          <th>Share</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => {
          const rank = cands.indexOf(c);
          return (
            <tr
              key={c.loc}
              className={`${onPick ? 'click' : ''} ${rank === 0 ? 'best' : ''} ${c.loc === played ? 'played' : ''}`}
              onClick={onPick ? () => onPick(c.loc) : undefined}
              onMouseEnter={onHover ? () => onHover(c) : undefined}
              onMouseLeave={onHover ? () => onHover(null) : undefined}
            >
              <td className="muted">{rank + 1}</td>
              <td className={rank === 0 ? 'kata strong' : c.loc === played ? 'you' : ''}>{c.loc === PASS ? 'pass' : locToGtp(c.loc, size)}</td>
              <td className="mono">{fmtPct(c.winrate, 1)}</td>
              <td className="mono">{`${c.scoreLead >= 0 ? '+' : '−'}${Math.abs(c.scoreLead).toFixed(1)}`}</td>
              <td className="mono">{shortCount(c.visits)}</td>
              <td className="mono muted">{((c.visits / total) * 100).toFixed(1)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
