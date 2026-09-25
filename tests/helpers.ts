import type { EngineBackend, EngineRequest, RawSearchResult } from '../src/lib/engine/types';
import { DEFAULT_POSTPROCESS, type RawNetOutput } from '../src/lib/engine/parse';
import type { EngineInfo, MoveFeatures, MoveRecord, PointFeatures } from '../src/lib/types';

/** Deterministic fake engine: prefers points near the centre, value from stone balance. */
export class FakeEngine implements EngineBackend {
  info: EngineInfo = { engine: 'fake', backend: 'cpu', modelId: 'fake-net', modelName: 'Fake', modelVersion: 1 };
  postProcess = DEFAULT_POSTPROCESS;
  evals = 0;
  searches = 0;
  async evalRaw(req: EngineRequest, ownership: boolean): Promise<RawNetOutput> {
    this.evals++;
    const n = req.size * req.size;
    const logits = new Float32Array(n + 1);
    const c = (req.size - 1) / 2;
    for (let i = 0; i < n; i++) {
      const x = i % req.size, y = Math.floor(i / req.size);
      logits[i] = -Math.hypot(x - c, y - c) * 0.3;
    }
    logits[n] = -10;
    const black = req.moves.filter((m) => m.color === 1).length;
    const white = req.moves.filter((m) => m.color === 2).length;
    const side = req.toPlay === 1 ? black - white : white - black;
    return { policyLogits: logits, value: new Float32Array([side * 0.1, 0, -5, 0, side * 0.05]), ownership: ownership ? new Float32Array(n) : null };
  }
  async searchRaw(req: EngineRequest, visits: number): Promise<RawSearchResult> {
    this.searches++;
    const c = Math.floor(req.size / 2);
    const best = c * req.size + c;
    return { best, winrate: 0.5, visits, pv: [best], children: [{ loc: best, visits, winrate: 0.5, prior: 0.2 }] };
  }
}

export function pf(p: Partial<PointFeatures> = {}): PointFeatures {
  return {
    line: 3, region: 'side', zone: 0, distLast: 3, local: true, tenuki: false, contact: false, captures: 0, atari: false, selfAtari: false,
    savesAtari: false, extendsSmallWeak: false, nearOwnWeak: false, nearOppWeak: false, nearOwnSafe: false, invasion: false, reduction: false, ownership: 0,
    ...p,
  };
}

export function mf(played: Partial<PointFeatures>, best: Partial<PointFeatures>, rest: Partial<MoveFeatures> = {}): MoveFeatures {
  return {
    phase: 'middlegame', moveNumber: 80, played: pf(played), best: pf(best), ownWeakGroups: 0, oppWeakGroups: 0, ownSmallWeakGroups: 0,
    hasTactics: false, leadBefore: 0, sameZoneAsBest: false, distToBest: 8, lastNearOwnSafe: false, ...rest,
  };
}

export function record(id: string, gameId: string, index: number, contexts: string[], errors: string[], scoreLoss = 0): MoveRecord {
  return {
    id, gameId, index, color: 1, loc: 0, isPlayer: true, bestLoc: 1, playedPolicy: 0.1, playedRank: 2, winrateLoss: scoreLoss / 50, scoreLoss,
    winBefore: 0.5, depth: 'deep', severity: scoreLoss >= 3 ? 'mistake' : 'good', features: mf({}, {}), contexts, errors, size: 19,
  };
}
