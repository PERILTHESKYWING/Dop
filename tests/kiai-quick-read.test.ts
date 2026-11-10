/**
 * The other moves in the words the board and KataGo's numbers use (critics r1 and r2, 2026-11-07/09):
 * "about as good" only for gaps the board marks ≈ (under 0.35 points); worse moves by their numbers,
 * closest first and grouped, never one named past a closer one; a quick read (Low, Medium, Local: the
 * levels "Read longer" is offered on) says once, at the end, that reading longer can change them. The
 * read is the real move-34 read of tests/kiai-sharp.test.ts with R12's lead moved.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { explainWithBudget, type EngineRead, type ExplainPosition, type Prober } from '../src/lib/coach/explain';
import { budgetFor, isQuickRead } from '../src/lib/coach/explain/budgets';
import { QUICK_LINE } from '../src/lib/coach/explain/teach';
import { gtpToLoc } from '../src/lib/go/coords';
import type { Move } from '../src/lib/go/types';
import { LEVELS, LOCAL_LEVEL, longerLevel } from '../kami/src/lib/levels';
import { pickById } from '../kami/src/lib/writer';

const root = new URL('../', import.meta.url);
const games = (JSON.parse(readFileSync(new URL('public/demo/demo.json', root), 'utf8')) as { games: { id: string; komi: number; moves: Move[] }[] }).games;
const game = games.find((g) => g.id === 'g70dd864b0bcbfc05')!;
const POS: ExplainPosition = { size: 19, komi: game.komi, setup: [], moves: game.moves.slice(0, 34), toPlay: 1 };
type Rec = { key: string; read: Omit<EngineRead, 'ownership'> & { ownership: number[] | null } };
const [rec] = JSON.parse(readFileSync(new URL('tests/fixtures/kiai-move34-reads.json', root), 'utf8')) as Rec[];
const R12 = gtpToLoc('R12', 19);

/** The recorded read with R12 (KataGo's second most-read move) `gap` points below its choice. */
function prober(gap: number, more: Record<string, number> = {}): Prober {
  const best = rec.read.candidates[0];
  const gaps = new Map([[R12, gap], ...Object.entries(more).map(([k, v]) => [gtpToLoc(k, 19), v] as [number, number])]);
  const candidates = rec.read.candidates.map((c) => (gaps.has(c.loc) ? { ...c, scoreLead: best.scoreLead - gaps.get(c.loc)! } : c));
  return {
    async read(p) {
      if (p.moves.length !== POS.moves.length || p.toPlay !== POS.toPlay) return null;
      return { ...rec.read, candidates, ownership: rec.read.ownership ? Float32Array.from(rec.read.ownership) : null };
    },
  };
}

const ask = { kind: 'best' as const, text: 'What should Black play here?' };
const summaryAt = async (gap: number, visits: number, more?: Record<string, number>) => {
  const budget = { ...budgetFor('hane', 'medium'), visits };
  const ex = await explainWithBudget(POS, ask, prober(gap, more), budget, { model: 'hane', thinking: 'medium' });
  return ex.summary.replace(/\s*\[\[[vd]\d+\]\]/g, '');
};

describe('quick reads (Kiai Low and Medium)', () => {
  it('are exactly the levels that offer Read longer', () => {
    for (const l of [...LEVELS, LOCAL_LEVEL]) {
      const b = budgetFor(pickById(l.pick).model, l.thinking);
      expect(isQuickRead(b), l.id).toBe(longerLevel(l.id) !== null);
    }
  });
});

describe('the other moves in the board’s words', () => {
  it('names every marked move closer than the runner-up, closest first, grouped, the caveat once at the end', async () => {
    const q = await summaryAt(1.3, 160);
    expect(q).toContain('R8 is about as good as Q10.');
    // all within 1.5 points: one clause, every marked move named, no figures (7 critics and the
    // pro teacher, 2026-11-10); their rows under KataGo's numbers give each one
    expect(q).toContain("N8, R10, Q12 and R12 each lose up to about a point.");
    expect(q).not.toMatch(/crosscut point/);
    expect(q).not.toMatch(/a little worse|about as good on/);
    expect(q.endsWith(QUICK_LINE)).toBe(true);
    expect(q.split('reading longer').length).toBe(2);
    const l = await summaryAt(1.3, 320);
    expect(l).toContain("N8, R10, Q12 and R12 each lose up to about a point.");
    expect(l).not.toContain('quick read');
  });

  it("the opponent's point goes last in its group, with its own clause, said from the mover's side", async () => {
    const q = await summaryAt(3.0, 320, { N8: 2.4, Q12: 2.4, R10: 2.4, R8: 2.4 });
    expect(q).toContain('Q12, N8 and R8 lose 2.4 points each; so does R10, which takes the crosscut point before White can; R12 is clearly worse, losing 3.0 points.');
    // a spread past 1.5 points keeps each move's figure
    const m = await summaryAt(2.4, 320);
    expect(m).toContain('N8 and Q12 lose 0.4 to 0.5 points; R10, which takes the crosscut point before White can, loses 0.5 points; R12 is clearly worse, losing 2.4 points.');
    expect(m).not.toMatch(/White's crosscut point/);
  });

  it('never names a worse move while skipping a closer one, and only moves the board marks', async () => {
    const q = await summaryAt(2.4, 320);
    for (const m of ['R10', 'N8', 'Q12']) expect(q.indexOf(m), m).toBeGreaterThan(-1);
    expect(q).toContain('R12 is clearly worse, losing 2.4 points');
    // O9 and S8 lose about as much as Q12 but are past the board's six marks
    expect(q).not.toMatch(/O9|S8/);
  });

  it('a gap the board marks ≈ is about as good on any read; ≥ is ahead on a shorter read', async () => {
    const t = await summaryAt(0.2, 160);
    expect(t).toContain('R12 and R8 are about as good as Q10.');
    expect(t).not.toMatch(/ lose|quick read/);
    const a = await summaryAt(-0.5, 160);
    expect(a).toContain('R12 came out 0.5 points ahead on a shorter read.');
    expect(a.endsWith(QUICK_LINE)).toBe(true);
  });
});
