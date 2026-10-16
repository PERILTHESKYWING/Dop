/**
 * Which diagram an answer gets: the fight the answer is about, cut out of the game and
 * checked by illustrate.ts (KataGo's final read last). One diagram per answer by default;
 * none when the fight is in the center, the board is small, or a check fails (the reason
 * goes into the thinking steps, never into the answer).
 */
import { chebyshev } from '../../go/coords';
import { other, PASS, type Loc } from '../../go/types';
import { afterMoves, boardOf, coord } from './geometry';
import { ILLUSTRATE_DEFAULTS, isolate, verifyDiagram, windowName, type DiagramSpec } from './illustrate';
import type { Findings } from './planner';
import type { ConceptExample } from '../library/types';
import type { Fact, Illustration, IllustrateOptions, ModelId, Prober, ThinkingLevel, ThoughtStep } from './types';

/** Library examples for a concept id (the explainer does not import the library itself). */
export type ExamplesFor = (concept: string) => ConceptExample[];

/** The asked move and KataGo's best move are "one fight" within this distance. */
const SAME_FIGHT = 4;

/** Default diagram reads per model and thinking level (null: no diagram). */
export function illustrateDefaults(model: ModelId, thinking: ThinkingLevel): IllustrateOptions | null {
  if (model === 'hane' || thinking === 'off' || thinking === 'low') return null;
  const deep = model === 'myoshu' || thinking === 'high';
  return { ...ILLUSTRATE_DEFAULTS, firstVisits: deep ? 80 : 48, visits: deep ? 240 : 160, maxMs: deep ? 14_000 : 9_000 };
}

/** The diagram worth building for these findings, if any. */
export function diagramFor(f: Findings): DiagramSpec | null {
  const best = f.best;
  if (!best || best.loc === PASS) return null;
  const size = f.pos.size;
  const C = (l: Loc) => coord(l, size);
  const a = f.asked;
  if (a && a.legal && !a.isBest && a.loss >= 0.5 && f.mode === 'refutation' && a.reply !== undefined && a.reply !== PASS) {
    // The refutation on its own: after the asked move, the opponent's answer still works.
    const pos = afterMoves(f.pos, [a.loc]);
    const spec = isolate(pos, boardOf(pos), [a.reply, a.loc], { best: a.reply }, `The answer to ${C(a.loc)}, on its own`);
    if (spec) spec.label = `${C(a.reply)} on its own`;
    return spec;
  }
  if (a && a.legal && !a.isBest && a.loss >= 0.5 && chebyshev(a.loc, best.loc, size) <= SAME_FIGHT) {
    const spec = isolate(f.pos, f.board, [best.loc, a.loc], { best: best.loc, worse: a.loc }, `${C(best.loc)} against ${C(a.loc)}, on its own`);
    if (spec) spec.label = `${C(best.loc)} vs ${C(a.loc)} on its own`;
    return spec;
  }
  const spec = isolate(f.pos, f.board, [best.loc], { best: best.loc }, `${C(best.loc)}, on its own`);
  if (spec) spec.label = `${C(best.loc)} on its own`;
  return spec;
}

/** A library example as a spec: its window, its first move as the claim, komi made even. */
export function exampleSpec(ex: ConceptExample, concept: string): DiagramSpec | null {
  const first = ex.line[0];
  if (!first || first.loc === PASS || ex.position.moves.length) return null;
  const view = ex.view;
  return {
    size: ex.position.size,
    stones: ex.position.setup,
    toPlay: ex.position.toPlay,
    komi: ex.position.komi,
    ...(view ? { window: { x0: view[0], y0: view[1], x1: view[2], y1: view[3] } } : {}),
    claim: { best: first.loc },
    title: ex.title,
    label: ex.title,
    concept,
    source: 'library',
  };
}

export interface DiagramResult {
  illustrations: Illustration[];
  facts: Fact[];
  reads: number;
  visits: number;
  ms: number;
  section?: { title: string; text: string };
}

/** Build and check the answer's diagram. Never throws for a failed check, only for an abort. */
export async function buildDiagrams(
  f: Findings,
  prober: Prober,
  options: IllustrateOptions,
  opts: { signal?: AbortSignal; onThought?: (t: ThoughtStep) => void; examplesFor?: ExamplesFor; concepts?: string[] } = {},
): Promise<DiagramResult> {
  const out: DiagramResult = { illustrations: [], facts: [], reads: 0, visits: 0, ms: 0 };
  if (options.max < 1) return out;
  const think = (text: string, ms: number, visits: number) => {
    const step: ThoughtStep = { text, ms, visits };
    f.thoughts.push(step);
    opts.onThought?.(step);
  };
  const t0 = Date.now();
  const timeLeft = () => options.maxMs - (Date.now() - t0);
  const tryOne = async (spec: DiagramSpec, what: string) => {
    const t = Date.now();
    const v = await verifyDiagram(spec, prober, 'd1', { ...options, maxMs: Math.max(1000, timeLeft()) }, opts.signal);
    const ms = Date.now() - t;
    out.reads += v.reads;
    out.visits += v.visits;
    out.ms += ms;
    if (!v.illustration) {
      const failed = v.checks.find((c) => !c.ok);
      think(`Tried a diagram (${what}) → not shown: ${failed?.detail ?? 'a check failed'}`, ms, v.visits);
      return null;
    }
    think(`Built a diagram (${what}) → passed ${v.checks.filter((c) => c.ok).length} checks, KataGo's final read last`, ms, v.visits);
    return v;
  };

  // 1. The game's own fight, cut out.
  const spec = diagramFor(f);
  if (spec) {
    const v = await tryOne(spec, spec.title.toLowerCase());
    if (v) {
      out.illustrations.push(v.illustration!);
      out.facts.push(...v.facts);
      const where = spec.frame ? windowName(spec.frame.rect, f.pos.size) : 'this part of the board';
      const who = spec.toPlay === f.mover ? '' : ` with ${other(f.mover) === 1 ? 'Black' : 'White'} to play`;
      out.section = {
        title: 'The idea on its own',
        text: `The same shape in ${where}, with the rest of the board settled${who} [[d1]]: ${v.facts.map((x) => x.text.replace(/^In diagram \[\[d1\]\], /, '')).join(' ')}`,
      };
      return out;
    }
  }
  // 2. A textbook position for the main idea, re-checked now (minimum winrate included).
  for (const concept of opts.concepts ?? []) {
    if (!opts.examplesFor || timeLeft() < 1500) break;
    // Same board size only: the engine reading this game is loaded for its size.
    const ex = opts.examplesFor(concept).find((e) => e.position.size === f.pos.size);
    const s2 = ex ? exampleSpec(ex, concept) : null;
    if (!s2) continue;
    const v = await tryOne(s2, `textbook ${concept.replace(/-/g, ' ')}`);
    if (!v) continue;
    const d = v.illustration!;
    out.illustrations.push(d);
    out.facts.push(...v.facts);
    out.section = {
      title: `The idea in a textbook diagram: ${concept.replace(/-/g, ' ')}`,
      text: `${ex!.title} [[d1]]: ${v.facts.map((x) => x.text.replace(/^In diagram \[\[d1\]\], /, '')).join(' ')}`,
    };
    return out;
  }
  return out;
}
