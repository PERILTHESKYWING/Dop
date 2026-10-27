import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEMO, FINAL } from '../kami/src/ui/landing/data';
import { ASK, BLACK_WINS, CHAPTERS, COLOPHON, FIRST_PICK, GROUP, HOW, PLAY_LEAD, WHAT, LAST_PICK, LEAD, LINE, locOf, PICK, PICKS, PLAY, pointsIn, READ_ROWS, READS, SCORE, TURN, TURN_FROM, TURN_TO } from '../kami/src/ui/landing/story';
import { WINRATE_FROM_SCORE } from '../src/lib/engine/models';

// The landing's words are a plain rewording of Kiai's recorded answers; every point and number
// they name must come from the recorded KataGo data (kami/src/ui/landing/demo.json).
const text = (id: string) => {
  const c = CHAPTERS.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return [c.title, c.lead, c.text].filter(Boolean).join(' ');
};

describe('Kiai landing copy', () => {
  it('answers the first question with Kiai’s own pick, which is also KataGo’s choice after its longest read', () => {
    expect(PICK).toBe(PLAY.variations.find((v) => v.id === 'v1')?.moves[0]);
    expect(PICK).toBe(FINAL.cands[0].at);
    expect(ASK.q).toBe(PLAY.question);
    // it opens with the position, as the recorded answer does, then KataGo's move
    expect(PLAY.summary).toMatch(new RegExp(`^White leads by about ${PLAY_LEAD} points\\.`));
    expect(Math.abs(PLAY_LEAD - LEAD)).toBeLessThanOrEqual(1);
    expect(ASK.a.startsWith(`White leads by about ${PLAY_LEAD} points. Black’s best try is ${PICK}:`)).toBe(true);
    expect(PLAY.summary).toMatch(new RegExp(`best try for Black is the [a-z ]+ at ${PICK}\\b`));
    expect(PLAY.summary).toContain('[[v1]]');
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
    // every move that was KataGo's favourite at some depth has a row, so no change of mind is hidden
    for (const r of DEMO.reads) expect(READ_ROWS).toContain(r.cands[0].at);
  });

  it('records the win chance the way the app shows it (from the score lead, as for the bundled b10)', () => {
    const sig = (lead: number) => 1 / (1 + Math.exp(-lead / WINRATE_FROM_SCORE));
    for (const r of DEMO.reads) {
      for (const c of r.cands) expect(Math.abs(c.win - sig(c.lead))).toBeLessThan(0.03);
    }
    // the score answer's numbers agree with each other the same way
    expect(Math.abs(BLACK_WINS - 100 * sig(-LEAD))).toBeLessThanOrEqual(2);
  });

  it('gives the score from the recorded score answer', () => {
    const m = /White leads by ([\d.]+) points \(Black.s win chance (\d+)%\)/.exec(SCORE.sections[0].text);
    expect(m).not.toBeNull();
    expect(LEAD).toBe(Math.round(Number(m![1])));
    expect(BLACK_WINS).toBe(Number(m![2]));
    expect(text('ahead')).toContain(`by about ${LEAD} points`);
    expect(SCORE.summary).toMatch(/White is clearly ahead/);
    // Black's chance is where the longest read and the first screen put it: the right side, at
    // KataGo's final pick, which the slide's ownership does not already give to Black
    expect(text('ahead')).toContain(`the right side, around ${LAST_PICK}`);
    expect(PLAY.summary).toMatch(/White's area on the right side/);
    expect(LAST_PICK).toBe(PICK);
    const [cx, cy] = [locOf(LAST_PICK) % 19, Math.floor(locOf(LAST_PICK) / 19)];
    // the empty points round it (a stone's own point carries no square)
    const taken = new Set(DEMO.stones.map(([g]) => locOf(g)));
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const l = (cy + dy) * 19 + cx + dx;
        if (!taken.has(l)) expect(FINAL.own[l]).toBeLessThan(0.45);
      }
  });

  it('says what it is and who made it, and claims nothing it cannot back', () => {
    expect(CHAPTERS[0].title).toBe('KataGo, in plain words.');
    // and says at once what KataGo is
    expect(WHAT).toMatch(/open-source Go engine/);
    expect(WHAT).toMatch(/in your browser/);
    expect(COLOPHON).toMatch(/KataGo, open source, by David\sJ\.\sWu/);
    const all = [...CHAPTERS.map((c) => text(c.id)), COLOPHON, WHAT].join(' ');
    expect(all).not.toMatch(/offline|leaves your device|AI-powered|smart|assistant|chatbot|coach/i);
    // what does what: KataGo reads, a language model (never named) only words it, and it is optional
    expect(COLOPHON).toMatch(/^Made by a professional Go player\./);
    expect(HOW).toMatch(/only turns KataGo’s numbers into words/);
    expect(HOW).toMatch(/works without it/);
    expect(HOW).toMatch(/No AI images/);
    expect(HOW).not.toMatch(/gemini|google|openai|gpt|claude/i);
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

  it('draws a review graph without a side-to-move comb (it read as a bug)', () => {
    // a comb: the chance jumping up and down by 15 or more on consecutive moves, again and again
    const w = DEMO.review.bWin;
    const d = w.slice(1).map((v, i) => v - w[i]);
    let run = 0, worst = 0;
    for (let i = 1; i < d.length; i++) {
      run = Math.abs(d[i]) >= 0.15 && Math.abs(d[i - 1]) >= 0.15 && d[i] * d[i - 1] < 0 ? run + 1 : 0;
      worst = Math.max(worst, run);
    }
    expect(worst).toBeLessThan(3);
    expect(DEMO.review.visits).toBe(60);
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
