import { describe, expect, it } from 'vitest';
import type { PositionFacts } from '../shared/ask';
import { buildChatPrompt, checkAnswer, claimIssues, parseChatReply, validChatRequest, type ChatRequest } from '../shared/chat';
import { handleLlmRequest } from '../shared/llmServer';
import { buildProfile, chatTurn, namedMoves } from '../src/lib/coach/chat';

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
    { move: 'C3', winrate: 60.1, lead: 2.9, visits: 90, line: ['C3', 'D2'] },
  ],
  groups: [
    { color: 'White', stones: 5, at: ['R14', 'R15', 'Q15'], all: ['R14', 'R15', 'Q15', 'Q16', 'R16'], liberties: 3, status: 'weak' },
    { color: 'Black', stones: 3, at: ['D4', 'D5', 'E4'], all: ['D4', 'D5', 'E4'], liberties: 7, status: 'safe' },
  ],
};

const ask = (text: string, position: PositionFacts | null = facts): ChatRequest => ({ task: 'chat', messages: [{ role: 'user', text }], position: position ?? undefined });

describe('chat: checker', () => {
  it('accepts stones anywhere in a group and flags wrong life-and-death claims', () => {
    expect(checkAnswer('The white stones at Q16 are weak, so attack with Q13.', ask('?'))).toEqual([]);
    expect(claimIssues('The white group at R16 is dead.', facts)).toEqual(["the White group at R16 called dead, but KataGo's ownership says weak"]);
    // Each status word goes with the point named just before it.
    expect(claimIssues('Black D4 is safe, while White R14 is weak.', facts)).toEqual([]);
    // Conditional sentences are not claims.
    expect(claimIssues('If White gets R13, the group at R14 is alive.', facts)).toEqual([]);
  });

  it('flags "only move" without a gap to the next move', () => {
    expect(claimIssues('Q13 is the only move here.', facts)).toEqual(['Q13 called the only move, but KataGo shows other moves close to it']);
    const clear = { ...facts, candidates: [facts.candidates[0], { ...facts.candidates[1], winrate: 40, lead: -2 }] };
    expect(claimIssues('The only move is Q13; C3 loses a lot.', clear)).toEqual([]);
  });

  it('flags invented figures with a board, and quoted winrates without one', () => {
    expect(checkAnswer('D10 gives 80%.', ask('?'))).toEqual(['D10', '80%']);
    expect(checkAnswer('Black is at 70% winrate here.', ask('Explain sente', null))).toEqual(['70% winrate']);
    expect(checkAnswer('Spend 30% of your time on tsumego.', ask('Plan?', null))).toEqual([]);
  });
});

describe('chat: prompt and parsing', () => {
  it('puts profile, facts, history and the question in the prompt', () => {
    const t = buildChatPrompt({
      task: 'chat',
      messages: [
        { role: 'user', text: 'Hi' },
        { role: 'coach', text: 'Hello!' },
        { role: 'user', text: 'Why Q13?' },
      ],
      position: facts,
      profile: { level: 'about 3k (likely 5k to 1k)', weaknesses: [{ title: 'Slow defence', detail: 'Defends too early.', area: 'weak groups', lossPerMove: 4.2, share: '12 times' }] },
    });
    expect(t).toContain('about 3k');
    expect(t).toContain('Slow defence (weak groups)');
    expect(t).toContain('Q13: winrate 62.8%');
    expect(t).toContain('Coach: Hello!');
    expect(t.trim().endsWith('Student: Why Q13?')).toBe(true);
    expect(buildChatPrompt(ask('Plan?', null))).toContain('No board is attached');
  });

  it('parses answers with follow-ups, and probes only when allowed', () => {
    expect(parseChatReply('{"answer":"Because.","followups":["Why?","",3]}', true, 19)).toEqual({ answer: 'Because.', followups: ['Why?'] });
    expect(parseChatReply('{"probes":[{"moves":["q13","zz"]}]}', true, 19)).toEqual({ probes: [{ moves: ['Q13'], why: undefined }] });
    expect(parseChatReply('{"probes":[{"moves":["Q13"]}]}', false, 19)).toBeNull();
    expect(validChatRequest({ task: 'chat', messages: [{ role: 'coach', text: 'x' }] })).toBe(false);
    expect(validChatRequest(ask('ok'))).toBe(true);
  });
});

describe('chat: server turn', () => {
  const env = { LLM_API_KEY: 'k', LLM_MODEL: 'Gemini' };
  const reply = (text: string) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }), text: async () => '' });

  it('answers in one call when the answer checks out', async () => {
    let calls = 0;
    const r = await handleLlmRequest('POST', JSON.stringify(ask('Best move?')), env, async () => (calls++, reply('{"answer":"**Q13** attacks the weak group at R14.","followups":["What if C3?"]}')));
    expect(calls).toBe(1);
    expect(r.body).toMatchObject({ answer: '**Q13** attacks the weak group at R14.', followups: ['What if C3?'], calls: 1, checks: { corrected: false, reviewed: false } });
  });

  it('sends a failing answer back once, and reviews checkable answers in deep mode', async () => {
    const answers = ['{"answer":"R14 is dead, play D10."}', '{"answer":"R14 is weak; Q13 attacks it."}', '{"ok":false,"issues":["x"],"answer":"Q13 attacks the weak R14 group."}'];
    let calls = 0;
    const r = await handleLlmRequest('POST', JSON.stringify({ ...ask('Best move?'), deep: true }), env, async () => reply(answers[calls++]));
    expect(calls).toBe(3);
    expect(r.body).toMatchObject({ answer: 'Q13 attacks the weak R14 group.', calls: 3, checks: { corrected: true, reviewed: true } });
  });

  it('returns probes on the first round', async () => {
    const r = await handleLlmRequest('POST', JSON.stringify(ask('What if C3?')), env, async () => reply('{"probes":[{"moves":["C3","D2"],"why":"check"}]}'));
    expect(r.body).toMatchObject({ probes: [{ moves: ['C3', 'D2'] }] });
  });
});

describe('chat: client turn', () => {
  it('pre-checks named moves, runs requested probes in one batch, then answers', async () => {
    const posts: ChatRequest[] = [];
    const pre = namedMoves('What about D10 and Q13?', facts, () => true);
    expect(pre).toEqual([{ moves: ['D10'], why: 'named by the student' }]);
    const out = await chatTurn(
      { messages: [{ role: 'user', text: 'What about D10?' }], position: facts, pre },
      async (p) => ({ moves: p.moves, legal: true, toPlay: 'White', blackWinrate: 50, blackLead: 0.5, bestLine: ['Q13'], visits: 100 }),
      () => {},
      async (body) => {
        posts.push(body);
        return posts.length === 1 ? { probes: [{ moves: ['C3'] }, { moves: ['Q13', 'P14'] }], calls: 1 } : { answer: 'D10 is slow.', calls: 1 };
      },
    );
    expect(posts[0].probes).toHaveLength(1);
    expect(posts[1].final).toBe(true);
    expect(posts[1].probes).toHaveLength(3);
    expect(out).toMatchObject({ answer: 'D10 is slow.', calls: 2 });
  });

  it('builds a profile from level and weaknesses', () => {
    const p = buildProfile(null, [], 0);
    expect(p).toEqual({});
  });
});
