import type { Corpus } from '../corpus';
import { buildContext, pointFeatures } from '../go/features';
import { PASS, type Loc } from '../go/types';
import { decodeOwnership } from '../engine/parse';
import { signatureById, type Signature } from '../profile/signatures';
import { positionFingerprint, similarity, type Fingerprint } from '../search/similarity';
import type { MoveRecord, TrainingItem, TrainingKind, Weakness } from '../types';

function recordToItem(corpus: Corpus, r: MoveRecord, w: Weakness, kind: TrainingKind, expectsContext: boolean, difficulty: number): TrainingItem | null {
  const g = corpus.games.get(r.gameId);
  const a = corpus.analyses.get(r.gameId);
  const e = a?.evals[r.index];
  if (!g || !e) return null;
  return {
    id: `${w.id}:${kind}:${r.id}`,
    weaknessId: w.id,
    signature: w.signature,
    kind,
    sourceMoveId: r.id,
    gameId: r.gameId,
    index: r.index,
    size: g.size,
    komi: g.komi,
    setup: g.setup,
    moves: g.moves.slice(0, r.index),
    toPlay: r.color,
    eval: e,
    expectsContext,
    difficulty,
    createdAt: Date.now(),
  };
}

export function fingerprintOf(corpus: Corpus, r: MoveRecord): Fingerprint {
  const g = corpus.games.get(r.gameId)!;
  const board = corpus.boards(r.gameId)[r.index];
  const prev = r.index > 0 ? g.moves[r.index - 1] : null;
  const focus = prev && prev.color !== r.color && prev.loc !== PASS ? prev.loc : r.bestLoc;
  return positionFingerprint(board, focus, r.color, r.features);
}

/** Would KataGo's move itself show the signature's pattern? (the counterexample test) */
export function bestCommits(sig: Signature, r: MoveRecord): boolean {
  return sig.commits({ ...r.features, played: r.features.best, sameZoneAsBest: true, distToBest: 0 });
}

/**
 * Gap between the best candidate and the best candidate with the other decision label
 * (small gap = boundary case). Needs a deep evaluation.
 */
export function decisionGap(corpus: Corpus, sig: Signature, r: MoveRecord): number | null {
  const e = corpus.analyses.get(r.gameId)?.evals[r.index];
  if (!e?.candidates?.length || !sig.decide) return null;
  const g = corpus.games.get(r.gameId)!;
  const ctx = buildContext(corpus.boards(r.gameId)[r.index], decodeOwnership(e.ownership));
  const prev = r.index > 0 ? g.moves[r.index - 1] : null;
  const lastOpp = prev && prev.color !== r.color ? prev.loc : null;
  const label = (loc: Loc) => sig.decide!(pointFeatures(ctx, loc, r.color, lastOpp), r.features);
  const bestLabel = label(r.bestLoc);
  const leads = e.candidates.filter((c) => c.scoreLead !== undefined);
  if (!leads.length) return null;
  const top = Math.max(...leads.map((c) => c.scoreLead!));
  const other = leads.filter((c) => label(c.loc) !== bestLabel);
  if (!other.length) return null;
  return top - Math.max(...other.map((c) => c.scoreLead!));
}

export interface GenerateOptions {
  perKind?: Partial<Record<TrainingKind, number>>;
}

/**
 * Build Forge positions for one weakness from the player's real games:
 *  - original: positions where the player made this exact error
 *  - similar: other positions with the same decision, ranked by similarity to the originals
 *  - counterexample: superficially similar positions where the right decision is the
 *    opposite (so the pattern cannot be memorised)
 *  - boundary: positions where the two decisions are close in value
 */
export function generateItems(corpus: Corpus, w: Weakness, opts: GenerateOptions = {}): TrainingItem[] {
  const sig = signatureById.get(w.signature);
  const per = { original: 8, similar: 10, counterexample: 8, boundary: 6, ...opts.perKind };
  const usable = corpus.records.filter((r) => r.loc !== PASS && r.bestLoc !== PASS);
  const originals = w.evidence.map((e) => corpus.byId.get(e.moveId)).filter((r): r is MoveRecord => !!r);
  const originalIds = new Set(originals.map((r) => r.id));
  const seeds = originals.slice(0, 12).map((r) => fingerprintOf(corpus, r));
  const simToSeeds = (r: MoveRecord) => {
    if (!seeds.length) return 0;
    const fp = fingerprintOf(corpus, r);
    return Math.max(...seeds.map((s) => similarity(s, fp)));
  };
  const deepFirst = (r: MoveRecord) => (r.depth === 'deep' ? 0.15 : 0);

  const items: TrainingItem[] = [];
  const push = (r: MoveRecord, kind: TrainingKind, expects: boolean, difficulty: number) => {
    const it = recordToItem(corpus, r, w, kind, expects, difficulty);
    if (it) items.push(it);
  };

  for (const r of originals.slice(0, per.original)) push(r, 'original', true, 2);

  if (!sig) {
    // A pattern the LLM described without a statistical signature: train on the
    // originals and the positions most similar to them.
    const similarOnly = usable
      .filter((r) => !originalIds.has(r.id) && r.depth === 'deep')
      .map((r) => ({ r, s: simToSeeds(r) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, per.similar + per.counterexample);
    for (const { r } of similarOnly) push(r, 'similar', true, 3);
    return items;
  }

  // Similar: same decision context, correct answer avoids the error, not an original.
  const similar = usable
    .filter((r) => !originalIds.has(r.id) && sig.context(r.features) && !bestCommits(sig, r))
    .map((r) => ({ r, s: simToSeeds(r) + deepFirst(r) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, per.similar);
  for (const { r } of similar) push(r, 'similar', true, r.isPlayer && r.errors.length === 0 ? 2 : 3);

  // Counterexamples: KataGo's move itself has the "error" pattern, in similar-looking positions.
  const counter = usable
    .filter((r) => !originalIds.has(r.id) && bestCommits(sig, r) && !sig.context(r.features))
    .map((r) => ({ r, s: simToSeeds(r) + deepFirst(r) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, per.counterexample);
  for (const { r } of counter) push(r, 'counterexample', false, 3);

  // Boundary: both decisions are close in value.
  const used = new Set(items.map((i) => i.sourceMoveId));
  const boundary = usable
    .filter((r) => !used.has(r.id) && r.depth === 'deep' && (sig.context(r.features) || bestCommits(sig, r)))
    .map((r) => ({ r, gap: decisionGap(corpus, sig, r) }))
    .filter((x): x is { r: MoveRecord; gap: number } => x.gap !== null && x.gap >= 0 && x.gap < 1.5)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, per.boundary);
  for (const { r } of boundary) push(r, 'boundary', sig.context(r.features), 5);

  return items;
}
