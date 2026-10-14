import { splitByGame, type CopyWeights, type DoppelExample } from './doppel';
import { bookFromExamples, fitWith, mistakesWith, sampleOf } from './copyTrain';
import { clampGenome, DEFAULT_GENOME, fitKey, GENES, type Genome } from './genome';
import { measurePlay, type PlayMetrics } from './human';

/**
 * Evolution: the copy tunes its own settings (genome.ts) for each player. A small
 * population of settings is scored by how well a copy built with them predicts the
 * player's actual moves (mistakes included) on games it did not learn from; the best
 * survive and breed. The population is kept on the model, so every update (new games, or
 * "Evolve more") carries on where the last one stopped: the copy keeps improving itself.
 */

export interface Individual {
  genes: Genome;
  /** Score on the current data (null: not scored since the data changed). */
  fitness: number | null;
}

export interface EvoState {
  generation: number;
  population: Individual[];
  /** Best and mean score of each generation scored. */
  history: { generation: number; best: number; mean: number; at: number }[];
  /** The player's moves the population was last scored on. */
  moves: number;
}

export const POPULATION = 8;
const ELITES = 3;
/** History entries kept. */
const HISTORY = 60;

/**
 * The score: mean log-likelihood of the player's moves under the copy's full choice (how
 * "you" the copy is), plus how often it plays the player's exact move (what playing it
 * feels like), minus a penalty when its points lost per move stray from the player's (a
 * copy that matches moves but errs far too much or too little is not them).
 */
export function fitnessOf(m: PlayMetrics): number {
  let gap = 0;
  let n = 0;
  for (const p of m.byPhase) {
    if (!p.you.moves) continue;
    gap += Math.abs(Math.log((p.copy.meanLoss + 0.2) / (p.you.meanLoss + 0.2))) * p.you.moves;
    n += p.you.moves;
  }
  return m.logLik + 1.5 * m.match - 0.5 * (n ? gap / n : 0);
}

/** Deterministic random numbers (mulberry32). */
export function rngFrom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = (rng: () => number) => Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());

export function mutate(g: Genome, rng: () => number, rate = 0.45, scale = 0.35): Genome {
  const out: Genome = { ...g };
  for (const s of GENES) {
    if (rng() > (s.fit ? rate * 0.6 : rate)) continue;
    const v = out[s.key];
    if (s.key === 'halfLife') out.halfLife = v <= 0 ? (rng() < 0.5 ? 0 : 20 + rng() * 150) : rng() < 0.15 ? 0 : v * Math.exp(scale * gauss(rng));
    else if (s.log) out[s.key] = v * Math.exp(scale * gauss(rng));
    else out[s.key] = v + scale * (s.max - s.min) * 0.25 * gauss(rng);
  }
  return clampGenome(out);
}

export function crossover(a: Genome, b: Genome, rng: () => number): Genome {
  const out: Genome = { ...a };
  for (const s of GENES) if (rng() < 0.5) out[s.key] = b[s.key];
  return out;
}

export function initialPopulation(rng: () => number, seed: Genome = DEFAULT_GENOME): Individual[] {
  const pop: Individual[] = [{ genes: clampGenome(seed), fitness: null }];
  if (fitKey(seed) !== fitKey(DEFAULT_GENOME) || seed.temperature !== DEFAULT_GENOME.temperature) pop.push({ genes: { ...DEFAULT_GENOME }, fitness: null });
  while (pop.length < POPULATION) pop.push({ genes: mutate(seed, rng, 0.8, 0.5), fitness: null });
  return pop;
}

export interface EvolveOptions {
  generations?: number;
  seed?: number;
  onProgress?: (done: number, total: number, best: number | null) => void;
}

/**
 * Run some generations on the player's examples (learn from 3 games in 4, scored on the
 * 4th; the examples given should already leave out the games kept for the final test).
 */
export function evolve(examples: readonly DoppelExample[], state: EvoState | null | undefined, seedGenome: Genome | undefined, opts: EvolveOptions = {}): EvoState {
  const generations = opts.generations ?? 3;
  const rng = rngFrom(opts.seed ?? Date.now());
  const real = examples.filter((e) => !e.fix && e.y >= 0);
  const fixes = examples.filter((e) => e.fix);
  const { train, test: val } = splitByGame(real, 4);
  const moves = real.length;
  // New data: everyone is scored again.
  let pop: Individual[] = state?.population?.length ? state.population.map((x) => ({ genes: clampGenome(x.genes), fitness: state.moves === moves ? x.fitness : null })) : initialPopulation(rng, seedGenome);
  const history = [...(state?.history ?? [])];
  let generation = state?.generation ?? 0;
  const fits = new Map<string, CopyWeights>();
  const book = bookFromExamples(train);
  const score = (g: Genome) => {
    const k = fitKey(g);
    let w = fits.get(k);
    if (!w) fits.set(k, (w = fitWith([...train, ...fixes], g)));
    const mistakes = mistakesWith(w, train, g, book);
    return fitnessOf(measurePlay(val.map((e) => sampleOf(w!, e, book)), { mistakes, genome: g }));
  };
  const total = generations * POPULATION;
  let done = 0;
  for (let gen = 0; gen < generations; gen++) {
    for (const ind of pop) {
      if (ind.fitness === null) ind.fitness = score(ind.genes);
      opts.onProgress?.(++done, total, Math.max(...pop.map((x) => x.fitness ?? -Infinity)));
    }
    pop.sort((a, b) => b.fitness! - a.fitness!);
    const fs = pop.map((x) => x.fitness!);
    generation++;
    history.push({ generation, best: fs[0], mean: fs.reduce((a, b) => a + b, 0) / fs.length, at: Date.now() });
    if (gen === generations - 1) break;
    const elites = pop.slice(0, ELITES);
    const next: Individual[] = elites.map((x) => ({ ...x }));
    while (next.length < POPULATION) {
      const a = elites[Math.floor(rng() * elites.length)].genes;
      const b = pop[Math.floor(rng() * Math.min(pop.length, ELITES + 2))].genes;
      next.push({ genes: mutate(crossover(a, b, rng), rng), fitness: null });
    }
    pop = next;
  }
  return { generation, population: pop, history: history.slice(-HISTORY), moves };
}

/** The best settings found so far. */
export function bestGenome(state: EvoState | null | undefined): Genome | undefined {
  const scored = (state?.population ?? []).filter((x) => x.fitness !== null);
  if (!scored.length) return undefined;
  return scored.reduce((a, b) => (b.fitness! > a.fitness! ? b : a)).genes;
}
