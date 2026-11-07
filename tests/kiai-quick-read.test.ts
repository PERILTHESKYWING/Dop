/**
 * A quick read's gaps in honest words (r/baduk critic, 2026-11-05 and 11-06: a Low read called a
 * 1.3-point gap "a little worse"). On Kiai's quick reads (Low, Medium, Local: the levels "Read
 * longer" is offered on) a runner-up within QUICK_NOISE_PTS of KataGo's choice is "about as good
 * on this quick read"; longer reads keep "a little worse". The read is the real move-34 read of
 * tests/kiai-sharp.test.ts with one runner-up's lead moved 1.3 points below KataGo's choice.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { explainWithBudget, type EngineRead, type ExplainPosition, type Prober } from '../src/lib/coach/explain';
import { budgetFor, isQuickRead, QUICK_NOISE_PTS } from '../src/lib/coach/explain/budgets';
import { NEAR_PTS, quickNoise } from '../src/lib/coach/explain/teach';
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

/** The recorded read with R12 (KataGo's second most-read move) 1.3 points below its choice. */
function prober(gap: number): Prober {
  const best = rec.read.candidates[0];
  const candidates = rec.read.candidates.map((c) => (c.loc === R12 ? { ...c, scoreLead: best.scoreLead - gap } : c));
  return {
    async read(p) {
      if (p.moves.length !== POS.moves.length || p.toPlay !== POS.toPlay) return null;
      return { ...rec.read, candidates, ownership: rec.read.ownership ? Float32Array.from(rec.read.ownership) : null };
    },
  };
}

const ask = { kind: 'best' as const, text: 'What should Black play here?' };
const summaryAt = async (gap: number, visits: number) => {
  const budget = { ...budgetFor('hane', 'medium'), visits };
  const ex = await explainWithBudget(POS, ask, prober(gap), budget, { model: 'hane', thinking: 'medium' });
  return ex.summary.replace(/\s*\[\[[vd]\d+\]\]/g, '');
};

describe('quick reads (Kiai Low and Medium)', () => {
  it('are exactly the levels that offer Read longer', () => {
    for (const l of [...LEVELS, LOCAL_LEVEL]) {
      const b = budgetFor(pickById(l.pick).model, l.thinking);
      expect(isQuickRead(b), l.id).toBe(longerLevel(l.id) !== null);
    }
  });

  it('a gap within the noise band, only on a quick read', () => {
    const quick = budgetFor('hane', 'medium');
    const long = budgetFor('tesuji', 'high');
    expect(quickNoise(1.3, quick)).toBe(true);
    expect(quickNoise(1.3, long)).toBe(false);
    expect(quickNoise(NEAR_PTS - 0.01, quick)).toBe(false); // plain "about as good" on any read
    expect(quickNoise(QUICK_NOISE_PTS, quick)).toBe(false);
    expect(quickNoise(2.5, quick)).toBe(false);
  });

  it('words a 1.3-point gap as about as good on this quick read; a longer read keeps "a little worse"', async () => {
    expect(await summaryAt(1.3, 160)).toContain('R12 is about as good on this quick read.');
    const long = await summaryAt(1.3, 320);
    expect(long).toContain('R12 is a little worse.');
    expect(long).not.toContain('quick read');
  });

  it('a gap past the noise is still worse on a quick read', async () => {
    const s = await summaryAt(1.8, 160);
    expect(s).toContain('R12 is a little worse.');
    expect(s).not.toContain('quick read');
  });
});
