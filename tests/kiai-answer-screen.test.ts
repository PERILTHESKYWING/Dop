import { describe, expect, it } from 'vitest';
import { quietWinChances } from '../kami/src/lib/markFacts';
import { placeClear } from '../kami/src/lib/tipPlace';
import { NOTES, wordsLine } from '../kami/src/lib/writer';

const alt = (t: string) => /^[A-HJ-T]\d{1,2} is (about as good as|[\d.]+ points? (worse than|ahead of)) /.test(t);
const box = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });

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
    expect(wordsLine({ by: 'engine' })).toBe('Words: Kiai, from KataGo’s numbers, no language model');
    expect(wordsLine({ by: 'gemini', text: 'x' })).toMatch(/^Words: a language model/);
    expect(wordsLine({ by: 'local', text: 'x' })).toMatch(/^Words: a small language model on this device/);
    // a model that failed its check: the engine's words are shown
    expect(wordsLine({ by: 'engine', note: NOTES.failed })).toMatch(/no language model/);
    for (const by of ['engine', 'gemini', 'local'] as const) expect(wordsLine({ by, text: 'x' })).not.toMatch(/gemini|google|openai/i);
  });

  it('says nothing while a draft waits for the model', () => {
    expect(wordsLine({ by: 'engine', note: NOTES.polishing })).toBeNull();
    expect(wordsLine({ by: 'engine', note: NOTES.polishingLocal })).toBeNull();
  });
});

describe('a desktop hover card covers no answer text (tipPlace placeClear)', () => {
  const pane = box(52, 48, 638, 734);
  const column = { left: 80, right: 662 };
  // the answer: name row, read row, five prose lines, KataGo's numbers
  const cover = [box(80, 170, 582, 20), box(80, 198, 582, 62), ...[0, 1, 2, 3, 4].map((i) => box(80, 276 + 30 * i, 582, 24)), box(80, 430, 582, 210)];

  it('moves over the answer’s first row when under and over the term’s line would cover text', () => {
    const p = placeClear(box(416, 276, 66, 24), 360, 110, pane, cover, column)!;
    expect(p).not.toBeNull();
    expect(p.attached).toBe(false);
    const card = box(p.left, p.top, 360, 110);
    for (const c of cover) expect(card.bottom <= c.top + 0.5 || card.top >= c.bottom - 0.5).toBe(true);
    expect(p.top).toBeGreaterThanOrEqual(pane.top + 8);
  });

  it('sits just under the line when that is clear, with its pointer', () => {
    const p = placeClear(box(416, 396, 66, 24), 360, 30, pane, cover.slice(0, 6).concat(box(80, 470, 582, 100)), column)!;
    expect(p).toMatchObject({ top: 423, below: true, attached: true });
  });

  it('is null when no place in the pane is clear', () => {
    expect(placeClear(box(416, 276, 66, 24), 360, 110, box(52, 160, 638, 500), [box(80, 160, 582, 500)], column)).toBeNull();
  });
});
