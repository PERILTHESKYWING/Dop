import { describe, expect, it } from 'vitest';
import { buildAskPrompt, coordsIn, parseAskReply, unsupportedFigures, type PositionFacts } from '../shared/ask';
import { handleLlmRequest } from '../shared/llmServer';
import { askPosition } from '../src/lib/coach/ask';
import { buildFacts, boardDiagram } from '../src/lib/coach/facts';
import { Board } from '../src/lib/go/board';
import { gtpToLoc } from '../src/lib/go/coords';

const facts: PositionFacts = {
  size: 19,
  komi: 7.5,
  moveNumber: 41,
  toPlay: 'Black',
  lastMove: 'R14',
  diagram: '',
  blackWinrate: 62.4,
  blackLead: 3.1,
  visits: 400,
  candidates: [
    { move: 'Q13', winrate: 62.8, lead: 3.3, visits: 250, line: ['Q13', 'P14', 'P13'] },
    { move: 'C3', winrate: 55.1, lead: 1.2, visits: 90, line: ['C3', 'D2'] },
  ],
  groups: [{ color: 'White', stones: 4, at: ['R14', 'R15', 'Q15'], liberties: 3, status: 'weak' }],
  played: { move: 'C3', winrateLoss: 7.3, pointsLost: 2.1, kataGoBest: 'Q13' },
};

describe('ask: figure checker', () => {
  it('finds coordinates, skipping I and out-of-range numbers', () => {
    expect(coordsIn('Play Q13, not I5 or A20; t19 is fine', 19)).toEqual(['Q13', 'T19']);
  });

  it('accepts figures that come from KataGo', () => {
    const a = 'Q13 keeps attacking the weak white group at R14 (62.8% for Black). C3 is 2.1 points worse, and Black leads by 3 points.';
    expect(unsupportedFigures(a, facts)).toEqual([]);
  });

  it('flags invented coordinates, winrates and point figures', () => {
    const a = 'D4 is best, winning 80% and 12 points.';
    expect(unsupportedFigures(a, facts).sort()).toEqual(['12 points', '80%', 'D4'].sort());
  });

  it('allows figures from probes and from the question', () => {
    const probes = [{ moves: ['D4', 'C4'], legal: true, toPlay: 'Black' as const, blackWinrate: 48, blackLead: -0.5, bestLine: ['D5'], visits: 160 }];
    expect(unsupportedFigures('After D4 C4, D5 and Black is at 48%.', facts, probes)).toEqual([]);
    expect(unsupportedFigures('K10 is not needed.', facts, [], 'what about K10?')).toEqual([]);
  });
});

describe('ask: reply parsing and prompt', () => {
  it('reads an answer or probes, and drops probes on the final round', () => {
    expect(parseAskReply('{"answer":"Because."}', false, 19)).toEqual({ answer: 'Because.', probes: undefined });
    const p = parseAskReply('```json\n{"probes":[{"moves":["d4","c3","zz"],"why":"check"}]}\n```', false, 19);
    expect(p?.probes?.[0].moves).toEqual(['D4', 'C3']);
    expect(parseAskReply('{"probes":[{"moves":["D4"]}]}', true, 19)).toBeNull();
    expect(parseAskReply('not json', false, 19)).toBeNull();
  });

  it('puts the facts, the level and corrections into the prompt', () => {
    const t = buildAskPrompt({ task: 'ask-position', question: 'Why Q13?', facts: { ...facts, level: 'about 3k' } }, ['D4']);
    expect(t).toContain('about 3k');
    expect(t).toContain('Q13: winrate 62.8%');
    expect(t).toContain('White 4 stones at R14 R15 Q15: 3 liberties, weak');
    expect(t).toContain('cited figures that are not in KataGo');
  });
});

describe('ask: server round and client flow', () => {
  const env = { LLM_API_KEY: 'k', LLM_MODEL: 'Gemini' };
  const reply = (text: string) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }), text: async () => '' });

  it('sends an answer with invented figures back once for correction', async () => {
    const answers = ['{"answer":"D4 wins 80%."}', '{"answer":"Q13 is best: 62.8% for Black."}'];
    let calls = 0;
    const r = await handleLlmRequest('POST', JSON.stringify({ task: 'ask-position', question: 'Best move?', facts }), env, async () => reply(answers[calls++]));
    expect(calls).toBe(2);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ answer: 'Q13 is best: 62.8% for Black.' });
    expect((r.body as { unsupported?: string[] }).unsupported).toBeUndefined();
  });

  it('runs requested probes, then asks for the final answer', async () => {
    const posts: { probes?: unknown; final?: boolean }[] = [];
    const out = await askPosition(
      'What if C3?',
      facts,
      async (p) => ({ moves: p.moves, legal: true, toPlay: 'White', blackWinrate: 55, blackLead: 1.2, bestLine: ['D2'], visits: 100 }),
      [],
      async (body) => {
        posts.push(body as { probes?: unknown; final?: boolean });
        return posts.length === 1 ? { probes: [{ moves: ['C3'] }] } : { answer: 'C3 gives up 2.1 points.' };
      },
    );
    expect(posts[1].final).toBe(true);
    expect(out.probes).toHaveLength(1);
    expect(out.answer).toContain('C3');
  });
});

describe('fact sheet', () => {
  it('describes the board, candidates and groups', () => {
    const b = new Board(9);
    const at = (s: string) => gtpToLoc(s, 9);
    b.play(at('C3'), 1);
    b.play(at('C4'), 2);
    b.play(at('D3'), 1);
    const f = buildFacts({
      board: b,
      komi: 7,
      moveNumber: 4,
      toPlay: 2,
      lastMove: at('D3'),
      bWin: 0.6,
      bLead: 2.04,
      visits: 50,
      candidates: [{ loc: at('D4'), winrate: 0.41, scoreLead: -1.96, visits: 30, pv: [at('D4'), at('E3')] }],
    });
    expect(f.toPlay).toBe('White');
    expect(f.lastMove).toBe('D3');
    expect(f.blackLead).toBe(2);
    expect(f.candidates[0]).toMatchObject({ move: 'D4', winrate: 41, line: ['D4', 'E3'] });
    expect(boardDiagram(b, at('D3')).split('\n')[7]).toBe(' 3 . . X x . . . . .');
  });
});
