/**
 * The explainer's Prober in Node: the site's WASM engine with the bundled b10 network, the
 * same search the browser runs. Used by scripts/explain-bench.ts and scripts/coachlm/factory.ts.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineEvaluator } from '../src/lib/engine/mcts';
import { NNCache } from '../src/lib/engine/nncache';
import { searchProber } from '../src/lib/coach/explain/searchProber';
import type { Prober } from '../src/lib/coach/explain/types';
import { loadNodeEngine } from './nodeEngine';

const models = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models');

/** `winrateScale`: derive winrates from the score lead, as the site does for the bundled b10 (WINRATE_FROM_SCORE). */
export async function nodeProber(size = 19, winrateScale?: number): Promise<Prober> {
  const file = readdirSync(models).find((f) => f.startsWith('g170e-b10c128') && f.endsWith('.bin.gz'));
  if (!file) throw new Error(`no bundled network in ${models}`);
  const eng = await loadNodeEngine(path.join(models, file), 'g170e-b10c128', size, 1, winrateScale);
  return searchProber(engineEvaluator(eng, { cache: new NNCache() }));
}
