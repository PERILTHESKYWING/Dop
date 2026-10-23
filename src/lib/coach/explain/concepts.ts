/**
 * Concept detectors. Each fires only on clear evidence from the reads the planner made, and
 * its evidence line carries KataGo's numbers. Not detected (no reliable signal from these
 * reads yet): ladder, thickness, overconcentration, aji. See docs/handoff/kami-engine.md.
 */
import { chebyshev, lineOf } from '../../go/coords';
import { other, PASS, type Color, type Loc, type Move } from '../../go/types';
import { boardOf, colorAdj, colorWord, coord, fmt1, groupAnchor, groupOwn, looseGroups, pct, stonesNear, type StoneGroup } from './geometry';
import { dyingGroups, GROUP_SHIFT, purposes, type Purpose } from './effects';
import { EQUAL_PTS, type Findings } from './planner';
import type { ConceptHit, EngineRead } from './types';

/** A reply this close (Chebyshev) to a move answers it locally (19x19; smaller boards use less). */
export const LOCAL_R = 3;
export const localR = (size: number) => (size >= 15 ? LOCAL_R : 2);
/** The mover's stones at or below this ownership are weak enough that giving them up is a real option. */
export const SAC_OWN = 0.35;
/** Playing elsewhere instead of answering must cost this much for sente. */
export const SENTE_PTS = 1.5;
/** Without a tenuki candidate to price, this share of visits on local replies makes sente (with at least SENTE_VISITS). */
export const SENTE_SHARE = 0.95;
export const SENTE_VISITS = 40;
/** Group ownership (for its colour) in this band is "weak". */
export const WEAK_LO = -0.3;
export const WEAK_HI = 0.35;
/** At or below this a group is dead; it counts as "was alive" at or above ALIVE. */
export const DEAD = -0.6;
export const ALIVE = 0.3;
/** Playing elsewhere must lose this much for "urgent". */
export const URGENT_PTS = 1.5;
/** Summed ownership gain, near the edge and sure (territory) or toward the centre and not sure (influence). */
export const TERRITORY_PTS = 3;
export const INFLUENCE_PTS = 4;
/** A move this far from the opponent's last move plays elsewhere (19x19; smaller boards use less). */
export const TENUKI_R = 6;
export const tenukiR = (size: number) => (size >= 15 ? TENUKI_R : 4);
/** Playing elsewhere is worth naming only when answering locally is this much worse. */
export const TENUKI_GAIN = 0.5;

interface Ctx {
  f: Findings;
  size: number;
  mover: Color;
  opp: Color;
  C: (l: Loc) => string;
  groups: StoneGroup[];
}

/** KataGo's ownership (-1..1, for one side) as a share: 0.6 is 80%. */
const share = (v: number) => Math.round(50 + 50 * Math.max(-1, Math.min(1, v)));

const groupName = (ctx: Ctx, g: StoneGroup) => `${colorAdj(g.color)} ${g.stones.length > 1 ? 'group' : 'stone'} at ${ctx.C(groupAnchor(g, ctx.size))}`;
const nearGroup = (g: StoneGroup, loc: Loc, size: number, r: number) => loc !== PASS && g.stones.some((s) => chebyshev(s, loc, size) <= r);

/** Sente or gote for a move, from the read right after it. */
export function senteGote(ctx: Ctx, move: Loc, after: EngineRead | null, variation?: string): ConceptHit | null {
  const { f, size, opp, C } = ctx;
  if (!after || move === PASS) return null;
  const cands = after.candidates.filter((c) => c.visits > 0);
  if (!cands.length) return null;
  const total = cands.reduce((t, c) => t + c.visits, 0);
  const local = (l: Loc) => l !== PASS && chebyshev(l, move, size) <= localR(size);
  const top = cands[0];
  const localShare = cands.filter((c) => local(c.loc)).reduce((t, c) => t + c.visits, 0) / total;
  const contact = stonesNear(f.board, move, 2);
  const hit = (id: 'sente' | 'gote', evidence: string): ConceptHit => ({ id, at: [move], evidence, ...(variation ? { variation } : {}) });
  if (local(top.loc)) {
    // Sente needs KataGo's own line to show it: the opponent answers locally and then the
    // mover's next move is elsewhere (tenuki). A reply that starts a fight (Q10 met by the cut
    // at R10, then Black has to go on locally) is not sente (critics, 2026-10-23).
    if (!senteInLine(move, top.pv, size)) return null;
    const tenuki = cands.filter((c) => !local(c.loc) && c.visits >= 3).sort((a, b) => b.scoreLead - a.scoreLead)[0];
    if (tenuki) {
      const cost = top.scoreLead - tenuki.scoreLead;
      if (cost >= SENTE_PTS && localShare >= 0.6) {
        return hit('sente', `After ${C(move)}, ${colorWord(opp)}'s best reply is ${C(top.loc)} nearby; playing elsewhere (${C(tenuki.loc)}) costs ${colorWord(opp)} ${fmt1(cost)} points.`);
      }
    } else if (localShare >= SENTE_SHARE && contact && total >= SENTE_VISITS) {
      return hit('sente', `After ${C(move)}, ${colorWord(opp)} answers nearby at ${C(top.loc)}: KataGo spends ${pct(localShare)} of its visits on replies there.`);
    }
    return null;
  }
  // Gote only for a contact play (a stone next to it or diagonal): a local exchange that ended.
  if (stonesNear(f.board, move, 1) && top.visits / total >= 0.3) {
    return hit('gote', `After ${C(move)}, ${colorWord(opp)}'s best reply is elsewhere (${C(top.loc)}): the local play is over and ${colorWord(opp)} moves first somewhere else.`);
  }
  return null;
}

/**
 * Whether a line after `move` (the opponent's reply first) shows sente: the reply is local and
 * the mover's next move in the line is away from both (or a pass). A line too short to show the
 * mover's next move shows nothing.
 */
export function senteInLine(move: Loc, pv: readonly Loc[] | undefined, size: number): boolean {
  if (!pv || pv.length < 2) return false;
  const [reply, next] = pv;
  const r = localR(size);
  if (reply === PASS || chebyshev(reply, move, size) > r) return false;
  return next === PASS || (chebyshev(next, move, size) > r + 1 && chebyshev(next, reply, size) > r + 1);
}

/** Weak groups in the position (near `focus` when given), from the root read's ownership. */
export function weakGroups(ctx: Ctx, focus: Loc[] | null, max: number): ConceptHit[] {
  const own = ctx.f.root?.ownership;
  if (!own) return [];
  const out: { g: StoneGroup; v: number }[] = [];
  for (const g of ctx.groups) {
    if (g.stones.length < 2) continue;
    const v = groupOwn(g, own);
    if (v < WEAK_LO || v > WEAK_HI) continue;
    if (focus && !focus.some((l) => nearGroup(g, l, ctx.size, 2))) continue;
    out.push({ g, v });
  }
  out.sort((a, b) => b.g.stones.length - a.g.stones.length);
  return out.slice(0, max).map(({ g, v }) => ({
    id: 'weak-group' as const,
    at: [groupAnchor(g, ctx.size)],
    evidence:
      v >= 0
        ? `The ${groupName(ctx, g)} (${g.stones.length} stones) is weak: KataGo gives ${colorWord(g.color)} only ${share(v)}% ownership of its stones.`
        : `The ${groupName(ctx, g)} (${g.stones.length} stones) is weak: KataGo already gives ${colorWord(other(g.color))} ${share(-v)}% ownership of its stones.`,
  }));
}

/** Groups that are alive in `ref` but dead in `end` (the asked move's line). */
export function deadGroups(ctx: Ctx, end: Float32Array | null | undefined, ref: Float32Array | null | undefined, refWords: string, variation?: string): ConceptHit[] {
  if (!end || !ref) return [];
  const hits: { n: number; hit: ConceptHit }[] = [];
  for (const g of ctx.groups) {
    if (g.stones.length < 2) continue;
    const a = groupOwn(g, end);
    const b = groupOwn(g, ref);
    if (a > DEAD || b < ALIVE) continue;
    hits.push({
      n: g.stones.length,
      hit: {
      id: 'dead-group',
      at: [groupAnchor(g, ctx.size)],
      evidence: `The ${groupName(ctx, g)} (${g.stones.length} stones) dies: KataGo gives ${colorWord(other(g.color))} ${share(-a)}% ownership of its stones, against ${share(b)}% for ${colorWord(g.color)} ${refWords}.`,
      ...(variation ? { variation } : {}),
      },
    });
  }
  return hits.sort((x, y) => y.n - x.n).slice(0, 2).map((h) => h.hit);
}

/** Groups KataGo already counts as dead in the position (overview). */
export function alreadyDead(ctx: Ctx): ConceptHit[] {
  const own = ctx.f.root?.ownership;
  if (!own) return [];
  return ctx.groups
    .filter((g) => g.stones.length >= 3 && groupOwn(g, own) <= -0.7)
    .sort((a, b) => b.stones.length - a.stones.length)
    .slice(0, 2)
    .map((g) => ({
      id: 'dead-group' as const,
      at: [groupAnchor(g, ctx.size)],
      evidence: `The ${groupName(ctx, g)} (${g.stones.length} stones) is already dead: KataGo gives ${colorWord(other(g.color))} ${share(-groupOwn(g, own))}% ownership of its stones.`,
    }));
}

/**
 * Territory or influence: how a move's ownership differs from a reference (another move's
 * read, or the position before it). Territory = sure points (>= 0.6) gained near the edge
 * (lines 1-4); influence = unsure gains further in (line 5 and up).
 */
export function territoryInfluence(ctx: Ctx, move: Loc, ownX: Float32Array | null | undefined, ref: Float32Array | null | undefined, refWords: string, scale: number, variation?: string): ConceptHit[] {
  if (!ownX || !ref || move === PASS) return [];
  const { f, size, mover, C } = ctx;
  const s = mover === 1 ? 1 : -1;
  let terr = 0;
  let infl = 0;
  const tPts: Loc[] = [];
  for (let p = 0; p < size * size; p++) {
    if (f.board.stones[p] || p === move) continue;
    const d = s * (ownX[p] - ref[p]);
    if (d <= 0) continue;
    const mine = s * ownX[p];
    if (lineOf(p, size) <= 4) {
      if (mine >= 0.6 && d >= 0.2) {
        terr += d;
        tPts.push(p);
      }
    } else if (mine < 0.6) infl += d;
  }
  const hits: ConceptHit[] = [];
  const v = variation ? { variation } : {};
  if (terr >= TERRITORY_PTS * scale) {
    hits.push({ id: 'territory', at: [move], evidence: `After ${C(move)}, ${colorWord(mover)} has about ${fmt1(terr)} more points of sure area near the edge than ${refWords}.`, ...v });
  }
  if (infl >= INFLUENCE_PTS * scale && infl > terr) {
    hits.push({ id: 'influence', at: [move], evidence: `After ${C(move)}, ${colorWord(mover)} has about ${fmt1(infl)} more points of potential toward the center than ${refWords}, though none of it is sure yet.`, ...v });
  }
  return hits;
}

/** Urgent: the best move tends a weak group and playing elsewhere loses. */
export function urgent(ctx: Ctx, variation?: string): ConceptHit | null {
  const { f, size, C } = ctx;
  const best = f.best;
  const own = f.root?.ownership;
  if (!best || !own || best.loc === PASS || !f.root) return null;
  const weak = ctx.groups.find((g) => g.stones.length >= 2 && nearGroup(g, best.loc, size, 2) && groupOwn(g, own) >= WEAK_LO && groupOwn(g, own) <= WEAK_HI);
  if (!weak) return null;
  const far = (l: Loc) => l === PASS || !nearGroup(weak, l, size, 4);
  const name = `the weak ${groupName(ctx, weak)} (${colorWord(weak.color)} has only ${share(groupOwn(weak, own))}% ownership of it)`;
  const hit = (evidence: string): ConceptHit => ({ id: 'urgent', at: [best.loc], evidence, ...(variation ? { variation } : {}) });
  const asked = f.asked;
  if (asked && !asked.isBest && asked.legal && (asked.read || f.mode === 'unchecked') && far(asked.loc) && asked.loss >= URGENT_PTS) {
    return hit(`${C(best.loc)} is urgent: it is next to ${name}; ${C(asked.loc)} elsewhere is ${fmt1(asked.loss)} points worse.`);
  }
  const elsewhere = f.root.candidates.filter((c) => c.visits >= 3 && far(c.loc)).sort((a, b) => b.scoreLead - a.scoreLead)[0];
  if (elsewhere && best.lead - elsewhere.scoreLead >= URGENT_PTS) {
    return hit(`${C(best.loc)} is urgent: it is next to ${name}; the best move elsewhere, ${C(elsewhere.loc)}, is ${fmt1(best.lead - elsewhere.scoreLead)} points worse.`);
  }
  const total = f.root.candidates.reduce((t, c) => t + c.visits, 0);
  const nearShare = f.root.candidates.filter((c) => !far(c.loc)).reduce((t, c) => t + c.visits, 0) / Math.max(1, total);
  if (!elsewhere && nearShare >= 0.9) {
    return hit(`${C(best.loc)} is urgent: it is next to ${name}, and KataGo spends ${pct(nearShare)} of its visits there.`);
  }
  return null;
}

/** Big point: a move in open space on the third or fourth line that KataGo rates (nearly) best. */
export function bigPoint(ctx: Ctx, move: Loc, loss: number, variation?: string): ConceptHit | null {
  const { f, size, C } = ctx;
  if (move === PASS || stonesNear(f.board, move, 3)) return null;
  const line = lineOf(move, size);
  if (line !== 3 && line !== 4) return null;
  if (loss > 1) return null;
  const rating = loss < 0.05 ? 'rates it best' : `rates it within ${fmt1(loss)} points of the best`;
  return {
    id: 'big-point',
    at: [move],
    evidence: `${C(move)} is on the ${line === 3 ? 'third' : 'fourth'} line in open space (no stones nearby), and KataGo ${rating}.`,
    ...(variation ? { variation } : {}),
  };
}

/** Tenuki: a move far from the opponent's last (local) move. */
export function tenuki(ctx: Ctx, move: Loc, loss: number, variation?: string): ConceptHit | null {
  const { f, size, C } = ctx;
  const last = f.pos.moves[f.pos.moves.length - 1];
  if (!last || last.loc === PASS || last.color === f.mover || move === PASS || !f.root || !f.best) return null;
  if (chebyshev(move, last.loc, size) < tenukiR(size) || !stonesNear(f.board, last.loc, 2)) return null;
  const v = variation ? { variation } : {};
  const isBest = move === f.best.loc;
  if (isBest) {
    const local = f.root.candidates.filter((c) => c.visits >= 3 && c.loc !== PASS && chebyshev(c.loc, last.loc, size) <= localR(size))[0];
    if (local && f.best.lead - local.scoreLead < TENUKI_GAIN) return null;
    const evidence = local
      ? `KataGo plays elsewhere (${C(move)}) instead of answering ${C(last.loc)}: the best reply nearby, ${C(local.loc)}, is ${fmt1(f.best.lead - local.scoreLead)} points worse.`
      : `KataGo plays elsewhere (${C(move)}) instead of answering ${C(last.loc)}; no move near ${C(last.loc)} is among its choices.`;
    return { id: 'tenuki', at: [move], evidence, ...v };
  }
  if (loss >= URGENT_PTS && chebyshev(f.best.loc, last.loc, size) <= localR(size)) {
    return { id: 'tenuki', at: [move], evidence: `${C(move)} plays elsewhere and leaves ${C(last.loc)} unanswered; KataGo answers at ${C(f.best.loc)}, ${fmt1(loss)} points better.`, ...v };
  }
  return null;
}

export function miai(ctx: Ctx, variation?: string): ConceptHit | null {
  const { f, opp, C } = ctx;
  const m = f.miai;
  if (!m) return null;
  return {
    id: 'miai',
    at: [m.a, m.b],
    evidence: `${C(m.a)} and ${C(m.b)} are nearly equal (${fmt1(m.gap)} points apart), and after ${C(m.a)} ${colorWord(opp)}'s best reply is ${C(m.reply)}: when one side takes one, the other takes the other.`,
    ...(variation ? { variation } : {}),
  };
}

/**
 * The opponent's answer to the asked move lands on (or right next to) KataGo's best move:
 * the asked move gave that point away. Only for real losses, never for "about as good".
 */
export function keyPointOf(f: Findings): { reply: Loc; exact: boolean } | null {
  const a = f.asked;
  const best = f.best;
  if (!a || !best || a.isBest || !a.legal || a.reply === undefined || a.reply === PASS || best.loc === PASS) return null;
  if (a.loss < EQUAL_PTS) return null;
  const d = chebyshev(a.reply, best.loc, f.pos.size);
  return d <= 1 ? { reply: a.reply, exact: d === 0 } : null;
}

/** "Urgent for both sides": the opponent answered the asked move by taking KataGo's point. */
export function keyPointHit(ctx: Ctx, variation?: string): ConceptHit | null {
  const { f, C, opp } = ctx;
  const key = keyPointOf(f);
  if (!key || !f.asked || !f.best) return null;
  const where = key.exact ? C(f.best.loc) : `${C(key.reply)}, next to ${C(f.best.loc)}`;
  return {
    id: 'urgent',
    at: [f.best.loc],
    evidence: `${C(f.best.loc)} is urgent for both sides: after ${C(f.asked.loc)}, ${colorWord(opp)}'s best answer is ${where}.`,
    ...(variation ? { variation } : {}),
  };
}

/**
 * Whether the side that did not play `move` has to answer it locally, from the read right
 * after it (`responder` to play): 'sente' when the best reply is nearby and playing elsewhere
 * costs SENTE_PTS (or nearly all visits go to nearby replies), 'gote' when the best reply is
 * elsewhere, null when unclear.
 */
export function answeredLocally(ctx: Ctx, move: Loc, after: EngineRead | null): { kind: 'sente' | 'gote'; reply: Loc; cost: number | null } | null {
  const { size } = ctx;
  if (!after || move === PASS) return null;
  const cands = after.candidates.filter((c) => c.visits > 0);
  if (!cands.length) return null;
  const total = cands.reduce((t, c) => t + c.visits, 0);
  const local = (l: Loc) => l !== PASS && chebyshev(l, move, size) <= localR(size);
  // "Elsewhere" means really elsewhere: a move one step outside the local box still answers.
  const away = (l: Loc) => l === PASS || chebyshev(l, move, size) > localR(size) + 1;
  const top = cands[0];
  if (local(top.loc)) {
    const localShare = cands.filter((c) => !away(c.loc)).reduce((t, c) => t + c.visits, 0) / total;
    const tenuki = cands.filter((c) => away(c.loc) && c.visits >= 3).sort((a, b) => b.scoreLead - a.scoreLead)[0];
    if (tenuki) {
      const cost = top.scoreLead - tenuki.scoreLead;
      return cost >= SENTE_PTS && localShare >= 0.6 ? { kind: 'sente', reply: top.loc, cost } : null;
    }
    return localShare >= SENTE_SHARE && total >= SENTE_VISITS ? { kind: 'sente', reply: top.loc, cost: null } : null;
  }
  return top.visits / total >= 0.3 ? { kind: 'gote', reply: top.loc, cost: null } : null;
}

/**
 * Double sente (ryou-sente) and reverse sente (gyaku-sente) at the best move: the opponent
 * playing there first (after a pass, or after the asked move) must be answered too. Both
 * sides' sente → double sente; only the opponent's → reverse sente (gote for the mover, but
 * it takes away the opponent's sente move).
 */
export function doubleSente(ctx: Ctx, variation?: string): ConceptHit | null {
  const { f, C, mover, opp } = ctx;
  const best = f.best;
  const at = f.oppAt;
  if (!best || !at || best.loc === PASS || chebyshev(at.move, best.loc, ctx.size) > 1) return null;
  const theirs = answeredLocally(ctx, at.move, at.read);
  if (theirs?.kind !== 'sente') return null;
  const mine = answeredLocally(ctx, best.loc, f.afterBest);
  const v = variation ? { variation } : {};
  const cost = (c: number | null, who: Color) => (c !== null ? `; playing elsewhere instead costs ${colorWord(who)} ${fmt1(c)} points` : '');
  if (mine?.kind === 'sente') {
    return {
      id: 'double-sente',
      at: [best.loc],
      evidence: `${C(best.loc)} is sente for both sides: after ${colorWord(mover)} ${C(best.loc)}, ${colorWord(opp)} answers at ${C(mine.reply)}${cost(mine.cost, opp)}; after ${colorWord(opp)} ${C(at.move)}, ${colorWord(mover)} answers at ${C(theirs.reply)}${cost(theirs.cost, mover)}.`,
      ...v,
    };
  }
  if (mine?.kind === 'gote') {
    return {
      id: 'reverse-sente',
      at: [best.loc],
      evidence: `${C(best.loc)} is gote for ${colorWord(mover)}, but if ${colorWord(opp)} plays ${C(at.move)} first, ${colorWord(mover)} has to answer at ${C(theirs.reply)}${cost(theirs.cost, mover)}: it takes away ${colorWord(opp)}'s sente move.`,
      ...v,
    };
  }
  return null;
}

/** Share for one side: 0.6 ownership is 80%. */
const ownShare = (v: number) => Math.round(50 + 50 * Math.max(-1, Math.min(1, v)));

/** Stones the best move saves: the mover's groups that live after it and die if the opponent moves first. */
export function saveStones(ctx: Ctx): ConceptHit | null {
  const { f, C, mover, opp, size } = ctx;
  const best = f.best;
  const t = f.threat;
  const ab = f.afterBest?.ownership;
  if (!best || !t?.read.ownership || !ab || best.loc === PASS) return null;
  const dying = dyingGroups(ctx.groups, t.read.ownership, ab, mover).filter(({ g }) => g.stones.some((q) => chebyshev(q, best.loc, size) <= 3));
  if (!dying.length) return null;
  const g = dying[0].g;
  const n = g.stones.length;
  return {
    id: 'save-stones',
    at: [groupAnchor(g, size), best.loc],
    evidence: `Without ${C(best.loc)}, ${colorWord(opp)} plays ${C(t.move)} and the ${n > 1 ? `${n} ${colorAdj(mover)} stones` : `${colorAdj(mover)} stone`} at ${C(groupAnchor(g, size))} die: KataGo gives ${colorWord(opp)} ${ownShare(-groupOwn(g, t.read.ownership))}% ownership of them, against ${ownShare(groupOwn(g, ab))}% for ${colorWord(mover)} after ${C(best.loc)}.`,
    ...(f.vars.threat ? { variation: f.vars.threat } : {}),
  };
}

/** The first ko capture along a line (replayed from the asked position), if any. */
export function koIn(ctx: Ctx, moves: readonly Move[]): { at: Loc; ply: number } | null {
  const b = boardOf(ctx.f.pos);
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (m.loc === PASS) {
      b.play(PASS, m.color);
      continue;
    }
    if (!b.isLegal(m.loc, m.color)) return null;
    b.play(m.loc, m.color);
    if (b.koPoint !== PASS) return { at: b.koPoint, ply: i + 1 };
  }
  return null;
}

/** A ko in the best line or the asked move's line. */
export function koHit(ctx: Ctx): ConceptHit | null {
  const { f, C } = ctx;
  for (const id of [f.vars.best, f.vars.asked, f.vars.lineB, f.vars.threat]) {
    const v = id ? f.variations.find((x) => x.id === id) : undefined;
    if (!v) continue;
    const k = koIn(ctx, v.moves);
    if (!k) continue;
    const by = v.moves[k.ply - 1];
    return {
      id: 'ko',
      at: [by.loc],
      evidence: `The line runs into a ko: at its move ${k.ply}, ${colorWord(by.color)} captures one stone at ${C(by.loc)} and the other side cannot take back at once.`,
      variation: v.id,
    };
  }
  return null;
}

/**
 * A group too hard to save (XIAO, item 19): the asked move tends a weak or dying group of the
 * mover's, KataGo plays elsewhere, and the asked move loses. Saving it would only make the
 * opponent stronger around it; giving it up and playing elsewhere is the lesson.
 */
export function sacrifice(ctx: Ctx): ConceptHit | null {
  const { f, C, mover, opp, size } = ctx;
  const a = f.asked;
  const best = f.best;
  const own = f.root?.ownership;
  if (!a || !best || !own || a.isBest || !a.legal || a.loss < EQUAL_PTS || best.loc === PASS || a.loc === PASS) return null;
  // The mover's weak stones the asked move tends, while KataGo's move is somewhere else entirely.
  const near = ctx.groups.filter((x) => x.color === mover && x.stones.some((q) => chebyshev(q, a.loc, size) <= 2) && groupOwn(x, own) <= SAC_OWN);
  if (!near.length || near.some((x) => x.stones.some((q) => chebyshev(q, best.loc, size) <= localR(size) + 1))) return null;
  const g = near.sort((x, y) => y.stones.length - x.stones.length)[0];
  const anchor = groupAnchor(g, size);
  const after = a.read?.ownership ?? null;
  const still = after ? groupOwn(g, after) : null;
  // The opponent's stones nearby that the asked move's line makes stronger.
  const end = f.refutation?.endRead?.ownership ?? after;
  const firmer = end
    ? ctx.groups
        .filter((x) => x.color === opp && x.stones.some((q) => chebyshev(q, a.loc, size) <= 3))
        .map((x) => ({ x, d: groupOwn(x, end) - groupOwn(x, own) }))
        .filter((o) => o.d >= GROUP_SHIFT)
        .sort((p, q) => q.d - p.d)[0]
    : undefined;
  const n = g.stones.length;
  return {
    id: 'sacrifice',
    at: [anchor, best.loc, ...(firmer ? [groupAnchor(firmer.x, size)] : [])],
    evidence:
      `${C(a.loc)} tends the ${n > 1 ? `${n} ${colorAdj(mover)} stones` : `${colorAdj(mover)} stone`} at ${C(anchor)}, which KataGo gives ${ownShare(groupOwn(g, own))}% to ${colorWord(mover)}` +
      (still !== null && still <= 0.5 ? ` and still only ${ownShare(still)}% after it` : '') +
      `; KataGo plays elsewhere, at ${C(best.loc)}` +
      (firmer ? `; in the ${C(a.loc)} line ${colorWord(opp)}'s stones at ${C(groupAnchor(firmer.x, size))} get stronger.` : '.'),
    ...(f.vars.asked ? { variation: f.vars.asked } : {}),
  };
}

/** What a move does against the opponent moving first there (the threat read). */
export function movePurposes(ctx: Ctx, move: Loc, after: EngineRead | null | undefined): Purpose[] {
  const t = ctx.f.threat?.read.ownership;
  if (!t || !after?.ownership || move === PASS) return [];
  return purposes(ctx.f.board, move, ctx.mover, after.ownership, t, ctx.groups);
}

/** Reduction and attack (two purposes at once) from a move's purposes. */
export function purposeHits(ctx: Ctx, move: Loc, ps: Purpose[], variation?: string): ConceptHit[] {
  const { C, mover, opp } = ctx;
  const v = variation ? { variation } : {};
  const out: ConceptHit[] = [];
  const red = ps.find((p) => p.kind === 'reduce');
  if (red && red.kind === 'reduce') {
    out.push({ id: 'reduction', at: [move], evidence: `${C(move)} trims ${colorWord(opp)}'s potential in the ${red.region}: about ${fmt1(red.amount)} points of it change hands compared with ${colorWord(opp)} playing there first.`, ...v });
  }
  const press = ps.find((p) => p.kind === 'press');
  const build = ps.find((p) => p.kind === 'framework' || p.kind === 'territory' || p.kind === 'reduce');
  if (press && press.kind === 'press' && build) {
    out.push({
      id: 'attack',
      at: [move, press.at],
      evidence: `${C(move)} presses the ${colorAdj(opp)} ${press.stones > 1 ? 'stones' : 'stone'} at ${C(press.at)} (${colorWord(opp)}'s ownership of ${press.stones > 1 ? 'them' : 'it'} drops by ${pct(press.amount / 2)}) while ${colorWord(mover)} gains in the ${'region' in build ? build.region : 'area'}.`,
      ...v,
    });
  }
  return out;
}

export function conceptContext(f: Findings): Ctx {
  const size = f.pos.size;
  return { f, size, mover: f.mover, opp: other(f.mover), C: (l) => coord(l, size), groups: looseGroups(f.board) };
}

/** Every concept the reads clearly show, most useful first. */
export function detectConcepts(f: Findings): ConceptHit[] {
  if (!f.root || !f.best) return [];
  const ctx = conceptContext(f);
  const out: ConceptHit[] = [];
  const add = (h: ConceptHit | ConceptHit[] | null) => {
    for (const x of Array.isArray(h) ? h : h ? [h] : []) {
      if (!out.some((o) => o.id === x.id && o.at.join() === x.at.join())) out.push(x);
    }
  };
  const best = f.best;
  const asked = f.asked && f.asked.legal && !f.asked.isBest ? f.asked : null;
  const bestVar = f.vars.lineB && f.lineMovesFrom?.b === best.loc ? f.vars.lineB : f.vars.best;

  // The asked move's own story first: what dies, what it misses.
  if (asked) {
    if (f.refutation) {
      add(deadGroups(ctx, f.refutation.endRead.ownership, f.refutation.against === 'best' ? f.afterBest?.ownership : f.root.ownership, f.refutation.against === 'best' ? `after ${ctx.C(best.loc)}` : 'now', f.vars.asked));
    }
    const tp = f.consequence?.turning;
    if (tp && f.consequence) {
      const a = f.consequence.a.checkpoints.find((c) => c.ply === tp.ply)?.read.ownership;
      const b = f.consequence.b.checkpoints.find((c) => c.ply === tp.ply)?.read.ownership;
      add(deadGroups(ctx, a, b, `in the ${ctx.C(best.loc)} line`, f.vars.lineA));
    }
    // When the opponent's answer takes KataGo's point, that is the story: the point was
    // urgent for both sides, and calling the asked move "gote" or "sente" would only blur it.
    const key = keyPointHit(ctx, f.vars.asked);
    add(key);
    if (!key) add(urgent(ctx, bestVar));
    add(tenuki(ctx, asked.loc, asked.loss, f.vars.asked));
    add(senteGote(ctx, best.loc, f.afterBest, bestVar));
    if (!key) add(senteGote(ctx, asked.loc, asked.read, f.vars.asked));
    // Territory against influence is a strategy choice: only for small losses, not life and death.
    if (asked.read && f.afterBest && f.mode !== 'refutation' && !out.some((h) => h.id === 'dead-group')) {
      add(territoryInfluence(ctx, best.loc, f.afterBest.ownership, asked.read.ownership, `after ${ctx.C(asked.loc)}`, 1, bestVar));
      add(territoryInfluence(ctx, asked.loc, asked.read.ownership, f.afterBest.ownership, `after ${ctx.C(best.loc)}`, 1, f.vars.asked));
    }
    add(bigPoint(ctx, asked.loc, asked.loss, f.vars.asked));
    add(bigPoint(ctx, best.loc, 0, bestVar));
  } else {
    add(urgent(ctx, bestVar));
    add(senteGote(ctx, best.loc, f.afterBest, bestVar));
    add(tenuki(ctx, best.loc, 0, bestVar));
    add(bigPoint(ctx, best.loc, 0, bestVar));
    if (f.afterBest) add(territoryInfluence(ctx, best.loc, f.afterBest.ownership, f.root.ownership, 'before it', 1.3, bestVar));
    const tp = f.consequence?.turning;
    if (tp && f.consequence && f.other) {
      const a = f.consequence.a.checkpoints.find((c) => c.ply === tp.ply)?.read.ownership;
      const b = f.consequence.b.checkpoints.find((c) => c.ply === tp.ply)?.read.ownership;
      add(deadGroups(ctx, a, b, `in the ${ctx.C(best.loc)} line`, f.vars.lineA));
    }
  }
  // What the reads with a pass add: double or reverse sente, stones saved, a ko, a group to give up.
  add(doubleSente(ctx, f.vars.best));
  add(saveStones(ctx));
  add(sacrifice(ctx));
  const moved = asked && f.mode === 'equal' ? asked.loc : asked ? null : best.loc;
  if (moved !== null) {
    const read = moved === best.loc ? f.afterBest : asked?.read;
    add(purposeHits(ctx, moved, movePurposes(ctx, moved, read), moved === best.loc ? bestVar : f.vars.asked));
  } else if (asked && f.asked?.isBest === false) {
    add(purposeHits(ctx, best.loc, movePurposes(ctx, best.loc, f.afterBest), bestVar));
  }
  add(koHit(ctx));
  // The double-sente story already says sente or gote for the best move.
  if (out.some((h) => h.id === 'double-sente' || h.id === 'reverse-sente')) {
    for (let i = out.length - 1; i >= 0; i--) if ((out[i].id === 'sente' || out[i].id === 'gote') && out[i].at[0] === best.loc) out.splice(i, 1);
  }
  add(miai(ctx, f.vars.best));
  const weak = f.mode === 'overview' ? weakGroups(ctx, null, 2) : weakGroups(ctx, asked ? [best.loc, asked.loc] : [best.loc], 1);
  // A group already shown dying, or tended by an "urgent" move, needs no "weak" line too.
  add(weak.filter((w) => !out.some((h) => (h.id === 'dead-group' || h.id === 'urgent') && (h.at[0] === w.at[0] || h.evidence.includes(` at ${ctx.C(w.at[0])} `)))));
  if (f.mode === 'overview') add(alreadyDead(ctx));
  return out;
}

export type { Ctx as ConceptContext };
