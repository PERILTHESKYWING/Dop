/**
 * Consequence search: why a move that loses only a little is still worse. Two lines are
 * played out with KataGo's best moves for both sides, one after the asked move (A) and one
 * after the better move (B). To save reads each line follows a read's principal variation
 * for as many moves as its visits can vouch for (trustedLen) and reads again only there.
 * Both lines are read at the same plies, so their ownership maps compare like with like.
 *
 * The turning point is the first ply where one of the 9 board regions is worse for the
 * mover in A than in B by TURN_PTS or more and stays worse at every later read. 9 fixed
 * regions were chosen over connected areas because they can be followed from read to read
 * (a connected area changes shape between reads, so "it stays" is ill-defined); the
 * highlight is then narrowed to the region's points that really changed.
 */
import { PASS, type Color, type Loc, type Move } from '../../go/types';
import { afterMoves, fmt1, lineMoves, sideLead, trustedLen, zoneName, zonePoints } from './geometry';
import type { Reader } from './reader';
import type { EngineRead, ExplainPosition } from './types';

/** A region counts once the mover is this many points (summed ownership) worse there. */
export const TURN_PTS = 2.5;
/** ... and stays at least this share of it at every later read. */
export const TURN_STAY = 0.6;
/** A difference first seen at the last read needs this much more to count. */
export const TURN_LAST = 1.5;
/** Points whose ownership moved this much against the mover make the highlight. */
export const POINT_GAP = 0.3;

export interface Checkpoint {
  /** Moves played since the asked position (the first move of the line is ply 1). */
  ply: number;
  read: EngineRead;
}

export interface LineResult {
  first: Loc;
  moves: Move[];
  checkpoints: Checkpoint[];
  /** Why the line stopped: reached lineDepth, out of reads/time, game over, or no move given. */
  ended: 'depth' | 'budget' | 'pass' | 'empty';
}

/**
 * Where and when line A went wrong. The region fields (gap, ownA, ownB, highlight) and the
 * leads are taken at `shownPly`: the turning read itself, or, when the region turned at the
 * very first move (the stone itself makes the difference), the last read, where it shows
 * best how it stayed.
 */
export interface TurningPoint extends RegionLoss {
  ply: number;
  /** The game's move number at that ply. */
  moveNumber: number;
  shownPly: number;
  shownMove: number;
  /** The mover's lead at shownPly in each line. */
  leadA: number;
  leadB: number;
}

export interface ConsequenceResult {
  a: LineResult;
  b: LineResult;
  /** Plies read in both lines. */
  common: number[];
  turning: TurningPoint | null;
}

/** Where each region stands between two ownership maps, for the mover (A minus B). */
export function zoneGaps(ownA: Float32Array, ownB: Float32Array, mover: Color, size: number): number[] {
  const s = mover === 1 ? 1 : -1;
  return zonePoints(size).map((pts) => {
    let g = 0;
    for (const p of pts) g += s * (ownA[p] - ownB[p]);
    return g;
  });
}

/** A region where the mover is worse off in A than in B. */
export interface RegionLoss {
  zone: number;
  region: string;
  /** Summed ownership difference for the mover (negative). */
  gap: number;
  /** Average Black-positive ownership of the highlighted points in A and in B. */
  ownA: number;
  ownB: number;
  highlight: Loc[];
}

function regionAt(ownA: Float32Array, ownB: Float32Array, mover: Color, size: number, zone: number, gap: number): RegionLoss {
  const s = mover === 1 ? 1 : -1;
  const pts = zonePoints(size)[zone];
  let highlight = pts.filter((p) => s * (ownA[p] - ownB[p]) <= -POINT_GAP);
  if (!highlight.length) highlight = pts.filter((p) => s * (ownA[p] - ownB[p]) < 0);
  const avg = (own: Float32Array) => highlight.reduce((t, p) => t + own[p], 0) / Math.max(1, highlight.length);
  return { zone, region: zoneName(zone), gap, ownA: avg(ownA), ownB: avg(ownB), highlight };
}

/** The region where A is worst for the mover against B, if it is at least `minPts` worse. */
export function regionLoss(ownA: Float32Array, ownB: Float32Array, mover: Color, size: number, minPts: number): RegionLoss | null {
  const gaps = zoneGaps(ownA, ownB, mover, size);
  let pick = 0;
  for (let z = 1; z < 9; z++) if (gaps[z] < gaps[pick]) pick = z;
  if (gaps[pick] > -minPts) return null;
  return regionAt(ownA, ownB, mover, size, pick, gaps[pick]);
}

/**
 * The turning point between two lines read at the same plies, or null (no region turns and
 * stays). Of the regions that turn, the one where the loss lands (worst at the last read)
 * is reported, at the first read where it turned.
 */
export function findTurningPoint(a: readonly Checkpoint[], b: readonly Checkpoint[], mover: Color, size: number, startMove: number): TurningPoint | null {
  const byPly = new Map(b.map((c) => [c.ply, c]));
  const pairs = a
    .filter((c) => byPly.has(c.ply) && c.read.ownership && byPly.get(c.ply)!.read.ownership)
    .map((c) => ({ ply: c.ply, a: c.read, b: byPly.get(c.ply)!.read }));
  if (!pairs.length) return null;
  const gaps = pairs.map((p) => zoneGaps(p.a.ownership!, p.b.ownership!, mover, size));
  const last = pairs.length - 1;
  let pick = -1;
  let pickK = -1;
  for (let z = 0; z < 9; z++) {
    let first = -1;
    for (let k = 0; k < pairs.length && first < 0; k++) {
      const need = k === last && pairs.length > 1 ? TURN_PTS * TURN_LAST : TURN_PTS;
      if (gaps[k][z] > -need) continue;
      let stays = true;
      for (let j = k + 1; j < pairs.length; j++) if (gaps[j][z] > -TURN_PTS * TURN_STAY) stays = false;
      if (stays) first = k;
    }
    if (first < 0) continue;
    if (pick < 0 || gaps[last][z] < gaps[last][pick]) {
      pick = z;
      pickK = first;
    }
  }
  if (pick < 0) return null;
  const shown = pickK > 0 ? pickK : last;
  const { a: ra, b: rb, ply } = pairs[shown];
  return {
    ply: pairs[pickK].ply,
    moveNumber: startMove + pairs[pickK].ply - 1,
    shownPly: ply,
    shownMove: startMove + ply - 1,
    ...regionAt(ra.ownership!, rb.ownership!, mover, size, pick, gaps[shown][pick]),
    leadA: sideLead(ra.bLead, mover),
    leadB: sideLead(rb.bLead, mover),
  };
}

interface LineState {
  res: LineResult;
  pos: ExplainPosition;
  done: boolean;
}

/**
 * Play both lines out. `a.read` / `b.read` are reads already made right after the first
 * move (reused as ply 1); a missing one is read here at lineVisits.
 */
export async function playLines(
  reader: Reader,
  pos: ExplainPosition,
  a: { loc: Loc; read?: EngineRead | null },
  b: { loc: Loc; read?: EngineRead | null },
  names: { a: string; b: string },
): Promise<ConsequenceResult> {
  const { budget } = reader;
  const mover = pos.toPlay;
  const size = pos.size;
  const start = pos.moves.length + 1;
  const mk = (first: Loc): LineState => ({
    res: { first, moves: lineMoves(mover, [first]), checkpoints: [], ended: 'depth' },
    pos: afterMoves(pos, [first]),
    done: false,
  });
  const lines = [mk(a.loc), mk(b.loc)];
  const given = [a.read ?? null, b.read ?? null];
  const label = [names.a, names.b];

  const note = (i: number, r: EngineRead, ply: number) => {
    const lead = sideLead(r.bLead, mover);
    const who = lead >= 0 ? `${mover === 1 ? 'Black' : 'White'} ahead by ${fmt1(lead)}` : `${mover === 1 ? 'Black' : 'White'} behind by ${fmt1(-lead)}`;
    reader.think(`Played out ${label[i]} to move ${start + ply - 1} → ${who}`);
  };

  // Ply 1 for both lines.
  for (let i = 0; i < 2; i++) {
    let r = given[i];
    if (!r) {
      r = await reader.read(lines[i].pos, budget.lineVisits);
      if (r) note(i, r, 1);
    }
    if (!r) {
      lines[i].done = true;
      lines[i].res.ended = 'budget';
      continue;
    }
    lines[i].res.checkpoints.push({ ply: 1, read: r });
  }

  // Reads at the same plies: 1, 1+stride, 1+2*stride, ... up to lineDepth.
  const perLine = Math.floor(reader.readsLeft() / 2);
  const depth = Math.max(1, budget.lineDepth);
  const trustCap = Math.max(2, trustedLen(budget.lineVisits * 0.7));
  const stride = perLine > 0 ? Math.max(2, Math.min(trustCap, Math.ceil((depth - 1) / perLine))) : depth;
  const nextStop = (ply: number) => Math.min(depth, 1 + (Math.floor((ply - 1) / stride) + 1) * stride);

  while (lines.some((l) => !l.done)) {
    for (let i = 0; i < 2; i++) {
      const L = lines[i];
      if (L.done) continue;
      const cps = L.res.checkpoints;
      const last = cps[cps.length - 1];
      if (last.ply >= depth) {
        L.done = true;
        L.res.ended = 'depth';
        continue;
      }
      const top = last.read.candidates[0];
      if (!top || !top.pv.length) {
        L.done = true;
        L.res.ended = 'empty';
        continue;
      }
      const n = Math.min(trustedLen(top.visits), top.pv.length, nextStop(last.ply) - last.ply);
      let follow = top.pv.slice(0, Math.max(1, n));
      // Two passes end the game: stop the line there.
      const lastMove = L.res.moves[L.res.moves.length - 1];
      let prevPass = lastMove?.loc === PASS;
      let cut = follow.length;
      for (let j = 0; j < follow.length; j++) {
        if (follow[j] === PASS && prevPass) {
          cut = j;
          break;
        }
        prevPass = follow[j] === PASS;
      }
      follow = follow.slice(0, cut);
      if (!follow.length) {
        L.done = true;
        L.res.ended = 'pass';
        continue;
      }
      const toMove = L.pos.toPlay;
      L.res.moves.push(...lineMoves(toMove, follow));
      L.pos = afterMoves(L.pos, follow);
      const ply = last.ply + follow.length;
      if (reader.readsLeft() <= 0) {
        L.done = true;
        L.res.ended = 'budget';
        continue;
      }
      const left = lines.reduce((t, l) => t + (l.done ? 0 : Math.max(1, Math.ceil((depth - l.res.checkpoints[l.res.checkpoints.length - 1].ply) / stride))), 0);
      const r = await reader.read(L.pos, budget.lineVisits, left * budget.lineVisits);
      if (!r) {
        L.done = true;
        L.res.ended = 'budget';
        continue;
      }
      cps.push({ ply, read: r });
      note(i, r, ply);
    }
  }

  const plyB = new Set(lines[1].res.checkpoints.map((c) => c.ply));
  const common = lines[0].res.checkpoints.map((c) => c.ply).filter((p) => plyB.has(p));
  const turning = findTurningPoint(lines[0].res.checkpoints, lines[1].res.checkpoints, mover, size, start);
  return { a: lines[0].res, b: lines[1].res, common, turning };
}

/** The two lines cut at a ply (the turning point, or the last common read). */
export function cutAt(moves: readonly Move[], ply: number): Move[] {
  return moves.slice(0, Math.max(1, ply));
}

/**
 * The turning point in words, lower case: "by move 27 the lower right is mostly White's (0.7)
 * instead of Black's (0.4)". A region that turned at the first move (the stone itself) is
 * described at the last read.
 */
export function turnPhrase(tp: TurningPoint, mover: Color): string {
  const c = `${ownerWords(tp.ownA)} instead of ${ownerWords(tp.ownB)}`;
  if (tp.ply > 1) return `by move ${tp.moveNumber} the ${tp.region} is ${c}`;
  if (tp.shownPly > tp.ply) return `the ${tp.region} is worse for ${mover === 1 ? 'Black' : 'White'} from the first move, and by move ${tp.shownMove} it is ${c}`;
  return `right after the move the ${tp.region} is ${c}`;
}

/** Where a consequence line is cut: where the turning point is shown. */
export function cutPly(tp: TurningPoint): number {
  return tp.shownPly;
}

export const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** "the upper right is mostly White's (0.7) instead of Black's (0.4)". */
export function ownershipContrast(region: string, ownA: number, ownB: number): string {
  return `the ${region} is ${ownerWords(ownA)} instead of ${ownerWords(ownB)}`;
}

/** "mostly White's (0.7)", "Black's (0.4)", "even (0.1)" from a Black-positive average. */
export function ownerWords(v: number): string {
  const r = Math.round(Math.abs(v) * 10) / 10;
  const n = r.toFixed(1);
  if (r < 0.2) return `about even (${n})`;
  const who = v > 0 ? "Black's" : "White's";
  return r >= 0.6 ? `mostly ${who} (${n})` : `${who} (${n})`;
}

