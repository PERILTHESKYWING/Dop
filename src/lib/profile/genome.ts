/**
 * The copy's settings that evolution tunes for each player (profile/evolve.ts): how it
 * learns habits from their games, and how it turns habits and move costs into a choice.
 */
export interface Genome {
  /** Pull of the whole-game habits toward KataGo's policy (times the default for the amount of data). */
  l2: number;
  /** How much harder the phase and the behind/level/ahead differences are pulled toward none. */
  l2Phase: number;
  l2Sit: number;
  /** Older games count half as much every this many games (0: all games count the same). */
  halfLife: number;
  /** Variety: the copy's choice is sharpened below 1 and flattened above. */
  temperature: number;
  /** How much a mistake must look natural (KataGo's instinct likes it) to be made. */
  gamma: number;
  /** Blunder guard: a move losing this many points that KataGo's instinct gives under guardPrior is never played. */
  guardLoss: number;
  guardPrior: number;
  /** How strongly the copy's mistakes follow the player's kinds of mistakes. */
  typeK: number;
  /** Pseudo-count of the copy's own choice against the opening book: book moves win once played more often than this. */
  bookAlpha: number;
  /** How much a mistake just made raises the chance of the next one (times the player's measured tilt). */
  tiltK: number;
}

export const DEFAULT_GENOME: Genome = {
  l2: 1,
  l2Phase: 4,
  l2Sit: 6,
  halfLife: 0,
  temperature: 1,
  gamma: 0.5,
  guardLoss: 3,
  guardPrior: 0.02,
  typeK: 1,
  bookAlpha: 1,
  tiltK: 1,
};

export interface GeneSpec {
  key: keyof Genome;
  min: number;
  max: number;
  /** Mutation on a log scale (multiplicative) or a linear one. */
  log: boolean;
  /** The gene changes the learned habits (a refit is needed), not just the choice. */
  fit: boolean;
  label: string;
}

export const GENES: GeneSpec[] = [
  { key: 'l2', min: 0.1, max: 10, log: true, fit: true, label: 'Pull toward KataGo' },
  { key: 'l2Phase', min: 0.5, max: 50, log: true, fit: true, label: 'Phase habits' },
  { key: 'l2Sit', min: 0.5, max: 50, log: true, fit: true, label: 'Ahead/behind habits' },
  { key: 'halfLife', min: 0, max: 400, log: false, fit: true, label: 'Recent games' },
  { key: 'temperature', min: 0.5, max: 1.6, log: true, fit: false, label: 'Variety' },
  { key: 'gamma', min: 0, max: 2, log: false, fit: false, label: 'Natural-looking mistakes' },
  { key: 'guardLoss', min: 1.5, max: 10, log: true, fit: false, label: 'Blunder guard size' },
  { key: 'guardPrior', min: 0.002, max: 0.1, log: true, fit: false, label: 'Blunder guard instinct' },
  { key: 'typeK', min: 0, max: 2, log: false, fit: false, label: 'Mistake kinds' },
  { key: 'bookAlpha', min: 0.2, max: 10, log: true, fit: false, label: 'Opening book trust' },
  { key: 'tiltK', min: 0, max: 2, log: false, fit: false, label: 'Tilt after a mistake' },
];

export function clampGenome(g: Partial<Genome>): Genome {
  const out = { ...DEFAULT_GENOME };
  for (const s of GENES) {
    const v = g[s.key];
    if (typeof v === 'number' && Number.isFinite(v)) out[s.key] = Math.min(s.max, Math.max(s.min, v));
  }
  return out;
}

/** Key of the genes that change the learned habits (fits with the same key are shared). */
export const fitKey = (g: Genome) => GENES.filter((s) => s.fit).map((s) => g[s.key].toPrecision(3)).join('|');
