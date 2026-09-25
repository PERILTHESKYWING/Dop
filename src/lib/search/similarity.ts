import type { Board } from '../go/board';
import { xy } from '../go/coords';
import { PASS, type Color, type Loc } from '../go/types';
import type { MoveFeatures } from '../types';

const R = 3; // 7x7 window

/**
 * Local stone pattern around a focus point, from the mover's perspective:
 * 0 empty, 1 own, 2 opponent, 3 off-board. Captured in all 8 symmetries.
 */
export function localPatterns(board: Board, focus: Loc, mover: Color): Uint8Array[] {
  const n = board.size;
  const out: Uint8Array[] = [];
  if (focus === PASS || focus < 0) return out;
  const [fx, fy] = xy(focus, n);
  for (let sym = 0; sym < 8; sym++) {
    const p = new Uint8Array((2 * R + 1) ** 2);
    let k = 0;
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        let ax = dx, ay = dy;
        if (sym & 1) ax = -ax;
        if (sym & 2) ay = -ay;
        if (sym & 4) [ax, ay] = [ay, ax];
        const x = fx + ax, y = fy + ay;
        if (x < 0 || y < 0 || x >= n || y >= n) p[k++] = 3;
        else {
          const c = board.stones[y * n + x];
          p[k++] = c === 0 ? 0 : c === mover ? 1 : 2;
        }
      }
    out.push(p);
  }
  return out;
}

export function patternSimilarity(a: Uint8Array[], b: Uint8Array[]): number {
  if (!a.length || !b.length) return 0;
  const q = a[0];
  let best = 0;
  for (const p of b) {
    let same = 0;
    let weight = 0;
    for (let i = 0; i < q.length; i++) {
      // Stones matter more than empty points.
      const w = q[i] || p[i] ? 1 : 0.35;
      weight += w;
      if (q[i] === p[i]) same += w;
    }
    best = Math.max(best, same / weight);
  }
  return best;
}

/** Stone balance in 9 zones, mover-relative; used for whole-board similarity. */
export function zoneVector(board: Board, mover: Color): Float32Array {
  const n = board.size;
  const v = new Float32Array(18);
  for (let i = 0; i < n * n; i++) {
    const c = board.stones[i];
    if (!c) continue;
    const x = i % n, y = Math.floor(i / n);
    const z = (y < n / 3 ? 0 : y < (2 * n) / 3 ? 1 : 2) * 3 + (x < n / 3 ? 0 : x < (2 * n) / 3 ? 1 : 2);
    v[z * 2 + (c === mover ? 0 : 1)] += 1;
  }
  return v;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

/** Similarity of the decision situation (0..1). */
export function featureSimilarity(a: MoveFeatures, b: MoveFeatures): number {
  let s = 0;
  if (a.phase === b.phase) s += 0.2;
  if (a.best.local === b.best.local) s += 0.15;
  if (a.best.region === b.best.region) s += 0.1;
  if (Math.abs(a.best.line - b.best.line) <= 1) s += 0.1;
  if (a.ownWeakGroups > 0 === b.ownWeakGroups > 0) s += 0.1;
  if (a.oppWeakGroups > 0 === b.oppWeakGroups > 0) s += 0.1;
  if (a.hasTactics === b.hasTactics) s += 0.1;
  if (a.best.contact === b.best.contact) s += 0.1;
  s += 0.05 * Math.max(0, 1 - Math.abs(a.moveNumber - b.moveNumber) / 100);
  return s;
}

export interface Fingerprint {
  patterns: Uint8Array[];
  zones: Float32Array;
  features: MoveFeatures;
}

export function positionFingerprint(board: Board, focus: Loc, mover: Color, features: MoveFeatures): Fingerprint {
  return { patterns: localPatterns(board, focus, mover), zones: zoneVector(board, mover), features };
}

export function similarity(a: Fingerprint, b: Fingerprint): number {
  return 0.45 * patternSimilarity(a.patterns, b.patterns) + 0.35 * featureSimilarity(a.features, b.features) + 0.2 * Math.max(0, cosine(a.zones, b.zones));
}
