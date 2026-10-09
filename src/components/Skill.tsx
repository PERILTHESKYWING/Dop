import { useEffect, useMemo } from 'react';
import { rankLabel, rankTier } from '../lib/level/ranks';
import type { LevelEstimate } from '../lib/level/model';
import type { Phase } from '../lib/types';
import { loadLevel, useLevel } from '../state/level';
import { gameSkill, measureSkill, skillKey, useSkill, type SkillGame } from '../state/skill';
import './skill.css';

/**
 * The Skill tab: both players' level in this game (Fox scale, up to 12d = AI), for the
 * whole game, the opening, the middle game and the endgame.
 */

const ROWS: { id: 'overall' | Phase; label: string }[] = [
  { id: 'overall', label: 'Total' },
  { id: 'opening', label: 'Opening' },
  { id: 'middlegame', label: 'Middle' },
  { id: 'endgame', label: 'Endgame' },
];

function Cell({ e, big }: { e: LevelEstimate | null | undefined; big?: boolean }) {
  if (!e) return <span className="sk-none">–</span>;
  const tier = rankTier(e.rank);
  return (
    <span className={`sk-val ${big ? 'big' : ''}`} title={`Likely ${rankLabel(e.low)} to ${rankLabel(e.high)}`}>
      <b>{rankLabel(e.rank)}</b>
      {tier && <i className="sk-tier">{tier}</i>}
    </span>
  );
}

export function SkillPanel(game: SkillGame) {
  const cal = useLevel((s) => s.calibration);
  const loaded = useLevel((s) => s.loaded);
  const levelSamples = useLevel((s) => s.samples);
  const skillSamples = useSkill((s) => s.samples);
  const running = useSkill((s) => s.running);
  const error = useSkill((s) => s.error);
  const key = skillKey(game);
  useEffect(() => void loadLevel(), []);
  const skill = useMemo(() => (cal ? gameSkill(cal, game) : null), [cal, key, game.analysis, levelSamples, skillSamples]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (cal && !skill && !running && game.moves.length >= 20) void measureSkill(game);
  }, [cal, key, !!skill, !!running]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loaded) return <div className="sk-msg">Loading…</div>;
  if (!cal) return <div className="sk-msg">Skill calibration missing from this build.</div>;
  if (game.moves.length < 20) return <div className="sk-msg">Needs 20+ moves.</div>;
  if (!skill) {
    const mine = running;
    return (
      <div className="sk-msg">
        {error && !running ? (
          <>Couldn't measure: {error}</>
        ) : (
          <>
            <span>Measuring {mine ? `${mine.done}/${mine.total}` : '…'}</span>
            <span className="sk-bar">
              <span style={{ width: `${mine ? (100 * mine.done) / Math.max(1, mine.total) : 0}%` }} />
            </span>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="sk">
      <div className="sk-grid" role="table" aria-label="Skill by phase">
        <span />
        <span className="sk-head" role="columnheader">
          <i className="sk-stone b" /> <span className="sk-name">{game.black || 'Black'}</span>
        </span>
        <span className="sk-head" role="columnheader">
          <i className="sk-stone w" /> <span className="sk-name">{game.white || 'White'}</span>
        </span>
        {ROWS.map((r) => (
          <div key={r.id} className={`sk-row ${r.id === 'overall' ? 'total' : ''}`} role="row">
            <span className="sk-label">{r.label}</span>
            {([1, 2] as const).map((c) => (
              <Cell key={c} big={r.id === 'overall'} e={r.id === 'overall' ? skill[c].overall : skill[c].phases[r.id]} />
            ))}
          </div>
        ))}
      </div>
      <p className="sk-note">One game: ±{cal.all.maeGame.toFixed(1)}. 10d pro · 11d top pro · 12d AI.</p>
    </div>
  );
}
