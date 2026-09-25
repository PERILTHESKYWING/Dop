import type { Color, Loc, Move } from '../go/types';
import type { EngineInfo } from '../types';
import type { PostProcessParams, RawNetOutput } from './parse';

export interface EngineRequest {
  size: number;
  komi: number;
  /** Setup stones (as leading moves) followed by the game moves. */
  moves: Move[];
  toPlay: Color;
}

export interface RawSearchChild {
  loc: Loc;
  visits: number;
  /** Winrate for the side to move at the root after this child. */
  winrate: number;
  prior: number;
}

export interface RawSearchResult {
  best: Loc;
  winrate: number;
  visits: number;
  pv: Loc[];
  children: RawSearchChild[];
}

/** A loaded KataGo network that can evaluate and search positions. */
export interface EngineBackend {
  readonly info: EngineInfo;
  readonly postProcess: PostProcessParams;
  evalRaw(req: EngineRequest, ownership: boolean): Promise<RawNetOutput>;
  searchRaw(req: EngineRequest, visits: number, maxMs: number): Promise<RawSearchResult>;
}
