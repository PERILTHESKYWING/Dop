/**
 * Native KataGo as an EngineBackend for scripts: each evaluation is a one-visit query to
 * `katago analysis` (the network's own output, one symmetry), turned back into the raw
 * outputs kataeval returns, so the site's own search and pipeline (src/lib) can run on
 * native speed in experiments (scripts/ai-eval.ts). About 20 times the browser engine's
 * speed under Node on the same machine.
 */
import { startKataGo, type KataGo, type KgQuery } from './katagoAnalysis';
import { gtpToLoc, locToGtp } from '../src/lib/go/coords';
import { PASS, type Loc } from '../src/lib/go/types';
import type { EngineBackend, EngineRequest, RawSearchResult } from '../src/lib/engine/types';
import type { RawNetOutput } from '../src/lib/engine/parse';
import type { EngineInfo } from '../src/lib/types';

export interface NativeBackend extends EngineBackend {
  kg: KataGo;
  /** One-visit evaluations made. */
  evals(): number;
  close(): Promise<void>;
}

const gtp = (l: Loc, size: number) => (l === PASS || l < 0 ? 'pass' : locToGtp(l, size));

export function nativeBackend(opts: { binary: string; model: string; modelId: string; threads?: number; winrateScale?: number }): NativeBackend {
  const kg = startKataGo({ binary: opts.binary, model: opts.model, threads: opts.threads ?? 4, oneSymmetry: true });
  let count = 0;
  const info: EngineInfo = { engine: 'katago-native', backend: 'cpu', modelId: opts.modelId, modelName: opts.modelId, modelVersion: 8 };
  const query = (req: EngineRequest, ownership: boolean): KgQuery => ({
    moves: req.moves.map((m) => [m.color === 1 ? 'B' : 'W', gtp(m.loc, req.size)] as [string, string]),
    initialPlayer: req.moves.length ? undefined : req.toPlay === 1 ? 'B' : 'W',
    komi: req.komi,
    boardXSize: req.size,
    boardYSize: req.size,
    maxVisits: 1,
    includePolicy: true,
    includeOwnership: ownership,
  });
  const evalOne = async (req: EngineRequest, ownership: boolean): Promise<RawNetOutput> => {
    // The side to move must match the request (KataGo infers it from the moves).
    const r = await kg.query(query(req, ownership));
    count++;
    const hw = req.size * req.size;
    const policyLogits = new Float32Array(hw + 1);
    const pol = r.policy ?? [];
    for (let i = 0; i <= hw; i++) {
      const p = pol[i] ?? -1;
      policyLogits[i] = p > 0 ? Math.log(p) : -1e9;
    }
    // Values are reported for Black; kataeval's raw outputs are for the side to move.
    const toPlay = r.rootInfo.currentPlayer === 'B' ? 1 : 2;
    if (toPlay !== req.toPlay) throw new Error('side to move mismatch');
    const win = Math.min(1 - 1e-6, Math.max(1e-6, toPlay === 1 ? r.rootInfo.winrate : 1 - r.rootInfo.winrate));
    const lead = toPlay === 1 ? r.rootInfo.scoreLead : -r.rootInfo.scoreLead;
    const value = Float32Array.from([Math.log(win), Math.log(1 - win), -30, lead / 20, lead / 20]);
    let own: Float32Array | null = null;
    if (ownership && r.ownership) {
      own = new Float32Array(hw);
      for (let i = 0; i < hw; i++) {
        const o = Math.max(-0.999, Math.min(0.999, toPlay === 1 ? r.ownership[i] : -r.ownership[i]));
        own[i] = Math.atanh(o);
      }
    }
    return { policyLogits, value, ownership: own };
  };
  return {
    kg,
    info,
    postProcess: { outputScale: 1, scoreMeanMultiplier: 20, leadMultiplier: 20, winrateScale: opts.winrateScale },
    batch: (opts.threads ?? 4) * 2,
    evalRaw: evalOne,
    evalSeqBatchRaw: (reqs) => Promise.all(reqs.map((r) => evalOne(r, !!r.ownership))),
    searchRaw: async (): Promise<RawSearchResult> => {
      throw new Error('searchRaw is not used');
    },
    evals: () => count,
    close: () => kg.close(),
  };
}

export const fromGtp = (s: string, size: number) => (s.toLowerCase() === 'pass' ? PASS : gtpToLoc(s, size));
