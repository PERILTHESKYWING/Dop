import { describe, expect, it } from 'vitest';
import { replay } from '../src/lib/go/board';
import { gtpToLoc, lineOf, zoneOf } from '../src/lib/go/coords';
import type { Loc } from '../src/lib/go/types';
import { budgetFor, buildLmPrompt, explain, explainWithBudget, MODELS, type Budget, type EngineRead, type Explanation, type ExplainPosition, type Prober, type Question } from '../src/lib/coach/explain';
import { conceptContext, bigPoint, deadGroups, miai, senteGote, tenuki, territoryInfluence, urgent, weakGroups } from '../src/lib/coach/explain/concepts';
import { findTurningPoint, zoneGaps, type Checkpoint } from '../src/lib/coach/explain/consequence';
import { runPlan, type Findings } from '../src/lib/coach/explain/planner';
import { numbersIn } from '../src/lib/coach/explain/text';

const S = 9;
const P = (s: string) => gtpToLoc(s, S);

/** Ownership with a value per region (zoneOf's 3x3 grid on 9x9), Black positive. */
function own(zones: Partial<Record<number, number>> = {}, base = 0): Float32Array {
  const o = new Float32Array(S * S).fill(base);
  for (let p = 0; p < S * S; p++) {
    const z = zoneOf(p, S);
    if (zones[z] !== undefined) o[p] = zones[z]!;
  }
  return o;
}

interface Cand {
  at: string;
  lead: number;
  win?: number;
  visits?: number;
  pv?: string[];
}

/** A read of a position: Black's lead/winrate and candidates for the side to move (their values). */
function read(bLead: number, bWin: number, cands: Cand[], ownership: Float32Array | null = own()): EngineRead {
  return {
    visits: cands.reduce((t, c) => t + (c.visits ?? 10), 1),
    bWin,
    bLead,
    ownership,
    candidates: cands.map((c) => ({ loc: P(c.at), winrate: c.win ?? 0.5, scoreLead: c.lead, visits: c.visits ?? 10, pv: (c.pv ?? [c.at]).map(P) })),
  };
}

/** Black C3, White G7, Black C7, White G3; Black to play. */
const BASE: ExplainPosition = {
  size: S,
  komi: 7,
  setup: [],
  moves: [
    { color: 1, loc: P('C3') },
    { color: 2, loc: P('G7') },
    { color: 1, loc: P('C7') },
    { color: 2, loc: P('G3') },
  ],
  toPlay: 1,
};

type Script = (extra: Loc[], pos: ExplainPosition) => EngineRead | null;

function fake(script: Script) {
  const calls: { extra: Loc[]; budget: { visits: number; maxMs: number } }[] = [];
  const prober: Prober = {
    async read(pos, budget) {
      const extra = pos.moves.slice(BASE.moves.length).map((m) => m.loc);
      calls.push({ extra, budget });
      return script(extra, pos);
    },
  };
  return { prober, calls };
}

const ROOT = read(1.37, 0.58, [
  { at: 'E5', lead: 1.37, win: 0.58, visits: 80, pv: ['E5', 'D4', 'F5', 'E4', 'D6', 'F4'] },
  { at: 'C5', lead: 0.12, win: 0.52, visits: 15, pv: ['C5', 'E5', 'D4'] },
  { at: 'G5', lead: -0.71, win: 0.47, visits: 6, pv: ['G5', 'E5'] },
]);

/**
 * The asked move B5 loses `loss` points; line A (after B5) loses the lower right from its
 * second read on, line B (after E5) keeps it.
 */
function scenario(askedLead: number, opts: { lowerRightTurn?: boolean } = {}): Script {
  const turn = opts.lowerRightTurn ?? true;
  return (extra) => {
    if (!extra.length) return ROOT;
    const first = extra[0];
    const ply = extra.length;
    const line = ['D4', 'F5', 'E4', 'D6', 'F4', 'D5', 'E6', 'F6', 'E3', 'D3', 'F3', 'E7', 'D7', 'F7', 'E2', 'D2', 'F2', 'E8', 'D8', 'F8', 'B2', 'B8', 'H2', 'H8'];
    const toMove = ply % 2 ? 'white' : 'black';
    const next = line.slice(ply - 1, ply + 7);
    const cands = (lead: number): Cand[] => [{ at: next[0] ?? 'A1', lead, visits: 40, pv: next.length ? next : ['A1'] }];
    if (first === P('E5')) {
      const bLead = ply === 1 ? 1.22 : 1.31;
      return read(bLead, 0.57, cands(toMove === 'white' ? -bLead : bLead), own({ 8: 0.43 }));
    }
    if (first === P('B5')) {
      const bLead = ply === 1 ? askedLead : askedLead - 0.4;
      const lr = turn && ply > 1 ? -0.72 : 0.43;
      return read(bLead, 0.49, cands(toMove === 'white' ? -bLead : bLead), own({ 8: lr }));
    }
    if (first === P('C5')) return read(0.12, 0.52, cands(-0.12), own({ 8: 0.43 }));
    return read(0, 0.5, cands(0));
  };
}

const why = (at: string, kind: Question['kind'] = 'why-not'): Question => ({ kind, move: P(at), text: `Why not ${at}?` });

/** Every number a student reads is in a fact, a concept's evidence or a variation note. */
function numbersSupported(ex: Explanation) {
  const pool = new Set<string>();
  for (const t of [...ex.facts.map((f) => f.text), ...ex.concepts.map((c) => c.evidence), ...ex.variations.flatMap((v) => [v.note ?? '', v.label, String(v.scoreLoss ?? '')])]) {
    for (const n of numbersIn(t)) pool.add(n);
  }
  const used = numbersIn([ex.summary, ...ex.sections.map((s) => s.text)].join(' '));
  return used.filter((n) => !pool.has(n));
}

/** Decimals in the facts and evidence that no read gives (directly or as a difference of two reads). */
function inventedDecimals(ex: Explanation, reads: EngineRead[]) {
  const ok = new Set<string>();
  const add = (x: number) => {
    for (const d of [-0.1, 0, 0.1]) ok.add(String(Number((Math.round(Math.abs(x) * 10) / 10 + d).toFixed(1))));
  };
  const leads: number[] = [];
  for (const r of reads) {
    leads.push(r.bLead, -r.bLead);
    for (const c of r.candidates) leads.push(c.scoreLead, -c.scoreLead);
    if (r.ownership) for (const v of r.ownership) add(v);
  }
  for (const a of leads) {
    add(a);
    for (const b of leads) add(a - b);
  }
  for (const a of reads) for (const b of reads) if (a.ownership && b.ownership) for (const g of zoneGaps(a.ownership, b.ownership, 1, S)) add(g);
  const text = [...ex.facts.map((f) => f.text), ...ex.concepts.map((c) => c.evidence), ...ex.variations.map((v) => v.note ?? '')].join(' ');
  return numbersIn(text).filter((n) => n.includes('.') && !ok.has(n));
}

function recordingScript(script: Script) {
  const reads: EngineRead[] = [];
  const wrapped: Script = (extra, pos) => {
    const r = script(extra, pos);
    if (r) reads.push(r);
    return r;
  };
  return { reads, script: wrapped };
}

describe('Kami explain: budgets', () => {
  it('Hane is tiny and the deeper models grow with the thinking level', () => {
    for (const t of ['off', 'low', 'medium', 'high'] as const) {
      const h = budgetFor('hane', t);
      expect(h.reads).toBeLessThanOrEqual(2);
      expect(h.lineDepth).toBe(0);
    }
    for (const m of ['tesuji', 'myoshu'] as const) {
      const levels = (['off', 'low', 'medium', 'high'] as const).map((t) => budgetFor(m, t));
      for (let i = 1; i < levels.length; i++) {
        expect(levels[i].reads).toBeGreaterThanOrEqual(levels[i - 1].reads);
        expect(levels[i].visits).toBeGreaterThanOrEqual(levels[i - 1].visits);
        expect(levels[i].lineDepth).toBeGreaterThanOrEqual(levels[i - 1].lineDepth);
        expect(levels[i].maxMs).toBeGreaterThanOrEqual(levels[i - 1].maxMs);
      }
    }
    expect(budgetFor('tesuji', 'medium').maxMs).toBeLessThanOrEqual(15000);
    expect(MODELS.map((m) => m.id)).toEqual(['hane', 'tesuji', 'myoshu']);
  });

  it('never makes more reads than the budget allows', async () => {
    const qs: Question[] = [{ kind: 'best', text: '' }, { kind: 'overview', text: '' }, why('B5'), why('E5', 'why-move'), why('C5')];
    for (const model of ['hane', 'tesuji', 'myoshu'] as const) {
      for (const thinking of ['off', 'medium', 'high'] as const) {
        for (const q of qs) {
          const { prober, calls } = fake(scenario(-0.21));
          const ex = await explain(BASE, q, prober, { model, thinking });
          expect(calls.length).toBe(ex.reads);
          expect(ex.reads).toBeLessThanOrEqual(budgetFor(model, thinking).reads);
          expect(ex.thoughts.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('stops reading when the time is up and gives each read only the time left', async () => {
    let clock = 0;
    const { prober, calls } = fake((extra, pos) => {
      clock += 4000;
      return scenario(-0.21)(extra, pos);
    });
    const budget: Budget = { reads: 10, visits: 100, lineVisits: 30, lineDepth: 20, maxMs: 10000 };
    const f = await runPlan(BASE, why('B5'), prober, budget, { now: () => clock });
    expect(f.reads).toBe(3);
    let t = 0;
    for (const c of calls) {
      expect(c.budget.maxMs).toBeLessThanOrEqual(10000 - t);
      t += 4000;
    }
  });
});

describe('Kami explain: abort', () => {
  it('rejects with an AbortError and reads no more after the signal', async () => {
    const ctl = new AbortController();
    const { prober, calls } = fake(scenario(-0.21));
    const p = explain(BASE, why('B5'), prober, { model: 'tesuji', thinking: 'high', signal: ctl.signal, onThought: () => ctl.abort() });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls.length).toBe(1);
  });

  it('does not wait for a read in flight', async () => {
    const ctl = new AbortController();
    const prober: Prober = { read: () => new Promise(() => {}) };
    const p = explain(BASE, { kind: 'best', text: '' }, prober, { model: 'tesuji', thinking: 'medium', signal: ctl.signal });
    setTimeout(() => ctl.abort(), 10);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects at once when already aborted', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const { prober, calls } = fake(scenario(-0.21));
    await expect(explain(BASE, why('B5'), prober, { model: 'hane', thinking: 'off', signal: ctl.signal })).rejects.toBeDefined();
    expect(calls.length).toBe(0);
  });
});

describe('Kami explain: what to read', () => {
  const budget = budgetFor('tesuji', 'medium');

  it('a big loss gets a refutation from the reply PV', async () => {
    const f = await runPlan(BASE, why('B5'), fake(scenario(-3.9)).prober, budget);
    expect(f.mode).toBe('refutation');
    expect(f.asked?.loss).toBeCloseTo(5.27, 2);
    const v = f.variations.find((x) => x.id === f.vars.asked)!;
    expect(v.kind).toBe('refutation');
    expect(v.moves[0].loc).toBe(P('B5'));
    expect(v.moves.length).toBeGreaterThan(2);
    expect(f.consequence).toBeUndefined();
  });

  it('a small loss gets a consequence search with a turning point', async () => {
    const f = await runPlan(BASE, why('B5'), fake(scenario(-0.21)).prober, budget);
    expect(f.mode).toBe('consequence');
    expect(f.asked?.loss).toBeCloseTo(1.58, 2);
    const cons = f.consequence!;
    expect(cons.common.length).toBeGreaterThan(1);
    // Both lines are read at the same plies.
    expect(cons.a.checkpoints.map((c) => c.ply).slice(0, cons.common.length)).toEqual(cons.b.checkpoints.map((c) => c.ply).slice(0, cons.common.length));
    const tp = cons.turning!;
    expect(tp.region).toBe('lower right');
    expect(tp.ply).toBeGreaterThan(1);
    const v = f.variations.find((x) => x.id === f.vars.lineA)!;
    expect(v.kind).toBe('consequence');
    // Cut where the lines turn, or shown whole up to where they meet again (move order).
    expect(v.moves.length).toBe(f.moveOrder ? f.moveOrder.ply : tp.ply);
    expect(v.highlight!.every((p) => zoneOf(p, S) === 8)).toBe(true);
    // Ownership as shares (0.7 is 85%), with "leaning" under 0.6; no raw decimals.
    expect(v.note).toMatch(/^By move \d+ the lower right is White's \(\d{2}%\) instead of leaning Black's \(\d{2}%\)\.$/);
    expect(v.note).not.toMatch(/0\.\d/);
  });

  it('a slow loss with no region turning says it is spread out and still shows the line', async () => {
    const f = await runPlan(BASE, why('B5'), fake(scenario(-0.21, { lowerRightTurn: false })).prober, budget);
    expect(f.mode).toBe('consequence');
    expect(f.consequence!.turning).toBeNull();
    const v = f.variations.find((x) => x.id === f.vars.lineA)!;
    expect(v.moves.length).toBeGreaterThan(3);
    expect(v.note).toMatch(/spread/);
  });

  it('a big loss where the opponent simply plays elsewhere is played out, not "refuted"', async () => {
    const script: Script = (extra, pos) => {
      const r = scenario(-3.9)(extra, pos);
      // After B5 White's best reply is far away (H9).
      if (r && extra.length === 1 && extra[0] === P('B5')) return { ...r, candidates: [{ ...r.candidates[0], loc: P('H9'), pv: [P('H9'), P('D4')] }] };
      return r;
    };
    const f = await runPlan(BASE, why('B5'), fake(script).prober, budget);
    expect(f.mode).toBe('consequence');
  });

  it('an asked move that reads better than the first look is called good, not "worse"', async () => {
    const rec = recordingScript(scenario(3.9));
    const ex = await explainWithBudget(BASE, why('B5'), fake(rec.script).prober, budget, { model: 'tesuji', thinking: 'medium' });
    // Celebrated (XIAO: "Look at you! 🎯"), never called worse.
    expect(ex.summary).toMatch(/^(Look at you|Nice move|Good eye|Lovely move)!/);
    expect(ex.summary).not.toMatch(/worse/);
    expect(numbersSupported(ex)).toEqual([]);
    expect(inventedDecimals(ex, rec.reads)).toEqual([]);
  });

  it('about equal moves are shown side by side; Hane shows a small loss as a what-if', async () => {
    const eq = await runPlan(BASE, why('B5'), fake(scenario(1.1)).prober, budget);
    expect(eq.mode).toBe('equal');
    const hane = await runPlan(BASE, why('B5'), fake(scenario(-0.21)).prober, budgetFor('hane', 'medium'));
    expect(hane.mode).toBe('whatif');
    expect(hane.reads).toBe(2);
  });

  it('asking about the best move compares it with the runner-up', async () => {
    const f = await runPlan(BASE, why('E5', 'why-move'), fake(scenario(-0.21)).prober, budget);
    expect(f.mode).toBe('good');
    expect(f.other?.loc).toBe(P('C5'));
    expect(f.other?.loss).toBeCloseTo(1.25, 2);
  });

  it('an illegal move falls back to the best move', async () => {
    const f = await runPlan(BASE, why('C3'), fake(scenario(-0.21)).prober, budget);
    expect(f.mode).toBe('illegal');
    expect(f.vars.best).toBeDefined();
  });
});

describe('Kami explain: turning point', () => {
  const cp = (ply: number, zones: Partial<Record<number, number>>): Checkpoint => ({ ply, read: read(0, 0.5, [], own(zones)) });

  it('finds the first read where a region turns and stays', () => {
    const a = [cp(1, { 8: 0.4 }), cp(7, { 8: -0.7 }), cp(13, { 8: -0.6 })];
    const b = [cp(1, { 8: 0.4 }), cp(7, { 8: 0.4 }), cp(13, { 8: 0.5 })];
    const tp = findTurningPoint(a, b, 1, S, 21)!;
    expect(tp.ply).toBe(7);
    expect(tp.moveNumber).toBe(27);
    expect(tp.region).toBe('lower right');
    expect(tp.ownA).toBeCloseTo(-0.7, 5);
    expect(tp.ownB).toBeCloseTo(0.4, 5);
    expect(tp.highlight.length).toBe(9);
  });

  it('ignores a region that recovers, and works for White', () => {
    const a = [cp(1, {}), cp(7, { 0: -0.6 }), cp(13, { 0: 0.3 })];
    const b = [cp(1, {}), cp(7, { 0: 0.3 }), cp(13, { 0: 0.3 })];
    expect(findTurningPoint(a, b, 1, S, 21)).toBeNull();
    // For White, Black-positive ownership going up is the loss.
    const w = findTurningPoint([cp(1, {}), cp(5, { 2: 0.6 })], [cp(1, {}), cp(5, { 2: -0.5 })], 2, S, 30)!;
    expect(w.region).toBe('upper right');
    expect(w.ply).toBe(5);
  });

  it('a region that turns at the first move is shown at the last read', () => {
    const a = [cp(1, { 6: -0.2 }), cp(7, { 6: -0.5 })];
    const b = [cp(1, { 6: 0.3 }), cp(7, { 6: 0.6 })];
    const tp = findTurningPoint(a, b, 1, S, 11)!;
    expect(tp.ply).toBe(1);
    expect(tp.shownPly).toBe(7);
    expect(tp.ownA).toBeCloseTo(-0.5, 5);
  });

  it('names the region that gained in a trade', () => {
    const a = [cp(1, {}), cp(7, { 8: -0.7, 0: 0.8 })];
    const b = [cp(1, {}), cp(7, { 8: 0.4, 0: 0.2 })];
    const tp = findTurningPoint(a, b, 1, S, 21)!;
    expect(tp.region).toBe('lower right');
    expect(tp.gain?.region).toBe('upper left');
    expect(tp.gain?.gap).toBeCloseTo(5.4, 4);
  });

  it('a difference seen only at the last read must be bigger', () => {
    const a = [cp(1, {}), cp(7, {}), cp(13, { 4: -0.35 })];
    const b = [cp(1, {}), cp(7, {}), cp(13, { 4: 0 })];
    expect(findTurningPoint(a, b, 1, S, 21)).toBeNull();
  });
});

describe('Kami explain: concepts', () => {
  /** Findings for detector tests: the root position plus whatever reads the test gives. */
  function findings(over: Partial<Findings> = {}, pos: ExplainPosition = BASE): Findings {
    const f: Findings = {
      pos,
      question: { kind: 'best', text: '' },
      budget: budgetFor('tesuji', 'medium'),
      mover: pos.toPlay,
      board: replay(pos.size, pos.setup, pos.moves),
      mode: 'best',
      root: ROOT,
      best: { loc: P('E5'), lead: 1.37, win: 0.58, visits: 80, pv: [] },
      alternatives: [],
      afterBest: null,
      vars: { alts: [] },
      variations: [],
      reads: 1,
      visits: 100,
      thoughts: [],
      ms: 0,
      ...over,
    };
    return f;
  }

  it('sente when the reply is local and playing elsewhere costs; not when it is cheap', () => {
    const ctx = conceptContext(findings());
    const after = (tenukiLead: number) => read(1, 0.55, [{ at: 'D3', lead: -1.0, visits: 60 }, { at: 'G5', lead: tenukiLead, visits: 8 }]);
    expect(senteGote(ctx, P('D4'), after(-3.1))?.id).toBe('sente');
    expect(senteGote(ctx, P('D4'), after(-3.1))?.evidence).toContain('2.1 points');
    expect(senteGote(ctx, P('D4'), after(-1.2))).toBeNull();
  });

  it('gote when a contact move lets the opponent play elsewhere; nothing for a move in open space', () => {
    const ctx = conceptContext(findings());
    const after = read(1, 0.55, [{ at: 'G5', lead: -1, visits: 50 }, { at: 'D3', lead: -1.4, visits: 10 }]);
    expect(senteGote(ctx, P('D4'), after)?.id).toBe('gote');
    expect(senteGote(ctx, P('E5'), read(1, 0.55, [{ at: 'A9', lead: -1, visits: 50 }]))).toBeNull();
  });

  it('weak and dead groups from ownership', () => {
    // A 2-stone black group at C3-C4.
    const pos: ExplainPosition = { ...BASE, moves: [...BASE.moves, { color: 1, loc: P('C4') }, { color: 2, loc: P('G6') }] };
    const weakOwn = own({}, 0);
    for (const p of [P('C3'), P('C4')]) weakOwn[p] = 0.1;
    const ctxWeak = conceptContext(findings({ root: { ...ROOT, ownership: weakOwn } }, pos));
    expect(weakGroups(ctxWeak, null, 2).map((h) => h.id)).toContain('weak-group');
    const strongOwn = own({}, 0.9);
    const ctxStrong = conceptContext(findings({ root: { ...ROOT, ownership: strongOwn } }, pos));
    expect(weakGroups(ctxStrong, null, 2)).toEqual([]);

    const end = own({}, 0);
    end[P('C3')] = -0.8;
    end[P('C4')] = -0.8;
    const ref = own({}, 0);
    ref[P('C3')] = 0.6;
    ref[P('C4')] = 0.6;
    const dead = deadGroups(ctxWeak, end, ref, 'after E5', 'v2');
    expect(dead[0]?.id).toBe('dead-group');
    expect(dead[0]?.evidence).toContain('80% for Black');
    const half = own({}, 0);
    half[P('C3')] = -0.3;
    half[P('C4')] = -0.3;
    expect(deadGroups(ctxWeak, half, ref, 'after E5')).toEqual([]);
  });

  it('territory near the edge, influence toward the center', () => {
    const pos19: ExplainPosition = { size: 19, komi: 7.5, setup: [], moves: [{ color: 1, loc: gtpToLoc('Q16', 19) }, { color: 2, loc: gtpToLoc('D4', 19) }], toPlay: 1 };
    const ctx = conceptContext(findings({ root: { ...ROOT, ownership: new Float32Array(361) } }, pos19));
    const ref = new Float32Array(361);
    const edge = new Float32Array(361);
    for (let p = 0; p < 361; p++) if (p >= 19 * 16 && p % 19 >= 6 && p % 19 <= 12) edge[p] = 0.8; // the bottom edge, K1-K3 area
    expect(territoryInfluence(ctx, gtpToLoc('K3', 19), edge, ref, 'before it', 1).map((h) => h.id)).toEqual(['territory']);
    const center = new Float32Array(361);
    for (let p = 0; p < 361; p++) if (lineOf(p, 19) >= 7) center[p] = 0.4;
    expect(territoryInfluence(ctx, gtpToLoc('K10', 19), center, ref, 'before it', 1).map((h) => h.id)).toEqual(['influence']);
    expect(territoryInfluence(ctx, gtpToLoc('K3', 19), ref, ref, 'before it', 1)).toEqual([]);
  });

  it('urgent when the best move tends a weak group and the asked move elsewhere loses; not without a weak group', () => {
    const o = own({}, 0);
    o[P('C3')] = 0.1;
    o[P('C4')] = 0.1;
    const pos: ExplainPosition = { ...BASE, moves: [...BASE.moves, { color: 1, loc: P('C4') }, { color: 2, loc: P('G6') }] };
    const asked = { loc: P('H8'), legal: true, isBest: false, read: ROOT, lead: -1, win: 0.4, loss: 2.4 };
    const f = findings({ root: { ...ROOT, ownership: o }, best: { loc: P('D4'), lead: 1.4, win: 0.6, visits: 80, pv: [] }, asked }, pos);
    expect(urgent(conceptContext(f))?.id).toBe('urgent');
    const g = findings({ root: { ...ROOT, ownership: own({}, 0.9) }, best: { loc: P('D4'), lead: 1.4, win: 0.6, visits: 80, pv: [] }, asked }, pos);
    expect(urgent(conceptContext(g))).toBeNull();
  });

  it('big point in open space on the third or fourth line; not next to stones', () => {
    const big: ExplainPosition = { size: 19, komi: 7.5, setup: [], moves: [{ color: 1, loc: gtpToLoc('Q16', 19) }, { color: 2, loc: gtpToLoc('D4', 19) }], toPlay: 1 };
    const f = findings({ root: { ...ROOT, ownership: new Float32Array(361) } }, big);
    const ctx = conceptContext(f);
    expect(bigPoint(ctx, gtpToLoc('K4', 19), 0)?.id).toBe('big-point');
    expect(bigPoint(ctx, gtpToLoc('E4', 19), 0)).toBeNull();
    expect(bigPoint(ctx, gtpToLoc('K10', 19), 0)).toBeNull();
  });

  it('tenuki when the best move ignores the last local move; not when it answers', () => {
    const pos: ExplainPosition = { size: 19, komi: 7.5, setup: [], moves: [{ color: 1, loc: gtpToLoc('Q16', 19) }, { color: 2, loc: gtpToLoc('R14', 19) }], toPlay: 1 };
    const root19 = read(0.5, 0.52, [{ at: 'D4', lead: 0.5, visits: 60 }]);
    root19.candidates = [
      { loc: gtpToLoc('D4', 19), winrate: 0.52, scoreLead: 0.5, visits: 60, pv: [] },
      { loc: gtpToLoc('R13', 19), winrate: 0.5, scoreLead: -0.3, visits: 20, pv: [] },
    ];
    const f = findings({ root: root19, best: { loc: gtpToLoc('D4', 19), lead: 0.5, win: 0.52, visits: 60, pv: [] } }, pos);
    const hit = tenuki(conceptContext(f), gtpToLoc('D4', 19), 0);
    expect(hit?.id).toBe('tenuki');
    expect(hit?.evidence).toContain('0.8 points');
    const g = findings({ root: root19, best: { loc: gtpToLoc('R13', 19), lead: 0.5, win: 0.52, visits: 60, pv: [] } }, pos);
    expect(tenuki(conceptContext(g), gtpToLoc('R13', 19), 0)).toBeNull();
  });

  it('miai when the best move makes the near-equal runner-up the reply; not otherwise', async () => {
    const root = read(0.3, 0.52, [
      { at: 'C5', lead: 0.3, visits: 40, pv: ['C5', 'G5'] },
      { at: 'G5', lead: 0.1, visits: 35, pv: ['G5', 'C5'] },
    ]);
    const script = (reply: string): Script => (extra) => (extra.length === 0 ? root : read(0.2, 0.51, [{ at: reply, lead: -0.2, visits: 40, pv: [reply] }]));
    const yes = await runPlan(BASE, { kind: 'best', text: '' }, fake(script('G5')).prober, budgetFor('hane', 'medium'));
    expect(yes.miai).toBeDefined();
    expect(miai(conceptContext(yes))?.id).toBe('miai');
    const no = await runPlan(BASE, { kind: 'best', text: '' }, fake(script('E8')).prober, budgetFor('hane', 'medium'));
    expect(no.miai).toBeUndefined();
    expect(miai(conceptContext(no))).toBeNull();
  });
});

describe('Kami explain: text from reads only', () => {
  const cases: [string, Question, number, 'hane' | 'tesuji' | 'myoshu'][] = [
    ['refutation', why('B5'), -3.9, 'tesuji'],
    ['consequence', why('B5'), -0.21, 'tesuji'],
    ['equal', why('B5'), 1.1, 'tesuji'],
    ['what-if', why('B5'), -0.21, 'hane'],
    ['good', why('E5', 'why-move'), -0.21, 'tesuji'],
    ['best', { kind: 'best', text: '' }, -0.21, 'myoshu'],
    ['overview', { kind: 'overview', text: '' }, -0.21, 'tesuji'],
  ];
  for (const [name, q, lead, model] of cases) {
    it(`${name}: every number comes from a read and every number in the text is in a fact`, async () => {
      const rec = recordingScript(scenario(lead));
      const ex = await explainWithBudget(BASE, q, fake(rec.script).prober, budgetFor(model, 'medium'), { model, thinking: 'medium' });
      expect(ex.summary.length).toBeGreaterThan(10);
      expect(ex.facts.length).toBeGreaterThan(0);
      expect(numbersSupported(ex)).toEqual([]);
      expect(inventedDecimals(ex, rec.reads)).toEqual([]);
      // [[vN]] refs point at real variations.
      const ids = new Set(ex.variations.map((v) => v.id));
      for (const m of [ex.summary, ...ex.sections.map((s) => s.text)].join(' ').matchAll(/\[\[(v\d+)\]\]/g)) expect(ids.has(m[1])).toBe(true);
    });
  }

  it('feeds the shared writer prompt', async () => {
    const ex = await explain(BASE, why('B5'), fake(scenario(-0.21)).prober, { model: 'myoshu', thinking: 'medium' });
    const prompt = buildLmPrompt(ex, 'about 5k');
    for (const f of ex.facts) expect(prompt).toContain(f.text);
    for (const v of ex.variations) expect(prompt).toContain(`[[${v.id}]]`);
  });

  it('says so when KataGo gives nothing', async () => {
    const ex = await explain(BASE, { kind: 'best', text: '' }, { read: async () => null }, { model: 'tesuji', thinking: 'medium' });
    expect(ex.summary).toMatch(/could not read/);
    expect(ex.variations).toEqual([]);
  });
});

describe('Kami explain: the key point', () => {
  /** B5 is answered by White taking E5, KataGo's own choice for Black. */
  const keyScript: Script = (extra, pos) => {
    if (!extra.length) return ROOT;
    if (extra[0] === P('B5') && extra.length === 1) return read(-0.6, 0.45, [{ at: 'E5', lead: 0.6, visits: 60, pv: ['E5', 'D4', 'F5', 'E4'] }], own());
    return scenario(-0.6)(extra, pos);
  };

  it('leads with the opponent taking the point KataGo wanted', async () => {
    const ex = await explain(BASE, why('B5'), fake(keyScript).prober, { model: 'tesuji', thinking: 'medium' });
    // E5 is the point both sides want: the answer leads with it, never with "the point Black should have played".
    expect(ex.summary).toMatch(/^B5 is (playable|a big point), but E5 is even bigger here!/);
    expect(ex.summary).not.toContain('should have played');
    const urgentHit = ex.concepts.find((c) => c.id === 'urgent');
    expect(urgentHit?.evidence).toContain('urgent for both sides');
    // Not also called "gote" or "sente": the key point is the story.
    expect(ex.concepts.some((c) => (c.id === 'gote' || c.id === 'sente') && c.at[0] === P('B5'))).toBe(false);
    expect(numbersSupported(ex)).toEqual([]);
  });

  it('says nothing about a key point when the answer is far from it', async () => {
    const far: Script = (extra, pos) => {
      if (!extra.length) return ROOT;
      if (extra[0] === P('B5') && extra.length === 1) return read(-0.6, 0.45, [{ at: 'H8', lead: 0.6, visits: 60, pv: ['H8', 'D4', 'F5', 'E4'] }], own());
      return scenario(-0.6)(extra, pos);
    };
    const ex = await explain(BASE, why('B5'), fake(far).prober, { model: 'tesuji', thinking: 'medium' });
    expect(ex.summary).not.toContain('should have played');
    expect(ex.concepts.some((c) => c.evidence.includes('for both sides'))).toBe(false);
  });

  it('never shows raw ownership decimals', async () => {
    for (const s of [scenario(-0.21), scenario(-3.9), keyScript]) {
      const ex = await explain(BASE, why('B5'), fake(s).prober, { model: 'tesuji', thinking: 'medium' });
      const text = [ex.summary, ...ex.sections.map((x) => x.text), ...ex.variations.map((v) => v.note ?? '')].join(' ');
      expect(text).not.toMatch(/\((?:0|1)\.\d\)/);
    }
  });
});
