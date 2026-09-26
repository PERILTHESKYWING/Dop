import { PASS, type Color, type Loc } from '../go/types';
import type { PolicyEntry } from '../types';

/** Raw network outputs as returned by kataeval (logits, side-to-move perspective). */
export interface RawNetOutput {
  policyLogits: Float32Array; // size*size + 1, pass last
  value: Float32Array; // [win, loss, noResult] logits, scoreMean, lead (pre-scaled)
  ownership?: Float32Array | null; // size*size, side-to-move perspective, pre-tanh
}

export interface PostProcessParams {
  outputScale: number;
  scoreMeanMultiplier: number;
  leadMultiplier: number;
  /**
   * When set, the winrate is derived from the score lead as 1 / (1 + e^(-lead / scale))
   * instead of the value head. For small networks whose value head is under-confident
   * (see WINRATE_FROM_SCORE in models.ts).
   */
  winrateScale?: number;
}

export const DEFAULT_POSTPROCESS: PostProcessParams = { outputScale: 1, scoreMeanMultiplier: 20, leadMultiplier: 20 };

export interface NetEval {
  /** Probabilities over size*size + 1 (pass last); illegal points are 0. */
  policy: Float32Array;
  /** Black's win probability and score lead. */
  bWin: number;
  bLead: number;
  /** Ownership from Black's perspective in [-1, 1]. */
  ownership?: Float32Array;
}

/**
 * Convert raw kataeval output to probabilities in Black's perspective, the way KataGo's
 * NNEvaluator post-processes it: policy softmax over legal moves, value softmax,
 * score scaling, tanh ownership.
 */
export function processRawOutput(
  raw: RawNetOutput,
  toPlay: Color,
  isLegal: (loc: Loc) => boolean,
  pp: PostProcessParams = DEFAULT_POSTPROCESS,
): NetEval {
  const hw = raw.policyLogits.length - 1;
  const s = pp.outputScale || 1;
  const policy = new Float32Array(hw + 1);
  let max = -Infinity;
  for (let i = 0; i <= hw; i++) {
    const legal = i === hw ? true : isLegal(i);
    const v = raw.policyLogits[i];
    if (legal && Number.isFinite(v) && v * s > max) max = v * s;
  }
  let z = 0;
  for (let i = 0; i <= hw; i++) {
    const legal = i === hw ? true : isLegal(i);
    const v = raw.policyLogits[i];
    if (!legal || !Number.isFinite(v)) continue;
    policy[i] = Math.exp(v * s - max);
    z += policy[i];
  }
  if (z > 0) for (let i = 0; i <= hw; i++) policy[i] /= z;

  const [w, l, n] = [raw.value[0] * s, raw.value[1] * s, raw.value[2] * s];
  const m = Math.max(w, l, n);
  const ew = Math.exp(w - m), el = Math.exp(l - m), en = Math.exp(n - m);
  const leadSide = raw.value[4] * s * pp.leadMultiplier;
  const winSide = pp.winrateScale ? 1 / (1 + Math.exp(-leadSide / pp.winrateScale)) : (ew + 0.5 * en) / (ew + el + en);
  const bWin = toPlay === 1 ? winSide : 1 - winSide;
  const bLead = toPlay === 1 ? leadSide : -leadSide;

  let ownership: Float32Array | undefined;
  if (raw.ownership) {
    ownership = new Float32Array(raw.ownership.length);
    const sign = toPlay === 1 ? 1 : -1;
    for (let i = 0; i < raw.ownership.length; i++) ownership[i] = sign * Math.tanh(raw.ownership[i] * s);
  }
  return { policy, bWin: clamp01(bWin), bLead, ownership };
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0.5);

/** Top-k policy entries (pass encoded as PASS). */
export function topPolicy(policy: Float32Array, k: number, minP = 0.001): PolicyEntry[] {
  const hw = policy.length - 1;
  const idx: number[] = [];
  for (let i = 0; i <= hw; i++) if (policy[i] >= minP) idx.push(i);
  idx.sort((a, b) => policy[b] - policy[a]);
  return idx.slice(0, k).map((i) => ({ loc: i === hw ? PASS : i, p: round(policy[i], 5) }));
}

export const round = (x: number, d = 4) => {
  const f = 10 ** d;
  return Math.round(x * f) / f;
};

/** Quantise ownership (-1..1) to a base64 string of int8. */
export function encodeOwnership(own: Float32Array): string {
  const bytes = new Uint8Array(own.length);
  for (let i = 0; i < own.length; i++) {
    const q = Math.max(-127, Math.min(127, Math.round(own[i] * 127)));
    bytes[i] = q & 0xff;
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function decodeOwnership(s: string | undefined): Float32Array | null {
  if (!s) return null;
  const bin = atob(s);
  const out = new Float32Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    const b = bin.charCodeAt(i);
    out[i] = (b > 127 ? b - 256 : b) / 127;
  }
  return out;
}

/** Winrate/lead of the mover after a move, from the evaluation of the following position. */
export function moverView(bWin: number, bLead: number, mover: Color) {
  return mover === 1 ? { win: bWin, lead: bLead } : { win: 1 - bWin, lead: -bLead };
}
