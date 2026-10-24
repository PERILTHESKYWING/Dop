import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scoreAnswer } from '../scripts/coachlm/verify';
import { buildConceptPrompt, conceptReference, conceptTask, readJsonl, referenceOf, splitOf, storedExplanation, type Task } from '../scripts/coachlm/tasks';
import { checkAnswer, checkConceptAnswer, COVERAGE_FLOOR } from '../src/lib/coach/answerCheck';
import type { Explanation, Variation } from '../src/lib/coach/explain/types';
import type { ConceptEntry } from '../src/lib/coach/library';
import { gtpToLoc } from '../src/lib/go/coords';
import type { Color, Move } from '../src/lib/go/types';

const L = (s: string) => gtpToLoc(s, 19);
const line = (first: Color, ...pts: string[]): Move[] => pts.map((p, i) => ({ color: (i % 2 === 0 ? first : first === 1 ? 2 : 1) as Color, loc: L(p) }));

const variations: Variation[] = [
  { id: 'v1', label: 'R16', kind: 'best', moves: line(1, 'R16', 'R17', 'Q17', 'S17') },
  { id: 'v2', label: 'C3', kind: 'refutation', moves: line(1, 'C3', 'D3', 'C4', 'D5'), scoreLoss: 4.2, note: 'White answers at D3 and Black is low.' },
  { id: 'v3', label: 'after 6 moves', kind: 'consequence', moves: line(1, 'R16', 'Q14', 'P13', 'Q12', 'O14', 'R13') },
];

/** Move 31, Black to play; KataGo prefers R16, the student asks about C3. */
const ex: Explanation = {
  position: { size: 19, komi: 7.5, setup: [], moves: Array.from({ length: 30 }, (_, i) => ({ color: (i % 2 === 0 ? 1 : 2) as Color, loc: i })), toPlay: 1 },
  model: 'tesuji',
  version: '1.0',
  thinking: 'medium',
  question: { kind: 'why-not', move: L('C3'), text: 'Why not C3?' },
  summary: 'R16 is better [[v1]]; C3 loses 4.2 points [[v2]].',
  sections: [{ title: 'What goes wrong later', text: 'After R16 the white group at Q13 stays weak [[v3]].' }],
  facts: [
    { id: 'f1', text: "KataGo's best move is R16, winrate 62%, lead 3.4 points." },
    { id: 'f2', text: "C3 loses 4.2 points: Black's winrate drops to 48%." },
    { id: 'f3', text: 'The white group at Q13 is weak.' },
  ],
  concepts: [{ id: 'weak-group', at: [L('Q13'), L('Q12')], evidence: 'White owns only 30% of the area around Q13.', variation: 'v3' }],
  variations,
  thoughts: [],
  reads: 3,
  totalVisits: 1200,
  ms: 900,
};

const good =
  'C3 is too slow: it loses 4.2 points [[v2]] and Black drops from 62% to 48%. R16 is the move [[v1]] because it attacks the weak group at Q13; ' +
  'if White saves it, Black builds territory on the right [[v3]].';

describe('checkAnswer: truth', () => {
  it('rejects "sente" that no concept or draft shows (wordingProblems)', () => {
    const s = checkAnswer(ex, good.replace('Black builds', 'Black gets sente and builds'));
    expect(s.truth).toBe(1);
    expect(s.wording).toEqual(['"sente" without KataGo evidence']);
    expect(s.pass).toBe(false);
  });

  it('passes an answer that only uses the explanation', () => {
    const s = checkAnswer(ex, good);
    expect(s.unsupported).toEqual([]);
    expect(s.truth).toBe(1);
    expect(s.pass).toBe(true);
    expect(s.coverage).toBeGreaterThan(0.9);
  });

  it("passes the engine's own text", () => {
    const s = checkAnswer(ex, referenceOf(ex));
    expect(s.truth).toBe(1);
    expect(s.pass).toBe(true);
  });

  it('flags invented and impossible coordinates, keeping the rest', () => {
    const s = checkAnswer(ex, 'D4 or Q20 would be better than R16 [[v1]], and I5 too.');
    expect(s.unsupported.sort()).toEqual(['D4', 'I5', 'Q20']);
    expect(s.truth).toBe(0.4);
    expect(s.pass).toBe(false);
  });

  it('reads lower-case coordinates and allows the ones the student asked about', () => {
    expect(checkAnswer(ex, 'r16 [[v1]] is better than c3.').unsupported).toEqual([]);
    const asked = { ...ex, question: { ...ex.question, text: 'Why not C3 or D4?' } };
    expect(checkAnswer(asked, 'D4 is also slow; R16 [[v1]].').unsupported).toEqual([]);
  });

  it('does not take point names, lines, ranks or the board size for figures', () => {
    const s = checkAnswer(ex, 'A 3-3 invasion or a 4-4 stone is not the issue on this 19x19 board; the 3rd line is low, even for a 3k player. R16 [[v1]].');
    expect(s.unsupported).toEqual([]);
    expect(checkAnswer(ex, 'On a 9x9 board this is different.').unsupported).toEqual(['9x9']);
  });

  it('checks move numbers against the game and its lines', () => {
    expect(checkAnswer(ex, 'At move 31, R16 [[v1]].').unsupported).toEqual([]);
    expect(checkAnswer(ex, 'Back at move 12 Black was ahead.').unsupported).toEqual([]);
    expect(checkAnswer(ex, 'By move 90 the group dies.').unsupported).toEqual(['move 90']);
    expect(checkAnswer(ex, 'After 6 moves the group is weak [[v3]].').unsupported).toEqual([]);
    expect(checkAnswer(ex, 'After 40 moves the group is dead.').unsupported).toEqual(['40 moves']);
  });

  it('allows rounding of point figures, not new ones', () => {
    expect(checkAnswer(ex, 'C3 loses 4.2 points.').unsupported).toEqual([]);
    expect(checkAnswer(ex, 'C3 loses 4 points.').unsupported).toEqual([]);
    expect(checkAnswer(ex, 'C3 costs about 4 points, a 4.2-point loss.').unsupported).toEqual([]);
    expect(checkAnswer(ex, 'R16 leads by 3.4.').unsupported).toEqual([]);
    expect(checkAnswer(ex, 'C3 loses 5.5 points, and 12 points later.').unsupported.sort()).toEqual(['12 points', '5.5 points']);
    // A gap between two KataGo figures is fair (4.2 - 3.4); a sum is not.
    expect(checkAnswer(ex, 'The gap between them is 0.8.').unsupported).toEqual([]);
    expect(checkAnswer(ex, 'Together that makes 9.1 points.').unsupported).toEqual(['9.1 points']);
  });

  it('allows winrates in either view, their gaps and hedged round numbers', () => {
    expect(checkAnswer(ex, 'Black has 62%.').unsupported).toEqual([]);
    expect(checkAnswer(ex, 'White has 38% after R16 [[v1]].').unsupported).toEqual([]);
    expect(checkAnswer(ex, 'C3 costs 14% [[v2]].').unsupported).toEqual([]);
    expect(checkAnswer(ex, 'Black has 60%.').unsupported).toEqual(['60%']);
    expect(checkAnswer(ex, 'Black has about 60%.').unsupported).toEqual([]);
    expect(checkAnswer(ex, 'Black has 75 percent.').unsupported).toEqual(['75 percent']);
  });

  it('flags missing variation refs', () => {
    const s = checkAnswer(ex, 'See [[v2]] and [[v9]].');
    expect(s.unsupported).toEqual(['[[v9]]']);
    expect(s.truth).toBe(0.5);
  });

  it('flags unknown counts of visits and other bare numbers, but not small counts', () => {
    expect(checkAnswer(ex, 'KataGo spent 1,200 visits on this.').unsupported).toEqual(['1200 visits']);
    expect(checkAnswer(ex, 'The group needs 2 eyes and has 1 move to make them.').unsupported).toEqual([]);
    expect(checkAnswer(ex, 'It is worth 27 here.').unsupported).toEqual(['27']);
  });
});

describe('checkAnswer: coverage, depth, pass', () => {
  it('fails a true but empty answer on coverage', () => {
    const s = checkAnswer(ex, 'This is an interesting position with many possibilities.');
    expect(s.truth).toBe(1);
    expect(s.coverage).toBeLessThan(COVERAGE_FLOOR);
    expect(s.pass).toBe(false);
  });

  it('fails an empty answer', () => {
    expect(checkAnswer(ex, '  ').pass).toBe(false);
  });

  it('scores reasons, deeper lines and concepts above restated numbers', () => {
    const flat = checkAnswer(ex, 'R16 [[v1]]. 62%. 3.4 points.');
    const deep = checkAnswer(ex, good + ' Otherwise White gets thickness. For example, the line in [[v2]] leaves Black low on the side.');
    expect(flat.depth).toBeLessThan(0.2);
    expect(deep.depth).toBeGreaterThan(0.7);
    expect(deep.depth).toBeLessThanOrEqual(1);
  });
});

// A test id, so the real library entry (thread 5) never replaces it in scoreAnswer.
const miai: ConceptEntry = {
  id: 'test-miai',
  name: 'miai',
  aliases: ['mutual alternatives', '見合い'],
  level: 'intermediate',
  short: 'Two points are miai when they are equivalent alternatives: if the opponent takes one, you take the other.',
  body: [{ title: 'Why it matters', text: 'Because you can always answer, you need not play either point yet, so you can tenuki.' }],
  mistakes: ['Answering a miai point early, which wastes a move.'],
  related: ['tenuki', 'sente'],
  examples: [],
};

describe('concept answers', () => {
  it("passes the library's own text and fails any coordinate", () => {
    const ref = checkConceptAnswer(miai, conceptReference(miai));
    expect(ref.truth).toBe(1);
    expect(ref.pass).toBe(true);
    const s = checkConceptAnswer(miai, 'Miai: if White takes Q16, Black takes D4.');
    expect(s.truth).toBe(0);
    expect(s.unsupported.sort()).toEqual(['D4', 'Q16']);
    expect(s.pass).toBe(false);
  });

  it('scores coverage on the key terms, and 3-3 is not a coordinate', () => {
    const thin = checkConceptAnswer(miai, 'It is a Go word.');
    const full = checkConceptAnswer(miai, 'Miai means two equivalent alternatives: if the opponent takes one point you take the other, so you can tenuki and keep sente. Like two ways to live after a 3-3 invasion.');
    expect(thin.coverage).toBeLessThan(full.coverage);
    expect(full.truth).toBe(1);
    expect(full.pass).toBe(true);
  });

  it('builds concept tasks with a stable split and a prompt holding the facts', () => {
    const t = conceptTask(miai, 'What is miai?');
    expect(t.kind).toBe('concept');
    expect(t.explanation).toBeNull();
    expect(t.concept).toBe('test-miai');
    expect(t.split).toBe(splitOf('concept|test-miai'));
    expect(t.prompt).toContain('Question: What is miai?');
    expect(buildConceptPrompt(miai, 'x')).toContain('do not name coordinates');
    expect(scoreAnswer(t, t.reference).pass).toBe(true);
  });
});

describe('task helpers', () => {
  it('splits deterministically, about a tenth held out', () => {
    let evalCount = 0;
    for (let i = 0; i < 4000; i++) {
      const s = splitOf(`pos|${i}`);
      expect(splitOf(`pos|${i}`)).toBe(s);
      if (s === 'eval') evalCount++;
    }
    expect(evalCount / 4000).toBeGreaterThan(0.08);
    expect(evalCount / 4000).toBeLessThan(0.12);
  });

  it('drops ownership from stored explanations', () => {
    const withOwnership = { ...ex, ownership: new Float32Array(361) } as Explanation & { ownership: Float32Array };
    const stored = storedExplanation(withOwnership) as Explanation & { ownership?: unknown };
    expect(stored.ownership).toBeUndefined();
    expect(stored.variations).toEqual(ex.variations);
  });

  const sample = new URL('../eval/coach/sample.jsonl', import.meta.url);
  it.runIf(existsSync(sample))("passes every reference in the committed sample (the factory's own output)", () => {
    const tasks = readJsonl<Task>(sample.pathname);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.length).toBeLessThanOrEqual(20);
    for (const t of tasks) {
      expect(['position', 'concept']).toContain(t.kind);
      const s = scoreAnswer(t, t.reference);
      expect(s.unsupported, t.id).toEqual([]);
      expect(s.truth).toBe(1);
    }
  });
});
