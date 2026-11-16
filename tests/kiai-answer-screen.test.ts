import { describe, expect, it } from 'vitest';
import { quietWinChances } from '../kami/src/lib/markFacts';
import { NOTES, wordsLine } from '../kami/src/lib/writer';

const alt = (t: string) => /^[A-HJ-T]\d{1,2} is (about as good as|[\d.]+ points? (worse than|ahead of)) /.test(t);

describe('KataGo’s numbers: the win chance once (markFacts quietWinChances)', () => {
  const rows = [
    "KataGo's best move for Black is Q10: Black's win chance 1%, Black trails by 10.4 points.",
    "Q12 is 1.3 points worse than Q10 (Black's win chance <1%).",
    "R12 is about as good as Q10 (0.2 points apart; Black's win chance 1%).",
    "R10 is 0.9 points worse than Q10 (Black's win chance 2%).",
  ];

  it('keeps it on the pick’s row and takes it off rows that only repeat it', () => {
    const q = quietWinChances(rows, alt)!;
    expect(q.pick).toBe('Q10');
    expect(q.rows).toEqual([rows[0], 'Q12 is 1.3 points worse than Q10.', 'R12 is about as good as Q10 (0.2 points apart).', 'R10 is 0.9 points worse than Q10.']);
  });

  it('leaves every row as it is when one win chance says something (more than 1% off)', () => {
    const close = [rows[0].replace('1%,', '52%,'), "Q12 is 1.3 points worse than Q10 (Black's win chance 47%)."];
    expect(quietWinChances(close, alt)).toBeNull();
  });

  it('changes nothing with no other moves or no pick row', () => {
    expect(quietWinChances([rows[0]], alt)).toBeNull();
    expect(quietWinChances(rows.slice(1), alt)).toBeNull();
  });
});

describe('who wrote the words (writer wordsLine)', () => {
  it('says so for each writer and never names a vendor', () => {
    expect(wordsLine({ by: 'engine' })).toBe('Written by Kiai, no language model');
    expect(wordsLine({ by: 'gemini', text: 'x' })).toMatch(/^Written by a language model/);
    expect(wordsLine({ by: 'local', text: 'x' })).toMatch(/^Written by a small language model on this device/);
    // a model that failed its check: the engine's words are shown
    expect(wordsLine({ by: 'engine', note: NOTES.failed })).toMatch(/no language model/);
    for (const by of ['engine', 'gemini', 'local'] as const) expect(wordsLine({ by, text: 'x' })).not.toMatch(/gemini|google|openai/i);
  });

  it('says nothing while a draft waits for the model', () => {
    expect(wordsLine({ by: 'engine', note: NOTES.polishing })).toBeNull();
    expect(wordsLine({ by: 'engine', note: NOTES.polishingLocal })).toBeNull();
  });
});
