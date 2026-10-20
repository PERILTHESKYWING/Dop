/** Kiai pro notes (kami/src/lib/notes.ts): which moments are offered, the note format, export. */
import { describe, expect, it } from 'vitest';
import { agreement, fromJsonl, gameIdOf, isDone, keyMoments, noteId, NOTES_FORMAT, toJsonl, type ProNote } from '../kami/src/lib/notes';
import type { EngineRead, ExplainPosition } from '../src/lib/coach/explain/types';
import { gtpToLoc } from '../src/lib/go/coords';
import type { Color, Move } from '../src/lib/go/types';

const at = (s: string) => gtpToLoc(s, 19);
const GTP = ['D4', 'Q16', 'D16', 'Q4', 'C10', 'R10', 'K3', 'K17', 'O3', 'F17'];
const moves: Move[] = GTP.map((s, i) => ({ color: (i % 2 === 0 ? 1 : 2) as Color, loc: at(s) }));
const positions: ExplainPosition[] = Array.from({ length: moves.length + 1 }, (_, i) => ({ size: 19, komi: 7.5, setup: [], moves: moves.slice(0, i), toPlay: (i % 2 === 0 ? 1 : 2) as Color }));

/** A read where the side to move's best move is `best` at `win`/`lead`; the played move (if given) is a candidate too. */
function read(i: number, best: string, win: number, lead: number, played?: { win: number; lead: number }): EngineRead {
  const toPlay = positions[i].toPlay;
  const bWin = toPlay === 1 ? win : 1 - win;
  const bLead = toPlay === 1 ? lead : -lead;
  const candidates = [{ loc: at(best), winrate: win, scoreLead: lead, visits: 150, pv: [] }];
  if (played && moves[i]) candidates.push({ loc: moves[i].loc, winrate: played.win, scoreLead: played.lead, visits: 40, pv: [] });
  return { visits: 200, bWin, bLead, ownership: null, candidates };
}

describe('keyMoments', () => {
  // Every move is fine except move 5 (C10, Black): 6 points and 20% lost.
  const reads = positions.map((_, i) => (i === 4 ? read(i, 'E3', 0.55, 1, { win: 0.35, lead: -5 }) : read(i, i < moves.length ? GTP[i] : 'A1', 0.5, 0.5)));

  it('offers the move that lost points, with KataGo’s best move', () => {
    const ks = keyMoments(positions, reads, moves);
    expect(ks.map((k) => k.index)).toEqual([4]);
    expect(ks[0]).toMatchObject({ played: 'C10', best: 'E3', color: 1 });
    expect(ks[0].scoreLoss).toBeCloseTo(6);
    expect(ks[0].winLoss).toBeCloseTo(0.2);
  });

  it('skips moves without both reads', () => {
    const missing = reads.slice();
    missing[4] = null as unknown as EngineRead;
    expect(keyMoments(positions, missing, moves)).toEqual([]);
  });

  it('in a decided game only a big point loss counts', () => {
    const decided = positions.map((_, i) => (i === 4 ? read(i, 'E3', 0.99, 20, { win: 0.97, lead: 17 }) : read(i, i < moves.length ? GTP[i] : 'A1', 0.5, 0.5)));
    expect(keyMoments(positions, decided, moves)).toEqual([]);
    const big = positions.map((_, i) => (i === 4 ? read(i, 'E3', 0.99, 20, { win: 0.97, lead: 14 }) : read(i, i < moves.length ? GTP[i] : 'A1', 0.5, 0.5)));
    expect(keyMoments(positions, big, moves).map((k) => k.index)).toEqual([4]);
  });

  it('keeps the biggest `max`, shown in game order', () => {
    const many = positions.map((_, i) => (i < moves.length ? read(i, 'E3', 0.6, 2, { win: 0.6 - 0.02 * (i + 1), lead: 2 - (i + 2) }) : read(i, 'A1', 0.5, 0.5)));
    const ks = keyMoments(positions, many, moves, 3);
    expect(ks.map((k) => k.index)).toEqual([7, 8, 9]);
  });
});

function note(over: Partial<ProNote> = {}): ProNote {
  return {
    format: NOTES_FORMAT,
    id: noteId('g1', 4),
    gameId: 'g1',
    game: { black: 'Shin Jinseo', white: 'Ke Jie', date: '2025-03-01', event: 'Test', size: 19 },
    index: 4,
    moveNumber: 5,
    color: 'B',
    played: 'C10',
    katago: { best: 'E3', scoreLoss: 6, winLoss: 0.2, winBefore: 0.55, visits: 200, network: 'KataGo b18 · GPU' },
    verdict: 'mistake',
    better: 'E3',
    reason: '方向错了, the lower side was bigger.',
    tags: ['direction'],
    byHand: false,
    created: 1,
    updated: 2,
    ...over,
  };
}

describe('notes format', () => {
  it('round-trips through JSONL, mixed languages included', () => {
    const a = note();
    const b = note({ id: noteId('g0', 9), gameId: 'g0', index: 9, verdict: 'katago-wrong', better: 'R3' });
    const text = toJsonl([a, b]);
    expect(text.trim().split('\n')).toHaveLength(2);
    expect(text.indexOf('"g0#9"')).toBeLessThan(text.indexOf('"g1#4"'));
    const back = fromJsonl(`${text}not json\n{"x":1}\n`);
    expect(back.bad).toBe(2);
    expect(back.notes).toEqual([b, a]);
  });

  it('a note is done with a reason or a tag; a skip is done too', () => {
    expect(isDone(note({ reason: '', tags: [] }))).toBe(false);
    expect(isDone(note({ reason: '', tags: ['shape'] }))).toBe(true);
    expect(isDone(note({ verdict: 'skip', reason: '', tags: [] }))).toBe(true);
  });

  it('counts agreement with KataGo', () => {
    const a = agreement([note(), note({ id: 'x', verdict: 'katago-wrong', better: 'R3' }), note({ id: 'y', verdict: 'skip' })]);
    expect(a).toEqual({ judged: 2, mistake: 1, fine: 0, katagoWrong: 1, sameMove: 1 });
  });

  it('the same game opened twice gets the same id', () => {
    expect(gameIdOf(19, [], moves)).toBe(gameIdOf(19, [], moves.slice()));
    expect(gameIdOf(19, [], moves)).not.toBe(gameIdOf(19, [], moves.slice(0, -1)));
  });
});
