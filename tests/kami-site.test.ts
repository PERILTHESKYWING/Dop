/** Kami site (kami/): question parsing, [[vN]] chips, writer fallback, concept routing, kami-write. */
import { describe, expect, it, vi } from 'vitest';
import { answerQuestion } from '../kami/src/lib/answer';
import { blocks, engineText, plainText, splitChips } from '../kami/src/lib/chips';
import { LlmUnavailable, type CallLlm } from '../kami/src/lib/llm';
import { boardFromSgf, emptyBoard, playAt, type BoardState } from '../kami/src/lib/position';
import { askFor, findCoords, isConceptQuestion, parseQuestion, routeQuestion } from '../kami/src/lib/question';
import { conceptPrompt, expandConcept, NOTES, writeAnswer } from '../kami/src/lib/writer';
import { LM_SYSTEM } from '../src/lib/coach/explain/prompt';
import type { ExplainFn, Explanation, Prober } from '../src/lib/coach/explain/types';
import type { ConceptEntry } from '../src/lib/coach/library';
import { gtpToLoc } from '../src/lib/go/coords';
import { handleLlmRequest } from '../shared/llmServer';
import { hasCoordinates, KAMI_WRITE_SYSTEM } from '../shared/kami';

const at = (s: string, size = 19) => gtpToLoc(s, size);

function boardWith(moves: string[], size = 19): BoardState {
  let b = emptyBoard(size);
  for (const m of moves) b = playAt(b, at(m, size))!;
  return b;
}

function explanation(over: Partial<Explanation> = {}): Explanation {
  return {
    position: { size: 19, komi: 7.5, setup: [], moves: [], toPlay: 1 },
    model: 'myoshu',
    version: '1.0',
    thinking: 'high',
    question: { kind: 'best', text: 'What should I play?' },
    summary: 'KataGo prefers Q16 [[v1]].',
    sections: [{ title: 'Why', text: 'It takes the corner [[v1]].' }],
    facts: [{ id: 'f1', text: "KataGo's best move is Q16." }],
    concepts: [],
    variations: [{ id: 'v1', label: 'Q16', kind: 'best', moves: [{ color: 1, loc: at('Q16') }] }],
    thoughts: [],
    reads: 1,
    totalVisits: 100,
    ms: 1000,
    ...over,
  };
}

const entry: ConceptEntry = {
  id: 'miai',
  name: 'Miai',
  aliases: ['mutual alternatives'],
  level: 'intermediate',
  short: 'Two points where getting either one is enough.',
  body: [{ title: 'Idea', text: 'If one is taken, take the other.' }],
  mistakes: ['Answering a miai point you did not need to.'],
  related: ['sente'],
  examples: [],
};

describe('question parsing', () => {
  it('finds coordinates that exist on the board', () => {
    expect(findCoords('Is R16 or q4 better?', 19).map((c) => c.label)).toEqual(['R16', 'Q4']);
    expect(findCoords('R16 on a small board', 9)).toEqual([]);
    expect(findCoords('I1 is not a point', 19)).toEqual([]);
  });

  it('tells the question kinds apart', () => {
    expect(parseQuestion('Why is R16 bad?', 19)).toMatchObject({ kind: 'why-move', move: at('R16') });
    expect(parseQuestion('Why not D4?', 19)).toMatchObject({ kind: 'why-not', move: at('D4') });
    expect(parseQuestion('What about C3 instead?', 19)).toMatchObject({ kind: 'why-not', move: at('C3') });
    expect(parseQuestion('I played R16, why not Q17?', 19)).toMatchObject({ kind: 'why-not', move: at('Q17') });
    expect(parseQuestion('What should I play here?', 19).kind).toBe('best');
    expect(parseQuestion('What’s the best move?', 19).kind).toBe('best');
    expect(parseQuestion('Explain this position', 19).kind).toBe('overview');
    expect(parseQuestion('Why was move 37 a mistake?', 19)).toMatchObject({ kind: 'why-move', moveNumber: 37 });
  });

  it('asks about a move already on the board in the position before it', () => {
    const b = boardWith(['Q16', 'D4', 'R16']);
    const a = askFor(b, parseQuestion('Why is R16 slow?', 19));
    expect(a.upTo).toBe(2);
    expect(a.pos.moves).toHaveLength(2);
    expect(a.pos.toPlay).toBe(1);
    expect(a.question).toMatchObject({ kind: 'why-move', move: at('R16') });
    const m = askFor(b, parseQuestion('What about move 2?', 19));
    expect(m.upTo).toBe(1);
    expect(m.question.move).toBe(at('D4'));
    const best = askFor(b, parseQuestion('What should White play?', 19));
    expect(best.upTo).toBe(3);
    expect(best.question.move).toBeUndefined();
  });

  it('reads what the student is after (intent)', () => {
    const q = (t: string) => parseQuestion(t, 19);
    expect(q('Can Black kill this group?')).toMatchObject({ kind: 'best', intent: 'kill' });
    expect(q('Can I kill the group?')).toMatchObject({ kind: 'best', intent: 'kill' });
    expect(q('Is it dead?')).toMatchObject({ kind: 'best', intent: 'kill' });
    expect(q('Is this group dead already?')).toMatchObject({ kind: 'best', intent: 'kill' });
    expect(q('Can White kill this group or does it live?')).toMatchObject({ kind: 'best', intent: 'kill' });
    expect(q('How does this group live?')).toMatchObject({ kind: 'best', intent: 'live' });
    expect(q('Can Black make two eyes?')).toMatchObject({ kind: 'best', intent: 'live' });
    expect(q('How do I save this group?')).toMatchObject({ kind: 'best', intent: 'live' });
    expect(q('What should Black play to live?')).toMatchObject({ kind: 'best', intent: 'live' });
    expect(q('Is there a tesuji here?')).toMatchObject({ kind: 'best', intent: 'tesuji' });
    expect(q('Who is ahead?')).toMatchObject({ kind: 'overview', intent: 'ahead' });
    expect(q("Who's winning?")).toMatchObject({ kind: 'overview', intent: 'ahead' });
    expect(q('Who is leading here?')).toMatchObject({ kind: 'overview', intent: 'ahead' });
    expect(q('What is the biggest move?')).toMatchObject({ kind: 'best', intent: 'biggest' });
    expect(q('Where is the biggest point?')).toMatchObject({ kind: 'best', intent: 'biggest' });
    // A point that names the group keeps the question about the best move; a move stays a move.
    expect(q('Can Black kill the group at R16?')).toMatchObject({ kind: 'best', intent: 'kill' });
    expect(q('Can Black kill the group at R16?').move).toBeUndefined();
    expect(q('Does R16 kill?')).toMatchObject({ kind: 'why-move', move: at('R16'), intent: 'kill' });
    // Concept questions and plain questions get no intent.
    expect(q('What is a tesuji?').intent).toBeUndefined();
    expect(q('What should I play here?').intent).toBeUndefined();
    expect(q('Explain this position').intent).toBeUndefined();
  });

  it('carries the intent into the explainer question', () => {
    const b = boardWith(['Q16', 'D4']);
    expect(askFor(b, parseQuestion('Can White kill this group?', 19)).question).toEqual({ kind: 'best', text: 'Can White kill this group?', intent: 'kill' });
    expect(askFor(b, parseQuestion('Who is ahead?', 19)).question).toMatchObject({ kind: 'overview', intent: 'ahead' });
    expect(askFor(b, parseQuestion('What should I play?', 19)).question).not.toHaveProperty('intent');
  });

  it('routes intent questions to the board, or to the library on an empty board', () => {
    const b = boardWith(['Q16', 'D4']);
    const none = () => [];
    expect(routeQuestion('Who is ahead?', b, none).type).toBe('position');
    expect(routeQuestion('Can Black live here?', b, none).type).toBe('position');
    expect(routeQuestion('How does a group live?', emptyBoard(), none).type).toBe('concept');
    expect(routeQuestion('What is a tesuji?', b, (t) => (/tesuji/i.test(t) ? [entry] : [])).type).toBe('concept');
  });
});

describe('[[vN]] chips', () => {
  it('splits text, bold and chips in order', () => {
    expect(splitChips('Play **here** [[v1]], not [[ v2 ]].')).toEqual([
      { type: 'text', text: 'Play ' },
      { type: 'bold', text: 'here' },
      { type: 'text', text: ' ' },
      { type: 'chip', id: 'v1' },
      { type: 'text', text: ', not ' },
      { type: 'chip', id: 'v2' },
      { type: 'text', text: '.' },
    ]);
  });

  it('flattens chips to labels for copying', () => {
    expect(plainText('KataGo prefers **Q16** [[v1]] over [[v9]].', explanation())).toBe('KataGo prefers Q16 Q16 over.');
  });

  it('reads paragraphs, lists and headings', () => {
    expect(blocks('First line\ngoes on.\n\n## Why\n- one\n- two\n\nEnd.')).toEqual([
      { type: 'p', text: 'First line goes on.' },
      { type: 'h', text: 'Why' },
      { type: 'ul', items: ['one', 'two'] },
      { type: 'p', text: 'End.' },
    ]);
    expect(engineText(explanation())).toBe('KataGo prefers Q16 [[v1]].\n\n## Why\n\nIt takes the corner [[v1]].');
  });
});

describe('writer fallback', () => {
  const pass = () => ({ truth: 1, coverage: 1, depth: 0.5, unsupported: [], pass: true });
  const llm: CallLlm = async () => ({ text: 'Q16 [[v1]] takes the corner.', model: 'gemini-test' });

  it('Hane and Tesuji use the engine text without any call', async () => {
    const callLlm = vi.fn(llm);
    expect(await writeAnswer(explanation(), 'hane', { callLlm, checkAnswer: pass })).toEqual({ by: 'engine' });
    expect(await writeAnswer(explanation(), 'tesuji', { callLlm, checkAnswer: pass })).toEqual({ by: 'engine' });
    expect(callLlm).not.toHaveBeenCalled();
  });

  it('Myoshu makes one call with the shared prompt and keeps checked text', async () => {
    const callLlm = vi.fn(llm);
    const w = await writeAnswer(explanation(), 'myoshu', { callLlm, checkAnswer: pass });
    expect(callLlm).toHaveBeenCalledTimes(1);
    expect(callLlm.mock.calls[0][0].kind).toBe('explain');
    expect(callLlm.mock.calls[0][0].prompt).toContain('[[v1]] Q16');
    expect(w).toMatchObject({ by: 'gemini', text: 'Q16 [[v1]] takes the corner.', model: 'gemini-test' });
  });

  it('falls back to engine text when the check throws, fails, or there is no LLM', async () => {
    const throws = () => {
      throw new Error('checkAnswer is not built yet');
    };
    expect(await writeAnswer(explanation(), 'myoshu', { callLlm: llm, checkAnswer: throws })).toEqual({ by: 'engine', note: NOTES.unchecked });
    const fails = () => ({ truth: 0.5, coverage: 1, depth: 0, unsupported: ['K10'], pass: false });
    expect(await writeAnswer(explanation(), 'myoshu', { callLlm: llm, checkAnswer: fails })).toEqual({ by: 'engine', note: NOTES.failed });
    const none: CallLlm = async () => {
      throw new LlmUnavailable('not configured');
    };
    expect(await writeAnswer(explanation(), 'myoshu', { callLlm: none, checkAnswer: pass })).toEqual({ by: 'engine', note: NOTES.noLlm });
    const broken: CallLlm = async () => {
      throw new Error('HTTP 502');
    };
    expect(await writeAnswer(explanation(), 'myoshu', { callLlm: broken, checkAnswer: pass })).toEqual({ by: 'engine', note: NOTES.llmError });
    expect(await writeAnswer(explanation(), 'local', { callLlm: llm, checkAnswer: pass })).toEqual({ by: 'engine', note: NOTES.localError });
  });

  it('Kami Local goes through the same gate', async () => {
    const localWrite = vi.fn(async (_prompt: string) => 'Q16 [[v1]].');
    expect(await writeAnswer(explanation(), 'local', { callLlm: llm, checkAnswer: pass, localWrite })).toMatchObject({ by: 'local', text: 'Q16 [[v1]].' });
    expect(localWrite.mock.calls[0][0]).toContain('Facts:');
  });

  it('passes Stop through instead of falling back', async () => {
    const aborted: CallLlm = async () => {
      throw new DOMException('stopped', 'AbortError');
    };
    await expect(writeAnswer(explanation(), 'myoshu', { callLlm: aborted, checkAnswer: pass })).rejects.toThrow('stopped');
  });
});

describe('concept routing', () => {
  const none = () => [];
  const lib = (t: string) => (/miai/i.test(t) ? [entry] : []);
  const game = boardWith(['Q16', 'D4']);

  it('routes by board, named points and library hits', () => {
    expect(routeQuestion('What is miai?', emptyBoard(), none)).toEqual({ type: 'concept', entries: [] });
    expect(routeQuestion('What is miai?', game, none)).toEqual({ type: 'concept', entries: [] });
    expect(routeQuestion('Is this miai?', game, lib)).toEqual({ type: 'concept', entries: [entry] });
    expect(routeQuestion('Explain this position', emptyBoard(), none).type).toBe('concept');
    expect(routeQuestion('Explain this position', game, none).type).toBe('position');
    expect(routeQuestion('What should Black play?', emptyBoard(), none).type).toBe('position');
    expect(routeQuestion('Is R16 miai with Q17?', game, lib).type).toBe('position');
    expect(isConceptQuestion('What does tenuki mean?')).toBe(true);
    expect(isConceptQuestion('What is White’s plan here?')).toBe(false);
  });

  it('answers concept questions without the engine, and Myoshu expands once', async () => {
    const explain = vi.fn<ExplainFn>();
    const getProber = vi.fn(async () => ({}) as Prober);
    const callLlm = vi.fn<CallLlm>(async () => ({ text: 'Miai means two equal points.', model: 'g' }));
    const deps = { explain, getProber, findConcepts: lib, callLlm, checkAnswer: () => ({ truth: 1, coverage: 1, depth: 1, unsupported: [], pass: true }) };
    expect(await answerQuestion('What is miai?', game, 'tesuji', 'medium', deps)).toEqual({ type: 'concept', ids: ['miai'] });
    expect(callLlm).not.toHaveBeenCalled();
    const a = await answerQuestion('What is miai?', game, 'myoshu', 'high', deps);
    expect(a).toEqual({ type: 'concept', ids: ['miai'], expansion: { text: 'Miai means two equal points.', model: 'g' } });
    expect(callLlm.mock.calls[0][0].kind).toBe('concept');
    expect(explain).not.toHaveBeenCalled();
    expect(getProber).not.toHaveBeenCalled();
  });

  it('runs the explainer for position questions with the picked planner', async () => {
    const ex = explanation();
    const explain = vi.fn<ExplainFn>(async () => ex);
    const prober = {} as Prober;
    const steps: string[] = [];
    const a = await answerQuestion(
      'What should White play?',
      game,
      'local',
      'low',
      { explain, getProber: async () => prober, findConcepts: none, callLlm: vi.fn(), checkAnswer: vi.fn() },
      { onStage: (s) => steps.push(s) },
    );
    expect(explain.mock.calls[0][2]).toBe(prober);
    expect(explain.mock.calls[0][3]).toMatchObject({ model: 'tesuji', thinking: 'low' });
    expect(a).toMatchObject({ type: 'explain', upTo: 2, writing: { by: 'engine', note: NOTES.localError } });
    expect(steps).toEqual(['engine', 'thinking', 'writing']);
  });

  it('passes the student profile to the explainer and the level to the writer', async () => {
    const ex = explanation();
    const explain = vi.fn<ExplainFn>(async () => ex);
    const prompts: string[] = [];
    const callLlm: CallLlm = async (req) => {
      prompts.push(req.prompt);
      return { text: 'Q16 [[v1]] takes the corner.', model: 'g' };
    };
    const deps = { explain, getProber: async () => ({}) as Prober, findConcepts: none, callLlm, checkAnswer: () => ({ truth: 1, coverage: 1, depth: 1, unsupported: [], pass: true }), student: () => ({ level: 'beginner' as const, style: 'fighting' as const }) };
    await answerQuestion('What should White play?', game, 'myoshu', 'high', deps);
    expect(explain.mock.calls[0][3]).toMatchObject({ student: { level: 'beginner', style: 'fighting' } });
    expect(prompts[0]).toContain('Student level: beginner');
    await answerQuestion('What should White play?', game, 'tesuji', 'medium', { ...deps, student: undefined });
    expect(explain.mock.calls[1][3]).not.toHaveProperty('student');
  });

  it('rejects concept wording that names board points', async () => {
    const coords: CallLlm = async () => ({ text: 'Play D4 and Q16 for miai.' });
    expect((await expandConcept(entry, 'What is miai?', coords)).text).toBeUndefined();
    expect(conceptPrompt(entry, 'What is miai?')).toContain('Short answer: Two points');
    expect(hasCoordinates('Miai is about two points.')).toBe(false);
    expect(hasCoordinates('then c3')).toBe(true);
  });
});

describe('boards from SGF', () => {
  it('opens a game at its last move and a setup-only problem with the right side to play', () => {
    const g = boardFromSgf('(;GM[1]SZ[19]KM[6.5]PB[A]PW[B];B[pd];W[dp])');
    expect(g).toMatchObject({ cursor: 2, title: 'A vs B', size: 19 });
    const p = boardFromSgf('(;GM[1]SZ[9]AB[cc][gg]AW[cg]PL[W])');
    expect(p).toMatchObject({ size: 9, cursor: 0, first: 2 });
    expect(p.setup).toHaveLength(3);
    expect(() => boardFromSgf('(;GM[1]SZ[7];B[aa])')).toThrow(/9x9/);
  });
});

describe('kami-write task', () => {
  it('keeps the server prompt identical to LM_SYSTEM', () => {
    expect(KAMI_WRITE_SYSTEM).toBe(LM_SYSTEM);
  });

  it('makes one plain-text call with the fixed system prompt', async () => {
    const env = { LLM_API_KEY: 'test-key-123456', LLM_MODEL: 'gemini-test' };
    const seen: { system: string; mime: string }[] = [];
    const res = await handleLlmRequest('POST', JSON.stringify({ task: 'kami-write', prompt: 'Facts:\n- x' }), env, async (_url, init) => {
      const body = JSON.parse(init.body);
      seen.push({ system: body.systemInstruction.parts[0].text, mime: body.generationConfig.responseMimeType });
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: ' Q16 [[v1]]. ' }] } }] }), text: async () => '' };
    });
    expect(res).toEqual({ status: 200, body: { text: 'Q16 [[v1]].', model: 'gemini-test' } });
    expect(seen).toEqual([{ system: LM_SYSTEM, mime: 'text/plain' }]);
  });

  it('refuses bad requests and reports a missing key', async () => {
    const env = { LLM_API_KEY: 'test-key-123456' };
    const noNet = async () => {
      throw new Error('no network');
    };
    expect((await handleLlmRequest('POST', JSON.stringify({ task: 'kami-write', prompt: '' }), env, noNet)).status).toBe(400);
    expect((await handleLlmRequest('POST', JSON.stringify({ task: 'kami-write', prompt: 'x', kind: 'poem' }), env, noNet)).status).toBe(400);
    expect((await handleLlmRequest('POST', JSON.stringify({ task: 'kami-write', prompt: 'x' }), {}, noNet)).status).toBe(503);
  });
});
