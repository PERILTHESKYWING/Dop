import type { Evidence, MoveRecord, Weakness } from '../types';
import { betaSurvival, mean } from '../util/stats';
import { SIGNATURES, type Signature } from './signatures';

export const MIN_OCCURRENCES = 3;
export const MIN_GAMES = 2;
export const MIN_CONFIDENCE = 0.75;
/** Error rates below this are never a weakness, whatever the player's typical rate. */
export const MIN_RATE = 0.06;

const PHASE_WORD = { opening: 'the opening', middlegame: 'the middlegame', endgame: 'the endgame' } as const;

/** Find a dominant sub-cluster (phase / region) to make the description specific. */
function whereClause(occ: MoveRecord[]): string {
  if (occ.length < 4) return '';
  const count = <K extends string>(key: (r: MoveRecord) => K) => {
    const m = new Map<K, number>();
    for (const r of occ) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  };
  const parts: string[] = [];
  const [phase, pn] = count((r) => r.features.phase);
  if (pn / occ.length >= 0.6) parts.push(`mostly in ${PHASE_WORD[phase]}`);
  const [region, rn] = count((r) => r.features.played.region);
  if (rn / occ.length >= 0.6) parts.push(`${parts.length ? 'and ' : 'mostly '}${region === 'center' ? 'in the centre' : region === 'corner' ? 'in corners' : 'on the sides'}`);
  const contact = occ.filter((r) => r.features.played.contact).length;
  if (contact / occ.length >= 0.7) parts.push('usually with a contact move');
  return parts.length ? `, ${parts.join(' ')}` : '';
}

function fill(t: string, v: Record<string, string>) {
  return t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
}

export interface DetectOptions {
  /** Game ids in chronological order, for trend estimation. */
  gameOrder: string[];
  previous?: Weakness[];
  now?: number;
}

/**
 * Statistical weakness detection. For each decision signature, count how often the
 * decision arose (opportunities) and how often the player made that specific error.
 * A weakness needs repeated evidence across games and an error rate clearly above the
 * player's own baseline mistake rate; one bad move never makes a weakness.
 */
export function detectWeaknesses(records: MoveRecord[], opts: DetectOptions): Weakness[] {
  const player = records.filter((r) => r.isPlayer);
  if (!player.length) return [];
  // Baseline: the player's typical error rate across decision types (median over
  // signatures with enough opportunities). A weakness is a decision the player gets
  // wrong clearly more often than their own typical decision.
  const rates = SIGNATURES.map((s) => {
    const ctx = player.filter((r) => r.contexts.includes(s.id));
    return ctx.length >= 15 ? ctx.filter((r) => r.errors.includes(s.id)).length / ctx.length : null;
  }).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const baseline = Math.max(MIN_RATE, rates.length ? rates[Math.floor(rates.length / 2)] : MIN_RATE);
  const order = new Map(opts.gameOrder.map((id, i) => [id, i]));
  const half = opts.gameOrder.length / 2;
  const prev = new Map((opts.previous ?? []).map((w) => [w.signature, w]));
  const now = opts.now ?? Date.now();
  const out: Weakness[] = [];

  for (const sig of SIGNATURES) {
    const ctx = player.filter((r) => r.contexts.includes(sig.id));
    const occ = ctx.filter((r) => r.errors.includes(sig.id));
    const games = new Set(occ.map((r) => r.gameId));
    if (occ.length < MIN_OCCURRENCES || games.size < MIN_GAMES) continue;
    const rate = occ.length / ctx.length;
    // Posterior probability that the error rate in this context exceeds the baseline.
    const threshold = Math.min(0.9, baseline);
    const confidence = betaSurvival(occ.length + 1, ctx.length - occ.length + 1, threshold);
    if (confidence < MIN_CONFIDENCE) continue;

    const losses = occ.map((r) => r.scoreLoss);
    const evidence: Evidence[] = [...occ]
      .sort((a, b) => b.scoreLoss - a.scoreLoss)
      .map((r) => ({ moveId: r.id, gameId: r.gameId, index: r.index, scoreLoss: r.scoreLoss, winrateLoss: r.winrateLoss }));

    const isOld = (r: MoveRecord) => (order.get(r.gameId) ?? 0) < half;
    const rateOf = (rs: MoveRecord[]) => {
      const c = rs.length;
      return c ? rs.filter((r) => r.errors.includes(sig.id)).length / c : 0;
    };
    const trend = { older: rateOf(ctx.filter(isOld)), newer: rateOf(ctx.filter((r) => !isOld(r))) };
    const p = prev.get(sig.id);
    const status: Weakness['status'] =
      opts.gameOrder.length >= 6 && trend.newer < trend.older * 0.6 && ctx.filter((r) => !isOld(r)).length >= 4 ? 'improving' : 'active';

    out.push({
      id: `w-${sig.id}`,
      signature: sig.id,
      category: sig.axis,
      title: sig.title,
      description: fill(sig.template, {
        occ: String(occ.length),
        opp: String(ctx.length),
        rate: `${Math.round(rate * 100)}%`,
        loss: mean(losses).toFixed(1),
        where: whereClause(occ),
      }),
      opportunities: ctx.length,
      occurrences: occ.length,
      games: games.size,
      errorRate: rate,
      baselineRate: baseline,
      avgScoreLoss: mean(losses),
      totalScoreLoss: losses.reduce((a, b) => a + b, 0),
      confidence,
      evidence,
      llm: p?.llm,
      trend,
      status: p?.status === 'resolved' ? 'resolved' : status,
      discoveredAt: p?.discoveredAt ?? now,
      updatedAt: now,
    });
  }
  // Rank by the points they cost, weighted by how sure we are.
  return out.sort((a, b) => b.totalScoreLoss * b.confidence - a.totalScoreLoss * a.confidence);
}

export function signatureFor(w: Weakness): Signature | undefined {
  return SIGNATURES.find((s) => s.id === w.signature);
}
