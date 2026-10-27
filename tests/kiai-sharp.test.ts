/**
 * Round 1 of the swarm critics (2026-10-23): answers that contradicted KataGo. The demo
 * position at move 34 (White's Q11 attaches to R11, White about 11 points ahead) used to get
 * "Plenty of room to play here! ... play to your style ... What kind of game do you feel like?",
 * a "sente Q10" chip (Q10 is met by the cut at R10), "the extension at R10" (a block) and the
 * filler fact "There are 34 stones on the board". The reads in fixtures/kiai-move34-reads.json
 * are real: the bundled b10 network in Node, 160 visits, recorded by the scratch script that
 * also produced the before/after text.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkAnswer, wordingProblems } from '../src/lib/coach/answerCheck';
import { explain, type EngineRead, type Explanation, type ExplainPosition, type Prober } from '../src/lib/coach/explain';
import { conceptContext, purposeHits, senteInLine } from '../src/lib/coach/explain/concepts';
import { leansWords, plainTurn } from '../src/lib/coach/explain/consequence';
import { DEFAULT_LEVEL, longerLevel } from '../kami/src/lib/levels';
import { shapeOf } from '../src/lib/coach/explain/shapes';
import { gameDecided } from '../src/lib/coach/explain/situation';
import { replay } from '../src/lib/go/board';
import { gtpToLoc } from '../src/lib/go/coords';
import type { Move } from '../src/lib/go/types';
import { BIG_R, candidateLabeler, holdPick, keyText, lossLabel, phonePick, phonePlaces } from '../kami/src/lib/candLabels';
import { LlmUnavailable, type CallLlm } from '../kami/src/lib/llm';
import { NOTES, writeAnswer } from '../kami/src/lib/writer';

const root = new URL('../', import.meta.url);
const games = (JSON.parse(readFileSync(new URL('public/demo/demo.json', root), 'utf8')) as { games: { id: string; komi: number; moves: Move[] }[] }).games;
const game = games.find((g) => g.id === 'g70dd864b0bcbfc05')!;
const POS: ExplainPosition = { size: 19, komi: game.komi, setup: [], moves: game.moves.slice(0, 34), toPlay: 1 };
const P = (s: string, size = 19) => gtpToLoc(s, size);

type Rec = { key: string; read: Omit<EngineRead, 'ownership'> & { ownership: number[] | null } };
const recorded = JSON.parse(readFileSync(new URL('tests/fixtures/kiai-move34-reads.json', root), 'utf8')) as Rec[];
const keyOf = (p: ExplainPosition) => p.moves.map((m) => `${m.color}${m.loc}`).join(',') + '|' + p.toPlay;
/** The recorded reads; any other read is "out of time" (null), as in the browser. */
const replayProber: Prober = {
  async read(p) {
    const r = recorded.find((x) => x.key === keyOf(p));
    return r ? { ...r.read, ownership: r.read.ownership ? Float32Array.from(r.read.ownership) : null } : null;
  },
};

let cached: Explanation | null = null;
async function move34(): Promise<Explanation> {
  cached ??= await explain(POS, { kind: 'best', text: 'What should Black play here?' }, replayProber, { model: 'hane', thinking: 'medium' });
  return cached;
}

describe('shape words follow the geometry', () => {
  const b = replay(19, [], POS.moves);
  it('R10, straight below Black R11 and touching White R9, is a block, not an extension', () => {
    expect(shapeOf(b, P('R10'), 1)?.id).toBe('block');
    expect(shapeOf(b, P('R10'), 1)?.name).toBe('the block');
  });
  it('keeps the hanes and the plain extension', () => {
    expect(shapeOf(b, P('Q10'), 1)?.id).toBe('hane');
    expect(shapeOf(b, P('Q12'), 1)?.id).toBe('hane');
    expect(shapeOf(b, P('R12'), 1)?.id).toBe('extend');
  });
  it('after Black Q10, White R10 is the cut', () => {
    const after = b.clone();
    after.play(P('Q10'), 1);
    expect(shapeOf(after, P('R10'), 2)?.id).toBe('cut');
  });
  it('a step toward the edge on the second line is a descent; into an opponent stone it is a block', () => {
    const S = 9;
    const q = (s: string) => gtpToLoc(s, S);
    const d = replay(S, [{ color: 1, loc: q('C3') }, { color: 2, loc: q('D2') }], []);
    expect(shapeOf(d, q('C2'), 1)?.id).toBe('descent');
    const k = replay(S, [{ color: 1, loc: q('C3') }, { color: 2, loc: q('C1') }], []);
    expect(shapeOf(k, q('C2'), 1)?.id).toBe('block');
    const e = replay(S, [{ color: 1, loc: q('D5') }], []);
    expect(shapeOf(e, q('D4'), 1)?.id).toBe('extend');
  });
});

describe('sente needs the line to show it', () => {
  it('the reply is local and the mover then plays elsewhere', () => {
    expect(senteInLine(P('Q10'), [P('R10'), P('C3')], 19)).toBe(true);
    expect(senteInLine(P('Q10'), [P('R10'), P('Q9')], 19)).toBe(false);
    expect(senteInLine(P('Q10'), [P('R10')], 19)).toBe(false);
    expect(senteInLine(P('Q10'), [P('C3'), P('D5')], 19)).toBe(false);
  });
});

describe('the game is decided only late, from the point lead', () => {
  it('not at move 35 with 11 points, yes at move 160; a huge early lead decides it', () => {
    expect(gameDecided(35, -11)).toBe(false);
    expect(gameDecided(160, -11)).toBe(true);
    expect(gameDecided(160, -5)).toBe(false);
    expect(gameDecided(35, -60)).toBe(true);
    expect(gameDecided(200, 2)).toBe(false);
  });
});

describe('the move-34 answer (engine text, no LLM)', () => {
  it('is a sharp position: lopsided and a contact play', async () => {
    const ex = await move34();
    expect(ex.situation).toMatchObject({ sharp: true, lopsided: true, contact: true, tone: 'teach' });
    expect(ex.situation?.lead).toBeLessThan(-5);
  });

  it('leads with the position, then KataGo’s move and the local fight from its line', async () => {
    const ex = await move34();
    expect(ex.summary.startsWith('White leads by about 11 points.')).toBe(true);
    expect(ex.summary).toContain("White's Q11 attaches to the black stone at R11.");
    expect(ex.summary).toContain('the hane at Q10 [[v1]]');
    expect(ex.summary).toContain('the cut at R10');
    for (const bad of [/plenty of room/i, /play (to )?your style/i, /no single correct/i, /!/, /\?/, /extension at R10/]) expect(ex.summary).not.toMatch(bad);
  });

  it('drops the stone-count filler and the unsupported sente chip', async () => {
    const ex = await move34();
    expect(ex.facts.some((f) => /stones on the board/.test(f.text))).toBe(false);
    expect(ex.concepts.some((c) => c.id === 'sente' && c.at[0] === P('Q10'))).toBe(false);
  });

  it('passes its own wording rules, and the old cheerful text does not', async () => {
    const ex = await move34();
    expect(wordingProblems(ex, ex.summary)).toEqual([]);
    const old = "Plenty of room to play here! There's no single correct move, so play to your style. The hane at Q10 [[v1]] and the extension at R10 are fine too. What kind of game do you feel like?";
    const problems = wordingProblems(ex, old);
    expect(problems.some((p) => p.includes('plenty of room'))).toBe(true);
    expect(problems.some((p) => p.includes('play your style'))).toBe(true);
    expect(problems).toContain('exclamation mark in a sharp position');
    expect(problems).toContain('closing question in a sharp position');
    expect(problems.some((p) => p.startsWith('"extension" at R10'))).toBe(true);
  });
});

describe('the code checker rejects wording that contradicts KataGo', () => {
  it('who leads, "close", "decided" and sente', async () => {
    const ex = await move34();
    expect(wordingProblems(ex, 'Black is ahead, so Q10 [[v1]] keeps it simple.').some((p) => p.startsWith('wrong side ahead'))).toBe(true);
    expect(wordingProblems(ex, 'The game is close. Q10 [[v1]] is the move.').some((p) => p.includes('"close"'))).toBe(true);
    expect(wordingProblems(ex, 'The game is decided. Q10 [[v1]] is the best try.')).toContain('"decided" before the game is decided');
    expect(wordingProblems(ex, 'Q10 [[v1]] is sente.')).toContain('"sente" without KataGo evidence');
    expect(wordingProblems(ex, 'White leads by about 11 points; the block at R10 is not the move, the hane at Q10 [[v1]] is.')).toEqual([]);
  });

  it('the writer gate shows the engine text when the wording fails, and with no LLM', async () => {
    const ex = await move34();
    const cheerful: CallLlm = async () => ({ text: "Plenty of room to play here! The hane at Q10 [[v1]] and R12 [[v2]] are both fine, so play your style. What kind of game do you feel like?", model: 'test' });
    expect(await writeAnswer(ex, 'myoshu', { callLlm: cheerful, checkAnswer })).toEqual({ by: 'engine', note: NOTES.failed });
    const good: CallLlm = async () => ({ text: "White leads by about 11 points. White's Q11 attaches to R11, and KataGo's best try for Black is the hane at Q10 [[v1]]: White's main reply is the cut at R10, and Black continues at Q9. R12 [[v2]] is about as good.", model: 'test' });
    expect(await writeAnswer(ex, 'myoshu', { callLlm: good, checkAnswer })).toMatchObject({ by: 'gemini' });
    const none: CallLlm = async () => {
      throw new LlmUnavailable('not configured');
    };
    expect(await writeAnswer(ex, 'myoshu', { callLlm: none, checkAnswer })).toEqual({ by: 'engine', note: NOTES.noLlm });
  });
});

describe('a calm, even opening keeps XIAO’s relaxed voice', () => {
  it('play your style, without a stone count', async () => {
    const pos: ExplainPosition = { size: 19, komi: 7.5, setup: [], moves: ['Q16', 'D4', 'Q4', 'D16'].map((s, i) => ({ color: (i % 2 ? 2 : 1) as 1 | 2, loc: P(s) })), toPlay: 1 };
    const cand = (at: string, lead: number, visits: number) => ({ loc: P(at), winrate: 0.52, scoreLead: lead, visits, pv: [P(at)] });
    const read: EngineRead = { visits: 90, bWin: 0.52, bLead: 0.4, ownership: null, candidates: [cand('C10', 0.4, 32), cand('R10', 0.35, 30), cand('K16', 0.3, 28)] };
    const ex = await explain(pos, { kind: 'best', text: 'What should Black play here?' }, { read: async () => read }, { model: 'hane', thinking: 'medium' });
    expect(ex.situation).toMatchObject({ tone: 'relaxed' });
    expect(ex.situation?.sharp).toBeUndefined();
    expect(ex.summary).toMatch(/play to your style/);
    expect(ex.facts.some((f) => /stones on the board/.test(f.text))).toBe(false);
    expect(ex.summary).not.toMatch(/\d+ stones/);
  });
});

describe('candidate labels in a lopsided game', () => {
  const c = (winrate: number, scoreLead: number, rank?: number) => ({ winrate, scoreLead, ...(rank !== undefined ? { rank } : {}) });
  it('show the loss against KataGo’s choice, not the same lead everywhere', () => {
    const cands = [c(0.01, -11.05, 0), c(0.01, -11.95, 1), c(0.004, -12.35, 2), c(0.01, -10.8, 3)];
    // KataGo's choice shows its win chance with a % (never "0.0"), the others the answer's own
    // rounding; a thinner read that came out ahead says so once an answer explains it, and is
    // "≈" before that.
    expect(cands.map(candidateLabeler(cands, false, true)!)).toEqual(['1%', '−0.9', '−1.3', '+0.3']);
    expect(cands.map(candidateLabeler(cands)!)).toEqual(['1%', '−0.9', '−1.3', '≈']);
    expect(cands.map(candidateLabeler(cands, true)!).some((l) => l.startsWith('+'))).toBe(false);
    expect(lossLabel(c(0, -30), c(0, -11))).toBe('−19.0');
    expect(lossLabel(c(0, -11.03), c(0, -11))).toBe('≈');
  });
  it('the same signed one-decimal numbers on a phone as on a desktop (whole points from 10)', () => {
    const cands = [c(0.01, -11.05, 0), c(0.01, -11.95, 1), c(0.004, -12.35, 2), c(0.01, -11.3, 3), c(0, -30, 4)];
    expect(cands.map(candidateLabeler(cands, true)!)).toEqual(['1%', '−0.9', '−1.3', '−0.3', '−19']);
    expect(cands.map(candidateLabeler(cands, true)!).slice(0, 4)).toEqual(cands.map(candidateLabeler(cands)!).slice(0, 4));
    // a true minus sign (U+2212), never a hyphen
    expect(candidateLabeler(cands, true)!(cands[1]).codePointAt(0)).toBe(0x2212);
  });
  it('a close game keeps the win chance', () => {
    expect(candidateLabeler([c(0.45, -1), c(0.4, -2)])).toBeUndefined();
    expect(keyText([c(0.45, -1)], 'Black')).toBe('Rings: KataGo’s best moves, with Black’s win chance. Thick ring: KataGo’s choice.');
  });
  it('the key names every figure a mark can show, in one name for the number', () => {
    const cands = [c(0.01, -11), c(0.01, -12)];
    expect(keyText(cands, 'Black')).toBe('Thick ring: KataGo’s choice, with Black’s win chance. Other rings: points lost against it (≈ about the same).');
    expect(keyText(cands, 'White', true)).toBe('Thick ring: KataGo’s choice, with White’s win chance. Other rings: points lost against it (≈ about the same, + ahead on a shorter read).');
    expect(keyText(cands, 'Black', false, true)).toMatch(/^Underlined: KataGo’s choice/);
    for (const t of [keyText(cands, 'Black'), keyText([c(0.45, -1)], 'Black')]) expect(t).not.toMatch(/winrate|win %/);
  });
  const at = (x: number, y: number) => y * 19 + x;
  const m = (rank: number, x: number, y: number, lead: number) => ({ ...c(0.01, lead, rank), loc: at(x, y) });
  it('a phone numbers at most three marks, spaced so the larger ones never overlap', () => {
    // KataGo's choice, its neighbour a point worse (skipped), two further away, a fifth past the three
    const cands = [m(0, 16, 9, -11), m(1, 17, 9, -12), m(2, 16, 11, -12.2), m(3, 13, 11, -12.5), m(4, 3, 3, -13)];
    const pick = phonePick(cands, 19);
    expect(pick).toEqual([at(16, 9), at(16, 11), at(13, 11)]);
    const label = candidateLabeler(cands, true, false, new Set(pick))!;
    expect(cands.map(label)).toEqual(['1%', '', '−1.2', '−1.5', '']);
    // a close game on a phone: the same three carry the win chance, the rest are bare
    const close = cands.map((x) => ({ ...x, winrate: 0.45 }));
    expect(close.map(candidateLabeler(close, true, false, new Set(pick))!)).toEqual(['45', '', '45', '45', '']);
    // spaced marks keep their full size on their own points
    expect([...phonePlaces(pick, 19).values()].every((p) => p.r === BIG_R && p.dx === 0 && p.dy === 0)).toBe(true);
  });
  it('a move the answer names is numbered even next to KataGo’s choice, and both marks fit', () => {
    // "R12 is about as good as Q10": R12 sits next to the choice
    const cands = [m(0, 15, 9, -11), m(1, 16, 9, -11.2), m(2, 12, 12, -12), m(3, 3, 3, -13)];
    const pick = phonePick(cands, 19, new Set([at(16, 9), at(15, 9)]));
    expect(pick).toEqual([at(15, 9), at(16, 9), at(12, 12)]);
    const places = phonePlaces(pick, 19);
    const a = places.get(at(15, 9))!, b = places.get(at(16, 9))!;
    // each moves 0.2 of a point apart and shrinks so the two never overlap
    expect(a.dx).toBeCloseTo(-0.2);
    expect(b.dx).toBeCloseTo(0.2);
    expect(a.r + b.r).toBeLessThanOrEqual(1 + 0.4);
    expect(a.r).toBeGreaterThan(0.6);
    // an answer naming more moves than fit still numbers the one about as good as the choice
    const more = [m(0, 15, 9, -11), m(1, 15, 7, -11.9), m(2, 14, 10, -12.3), m(3, 16, 9, -11.2)];
    expect(phonePick(more, 19, new Set([at(15, 7), at(14, 10), at(16, 9), at(15, 9)]))).toEqual([at(15, 9), at(16, 9), at(15, 7)]);
    // with no answer, a move within 0.3 points of the choice is numbered first the same way
    expect(phonePick(cands, 19)).toEqual([at(15, 9), at(16, 9), at(12, 12)]);
    expect(phonePick(cands.map((x, i) => (i === 1 ? { ...x, scoreLead: -12 } : x)), 19)).toEqual([at(15, 9), at(12, 12), at(3, 3)]);
  });
  it('the numbered points hold for a second while ranks swap', () => {
    const present = new Set([1, 2, 3, 4]);
    let h = holdPick(null, [1, 2, 3], present, 0);
    h = holdPick(h, [1, 2, 4], present, 100);
    expect(h.shown).toEqual([1, 2, 3]);
    h = holdPick(h, [1, 2, 3], present, 400);
    h = holdPick(h, [1, 2, 4], present, 500);
    expect(holdPick(h, [1, 2, 4], present, 1400).shown).toEqual([1, 2, 3]);
    expect(holdPick(h, [1, 2, 4], present, 1500).shown).toEqual([1, 2, 4]);
    // a new choice of KataGo's, or a shown point gone from the read, moves at once
    expect(holdPick(h, [4, 2, 3], present, 600).shown).toEqual([4, 2, 3]);
    expect(holdPick(h, [1, 2, 4], new Set([1, 2, 4]), 600).shown).toEqual([1, 2, 4]);
  });
});

describe('round 2: one read on screen, each fact once', () => {
  it('the answer carries its own read for the board, without ownership', async () => {
    const ex = await move34();
    expect(ex.root?.candidates[0].loc).toBe(P('Q10'));
    expect(ex.root?.ownership).toBeNull();
    expect(ex.root?.candidates.length).toBeLessThanOrEqual(12);
  });

  it('the first sentence, the bar and the list round the same number', async () => {
    const ex = await move34();
    const trails = Number(/Black trails by ([\d.]+) points/.exec(ex.facts.map((f) => f.text).join(' '))?.[1]);
    expect(trails).toBeGreaterThan(5);
    // the bar shows the answer's root lead: Black's side of KataGo's best move
    expect(ex.root?.bLead.toFixed(1)).toBe((-trails).toFixed(1));
    expect(ex.summary.startsWith(`White leads by about ${Math.round(trails)} points.`)).toBe(true);
  });

  it('names every move the board marks as about as good, chips at the end of the sentence', async () => {
    const ex = await move34();
    // R12 read 0.5 points ahead in fewer visits; R8 is within 0.3 of Q10 in the same read.
    expect(ex.summary).toContain('R12 is about as good: KataGo read it less, and it came out 0.5 points ahead [[v2]].');
    expect(ex.summary).toContain('R8 is about as good too.');
    expect(ex.summary).toContain('the hane at Q10 [[v1]].');
    // No chip in the middle of a sentence.
    expect(ex.summary).not.toMatch(/\]\] [a-z]/);
  });

  it('the rounded lead of the first sentence is not listed again', async () => {
    const ex = await move34();
    expect(ex.facts.find((f) => f.text === 'White leads by about 11 points.')?.quiet).toBe(true);
  });
});

describe('round 2: plain words', () => {
  it('ownership in plain words', () => {
    expect(leansWords(0.22)).toBe("leans Black's way (61%)");
    expect(leansWords(-0.6)).toBe("is White's (80%)");
    expect(leansWords(0.1)).toBe('is still open');
    const tp = { ply: 1, moveNumber: 36, shownPly: 6, shownMove: 40, region: 'right side', zone: 5, ownA: -0.6, ownB: 0.22, leadA: -12, leadB: -9.9 } as unknown as Parameters<typeof plainTurn>[0];
    expect(plainTurn(tp, 1, 'Q12', 'Q10')).toBe("Without Q10, White gets the right side: after Q12, by move 40 it is White's (80%); after Q10 it is leaning Black's (61%).");
  });

  it('no reduction chip for a contact play; a cap from outside keeps it', () => {
    const b = replay(19, [], POS.moves);
    const ctx = conceptContext({ pos: POS, board: b, mover: 1 } as unknown as Parameters<typeof conceptContext>[0]);
    const red = [{ kind: 'reduce' as const, region: 'right side', amount: 2.9 }];
    expect(purposeHits(ctx, P('Q10'), red).some((h) => h.id === 'reduction')).toBe(false);
    expect(purposeHits(ctx, P('K10'), red).find((h) => h.id === 'reduction')?.evidence).toContain('on the right side');
  });

  it('Low by default, and a quick read offers a longer one', () => {
    expect(DEFAULT_LEVEL).toBe('low');
    expect(longerLevel('low')?.id).toBe('high');
    expect(longerLevel('medium')?.id).toBe('high');
    expect(longerLevel('max')).toBeNull();
    expect(longerLevel('ultrago')).toBeNull();
  });
});
