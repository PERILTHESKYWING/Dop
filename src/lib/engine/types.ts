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

/** A position given by its stones only (no move history), for batched evaluation. */
export interface StonesPosition {
  /** size*size points: 0 empty, 1 black, 2 white. */
  stones: ArrayLike<number>;
  toPlay: Color;
}

/** A loaded KataGo network that can evaluate and search positions. */
export interface EngineBackend {
  readonly info: EngineInfo;
  readonly postProcess: PostProcessParams;
  evalRaw(req: EngineRequest, ownership: boolean): Promise<RawNetOutput>;
  searchRaw(req: EngineRequest, visits: number, maxMs: number): Promise<RawSearchResult>;
  /**
   * Several positions with their move history (and a board symmetry each), spread over the
   * engine's workers and network batches. Results are side-to-move, like evalRaw.
   */
  evalSeqBatchRaw?(reqs: (EngineRequest & { ownership?: boolean; symmetry?: number })[]): Promise<RawNetOutput[]>;
  /** Several positions in one network call; results are side-to-move, like evalRaw. */
  evalBatchRaw?(size: number, komi: number, positions: StonesPosition[]): Promise<RawNetOutput[]>;
  /** Positions per network call worth batching on this device (1 or undefined = no batching). */
  readonly batch?: number;
}
