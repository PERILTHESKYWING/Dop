import { describe, expect, it } from 'vitest';
import { Board } from '../src/lib/go/board';
import { locToGtp, sgfToLoc, toLoc } from '../src/lib/go/coords';
import { canonicalKey, decodeStones, encodeStones, framePosition, lifeWindow, lineTags, looseGroups, problemWindow, shapeOk } from '../src/lib/problems/frame';
import { answerLength, mainLine, playMove, problemBoard, startSolve, viewOf } from '../src/lib/problems/play';
import { dailySet, matches, pickSet, type SetFilter } from '../src/lib/problems/bank';
import { expectedSolve, levelsByQuantile, rankToRating, updateRating } from '../src/lib/problems/level';
import { fallbackText, problemDiagram, problemFacts } from '../src/lib/problems/text';
import { checkText, diagramStones, handleForgeWrite, parseForgeReply, type ForgeWriteRequest, type ProblemText } from '../shared/forgeWriter';
import type { Problem } from '../src/lib/problems/types';

const N = 19;
const L = (s: string) => sgfToLoc(s, N);

/** A top-left corner problem: black group in the corner, white around it. */
function cornerProblem(overrides: Partial<Problem> = {}): Problem {
  return {
    id: 'p1',
    cat: 'life',
    goal: 'kill',
    size: N,
    // Black: a small corner group; White: the surrounding wall.
    b: 'abbbcbdbdaeb',
    w: 'acbccdcdddedfbfafc',
    toPlay: 'W',
    view: [0, 0, 7, 6],
    frame: 'W',
    tree: {
      ok: { fe: [{ r: 'ge', n: { ok: { ff: [] } } }] },
      bad: { gf: ['fe', 'ge'] },
    },
    level: -8,
    win: 0.5,
    stakes: 20,
    tags: ['placement'],
    target: 'abbbcbdb',
    src: { kind: 'fox', rank: -6, move: 120 },
    ...overrides,
  };
}

describe('tsumego frame', () => {
  it('cuts a corner window and gives both sides a living, settled area', () => {
    const b = new Board(N);
    for (const s of ['cc', 'dc', 'cd']) b.stones[L(s)] = 1;
    for (const s of ['ec', 'ed', 'de', 'ce', 'cf']) b.stones[L(s)] = 2;
    b.stones[L('qq')] = 1; // far away: must not survive the cut
    const r = problemWindow(N, [L('cc'), L('dc'), L('cd')])!;
    expect(r.x0).toBe(0);
    expect(r.y0).toBe(0);
    const framed = framePosition(b.stones, N, r, 2)!;
    expect(framed).not.toBeNull();
    // Inside: copied. Outside: filled, the far stone replaced.
    expect(framed[L('cc')]).toBe(1);
    expect(framed[L('qq')]).not.toBe(1 as never);
    const fb = new Board(N, framed);
    // Every chain has a liberty and the frame has eyes for both colours.
    expect(fb.groups().every((g) => g.liberties.length > 0)).toBe(true);
    const eyes = [0, 0, 0];
    for (let l = 0; l < N * N; l++) {
      if (framed[l]) continue;
      const n = fb.neighbors(l).map((q) => framed[q]);
      if (n.every((c) => c === 1)) eyes[1]++;
      if (n.every((c) => c === 2)) eyes[2]++;
    }
    expect(eyes[1]).toBeGreaterThanOrEqual(2);
    expect(eyes[2]).toBeGreaterThanOrEqual(2);
    // The wall right around the window is the attacker's.
    expect(framed[toLoc(r.x1 + 1, 0, N)]).toBe(2);
  });

  it('refuses center groups and oversized windows', () => {
    expect(problemWindow(N, [toLoc(9, 9, N), toLoc(10, 9, N)])).toBeNull();
    const long = Array.from({ length: 15 }, (_, i) => toLoc(i + 2, 1, N));
    expect(problemWindow(N, long)).toBeNull();
  });

  it('joins diagonal and one-point-jump chains into one group', () => {
    const b = new Board(N);
    for (const s of ['cc', 'dd', 'fd']) b.stones[L(s)] = 1;
    const groups = looseGroups(b);
    expect(groups).toHaveLength(1);
    expect(groups[0].stones).toHaveLength(3);
    expect(lifeWindow(b, groups[0].stones)).not.toBeNull();
  });

  it('keys a position the same under rotation, mirroring and colour swap', () => {
    const a = new Int8Array(N * N);
    a[L('cc')] = 1;
    a[L('dc')] = 2;
    const rot = new Int8Array(N * N);
    rot[toLoc(N - 1 - 2, 2, N)] = 2; // mirrored and colours swapped
    rot[toLoc(N - 1 - 3, 2, N)] = 1;
    expect(canonicalKey(a, N, 1)).toBe(canonicalKey(rot, N, 2));
    expect(canonicalKey(a, N, 1)).not.toBe(canonicalKey(a, N, 2));
  });

  it('round-trips stones and judges crowded windows', () => {
    const s = decodeStones('aabb', 'ccdd', N);
    expect(encodeStones(s, N, 1)).toBe('aabb');
    expect(encodeStones(s, N, 2)).toBe('ccdd');
    const full = new Int8Array(N * N).fill(1);
    expect(shapeOk(full, N, { x0: 0, y0: 0, x1: 6, y1: 6 })).toBe(false);
    expect(shapeOk(s, N, { x0: 0, y0: 0, x1: 6, y1: 6 })).toBe(true);
  });

  it('names techniques in a line: a stone that can be taken at once is a throw-in or sacrifice', () => {
    const b = new Board(N);
    // White stone at bb with black around three sides: playing ab... simple atari check.
    b.stones[L('ba')] = 2;
    b.stones[L('aa')] = 1;
    b.stones[L('bb')] = 1;
    const tags = lineTags(b, 1, [L('ca')]);
    expect(tags).toContain('capture');
  });
});

describe('solving', () => {
  it('rebuilds the frame the problem was verified with and shows one more line', () => {
    const p = cornerProblem();
    const b = problemBoard(p);
    expect(b.stones[L('ab')]).toBe(1);
    expect(b.stones[toLoc(9, 0, N)]).toBe(2); // frame wall
    expect(viewOf(p)).toEqual({ x0: 0, y0: 0, x1: 8, y1: 7 });
  });

  it('answers right moves, finishes a solved line and refutes a wrong one', () => {
    const p = cornerProblem();
    let s = startSolve(p);
    const r1 = playMove(p, s, L('fe'), () => 0);
    expect(r1.state.outcome).toBe('continue');
    expect(r1.reply).toBe(L('ge'));
    expect(r1.state.board.stones[L('ge')]).toBe(1);
    s = r1.state;
    const r2 = playMove(p, s, L('ff'));
    expect(r2.state.outcome).toBe('solved');
    const w = playMove(p, startSolve(p), L('gf'));
    expect(w.state.outcome).toBe('wrong');
    expect(w.state.refutation).toEqual([L('fe'), L('ge')]);
    const other = playMove(p, startSolve(p), L('ee'));
    expect(other.state.outcome).toBe('wrong');
    expect(other.state.refutation).toBeNull();
    expect(mainLine(p.tree, N)).toEqual([L('fe'), L('ge'), L('ff')]);
    expect(answerLength(p)).toBe(2);
  });
});

describe('problem sets', () => {
  const bank: Problem[] = [];
  for (let i = 0; i < 40; i++)
    bank.push(cornerProblem({ id: `p${i}`, cat: i % 2 ? 'life' : 'endgame', level: -14 + (i % 22), win: i % 5 === 0 ? 0.1 : 0.45 }));
  const f: SetFilter = { categories: ['life', 'endgame'], minLevel: -14, maxLevel: 7, minLosingWinrate: 0.3 };

  it('keeps the winrate floor and the level range', () => {
    expect(matches(bank[0], f)).toBe(false); // 10% for the side behind
    expect(matches(bank[1], { ...f, maxLevel: -14 })).toBe(false);
  });

  it('brings missed problems back, mixes categories and climbs in level', () => {
    const last = new Map([['p1', { at: 0, ok: false }]]);
    const set = pickSet(bank, f, 8, { last }, () => 0.3, 10 * 86_400_000);
    expect(set.map((p) => p.id)).toContain('p1');
    expect(new Set(set.map((p) => p.cat)).size).toBe(2);
    expect(set.map((p) => p.level)).toEqual([...set.map((p) => p.level)].sort((a, b) => a - b));
  });

  it('gives the same daily set all day', () => {
    expect(dailySet(bank, -5, '2026-09-28').map((p) => p.id)).toEqual(dailySet(bank, -5, '2026-09-28').map((p) => p.id));
  });
});

describe('levels and rating', () => {
  it('spreads levels over 15k to 7d, easiest first', () => {
    const lv = levelsByQuantile([0.9, 0.1, 0.5, 0.7]);
    expect(lv[0]).toBeLessThan(lv[3]);
    expect(lv[3]).toBeLessThan(lv[2]);
    expect(lv[2]).toBeLessThan(lv[1]);
    const many = levelsByQuantile(Array.from({ length: 220 }, (_, i) => i / 220));
    expect(Math.min(...many)).toBe(-14);
    expect(Math.max(...many)).toBe(7);
  });

  it('moves the rating toward the problems solved', () => {
    const r = rankToRating(-5);
    expect(expectedSolve(r, -5)).toBeCloseTo(0.5);
    expect(updateRating(r, -2, 1, 0)).toBeGreaterThan(r);
    expect(updateRating(r, -8, 0, 0)).toBeLessThan(r);
  });
});

describe('problem texts', () => {
  const p = cornerProblem();
  const facts = problemFacts(p);

  it('builds facts from the answer tree, with a diagram the checker can read', () => {
    expect(facts.task).toBe('White to play and kill.');
    expect(facts.answer[0]).toBe(`W ${locToGtp(L('fe'), N)}`);
    expect(facts.wrong[0].move).toBe(locToGtp(L('gf'), N));
    expect(diagramStones(problemDiagram(p))).toContain(locToGtp(L('ab'), N));
  });

  it('has its own text without a language model', () => {
    const t = fallbackText(p);
    expect(t.question).toBe('White to play and kill.');
    expect(t.explanation).toContain(locToGtp(L('fe'), N));
    expect(checkText(t, facts)).toEqual([]);
  });

  it('rejects invented coordinates, answers in hints and made-up numbers', () => {
    const base: ProblemText = { id: 'p1', keep: true, instructive: 4, title: 'Corner', question: 'White to play and kill.', hint: 'Look inside.', explanation: 'F15 is the vital point.', wrongNotes: {} };
    expect(checkText(base, facts)).toEqual([]);
    expect(checkText({ ...base, explanation: 'K10 kills.' }, facts).length).toBe(1);
    expect(checkText({ ...base, hint: 'Play F15.' }, facts).length).toBeGreaterThan(0);
    expect(checkText({ ...base, explanation: 'F15 wins 55% of the time.' }, facts).length).toBe(1);
    expect(checkText({ ...base, explanation: 'F15 is worth 40 points.' }, facts).length).toBe(1);
  });

  it('parses the reply and sends failing texts back once', async () => {
    const req: ForgeWriteRequest = { task: 'forge-problems', playerLevel: '5k', problems: [facts] };
    const bad = JSON.stringify({ texts: [{ id: 'p1', keep: true, instructive: 4, title: 'x', question: 'White to play and kill.', hint: 'h', explanation: 'K10 kills.', wrongNotes: {} }] });
    const good = JSON.stringify({ texts: [{ id: 'p1', keep: false, instructive: 1, title: 'x', question: 'White to play and kill.', hint: 'h', explanation: 'F15 kills.', wrongNotes: { G14: 'Too slow.', Z99: 'x' } }] });
    expect(parseForgeReply(bad, req).texts).toHaveLength(0);
    const calls: string[] = [];
    const res = await handleForgeWrite(
      req,
      async (prompt) => {
        calls.push(prompt.user);
        return { ok: true, text: calls.length === 1 ? bad : good, model: 'm', errors: [] };
      },
      60_000,
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('K10');
    const body = res.body as { texts: ProblemText[]; rejected: string[] };
    expect(body.texts).toHaveLength(1);
    expect(body.texts[0].keep).toBe(false);
    expect(Object.keys(body.texts[0].wrongNotes)).toEqual(['G14']);
    expect(body.rejected).toEqual([]);
  });
});
