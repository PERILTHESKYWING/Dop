import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEMO, FINAL } from '../kami/src/ui/landing/data';
import { ASK, BLACK_WINS, CHAPTERS, COLOPHON, FIRST_PICK, GROUP, LAST_PICK, LEAD, LINE, PICK, PICKS, PLAY, pointsIn, READ_ROWS, READS, SCORE, TURN, TURN_FROM, TURN_TO } from '../kami/src/ui/landing/story';

// The landing's words are a plain rewording of Kiai's recorded answers; every point and number
// they name must come from the recorded KataGo data (kami/src/ui/landing/demo.json).
const text = (id: string) => {
  const c = CHAPTERS.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return [c.title, c.lead, c.text].filter(Boolean).join(' ');
};

describe('Kiai landing copy', () => {
  it('answers the first question with Kiai’s own Deep pick, which is also KataGo’s final choice', () => {
    expect(PICK).toBe(pointsIn(PLAY.summary)[0]);
    expect(PICK).toBe(FINAL.cands[0].at);
    expect(ASK.q).toBe(PLAY.question);
    expect(ASK.a.startsWith(`Play at ${PICK}.`)).toBe(true);
  });

  it('rewords the answer without adding anything to it', () => {
    // the recorded answer says the move trims White's area on the right and makes the black group safer
    expect(PLAY.summary).toMatch(/trims White's area on the right side/);
    expect(PLAY.summary).toMatch(new RegExp(`black group at ${GROUP} safer`));
    expect(ASK.a).toMatch(/White’s area on the right/);
    expect(ASK.a).toMatch(/the black stones below it safer/);
    // the group it names is Black's, and it is below the move (a lower row number)
    const g = DEMO.stones.find(([at]) => at === GROUP);
    expect(g?.[1]).toBe(1);
    expect(Number(GROUP.slice(1))).toBeLessThan(Number(PICK.slice(1)));
    // every point the answer names is one the recorded answer names
    for (const p of pointsIn(ASK.a)) expect(pointsIn(PLAY.summary)).toContain(p);
  });

  it('tells how the read changed with the recorded first and last favourites', () => {
    expect(FIRST_PICK).toBe(DEMO.reads[0].cands[0].at);
    expect(LAST_PICK).toBe(DEMO.reads[DEMO.reads.length - 1].cands[0].at);
    expect(FIRST_PICK).not.toBe(LAST_PICK);
    expect(PICKS.first.at).toBe(FIRST_PICK);
    expect(PICKS.then.at).toBe(LAST_PICK);
    // the chart's step where the favourite changes really has the final pick on top
    const flip = READS.findIndex((r) => r.cands[0].at === LAST_PICK);
    expect(flip).toBeGreaterThan(0);
    for (const r of READS.slice(flip)) expect(r.cands[0].at).toBe(LAST_PICK);
    expect(READS.map((r) => r.visits)).toEqual(DEMO.reads.map((r) => r.visits));
    for (const at of READ_ROWS) expect(DEMO.reads.some((r) => r.cands.some((c) => c.at === at))).toBe(true);
  });

  it('gives the score from the recorded score answer', () => {
    const m = /White leads by ([\d.]+) points \(Black.s winrate (\d+)%\)/.exec(SCORE.sections[0].text);
    expect(m).not.toBeNull();
    expect(LEAD).toBe(Math.round(Number(m![1])));
    expect(BLACK_WINS).toBe(Number(m![2]));
    expect(text('ahead')).toContain(`by about ${LEAD} points`);
    expect(SCORE.summary).toMatch(/White is clearly ahead/);
    expect(SCORE.summary).toMatch(/Black's best hope is the framework in the upper right/);
    expect(text('ahead')).toMatch(/upper right/);
  });

  it('says what it is and who made it, and claims nothing it cannot back', () => {
    expect(CHAPTERS[0].title).toBe('KataGo, in plain words.');
    expect(COLOPHON).toMatch(/KataGo, open source, by David J\. Wu/);
    const all = [...CHAPTERS.map((c) => text(c.id)), COLOPHON].join(' ');
    expect(all).not.toMatch(/offline|leaves your device|AI-powered|smart|assistant|chatbot|coach/i);
  });

  it('shows the line Kiai gave with its pick', () => {
    expect(LINE[0]).toBe(PICK);
    expect(PLAY.variations.some((v) => v.moves.filter((x) => x !== 'pass').join(' ') === LINE.join(' '))).toBe(true);
  });

  it('names the review’s biggest swing with its recorded numbers', () => {
    const w = DEMO.review.bWin;
    const drops = DEMO.review.moves.map(([c], i) => (c === 1 ? w[i] - w[i + 1] : w[i + 1] - w[i]));
    expect(TURN.n).toBe(drops.indexOf(Math.max(...drops)) + 1);
    expect(TURN_FROM).toBe(Math.round(w[TURN.n - 1] * 100));
    expect(TURN_TO).toBe(Math.round(w[TURN.n] * 100));
    expect(TURN_FROM).toBeGreaterThan(50);
    expect(TURN_TO).toBeLessThan(50);
    // the move that dropped Black's chances was Black's own
    expect(TURN.color).toBe(1);
  });
});

describe('Kiai landing style', () => {
  const css = readFileSync(new URL('../kami/src/ui/landing.css', import.meta.url), 'utf8');

  it('has no small words: no font smaller than 17 px', () => {
    for (const m of css.matchAll(/font-size:\s*([^;]+);/g)) {
      for (const px of m[1].matchAll(/(\d+(?:\.\d+)?)px/g)) {
        const v = Number(px[1]);
        // under 2 is a size in board units inside the book diagram (a grid cell is 1): at least half a cell
        if (v < 2) expect(v, m[0]).toBeGreaterThanOrEqual(0.5);
        else expect(v, m[0]).toBeGreaterThanOrEqual(17);
      }
    }
  });

  it('has no neon: no glowing blues and no box glows', () => {
    expect(css).not.toMatch(/#2fd3ff|#2fc4e4|#18aaf2|#6fd4ff/i);
    // a shadow spread evenly all round (0 0 blur) is a glow; inset rings are fine
    for (const m of css.matchAll(/box-shadow:([^;]+);/g)) {
      for (const part of m[1].split(/,(?![^(]*\))/)) if (!/inset/.test(part)) expect(part, m[0]).not.toMatch(/^\s*0 0 [1-9]/);
    }
  });
});
