import type { AxisStats, FingerprintAxis, MoveFeatures, MoveRecord, PointFeatures } from '../types';
import { mean } from '../util/stats';

interface AxisDef {
  axis: FingerprintAxis;
  label: string;
  select: (f: MoveFeatures) => boolean;
  tendencies: { label: string; test: (p: PointFeatures, f: MoveFeatures) => boolean }[];
}

const early = (f: MoveFeatures) => f.phase !== 'endgame';

export const AXES: AxisDef[] = [
  {
    axis: 'opening',
    label: 'Opening',
    select: (f) => f.phase === 'opening',
    tendencies: [
      { label: 'Corner moves', test: (p) => p.region === 'corner' },
      { label: 'Third line or lower', test: (p) => p.line <= 3 },
      { label: 'Approach / contact', test: (p) => p.contact || p.distLast <= 2 },
    ],
  },
  {
    axis: 'fighting',
    label: 'Fighting',
    select: (f) => f.phase === 'middlegame' && (f.best.contact || f.played.contact || f.hasTactics),
    tendencies: [
      { label: 'Contact moves', test: (p) => p.contact },
      { label: 'Ataris', test: (p) => p.atari },
    ],
  },
  {
    axis: 'invasion',
    label: 'Invasions & reductions',
    select: (f) => f.played.invasion || f.best.invasion || f.played.reduction || f.best.reduction,
    tendencies: [
      { label: 'Deep invasions', test: (p) => p.invasion },
      { label: 'Reductions', test: (p) => p.reduction },
    ],
  },
  {
    axis: 'attackDefence',
    label: 'Attack & defence',
    select: (f) => f.ownWeakGroups > 0 || f.oppWeakGroups > 0,
    tendencies: [
      { label: 'Attacks a weak group', test: (p) => p.nearOppWeak },
      { label: 'Defends an own weak group', test: (p) => p.nearOwnWeak },
    ],
  },
  {
    axis: 'territoryInfluence',
    label: 'Territory & influence',
    select: (f) => early(f) && !f.played.contact && !f.best.contact,
    tendencies: [
      { label: 'Low (line ≤ 3)', test: (p) => p.line <= 3 },
      { label: 'High (line ≥ 4)', test: (p) => p.line >= 4 },
    ],
  },
  {
    axis: 'tenuki',
    label: 'Tenuki',
    select: (f) => f.played.distLast < 99 && f.phase !== 'opening',
    tendencies: [
      { label: 'Plays elsewhere', test: (p) => p.tenuki },
      { label: 'Answers locally', test: (p) => p.local },
    ],
  },
  {
    axis: 'sacrifice',
    label: 'Sacrifice',
    select: (f) => f.ownSmallWeakGroups > 0,
    tendencies: [{ label: 'Rescues small stones', test: (p) => p.extendsSmallWeak || p.savesAtari }],
  },
  {
    axis: 'direction',
    label: 'Direction of play',
    select: (f) => early(f) && !f.best.local && f.moveNumber <= 120,
    tendencies: [{ label: 'Same area as KataGo', test: (_p, f) => f.sameZoneAsBest || f.distToBest <= 3 }],
  },
  {
    axis: 'weakGroups',
    label: 'Weak-group handling',
    select: (f) => f.ownWeakGroups > 0,
    tendencies: [
      { label: 'Moves near a weak group', test: (p) => p.nearOwnWeak || p.nearOppWeak },
      { label: 'Moves next to a safe group', test: (p) => p.nearOwnSafe && !p.nearOwnWeak && !p.nearOppWeak },
    ],
  },
  {
    axis: 'endgame',
    label: 'Endgame',
    select: (f) => f.phase === 'endgame',
    tendencies: [{ label: 'First/second line moves', test: (p) => p.line <= 2 }],
  },
  {
    axis: 'tactics',
    label: 'Tactics',
    select: (f) => f.hasTactics,
    tendencies: [
      { label: 'Captures', test: (p) => p.captures > 0 },
      { label: 'Self-atari', test: (p) => p.selfAtari },
    ],
  },
];

export const AXIS_LABEL: Record<FingerprintAxis, string> = Object.fromEntries(AXES.map((a) => [a.axis, a.label])) as Record<
  FingerprintAxis,
  string
>;

const accurate = (r: MoveRecord) => r.scoreLoss < 1 && r.winrateLoss < 0.03;
const mistake = (r: MoveRecord) => r.scoreLoss >= 2.5 || r.winrateLoss >= 0.07;

/**
 * Player DNA: per axis, how accurate the player is and how their choices differ from
 * KataGo's choices in the same positions (a behavioural fingerprint, not a grade).
 */
export function computeFingerprint(records: MoveRecord[]): AxisStats[] {
  const player = records.filter((r) => r.isPlayer);
  const overall = player.length ? player.filter(accurate).length / player.length : 0;
  return AXES.map((def) => {
    const rs = player.filter((r) => def.select(r.features));
    const n = rs.length;
    const acc = n ? rs.filter(accurate).length / n : 0;
    const tendencies = def.tendencies.map((t) => ({
      label: t.label,
      player: n ? rs.filter((r) => t.test(r.features.played, r.features)).length / n : 0,
      engine: n ? rs.filter((r) => t.test(r.features.best, r.features)).length / n : 0,
    }));
    let summary = n < 8 ? 'Not enough positions yet.' : '';
    if (!summary) {
      const diff = acc - overall;
      summary =
        Math.abs(diff) < 0.04
          ? 'About your usual accuracy.'
          : diff > 0
            ? `A relative strength: ${Math.round(diff * 100)} points above your average accuracy.`
            : `A relative weakness: ${Math.round(-diff * 100)} points below your average accuracy.`;
      const big = tendencies
        .map((t) => ({ ...t, d: t.player - t.engine }))
        .filter((t) => Math.abs(t.d) >= 0.08)
        .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
      if (big)
        summary += ` ${big.label}: you ${Math.round(big.player * 100)}% vs KataGo ${Math.round(big.engine * 100)}%.`;
    }
    return {
      axis: def.axis,
      label: def.label,
      n,
      accuracy: acc,
      avgScoreLoss: mean(rs.map((r) => r.scoreLoss)),
      mistakeRate: n ? rs.filter(mistake).length / n : 0,
      tendencies,
      summary,
    };
  });
}
