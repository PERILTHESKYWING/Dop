import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkRule, findRepeat, numbersIn, rubricText, scoreRubric, whenMatches, type Rubric, type RubricCheck } from '../src/lib/coach/rubric';
import type { Explanation, Question, Situation } from '../src/lib/coach/explain/types';
import { gtpToLoc } from '../src/lib/go/coords';
import type { Color, Move } from '../src/lib/go/types';

const N = 19;
const P = (s: string) => gtpToLoc(s, N);
const line = (list: string): Move[] => list.split(' ').map((s, i): Move => ({ color: (i % 2 ? 2 : 1) as Color, loc: P(s) }));
const rubric = JSON.parse(readFileSync(new URL('../eval/coach/rubric.json', import.meta.url), 'utf8')) as Rubric;
const rule = (id: string) => rubric.rules.find((r) => r.id === id)!;

const SIT: Situation = { phase: 'middle', open: false, handicap: false, tsumego: false, gap: 'clear', tone: 'teach' };
function mk(q: Partial<Question> & { kind: Question['kind'] }, situation?: Partial<Situation>, extra: Partial<Explanation> = {}): Explanation {
  return {
    position: { size: N, komi: 7.5, setup: [], moves: [], toPlay: 1 as Color },
    question: { text: '', ...q },
    variations: [
      { id: 'v1', label: 'Q17', kind: 'best', moves: line('Q17 R17') },
      { id: 'v2', label: 'P16', kind: 'refutation', moves: line('P16 Q17') },
    ],
    illustrations: [],
    ...(situation ? { situation: { ...SIT, ...situation } } : {}),
    ...extra,
  } as unknown as Explanation;
}
const check = (id: string, text: string, ex: Explanation | null) => {
  const r = rule(id);
  return whenMatches(r.when, ex) ? checkRule(r.check!, text, ex) : null;
};

describe('rubric v1 file', () => {
  it('traces every rule to XIAO and keeps the judge text short', () => {
    expect(rubric.version).toBe(1);
    const ids = rubric.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(rubric.rules.length).toBeGreaterThanOrEqual(20);
    for (const r of rubric.rules) {
      expect(r.from, r.id).toMatch(/^XIAO, /);
      expect(r.text.split(/\s+/).length, r.id).toBeLessThanOrEqual(36);
      expect([1, 2, 3], r.id).toContain(r.weight);
      expect(['tone', 'teaching', 'accuracy', 'structure', 'diagrams'], r.id).toContain(r.topic);
    }
  });
  it('has patterns that compile', () => {
    for (const r of rubric.rules) {
      const c = r.check as (RubricCheck & { pattern?: string; flags?: string }) | undefined;
      if (c?.pattern !== undefined) expect(() => new RegExp(c.pattern!, c.flags), r.id).not.toThrow();
      if (r.when?.ask) expect(() => new RegExp(r.when!.ask!, 'i'), r.id).not.toThrow();
    }
  });
});

describe('numbers, matches, repeats, leads', () => {
  it('counts numbers but not coordinates, refs or names', () => {
    expect(numbersIn('Q16 [[v1]] at the 3-3 point on 19x19, a 3rd line move by a 5k in a 4-stone game')).toEqual([]);
    expect(numbersIn('R16 is 0.1 points worse (56%) by move 91')).toEqual(['0.1', '56', '91']);
    expect(numbersIn('1. Who is ahead\n2. Why')).toEqual([]);
    expect(numbersIn('a 2-3 points gap')).toEqual(['2', '3']);
    expect(checkRule({ kind: 'maxNumbers', max: 1 }, 'Play Q16 [[v1]] or R4 [[v2]], about 2 points.', null)).toBe(true);
    expect(checkRule({ kind: 'maxNumbers', max: 1 }, 'C10 is 1.0 points worse (46%).', null)).toBe(false);
  });
  it('counts matches with the g flag added', () => {
    const emoji: RubricCheck = { kind: 'maxMatches', pattern: '\\p{Extended_Pictographic}', flags: 'u', max: 2 };
    expect(checkRule(emoji, 'Nice! 🐉🎁 That is a gift.', null)).toBe(true);
    expect(checkRule(emoji, 'Nice! 🐉🎁 Ouch 😊', null)).toBe(false);
    expect(checkRule({ kind: 'maxMatches', pattern: 'winrate', flags: 'i', max: 1 }, 'Winrate 46%, winrate 45%.', null)).toBe(false);
  });
  it('finds sentences and comparisons said twice', () => {
    expect(findRepeat('C10 is 1.0 points slower than C17 [[v2]]. Later on.\n\nWhat goes wrong\nC10 is 1.0 points worse than C17.')).not.toBeNull();
    expect(findRepeat('P16 loses 3.1 points against Q17. After that, P16 is 3.1 points worse than Q17 (3%).')).not.toBeNull();
    expect(findRepeat('Black trails by 0.8 points after it. The best move: Black\'s winrate 46%, Black trails by 0.8 points.')).not.toBeNull();
    expect(findRepeat('Before the move, Black leads by 3.1 points [[v1]].\n\nThe position\n**Before the move, black leads by 3.1 points.**')).not.toBeNull();
    // A natural answer with the same words in different sentences is fine.
    expect(findRepeat('Q17 is the better choice here. Playing P16 allows Black to take the valuable corner at Q17 instead. White should secure the corner with Q17 first.')).toBeNull();
    expect(findRepeat('C10 is 1 point worse than C17. After C10, D10 would be 1 point worse still.')).toBeNull();
  });
  it('reads the first sentence without markdown or refs', () => {
    const yes: RubricCheck = { kind: 'leadsWith', pattern: '^\\W*(?:yes|no|it depends)\\b', flags: 'i' };
    expect(checkRule(yes, '**Yes!** Black can kill this group.', null)).toBe(true);
    expect(checkRule(yes, 'Black should play B3 [[v1]]. Yes, it dies.', null)).toBe(false);
    expect(checkRule(yes, '', null)).toBe(false);
  });
});

describe('rubric v1 rules', () => {
  const why = mk({ kind: 'why-not', move: P('P16'), text: 'Why not P16?' }, { gap: 'clear', tone: 'teach' });
  it('does not misfire on coordinates, refs, "vital point" or "3-3 point"', () => {
    const tsu = mk({ kind: 'best', text: 'How does this group live?', intent: 'live' }, { tsumego: true, tone: 'tsumego', gap: 'none' });
    for (const t of ['S14 is the vital point [[v1]]: the S14 point makes two eyes.', 'The 3-3 point is the big point here; Q16 points at the corner.']) {
      expect(check('tsumego-no-score', t, tsu), t).toBe(true);
      expect(check('lead-in-go-words', t, tsu), t).toBe(true);
    }
    expect(check('tsumego-no-score', 'S14 lives; Black trails by 1.6 points.', tsu)).toBe(false);
    expect(check('tsumego-no-score', 'S14 lives (winrate 19%).', tsu)).toBe(false);
    expect(check('lead-in-go-words', 'P16 loses 3.1 points against Q17.', why)).toBe(false);
    expect(check('lead-in-go-words', 'Q17 [[v1]] is the better choice here. P16 is 3.1 points worse.', why)).toBe(true);
  });
  it('catches the wording XIAO quoted as confusing', () => {
    for (const t of [
      'After P16, Black takes Q17 itself, the point White should have played [[v2]].',
      'Play Q17 Q17 instead.',
      'By move 81 the top is unsettled instead of unsettled.',
      "The right side is leaning Black's (60%) instead of leaning Black's (67%).",
    ])
      expect(check('clear-wording', t, why), t).toBe(false);
    expect(check('clear-wording', 'Q17 is the better choice: P16 lets Black take the corner.', why)).toBe(true);
    expect(check('no-engine-report', 'KataGo spends 100% of its visits there.', why)).toBe(false);
    expect(check('no-engine-report', "KataGo's line is D4 O17 Q14 Q13 P14 R16 R13.", why)).toBe(false);
    expect(check('no-engine-report', 'Black connects at C3, D3 and E3 [[v1]].', why)).toBe(true);
  });
  it('applies the situation rules only in their situation', () => {
    const negligible = mk({ kind: 'best', text: 'What should I play here?' }, { phase: 'opening', open: true, gap: 'negligible', tone: 'relaxed' });
    expect(check('split-hairs', 'R16 [[v2]] is 0.1 points worse than Q17.', negligible)).toBe(false);
    expect(check('split-hairs', 'Both moves are good! Q17 [[v1]] might be the tiny preference.', negligible)).toBe(true);
    expect(check('split-hairs', 'R16 is 0.1 points worse.', why)).toBeNull();
    expect(check('open-many-moves', 'Black should play C17 [[v1]].', negligible)).toBe(false);
    expect(check('open-many-moves', "There's no single correct answer here, so play your style!", negligible)).toBe(true);
    const kill = mk({ kind: 'best', text: 'Can I kill this group?', intent: 'kill' });
    expect(check('yes-no-first', 'Black should play B3 [[v1]].', kill)).toBe(false);
    expect(check('yes-no-first', '**Yes!** B3 [[v1]] takes the vital point.', kill)).toBe(true);
    expect(check('yes-no-first', 'S14.', mk({ kind: 'best', text: 'How does this group live?', intent: 'live' }))).toBeNull();
    const blunder = mk({ kind: 'why-not', move: P('P16'), text: 'Why not here?' }, { tone: 'blunder', gap: 'blunder' });
    expect(check('short-when-simple', 'word '.repeat(121), blunder)).toBe(false);
    expect(check('short-when-simple', 'word '.repeat(121), why)).toBeNull();
    const twist = mk({ kind: 'why-not', move: P('P16'), text: 'Why not?' }, { transposes: true });
    expect(check('transposition-honest', 'Plot twist: both lines end up in practically the same position [[v1]].', twist)).toBe(true);
    expect(check('transposition-honest', 'C15 is better [[v1]].', twist)).toBe(false);
    const style = mk({ kind: 'why-move', move: P('P16'), text: 'Was this a good move?' }, { gap: 'negligible', tone: 'celebrate', styleChoice: true });
    expect(check('style-choice', 'Both are good: do you want a calm game or a fight? The choice is yours! [[v1]]', style)).toBe(true);
    expect(check('celebrate-first', 'P16 is about as good as Q17 [[v1]].', style)).toBe(true);
    expect(check('celebrate-first', 'Q17 [[v1]] is KataGo\'s best move.', style)).toBe(false);
  });
  it('wants a reason when there is something to teach', () => {
    expect(check('gives-a-reason', 'KataGo prefers R3 [[v1]].', why)).toBe(false);
    expect(check('gives-a-reason', 'R3 [[v1]] is better because it saves the corner.', why)).toBe(true);
    const relaxed = mk({ kind: 'best', text: 'What should I play?' }, { open: true, gap: 'negligible', tone: 'relaxed' });
    expect(check('gives-a-reason', 'Both moves are good! Play your style.', relaxed)).toBeNull();
  });
  it('reads `when` from the situation and the question', () => {
    const old = mk({ kind: 'overview', text: 'Who is ahead?', intent: 'ahead' });
    expect(whenMatches({ tsumego: true }, old)).toBe(false); // made before `situation` existed
    expect(whenMatches({ kind: ['overview'], intent: ['ahead'] }, old)).toBe(true);
    expect(whenMatches({ ask: '^who\\b' }, old)).toBe(true);
    expect(whenMatches({ intent: ['kill'] }, old)).toBe(false);
    expect(whenMatches({ kind: ['overview'] }, null)).toBe(false); // concept answers
    expect(whenMatches(undefined, null)).toBe(true);
    const ex = mk({ kind: 'best', text: '' }, { phase: 'opening', gap: 'small' });
    expect(whenMatches({ styleChoice: false, transposes: false, phase: ['opening', 'middle'], gap: ['small'] }, ex)).toBe(true);
    expect(whenMatches({ styleChoice: true }, ex)).toBe(false);
    expect(whenMatches({ tone: ['blunder'] }, ex)).toBe(false);
  });
  it('wants a line linked when there is one', () => {
    expect(checkRule({ kind: 'refsLine' }, 'Q17 is better.', why)).toBe(false);
    expect(checkRule({ kind: 'refsLine' }, 'Q17 [[v1]] is better.', why)).toBe(true);
    expect(checkRule({ kind: 'refsLine' }, 'Q17 [[v9]] is better.', why)).toBe(false);
    expect(checkRule({ kind: 'refsLine' }, 'x', mk({ kind: 'best', text: '' }, undefined, { variations: [] }))).toBeNull();
    expect(checkRule({ kind: 'refsLine' }, 'x', null)).toBeNull();
  });
});

describe('scoring', () => {
  it('scores an old engine answer low and XIAO-style answers high', () => {
    const ex = mk({ kind: 'best', text: 'What should I play here?' }, { phase: 'opening', open: true, gap: 'negligible', tone: 'relaxed' });
    const old = "White should play Q17 [[v1]]: White leads by 1.3 points after it. R16 [[v2]] is 0.1 points worse.\n\nThe best move\nKataGo's best move for White is Q17: White's winrate 56%, White leads by 1.3 points. [[v1]]\n\nOther moves\nR16 is 0.1 points worse than Q17 (White's winrate 56%). [[v2]]";
    const s = scoreRubric(rubric, old, ex);
    expect(s.broken).toEqual(expect.arrayContaining(['no-repeats', 'lead-in-go-words', 'few-numbers', 'winrate-sparing', 'split-hairs', 'relaxed-few-numbers', 'open-many-moves']));
    expect(s.rubric!).toBeLessThan(0.5);
    const xiao = "Both moves are good! Q17 [[v1]] might be the engine's tiny preference, but we're splitting hairs here. R16 [[v2]] is just as fine. Play your style! 😊";
    expect(scoreRubric(rubric, xiao, ex)).toEqual({ rubric: 1, broken: [] });
    const teach = mk({ kind: 'why-not', move: P('P16'), text: 'Why not this?' }, { gap: 'clear', tone: 'teach' });
    const good = 'Q17 [[v1]] is the better choice here. Playing P16 lets Black take the valuable corner at Q17 [[v2]], and with Black already strong on the top left, the outside is worth less than the corner. Secure the corner first.';
    expect(scoreRubric(rubric, good, teach)).toEqual({ rubric: 1, broken: [] });
  });
  it('still scores answers with no situation and concept answers', () => {
    const ex = mk({ kind: 'why-not', move: P('C10'), text: 'Why not C10?' });
    const good = 'C10 is too low here because it lets White build a wall facing your weak group [[v1]].';
    expect(scoreRubric(rubric, good, ex)).toEqual({ rubric: 1, broken: [] });
    const bad = scoreRubric(rubric, 'Great question! KataGo with 400 visits says so.', ex);
    expect(bad.broken).toEqual(expect.arrayContaining(['answer-first', 'shows-a-line', 'no-filler', 'no-engine-report']));
    expect(bad.rubric!).toBeLessThan(0.7);
    const concept = scoreRubric(rubric, 'Miai: two points that do the same job. If your opponent takes one, you take the other.', null);
    expect(concept).toEqual({ rubric: 1, broken: [] });
  });
  it('skips rules that do not apply and survives a bad pattern', () => {
    const ex = mk({ kind: 'why-not', move: P('C10'), text: 'Why not C10?' });
    expect(checkRule({ kind: 'refsDiagram' }, 'x', ex)).toBeNull();
    const r: Rubric = { version: 9, updated: '', rules: [{ id: 'x', text: 't', weight: 1, check: { kind: 'require', pattern: '(' } }] };
    expect(scoreRubric(r, 'x', ex)).toEqual({ rubric: null, broken: [] });
    const w: Rubric = { version: 9, updated: '', rules: [{ id: 'x', text: 't', weight: 1, when: { ask: '(' }, check: { kind: 'require', pattern: 'y' } }] };
    expect(scoreRubric(w, 'x', ex)).toEqual({ rubric: null, broken: [] });
  });
  it('gives the judge a numbered list, or one topic', () => {
    expect(rubricText(rubric).split('\n')).toHaveLength(rubric.rules.length);
    const tone = rubricText(rubric, 'tone').split('\n');
    expect(tone).toHaveLength(rubric.rules.filter((r) => r.topic === 'tone').length);
    expect(tone[0]).toMatch(/^1\. /);
    expect(rubricText(rubric)).toContain('(most important)');
  });
});
