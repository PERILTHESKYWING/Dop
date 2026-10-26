import { describe, expect, it } from 'vitest';
import { moveStats, stoneNote } from '../kami/src/lib/moveCaption';
import { DEMO } from '../kami/src/ui/landing/data';
import { FINAL, loc } from '../kami/src/ui/landing/data';
import { EARLIER_PICKS, PICK, PICK_VISITS, PROOF, READ_VISITS } from '../kami/src/ui/landing/story';
import { TERM_NAMES, termCard } from '../kami/src/lib/terms';
import { GLOSSARY } from '../src/lib/coach/glossary';

// the landing's recorded read (demo.json): Black to play, KataGo's longest read of the position
const read = { candidates: FINAL.cands.map((c) => ({ loc: loc(c.at), winrate: c.win, scoreLead: c.lead, visits: c.visits, pv: c.pv.map(loc) })) };

describe('the caption over a previewed move (KataGo numbers only)', () => {
  it('names KataGo’s choice with its win chance and visits', () => {
    expect(moveStats(read, loc('Q9'), 1, 19)).toEqual({ at: 'Q9', text: 'KataGo’s choice · Black 3% · 1,515 visits' });
  });
  it('ranks another move and gives its loss in points, in the board labels’ rounding', () => {
    // R12: lead −10.19 against Q9's −8.62 → 1.6 points worse
    expect(moveStats(read, loc('R12'), 1, 19)?.text).toBe('KataGo’s 2nd choice · Black 1%, 1.6 points worse · 214 visits');
    expect(moveStats(read, loc('Q10'), 1, 19, true)?.text).toBe('3rd choice · 2.7 pts worse · 92 visits');
  });
  it('says plainly when KataGo did not list the move, and nothing for a pass or no read', () => {
    expect(moveStats(read, loc('A1'), 1, 19)?.text).toBe('Not in KataGo’s top 8 moves here');
    expect(moveStats(read, -1, 1, 19)).toBeNull();
    expect(moveStats(null, loc('Q9'), 1, 19)).toBeNull();
  });
});

describe('the landing hero’s proof beside its pick', () => {
  it('is the pick’s real visits out of the read’s total', () => {
    expect(PICK_VISITS).toBe(FINAL.cands.find((c) => c.at === PICK)?.visits);
    expect(PICK_VISITS).toBeGreaterThan(0);
    expect(READ_VISITS).toBe(FINAL.visits);
    expect(PICK_VISITS).toBeLessThanOrEqual(READ_VISITS);
  });
  it('says honestly what shorter reads preferred, from the recorded reads', () => {
    expect(EARLIER_PICKS).toEqual([...new Set(DEMO.reads.slice(0, -1).map((r) => r.cands[0].at))].filter((m) => m !== PICK));
    expect(EARLIER_PICKS[0]).toBe(DEMO.reads[0].cands[0].at);
    expect(PROOF).toBe(`KataGo read ${READ_VISITS.toLocaleString('en-US')} positions, ${PICK_VISITS.toLocaleString('en-US')} of them after ${PICK}. Shorter reads preferred ${EARLIER_PICKS.join(', then ')}.`);
    // the app's quick (Low) answer on this board is one of them
    const low = DEMO.answers.find((a) => a.question === 'What should Black play here?' && a.depth === 'Low')!;
    expect(EARLIER_PICKS).toContain(low.variations[0].moves[0]);
  });
});

describe('what a played stone is', () => {
  const pos = { size: 9, komi: 7, setup: [{ color: 2 as const, loc: 0 }], moves: [{ color: 1 as const, loc: 40 }, { color: 2 as const, loc: 20 }], toPlay: 1 as const };
  it('names its move from the game itself', () => {
    expect(stoneNote(pos, 20)).toEqual({ at: 'C7', text: 'White’s move 2, the last one played' });
    expect(stoneNote(pos, 40)?.text).toBe('Black’s move 1');
    expect(stoneNote(pos, 0)?.text).toBe('a White stone from the setup');
    expect(stoneNote(pos, 1)).toBeNull();
  });
});

describe('Go terms in Chinese and Japanese', () => {
  it('names only glossary terms, and the card carries them', () => {
    for (const k of Object.keys(TERM_NAMES)) expect(GLOSSARY.some((g) => g.term === k), k).toBe(true);
    const hane = GLOSSARY.find((g) => g.term === 'hane')!;
    expect(termCard(hane).names).toEqual({ zh: '扳', ja: 'ハネ' });
    expect(termCard(GLOSSARY.find((g) => g.term === 'keima')!).names).toBeUndefined();
  });
});
