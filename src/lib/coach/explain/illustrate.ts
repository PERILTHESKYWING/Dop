/**
 * Built positions ("diagrams"): a position made to show one idea on its own, the way a
 * teacher sets up a diagram. Kami never shows one KataGo has not passed:
 *
 *   1. board  every stone and claimed point is on the board, no point is used twice
 *   2. legal  every chain has a liberty, the claimed move is legal (pure rules, no engine)
 *   3. frame  a local diagram can be framed (the rest of the board settled, both sides alive)
 *   4. first  KataGo's first read; a framed diagram's komi is set from it so it starts even
 *   5. komi   the window itself is worth at most maxKomi points (the frame's own share of the
 *             board is taken out first: frames are not split exactly evenly)
 *   6. final  KataGo's final read, at full visits, last of all:
 *        even   neither side's winrate is below minWinrate (setting, default 30%)
 *        claim  the claimed move is KataGo's best move (or within EQUAL_PTS and well visited)
 *        stable the first and final reads agree on the best move
 *        worse  (when claimed) the worse move really is worse by at least WORSE_PTS
 *
 * Every number in a diagram's note comes from those reads. Where the candidates come from:
 * `isolate` cuts the real fight out of the game and frames it (same coordinates, so the
 * student recognises it); `writerSpec` (kami/src/lib/writer.ts) parses a set-up the writer
 * asked for; library and bank positions come in as specs too.
 */
import { Board } from '../../go/board';
import { chebyshev, xy } from '../../go/coords';
import { other, PASS, type Color, type Loc, type Move } from '../../go/types';
import { distToRect, framePosition, problemWindow, rectHeight, rectWidth, type Rect } from '../../problems/frame';
import { colorWord, coord, fmt1, lineMoves, sideLead, trustedLen } from './geometry';
import type { EngineRead, ExplainPosition, Fact, Illustration, IllustrationCheck, IllustrateOptions, Prober } from './types';

export const ILLUSTRATE_DEFAULTS: IllustrateOptions = {
  minWinrate: 0.3,
  firstVisits: 64,
  visits: 200,
  maxKomi: 30,
  maxMs: 12_000,
  max: 1,
};

/** A claimed move this close to KataGo's best (and well visited) still counts as "the best". */
export const EQUAL_PTS = 0.5;
/** A claimed worse move must lose at least this much. */
export const WORSE_PTS = 0.5;
/** Share of the read's visits a near-best claimed move needs. */
const CLAIM_SHARE = 0.1;

export interface DiagramSpec {
  size: number;
  /** The diagram's stones (as set-up stones). */
  stones: Move[];
  toPlay: Color;
  /** Frame this window: `attacker` surrounds it and the rest of the board is settled. */
  frame?: { rect: Rect; attacker: Color } | null;
  /** An already framed position (library examples): its window, and komi is set to make it even. */
  window?: Rect;
  /** Komi for an open (unframed) diagram; framed ones get the komi that makes them even. */
  komi?: number;
  /** What the diagram is meant to show. */
  claim: { best?: Loc; worse?: Loc };
  title: string;
  label: string;
  concept?: string;
  source: Illustration['source'];
}

export interface Verified {
  illustration?: Illustration;
  checks: IllustrationCheck[];
  /** The first failed check's name, when it failed. */
  failed?: string;
  /** Facts the writer may use (each says "in diagram [[dN]]"). */
  facts: Fact[];
  /** Engine reads made and their visits. */
  reads: number;
  visits: number;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Stones as an array (0 empty, 1 black, 2 white). */
function stoneArray(spec: DiagramSpec): Int8Array {
  const a = new Int8Array(spec.size * spec.size);
  for (const m of spec.stones) a[m.loc] = m.color;
  return a;
}

const toSetup = (stones: ArrayLike<number>): Move[] => {
  const out: Move[] = [];
  for (let l = 0; l < stones.length; l++) if (stones[l]) out.push({ color: stones[l] as Color, loc: l });
  return out;
};

/** Checks 1-3: no engine. Returns the checks and the diagram's stones (framed when asked). */
export function staticChecks(spec: DiagramSpec): { checks: IllustrationCheck[]; stones: Int8Array | null } {
  const checks: IllustrationCheck[] = [];
  const n = spec.size * spec.size;
  const add = (name: string, ok: boolean, detail: string) => {
    checks.push({ name, ok, detail });
    return ok;
  };
  const seen = new Set<Loc>();
  const offBoard = spec.stones.filter((m) => !Number.isInteger(m.loc) || m.loc < 0 || m.loc >= n);
  const twice = spec.stones.filter((m) => (seen.has(m.loc) ? true : (seen.add(m.loc), false)));
  const claimed = [spec.claim.best, spec.claim.worse].filter((l): l is Loc => l !== undefined);
  const claimOff = claimed.filter((l) => l < 0 || l >= n || seen.has(l));
  const okBoard =
    offBoard.length === 0 &&
    twice.length === 0 &&
    claimOff.length === 0 &&
    spec.stones.length >= 2 &&
    (spec.claim.best === undefined || spec.claim.best !== spec.claim.worse);
  if (!add('board', okBoard, okBoard ? `${spec.stones.length} stones, all on the board` : offBoard.length ? 'a stone is off the board' : twice.length ? 'two stones on one point' : claimOff.length ? 'a claimed move is on a stone or off the board' : 'too few stones'))
    return { checks, stones: null };

  let stones = stoneArray(spec);
  const legalIn = (a: Int8Array): string | null => {
    const b = new Board(spec.size, a);
    for (const g of b.groups()) if (g.liberties.length === 0) return `the ${colorWord(g.color as Color).toLowerCase()} chain at ${coord(g.stones[0], spec.size)} has no liberty`;
    for (const l of claimed) if (!b.isLegal(l, spec.toPlay)) return `${coord(l, spec.size)} is not a legal move`;
    return null;
  };
  const bad = legalIn(stones);
  if (!add('legal', !bad, bad ?? 'every chain has a liberty')) return { checks, stones: null };

  if (spec.frame) {
    const { rect, attacker } = spec.frame;
    const framed = framePosition(stones, spec.size, rect, attacker);
    if (!add('frame', !!framed, framed ? `${rectWidth(rect)}x${rectHeight(rect)} window, rest of the board settled` : 'the window is too large to frame')) return { checks, stones: null };
    stones = framed!;
    const bad2 = legalIn(stones);
    if (!add('legal', !bad2, bad2 ? `after framing: ${bad2}` : 'still legal after framing')) return { checks, stones: null };
  }
  return { checks, stones };
}

/**
 * Black's points outside the window minus White's: frame stones and the eyes inside each
 * colour's area (area scoring). The frame is split about evenly, not exactly.
 */
export function frameBalance(stones: ArrayLike<number>, size: number, rect: Rect): number {
  let bal = 0;
  for (let l = 0; l < size * size; l++) {
    const [x, y] = xy(l, size);
    if (distToRect(rect, x, y) === 0) continue;
    let c = stones[l];
    if (!c) {
      const ns = [x > 0 ? l - 1 : -1, x < size - 1 ? l + 1 : -1, y > 0 ? l - size : -1, y < size - 1 ? l + size : -1].filter((q) => q >= 0).map((q) => stones[q]);
      c = ns.every((v) => v === 1) ? 1 : ns.every((v) => v === 2) ? 2 : 0;
    }
    bal += c === 1 ? 1 : c === 2 ? -1 : 0;
  }
  return bal;
}

/** KataGo's verdict on a claimed move in a read: is it the best, or as good and well visited? */
function claimHolds(r: EngineRead, loc: Loc): { ok: boolean; loss: number | null } {
  const top = r.candidates[0];
  if (!top) return { ok: false, loss: null };
  if (top.loc === loc) return { ok: true, loss: 0 };
  const c = r.candidates.find((x) => x.loc === loc);
  if (!c) return { ok: false, loss: null };
  const loss = top.scoreLead - c.scoreLead;
  return { ok: loss <= EQUAL_PTS && c.visits >= CLAIM_SHARE * r.visits, loss };
}

/**
 * Checks 1-6, KataGo last. Stops at the first failed check (later reads are not made).
 * `id` is the diagram's id ('d1'); `signal` aborts between reads.
 */
export async function verifyDiagram(
  spec: DiagramSpec,
  prober: Prober,
  id: string,
  options: Partial<IllustrateOptions> = {},
  signal?: AbortSignal,
): Promise<Verified> {
  const o = { ...ILLUSTRATE_DEFAULTS, ...options };
  const count = { reads: 0, visits: 0 };
  const engine = prober;
  prober = {
    async read(pos, b) {
      const r = await engine.read(pos, b);
      count.reads++;
      count.visits += r?.visits ?? 0;
      return r;
    },
  };
  const t0 = Date.now();
  const left = () => Math.max(200, o.maxMs - (Date.now() - t0));
  const { checks, stones } = staticChecks(spec);
  const fail = (name: string, detail: string): Verified => {
    checks.push({ name, ok: false, detail });
    return { checks, failed: name, facts: [], ...count };
  };
  if (!stones) return { checks, failed: checks.find((c) => !c.ok)?.name, facts: [], reads: 0, visits: 0 };
  const size = spec.size;
  const C = (l: Loc) => coord(l, size);
  const mover = spec.toPlay;
  const rect = spec.frame?.rect ?? spec.window;
  const framed = !!rect;
  const base: ExplainPosition = { size, komi: spec.frame ? 0 : spec.komi ?? 7.5, setup: toSetup(stones), moves: [], toPlay: mover };
  const abort = () => {
    if (signal?.aborted) throw signal.reason ?? Object.assign(new Error('stopped'), { name: 'AbortError' });
  };

  abort();
  const total = o.firstVisits + o.visits * (spec.claim.worse !== undefined ? 2 : 1);
  const first = await prober.read(base, { visits: o.firstVisits, maxMs: Math.floor((left() * o.firstVisits) / total) });
  abort();
  if (!first || !first.candidates.length) return fail('first', 'KataGo gave no read');
  checks.push({ name: 'first', ok: true, detail: `${first.visits} visits, best ${C(first.candidates[0].loc)}` });

  /** The komi that makes the diagram even with best play (the problem bank does the same). */
  const evenKomi = (r: EngineRead) => Math.round((base.komi + r.bLead) * 2) / 2;
  if (framed) {
    const komi = evenKomi(first);
    const local = komi - frameBalance(stones, size, rect!);
    if (Math.abs(local) > o.maxKomi) return fail('komi', `the shape alone is worth ${fmt1(Math.abs(local))} points to ${local > 0 ? 'Black' : 'White'} (limit ${o.maxKomi}): it is already decided`);
    base.komi = komi;
    checks.push({ name: 'komi', ok: true, detail: `komi ${fmt1(komi)} makes it even; the shape alone is worth ${fmt1(Math.abs(local))} points` });
  }
  if (spec.claim.best !== undefined && !claimHolds(first, spec.claim.best).ok) {
    return fail('claim', `KataGo's first read prefers ${C(first.candidates[0].loc)} to ${C(spec.claim.best)}`);
  }

  let final = await prober.read(base, { visits: o.visits, maxMs: Math.floor((left() * o.visits) / (total - o.firstVisits)) });
  abort();
  if (!final || !final.candidates.length) return fail('final', 'KataGo gave no final read');
  // A short first read can miss the komi by a few points; a framed diagram gets one retry.
  if (framed && Math.min(final.bWin, 1 - final.bWin) < o.minWinrate && Math.abs(final.bLead) >= 0.5) {
    base.komi = evenKomi(final);
    const local = base.komi - frameBalance(stones, size, rect!);
    if (Math.abs(local) > o.maxKomi) return fail('komi', `the shape alone is worth ${fmt1(Math.abs(local))} points to ${local > 0 ? 'Black' : 'White'} (limit ${o.maxKomi}): it is already decided`);
    const again = await prober.read(base, { visits: o.visits, maxMs: left() });
    abort();
    if (!again || !again.candidates.length) return fail('final', 'KataGo gave no final read');
    checks.push({ name: 'komi', ok: true, detail: `komi corrected to ${fmt1(base.komi)} from the final read` });
    final = again;
  }
  const bWin = final.bWin;
  const low = Math.min(bWin, 1 - bWin);
  if (low < o.minWinrate) {
    return fail('even', `${bWin < 0.5 ? 'Black' : 'White'} would have only ${pct(low)} (minimum ${pct(o.minWinrate)})`);
  }
  checks.push({ name: 'even', ok: true, detail: `Black ${pct(bWin)}, White ${pct(1 - bWin)} (minimum ${pct(o.minWinrate)})` });
  const top = final.candidates[0];
  let bestLoc = top.loc;
  if (spec.claim.best !== undefined) {
    const h = claimHolds(final, spec.claim.best);
    if (!h.ok) return fail('claim', `KataGo's final read prefers ${C(top.loc)} to ${C(spec.claim.best)}`);
    checks.push({ name: 'claim', ok: true, detail: h.loss && h.loss >= 0.05 ? `${C(spec.claim.best)} is within ${fmt1(h.loss)} points of the best` : `${C(spec.claim.best)} is KataGo's best move` });
    bestLoc = spec.claim.best;
  }
  if (first.candidates[0].loc !== top.loc && !(spec.claim.best !== undefined && claimHolds(first, top.loc).ok)) {
    return fail('stable', `the first read chose ${C(first.candidates[0].loc)}, the final read ${C(top.loc)}`);
  }
  checks.push({ name: 'stable', ok: true, detail: 'both reads agree' });
  if (bestLoc === PASS) return fail('claim', 'KataGo passes: nothing to show');

  const facts: Fact[] = [];
  const fact = (text: string) => facts.push({ id: `${id}f${facts.length + 1}`, text });
  const ref = `[[${id}]]`;
  const bestCand = final.candidates.find((c) => c.loc === bestLoc) ?? top;
  const pvLen = Math.max(Math.min(4, bestCand.pv.length), trustedLen(bestCand.visits));
  const line = lineMoves(mover, bestCand.pv.slice(0, pvLen).filter((l, i) => i === 0 || l !== PASS));
  const me = colorWord(mover);
  const noteParts = [`KataGo's best move for ${me} here is ${C(bestLoc)}.`];
  fact(`In diagram ${ref}, KataGo's best move for ${me} is ${C(bestLoc)}.`);
  if (line.length > 1) fact(`In diagram ${ref}, KataGo's line is ${line.map((m) => C(m.loc)).join(' ')}.`);

  if (spec.claim.worse !== undefined) {
    const w = spec.claim.worse;
    const after: ExplainPosition = { ...base, moves: [{ color: mover, loc: w }], toPlay: other(mover) };
    const r = await prober.read(after, { visits: o.visits, maxMs: left() });
    abort();
    if (!r || !r.candidates.length) return fail('worse', `KataGo could not read ${C(w)}`);
    const loss = sideLead(final.bLead, mover) - sideLead(r.bLead, mover);
    if (loss < WORSE_PTS) return fail('worse', `${C(w)} is only ${fmt1(Math.max(0, loss))} points worse`);
    checks.push({ name: 'worse', ok: true, detail: `${C(w)} loses ${fmt1(loss)} points` });
    const reply = r.candidates[0].loc;
    noteParts.push(`${C(w)} is ${fmt1(loss)} points worse${reply !== PASS ? `; ${colorWord(other(mover))} answers ${C(reply)}` : ''}.`);
    fact(`In diagram ${ref}, ${C(w)} is ${fmt1(loss)} points worse than ${C(bestLoc)} for ${me}${reply !== PASS ? `, and ${colorWord(other(mover))} answers ${C(reply)}` : ''}.`);
  }
  if (framed) noteParts.push('The rest of the board is settled and the komi makes it an even game.');

  const view = rect ? ([rect.x0, rect.y0, rect.x1, rect.y1] as [number, number, number, number]) : undefined;
  const illustration: Illustration = {
    id,
    label: spec.label,
    base,
    line,
    highlight: [bestLoc, ...(spec.claim.worse !== undefined ? [spec.claim.worse] : [])],
    title: spec.title,
    note: noteParts.join(' '),
    source: spec.source,
    checks,
    read: { bWin: final.bWin, bLead: final.bLead, visits: final.visits },
  };
  if (spec.concept) illustration.concept = spec.concept;
  if (view) illustration.view = view;
  return { illustration, checks, facts, ...count };
}

/**
 * The real fight on its own: the stones around `focus` (the key moves) cut out of the game,
 * whole chains kept, and the rest of the board replaced by a settled frame. Same coordinates
 * as the game. The side with more stones just outside the window surrounds it (it was the
 * stronger side there). Null when the fight is in the center or too large to cut out.
 */
export function isolate(pos: ExplainPosition, board: Board, focus: Loc[], claim: DiagramSpec['claim'], title: string): DiagramSpec | null {
  const size = pos.size;
  if (size < 13) return null;
  const pts = focus.filter((l) => l !== PASS && l >= 0);
  if (!pts.length) return null;
  const near: Loc[] = [...pts];
  const seen = new Set<Loc>();
  for (let l = 0; l < size * size; l++) {
    if (!board.stones[l] || seen.has(l)) continue;
    if (!pts.some((p) => chebyshev(p, l, size) <= 2)) continue;
    const g = board.groupAt(l)!;
    for (const s of g.stones) seen.add(s);
    near.push(...g.stones);
  }
  const rect = problemWindow(size, near, 1);
  if (!rect) return null;
  const stones: Move[] = [];
  const ring: [number, number, number] = [0, 0, 0];
  for (let l = 0; l < size * size; l++) {
    const c = board.stones[l];
    if (!c) continue;
    const [x, y] = xy(l, size);
    const d = distToRect(rect, x, y);
    if (d === 0) stones.push({ color: c as Color, loc: l });
    else if (d <= 2) ring[c]++;
  }
  if (stones.length < 2) return null;
  const attacker: Color = ring[1] === ring[2] ? other(pos.toPlay) : ring[1] > ring[2] ? 1 : 2;
  return {
    size,
    stones,
    toPlay: pos.toPlay,
    frame: { rect, attacker },
    claim,
    title,
    label: 'on its own',
    source: 'isolated',
  };
}

/** The window's corner or side, in words ("the lower right"). */
export function windowName(rect: Rect, size: number): string {
  const cx = (rect.x0 + rect.x1) / 2;
  const cy = (rect.y0 + rect.y1) / 2;
  const h = cx < size / 3 ? 'left' : cx > (2 * size) / 3 ? 'right' : '';
  const v = cy < size / 3 ? 'upper' : cy > (2 * size) / 3 ? 'lower' : '';
  if (v && h) return `the ${v} ${h}`;
  if (v) return v === 'upper' ? 'the top' : 'the bottom';
  if (h) return `the ${h} side`;
  return 'the center';
}
