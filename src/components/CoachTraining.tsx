import { useEffect, useState } from 'react';
import type { CoachProgress } from '../lib/coach/progress';
import type { DifficultyModel } from '../lib/coach/difficulty';
import { difficultyModel } from '../state/insight';
import { useLevel } from '../state/level';

let progress: Promise<CoachProgress | null> | null = null;
const loadProgress = () =>
  (progress ??= fetch('/coach/progress.json')
    .then((r) => (r.ok ? (r.json() as Promise<CoachProgress>) : null))
    .catch(() => null));

function ago(iso: string) {
  const h = (Date.now() - Date.parse(iso)) / 36e5;
  if (!Number.isFinite(h)) return '';
  if (h < 1) return '<1 h ago';
  if (h < 36) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** Tiny growth line of what the coach has measured, run by run. */
function Growth({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const W = 120, H = 28;
  const lo = Math.min(...values), hi = Math.max(...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - ((v - lo) / (hi - lo || 1)) * (H - 4) - 2).toFixed(1)}`);
  return (
    <svg className="coach-growth" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
      <path d={`M${pts.join('L')}`} />
    </svg>
  );
}

/**
 * How much the coach has learned: it measures new ranked and professional games in the
 * cloud every day (.github/workflows/coach-training.yml), with or without the site open.
 */
export function CoachTraining() {
  const cal = useLevel((s) => s.calibration);
  const [prog, setProg] = useState<CoachProgress | null>(null);
  const [diff, setDiff] = useState<DifficultyModel | null>(null);
  useEffect(() => {
    void loadProgress().then(setProg);
    void difficultyModel().then(setDiff);
  }, []);
  const last = prog?.entries[prog.entries.length - 1];
  const games = last?.rankGames ?? cal?.games;
  const positions = last?.positions ?? diff?.positions;
  const err10 = last?.rankError10 ?? cal?.maeByGames?.['10'];
  if (!games && !positions) return null;
  const first = prog?.entries[0];
  return (
    <div className="coach-training">
      <span className="coach-live" aria-hidden />
      <div className="tiny">
        <b>Coach trains daily.</b> {games?.toLocaleString() ?? '–'} games, {positions?.toLocaleString() ?? '–'} positions
        {err10 ? `, ±${err10.toFixed(1)} ranks from 10 games` : ''}.{' '}
        <span className="muted">
          {last ? `Updated ${ago(last.at)}` : 'First run tonight'}
          {first && last && first !== last && positions && first.positions < positions ? ` · +${(positions - first.positions).toLocaleString()} since ${new Date(first.at).toLocaleDateString()}` : ''}
        </span>
      </div>
      <Growth values={(prog?.entries ?? []).map((e) => e.positions + e.rankGames * 40)} />
    </div>
  );
}
