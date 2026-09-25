import type { Attempt, BlindTest, TrainingItem, TrainingKind, Weakness, WeaknessMastery } from '../types';
import { binomialPValue } from '../util/stats';

/** Mix of position kinds by level: harder levels bring more counterexamples and boundary cases. */
export const KIND_MIX: Record<number, Record<TrainingKind, number>> = {
  1: { original: 0.5, similar: 0.4, counterexample: 0.1, boundary: 0 },
  2: { original: 0.35, similar: 0.35, counterexample: 0.2, boundary: 0.1 },
  3: { original: 0.25, similar: 0.3, counterexample: 0.3, boundary: 0.15 },
  4: { original: 0.15, similar: 0.3, counterexample: 0.3, boundary: 0.25 },
  5: { original: 0.1, similar: 0.25, counterexample: 0.3, boundary: 0.35 },
};

export function newMastery(weaknessId: string): WeaknessMastery {
  return { weaknessId, level: 1, mastery: 0, attempts: 0, lastPracticed: 0, history: [] };
}

/** Update mastery after an attempt. Concept correctness counts most; clean moves add a little. */
export function updateMastery(m: WeaknessMastery, a: Attempt, recent: Attempt[]): WeaknessMastery {
  const score = (a.conceptCorrect ? 0.75 : 0) + (a.grade === 'excellent' || a.grade === 'good' ? 0.25 : 0);
  const alpha = m.attempts < 5 ? 0.3 : 0.15;
  const mastery = m.mastery * (1 - alpha) + score * alpha;
  const last = [...recent.slice(-4), a];
  const acc = last.filter((x) => x.conceptCorrect).length / last.length;
  let level = m.level;
  if (a.conceptCorrect && last.length >= 5 && acc >= 0.8) level = Math.min(5, level + 1);
  else if (!a.conceptCorrect && last.length >= 3 && acc <= 0.34) level = Math.max(1, level - 1);
  return {
    ...m,
    mastery,
    level,
    attempts: m.attempts + 1,
    lastPracticed: a.at,
    history: [...m.history, { at: a.at, mastery }].slice(-200),
  };
}

/** Which weakness to train next: costly weaknesses with low mastery, not trained just now. */
export function pickWeakness(weaknesses: Weakness[], mastery: Map<string, WeaknessMastery>, now = Date.now()): Weakness | null {
  const active = weaknesses.filter((w) => w.status !== 'resolved');
  if (!active.length) return null;
  let best: Weakness | null = null;
  let bestScore = -Infinity;
  for (const w of active) {
    const m = mastery.get(w.id);
    const need = 1 - (m?.mastery ?? 0);
    const impact = Math.log1p(w.totalScoreLoss) * w.confidence;
    const recency = m && now - m.lastPracticed < 60_000 ? 0.7 : 1;
    const s = need * impact * recency;
    if (s > bestScore) {
      bestScore = s;
      best = w;
    }
  }
  return best;
}

/**
 * Next Forge position for a weakness. Items missed before come back first (after a few
 * other positions), then the level's kind mix decides, avoiding recent repeats.
 */
export function pickItem(items: TrainingItem[], attempts: Attempt[], level: number, rand: () => number = Math.random): TrainingItem | null {
  if (!items.length) return null;
  const recentIds = new Set(attempts.slice(-8).map((a) => a.itemId));
  const lastByItem = new Map<string, Attempt>();
  for (const a of attempts) lastByItem.set(a.itemId, a);
  const missed = items.filter((it) => {
    const a = lastByItem.get(it.id);
    return a && !a.conceptCorrect && !recentIds.has(it.id);
  });
  if (missed.length && rand() < 0.35) return missed[Math.floor(rand() * missed.length)];

  const mix = KIND_MIX[Math.min(5, Math.max(1, level))];
  const fresh = items.filter((it) => !recentIds.has(it.id));
  const pool = fresh.length ? fresh : items;
  const kinds = (Object.keys(mix) as TrainingKind[]).filter((k) => pool.some((it) => it.kind === k));
  const total = kinds.reduce((s, k) => s + mix[k], 0) || 1;
  let x = rand() * total;
  let kind = kinds[0];
  for (const k of kinds) {
    x -= mix[k];
    if (x <= 0) {
      kind = k;
      break;
    }
  }
  const candidates = pool.filter((it) => it.kind === kind);
  // Prefer items never attempted.
  const unseen = candidates.filter((it) => !lastByItem.has(it.id));
  const from = unseen.length ? unseen : candidates;
  return from[Math.floor(rand() * from.length)] ?? pool[0];
}

/**
 * "Do I really know this?": a balanced blind set (no feedback until the end), half
 * positions where the habit is wrong and half where the opposite is right.
 */
export function buildBlindSet(items: TrainingItem[], attempts: Attempt[], size = 14, rand: () => number = Math.random): TrainingItem[] {
  const n = Math.max(10, Math.min(20, size));
  const recentlyTrained = new Set(attempts.filter((a) => Date.now() - a.at < 12 * 3600_000).map((a) => a.itemId));
  const shuffle = <T,>(xs: T[]) => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const prefer = (xs: TrainingItem[]) => [...shuffle(xs.filter((i) => !recentlyTrained.has(i.id))), ...shuffle(xs.filter((i) => recentlyTrained.has(i.id)))];
  const pos = prefer(items.filter((i) => i.expectsContext));
  const neg = prefer(items.filter((i) => !i.expectsContext));
  const out: TrainingItem[] = [];
  let a = 0, b = 0;
  while (out.length < n && (a < pos.length || b < neg.length)) {
    if (a < pos.length && (out.length % 2 === 0 || b >= neg.length)) out.push(pos[a++]);
    else if (b < neg.length) out.push(neg[b++]);
  }
  return shuffle(out);
}

export function scoreBlindTest(test: BlindTest, attempts: Attempt[], items: TrainingItem[]): NonNullable<BlindTest['result']> {
  // Answers given after opening the analysis board do not count.
  const mine = attempts.filter((a) => test.attempts.includes(a.id) && !a.assisted);
  const n = mine.length || 1;
  const concept = mine.filter((a) => a.conceptCorrect).length;
  const good = mine.filter((a) => a.grade === 'excellent' || a.grade === 'good').length;
  // Chance level: always making the same decision would be right on the larger half.
  const byId = new Map(items.map((i) => [i.id, i]));
  const expects = mine.filter((a) => byId.get(a.itemId)?.expectsContext).length;
  const baseline = Math.max(0.5, Math.max(expects, n - expects) / n);
  const pValue = binomialPValue(concept, n, baseline);
  const conceptAccuracy = concept / n;
  const verdict = conceptAccuracy >= 0.8 && pValue < 0.05 ? 'learned' : conceptAccuracy >= 0.6 ? 'partial' : 'not-yet';
  return { accuracy: good / n, conceptAccuracy, baseline, pValue, verdict };
}
