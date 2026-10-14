import { trainCopy } from './copyTrain';
import { splitByGame, type DoppelExample, type DoppelModel } from './doppel';
import { bestGenome, evolve, type EvoState } from './evolve';
import type { Genome } from './genome';

/** Train (and optionally evolve) a copy off the page's thread. */
export interface CopyRequest {
  id: number;
  examples: DoppelExample[];
  version: number;
  genome?: Genome;
  evo?: EvoState;
  /** Generations of evolution before the final training (0: none). */
  generations: number;
  seed?: number;
}

export type CopyReply =
  | { id: number; type: 'progress'; done: number; total: number; best: number | null }
  | { id: number; type: 'done'; model: DoppelModel }
  | { id: number; type: 'error'; error: string };

/** Evolve on the games the final test does not use, then train the copy with the best settings. */
export function runCopyJob(req: Omit<CopyRequest, 'id'>, onProgress?: (done: number, total: number, best: number | null) => void): DoppelModel {
  let genome = req.genome;
  let evo = req.evo;
  if (req.generations > 0) {
    const real = req.examples.filter((e) => !e.fix && e.y >= 0);
    const { train } = splitByGame(real);
    evo = evolve([...train, ...req.examples.filter((e) => e.fix)], evo, genome, { generations: req.generations, seed: req.seed, onProgress });
    genome = bestGenome(evo) ?? genome;
  }
  return trainCopy(req.examples, { version: req.version, genome, evo });
}
