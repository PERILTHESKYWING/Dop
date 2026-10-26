import { describe, expect, it } from 'vitest';
import { moveStats } from '../kami/src/lib/moveCaption';
import { FINAL, loc } from '../kami/src/ui/landing/data';
import { PICK, PICK_VISITS, READ_VISITS } from '../kami/src/ui/landing/story';
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
});

describe('Go terms in Chinese and Japanese', () => {
  it('names only glossary terms, and the card carries them', () => {
    for (const k of Object.keys(TERM_NAMES)) expect(GLOSSARY.some((g) => g.term === k), k).toBe(true);
    const hane = GLOSSARY.find((g) => g.term === 'hane')!;
    expect(termCard(hane).names).toEqual({ zh: '扳', ja: 'ハネ' });
    expect(termCard(GLOSSARY.find((g) => g.term === 'keima')!).names).toBeUndefined();
  });
});
