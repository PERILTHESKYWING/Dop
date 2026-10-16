import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkAnswer } from '../src/lib/coach/answerCheck';
import { buildLmPrompt, type EngineRead, type Explanation, type ExplainPosition, type Prober } from '../src/lib/coach/explain';
import { frameBalance, isolate, staticChecks, verifyDiagram, type DiagramSpec } from '../src/lib/coach/explain/illustrate';
import { boardOf } from '../src/lib/coach/explain/geometry';
import { illustrateDefaults } from '../src/lib/coach/explain/diagrams';
import { diagramBlock, dropDiagramRefs, parseWriterDiagram, withoutDiagrams } from '../src/lib/coach/explain/writerDiagram';
import { numbersIn } from '../src/lib/coach/explain/text';
import { checkRule, rubricText, scoreRubric, type Rubric } from '../src/lib/coach/rubric';
import { gtpToLoc } from '../src/lib/go/coords';
import type { Color, Move } from '../src/lib/go/types';
import { splitChips, plainText } from '../kami/src/lib/chips';
import { writerDiagram } from '../kami/src/lib/writer';
import { KAMI_WRITE_SYSTEM } from '../shared/kami';
import { LM_SYSTEM, PROMPT_VERSION } from '../src/lib/coach/explain/prompt';

const N = 19;
const P = (s: string) => gtpToLoc(s, N);
const stones = (color: Color, list: string) => list.split(' ').map((s): Move => ({ color, loc: P(s) }));

/** A corner shape: Black's group on the lower left, White around it. */
const CORNER: DiagramSpec = {
  size: N,
  stones: [...stones(1, 'B2 C2 D2 E2 B3 E3'), ...stones(2, 'B4 C4 D4 E4 F3 F2 G2')],
  toPlay: 1,
  frame: { rect: { x0: 0, y0: 11, x1: 7, y1: 18 }, attacker: 2 },
  claim: { best: P('C3') },
  title: 'Eye shape',
  label: 'eye shape',
  source: 'writer',
};

/** A prober that answers from a script: each read gets the next answer (komi is recorded). */
function scripted(answers: Partial<EngineRead>[]): Prober & { komis: number[] } {
  let i = 0;
  const komis: number[] = [];
  return {
    komis,
    async read(pos) {
      komis.push(pos.komi);
      const a = answers[Math.min(i++, answers.length - 1)];
      return { visits: 100, bWin: 0.5, bLead: 0, ownership: null, candidates: [], ...a } as EngineRead;
    },
  };
}
const cand = (at: string, lead: number, visits = 60, pv: string[] = [at]) => ({ loc: P(at), winrate: 0.5, scoreLead: lead, visits, pv: pv.map(P) });

describe('diagram checks before the engine', () => {
  it('passes a legal, framed shape', () => {
    const r = staticChecks(CORNER);
    expect(r.stones).not.toBeNull();
    expect(r.checks.map((c) => c.name)).toEqual(['board', 'legal', 'frame', 'legal']);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });
  it('rejects two stones on one point, a chain with no liberty, and an illegal claim', () => {
    expect(staticChecks({ ...CORNER, stones: [...CORNER.stones, { color: 2, loc: P('B2') }] }).stones).toBeNull();
    const dead = { ...CORNER, frame: null, stones: [...stones(1, 'A1'), ...stones(2, 'A2 B1')], claim: {} };
    const r = staticChecks(dead);
    expect(r.stones).toBeNull();
    expect(r.checks.at(-1)!.detail).toMatch(/no liberty/);
    expect(staticChecks({ ...CORNER, claim: { best: P('B2') } }).stones).toBeNull();
  });
  it('counts the frame so komi is judged on the shape alone', () => {
    const { stones: s } = staticChecks(CORNER);
    const bal = frameBalance(s!, N, CORNER.frame!.rect);
    expect(Math.abs(bal)).toBeGreaterThan(5); // frames are not split exactly evenly
  });
});

describe('verifyDiagram: KataGo last', () => {
  it('keeps a diagram whose claim KataGo confirms, with an even komi and facts', async () => {
    const pr = scripted([
      { bLead: -40, candidates: [cand('C3', -40, 80, ['C3', 'D3'])] },
      { bLead: 0.3, bWin: 0.52, candidates: [cand('C3', 0.3, 150, ['C3', 'D3', 'A3'])] },
    ]);
    const v = await verifyDiagram(CORNER, pr, 'd1', { minWinrate: 0.3 });
    expect(v.illustration).toBeDefined();
    expect(pr.komis).toEqual([0, -40]);
    expect(v.illustration!.base.komi).toBe(-40);
    expect(v.checks.map((c) => c.name)).toEqual(['board', 'legal', 'frame', 'legal', 'first', 'komi', 'even', 'claim', 'stable']);
    expect(v.facts[0].text).toBe("In diagram [[d1]], KataGo's best move for Black is C3.");
    expect(v.illustration!.line.map((m) => m.color)).toEqual([1, 2, 1]);
    expect(v.reads).toBe(2);
  });
  it('drops a diagram where one side is losing too much (the minimum winrate setting)', async () => {
    const pr = scripted([{ bLead: 0, candidates: [cand('C3', 0)] }, { bLead: 0.2, bWin: 0.8, candidates: [cand('C3', 0.2)] }, { bLead: 0.1, bWin: 0.8, candidates: [cand('C3', 0.1)] }]);
    const v = await verifyDiagram(CORNER, pr, 'd1', { minWinrate: 0.3 });
    expect(v.illustration).toBeUndefined();
    expect(v.failed).toBe('even');
    // The same position passes with a lower minimum.
    const v2 = await verifyDiagram(CORNER, scripted([{ bLead: 0, candidates: [cand('C3', 0)] }, { bLead: 0.2, bWin: 0.8, candidates: [cand('C3', 0.2)] }]), 'd1', { minWinrate: 0.15 });
    expect(v2.illustration).toBeDefined();
  });
  it('drops a diagram whose claimed move KataGo does not play', async () => {
    const v = await verifyDiagram(CORNER, scripted([{ bLead: 0, candidates: [cand('D3', 0), cand('C3', -3)] }]), 'd1');
    expect(v.failed).toBe('claim');
  });
  it('drops a diagram the two reads disagree on', async () => {
    const spec = { ...CORNER, claim: {} };
    const v = await verifyDiagram(spec, scripted([{ bLead: 0, candidates: [cand('C3', 0)] }, { bLead: 0, candidates: [cand('D3', 0)] }]), 'd1');
    expect(v.failed).toBe('stable');
  });
  it('drops a framed shape that is already decided', async () => {
    const v = await verifyDiagram(CORNER, scripted([{ bLead: 300, candidates: [cand('C3', 300)] }]), 'd1', { maxKomi: 30 });
    expect(v.failed).toBe('komi');
  });
  it('checks a claimed worse move with one more read', async () => {
    const spec = { ...CORNER, claim: { best: P('C3'), worse: P('D3') } };
    const ok = await verifyDiagram(spec, scripted([{ bLead: 0, candidates: [cand('C3', 0)] }, { bLead: 0, candidates: [cand('C3', 0)] }, { bLead: -6, candidates: [cand('C3', 6)] }]), 'd1');
    expect(ok.checks.find((c) => c.name === 'worse')?.ok).toBe(true);
    expect(ok.facts.some((f) => /D3 is 6\.0 points worse than C3/.test(f.text))).toBe(true);
    const bad = await verifyDiagram(spec, scripted([{ bLead: 0, candidates: [cand('C3', 0)] }, { bLead: 0, candidates: [cand('C3', 0)] }, { bLead: -0.2, candidates: [cand('C3', 0)] }]), 'd1');
    expect(bad.failed).toBe('worse');
  });
});

describe('isolate: the real fight, cut out and framed', () => {
  it('keeps the corner fight and its whole chains, with the outside stronger side as the frame', () => {
    const moves: Move[] = [...stones(1, 'C3'), ...stones(2, 'D4'), ...stones(1, 'D3'), ...stones(2, 'E3'), ...stones(1, 'Q16'), ...stones(2, 'Q4')];
    // alternate colours as played
    const seq = moves.map((m, i) => ({ ...m, color: (i % 2 ? 2 : 1) as Color }));
    const pos: ExplainPosition = { size: N, komi: 7.5, setup: [], moves: seq, toPlay: 1 };
    const spec = isolate(pos, boardOf(pos), [P('E2')], { best: P('E2') }, 't')!;
    expect(spec).not.toBeNull();
    const pts = spec.stones.map((m) => m.loc);
    expect(pts).toEqual(expect.arrayContaining([P('C3'), P('D3'), P('D4'), P('E3')]));
    expect(pts).not.toContain(P('Q16'));
  });
  it('does not cut out center fights or small boards', () => {
    const pos: ExplainPosition = { size: N, komi: 7.5, setup: [], moves: stones(1, 'K10'), toPlay: 2 };
    expect(isolate(pos, boardOf(pos), [P('K11')], {}, 't')).toBeNull();
  });
  it('is on for Tesuji medium and up, off for Hane and quick thinking', () => {
    expect(illustrateDefaults('hane', 'high')).toBeNull();
    expect(illustrateDefaults('tesuji', 'low')).toBeNull();
    expect(illustrateDefaults('tesuji', 'medium')!.minWinrate).toBe(0.3);
  });
});

describe("the writer's own DIAGRAM block", () => {
  const answer = 'Black lives in the corner. Here is the shape on its own [[d1]]. Play C3 first.\n\nDIAGRAM\nto play: Black\nblack: B2 C2 D2 E2 B3 E3\nwhite: B4 C4 D4 E4 F3 F2 G2\nbest: C3\nidea: eye shape\nEND';
  it('parses into a framed spec and strips the block', () => {
    const d = parseWriterDiagram(answer, N);
    expect(d.found).toBe(true);
    expect(d.text).not.toMatch(/DIAGRAM|END/);
    expect(d.spec!.claim.best).toBe(P('C3'));
    expect(d.spec!.frame!.attacker).toBe(2);
    expect(d.spec!.stones).toHaveLength(13);
  });
  it('reports bad blocks', () => {
    expect(parseWriterDiagram('x\nDIAGRAM\nto play: Black\nblack: Z99\nbest: C3\nEND', N).error).toMatch(/not a point/);
    expect(parseWriterDiagram('x\nDIAGRAM\nblack: C3 D3 E3\nbest: C4\nEND', N).error).toMatch(/side to play/);
    expect(parseWriterDiagram('x\nDIAGRAM\nto play: W\nblack: K10 K11 L10\nbest: K12\nEND', N).error).toMatch(/corner or on one side/);
  });
  it('drops every sentence that points at a failed diagram', () => {
    expect(dropDiagramRefs('Black lives. See it alone [[d1]]. Play C3.\n- also [[d1]] here.\n- keep', 'd1')).toBe('Black lives. Play C3.\n\n- keep');
  });
  const ex: Explanation = {
    position: { size: N, komi: 7.5, setup: [], moves: [], toPlay: 1 },
    model: 'myoshu', version: '1.0', thinking: 'high', question: { kind: 'best', text: 'How does Black live?' },
    summary: 'KataGo plays K10.', sections: [], facts: [{ id: 'f1', text: "KataGo's best move for Black is K10: Black's winrate 50%, the game is even." }],
    concepts: [], variations: [{ id: 'v1', label: 'K10', kind: 'best', moves: stones(1, 'K10') }], thoughts: [], reads: 1, totalVisits: 10, ms: 1,
  };
  it('keeps a diagram that passes and lets the text use its moves', async () => {
    const verify = (spec: DiagramSpec, id: string) => verifyDiagram(spec, scripted([{ bLead: -40, candidates: [cand('C3', -40)] }, { bLead: 0, candidates: [cand('C3', 0, 100, ['C3', 'D3'])] }]), id);
    const r = await writerDiagram(ex, answer, { verifyDiagram: verify });
    expect(r.diagram).toBeDefined();
    expect(r.ex.illustrations).toHaveLength(1);
    const s = checkAnswer(r.ex, r.text);
    expect(s.unsupported).toEqual([]);
  });
  it('removes a diagram that fails, and its sentences', async () => {
    const verify = (spec: DiagramSpec, id: string) => verifyDiagram(spec, scripted([{ bLead: 0, candidates: [cand('D3', 0)] }]), id);
    const r = await writerDiagram(ex, answer, { verifyDiagram: verify });
    expect(r.diagram).toBeUndefined();
    expect(r.text).not.toMatch(/\[\[d1\]\]/);
    expect(r.note).toMatch(/failed a check/);
    // C3 came only from the diagram, so the answer now fails the truth check: the site shows engine text.
    expect(checkAnswer(r.ex, r.text).unsupported).toContain('C3');
  });
  it('round-trips a checked diagram as a block (training tasks)', async () => {
    const v = await verifyDiagram(CORNER, scripted([{ bLead: -40, candidates: [cand('C3', -40)] }, { bLead: 0, candidates: [cand('C3', 0)] }]), 'd1');
    const block = diagramBlock(v.illustration!)!;
    const back = parseWriterDiagram(`text\n\n${block}`, N).spec!;
    expect(new Set(back.stones.map((m) => `${m.color}${m.loc}`))).toEqual(new Set(CORNER.stones.map((m) => `${m.color}${m.loc}`)));
    const withD = { ...ex, illustrations: [v.illustration!], facts: [...ex.facts, ...v.facts], sections: [{ title: 'x', text: 'see [[d1]]' }] };
    const bare = withoutDiagrams(withD);
    expect(bare.illustrations).toBeUndefined();
    expect(bare.sections).toEqual([]);
    expect(bare.facts).toEqual(ex.facts);
  });
});

describe('prompt, chips and checker know diagrams', () => {
  it('bumps the prompt version and keeps the server prompt identical', () => {
    expect(PROMPT_VERSION).toBe(3);
    expect(KAMI_WRITE_SYSTEM).toBe(LM_SYSTEM);
    expect(LM_SYSTEM).toMatch(/DIAGRAM/);
  });
  it('lists diagrams and the id for the writer’s own', async () => {
    const v = await verifyDiagram(CORNER, scripted([{ bLead: -40, candidates: [cand('C3', -40)] }, { bLead: 0, candidates: [cand('C3', 0)] }]), 'd1');
    const base: Explanation = {
      position: { size: N, komi: 7.5, setup: [], moves: [], toPlay: 1 }, model: 'tesuji', version: '1.0', thinking: 'medium', question: { kind: 'best', text: 'q' },
      summary: '', sections: [], facts: [], concepts: [], variations: [], thoughts: [], reads: 0, totalVisits: 0, ms: 0, illustrations: [v.illustration!],
    };
    const p = buildLmPrompt(base);
    expect(p).toMatch(/Diagrams:\n- \[\[d1\]\] Eye shape \(writer\): B C3/);
    expect(p).toMatch(/Your own diagram, if you ask for one: \[\[d2\]\]/);
  });
  it('turns [[dN]] into chips and labels', () => {
    expect(splitChips('see [[d1]] and [[v2]]').filter((x) => x.type === 'chip').map((x) => (x as { id: string }).id)).toEqual(['d1', 'v2']);
    expect(plainText('see [[d1]].', { variations: [], illustrations: [{ id: 'd1', label: 'eye shape' } as never] })).toBe('see eye shape.');
    expect(numbersIn('In diagram [[d1]], 3 points')).toEqual(['3']);
  });
});

describe('rubric', () => {
  const rubric = JSON.parse(readFileSync(new URL('../eval/coach/rubric.json', import.meta.url), 'utf8')) as Rubric;
  const ex = {
    position: { size: N, komi: 7.5, setup: [], moves: [], toPlay: 1 as Color },
    question: { kind: 'why-not' as const, move: P('C10'), text: 'Why not C10?' },
    variations: [{ id: 'v1', label: 'R16', kind: 'best' as const, moves: stones(1, 'R16') }],
  } as unknown as Explanation;
  it('scores the code-checked rules and lists broken ones', () => {
    const good = 'C10 is too low here because it lets White build a wall facing your weak group [[v1]]. ' + 'Words '.repeat(40);
    const s = scoreRubric(rubric, good, ex);
    expect(s.broken).toEqual([]);
    expect(s.rubric).toBe(1);
    const bad = scoreRubric(rubric, 'Great question! KataGo with 400 visits says so.', ex);
    expect(bad.broken).toEqual(expect.arrayContaining(['answer-first', 'show-on-board', 'no-filler', 'length', 'level']));
    expect(bad.rubric!).toBeLessThan(0.3);
  });
  it('skips rules that do not apply and survives a bad pattern', () => {
    expect(checkRule({ kind: 'refsDiagram' }, 'x', ex)).toBeNull();
    const r: Rubric = { version: 9, updated: '', rules: [{ id: 'x', text: 't', weight: 1, check: { kind: 'require', pattern: '(' } }] };
    expect(scoreRubric(r, 'x', ex)).toEqual({ rubric: null, broken: [] });
    expect(rubricText(rubric).split('\n')).toHaveLength(rubric.rules.length);
  });
});
