import { describe, expect, it } from 'vitest';
import type { ConceptId } from '../src/lib/coach/explain/types';
import { CONCEPTS, conceptById, findConcepts, normalizeQuestion } from '../src/lib/coach/library';
import { EXAMPLE_RECORDS } from '../src/lib/coach/library/examples';
import { Board } from '../src/lib/go/board';

const ids = (text: string) => findConcepts(text).map((c) => c.id);
const first = (text: string) => ids(text)[0];

describe('concept library entries', () => {
  it('has about forty concepts with unique kebab-case ids', () => {
    expect(CONCEPTS.length).toBeGreaterThanOrEqual(40);
    const seen = new Set<string>();
    for (const c of CONCEPTS) {
      expect(c.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(seen.has(c.id), c.id).toBe(false);
      seen.add(c.id);
    }
  });

  it('has an entry for every ConceptId the explainer can report, meaning the same idea', () => {
    // A Record forces this list to stay complete when ConceptId grows.
    const all: Record<ConceptId, true> = {
      sente: true, gote: true, miai: true, 'weak-group': true, 'dead-group': true, thickness: true, territory: true,
      influence: true, overconcentration: true, aji: true, ladder: true, tenuki: true, 'big-point': true, urgent: true,
      'double-sente': true, 'reverse-sente': true, 'save-stones': true, ko: true, sacrifice: true, reduction: true, attack: true,
    };
    for (const id of Object.keys(all)) expect(conceptById(id), id).toBeDefined();
  });

  it('every entry is well formed', () => {
    for (const c of CONCEPTS) {
      expect(c.name.trim().length, c.id).toBeGreaterThan(1);
      expect(c.aliases.length, c.id).toBeGreaterThanOrEqual(3);
      expect(['beginner', 'intermediate', 'advanced']).toContain(c.level);
      expect(c.short, c.id).toMatch(/\.$/);
      expect(c.short.length, c.id).toBeLessThan(320);
      expect(c.body.length, c.id).toBeGreaterThanOrEqual(3);
      for (const s of c.body) {
        expect(s.title.trim().length, c.id).toBeGreaterThan(2);
        expect(s.text.length, `${c.id}: ${s.title}`).toBeGreaterThan(150);
      }
      expect(c.mistakes.length, c.id).toBeGreaterThanOrEqual(2);
      expect(c.related.length, c.id).toBeGreaterThanOrEqual(2);
      if (c.hover !== undefined) {
        expect(c.hover.length, c.id).toBeLessThanOrEqual(140);
        expect(c.hover, c.id).toMatch(/\.$/);
      }
    }
  });

  it('miai is XIAO\'s text, with its hover definition as the short answer', () => {
    const m = conceptById('miai')!;
    expect(m.short).toBe('Two points that achieve the same goal. If your opponent takes one, you can use the other.');
    expect(m.hover).toBe(m.short);
    expect(m.body.map((s) => s.title)).toEqual(['What is miai?', 'Why does it matter?', 'Can miai be broken?', 'How strong players use miai', 'Diagram example: Straight four', 'Remember']);
    expect(m.mistakes.map((x) => x.split(':')[0])).toEqual(['Playing too early', 'Missing the follow-up', 'Assuming miai without reading']);
  });

  it('related ids exist and are not the entry itself', () => {
    for (const c of CONCEPTS)
      for (const r of c.related) {
        expect(conceptById(r), `${c.id} -> ${r}`).toBeDefined();
        expect(r).not.toBe(c.id);
      }
  });

  it('no alias belongs to two concepts', () => {
    const owner = new Map<string, string>();
    for (const c of CONCEPTS)
      for (const a of new Set([c.id, ...c.aliases].map(normalizeQuestion))) {
        expect(owner.get(a) ?? c.id, `"${a}" in ${owner.get(a)} and ${c.id}`).toBe(c.id);
        owner.set(a, c.id);
      }
  });

  it('conceptById finds every entry and nothing else', () => {
    for (const c of CONCEPTS) expect(conceptById(c.id)).toBe(c);
    expect(conceptById('not-a-concept')).toBeUndefined();
  });
});

describe('findConcepts', () => {
  it('finds concepts by name, id and alias, best first', () => {
    expect(first('what is miai?')).toBe('miai');
    expect(first('Explain aji to me')).toBe('aji');
    expect(first('When should I tenuki?')).toBe('tenuki');
    expect(first('how do ladders work')).toBe('ladder');
    expect(first('what is a ladder breaker')).toBe('ladder');
    expect(first('Is the empty triangle always bad?')).toBe('empty-triangle');
    expect(first("tiger’s mouth or solid connection?")).toBe('tigers-mouth');
    expect(first('What is a bamboo joint')).toBe('bamboo-joint');
    expect(first('how do I count liberties')).toBe('liberties');
    expect(first('what is sabaki')).toBe('sabaki');
    expect(first('when do I play the 3-3 invasion')).toBe('three-three-invasion');
    expect(ids('Should I invade or reduce this moyo?').slice(0, 3).sort()).toEqual(['invasion', 'moyo', 'reduction']);
  });

  it('handles plurals, inflections, case and accents', () => {
    expect(first('Tell me about KO THREATS')).toBe('ko-threats');
    expect(first('sacrificing stones')).toBe('sacrifice');
    expect(first('JŌSEKI choice')).toBe('joseki');
    expect(first('shichō')).toBe('ladder');
    expect(first('Are these stones overconcentrated?')).toBe('overconcentration');
    expect(first('invading the corner')).toBe('invasion');
  });

  it('understands Chinese, Japanese and Korean terms', () => {
    expect(first('什么是厚势')).toBe('thickness');
    expect(first('征子怎么看')).toBe('ladder');
    expect(first('打劫的时候')).toBe('ko');
    expect(first('劫材不够')).toBe('ko-threats');
    expect(first('弃子争先是什么意思')).toBe('sacrifice');
    expect(first('点三三')).toBe('three-three-invasion');
    expect(first('見合いとは')).toBe('miai');
    expect(first('シチョウ')).toBe('ladder');
    expect(first('手抜きしていい?')).toBe('tenuki');
    expect(first('빈삼각은 왜 나쁜가요')).toBe('empty-triangle');
    expect(first('사활 문제')).toBe('life-and-death');
    expect(first('끝내기 순서')).toBe('endgame');
  });

  it('returns both sides of a comparison', () => {
    const r = ids('When is thickness worth more than territory?');
    expect(r.slice(0, 2).sort()).toEqual(['territory', 'thickness']);
    const u = ids('big point vs urgent point');
    expect(u.slice(0, 2).sort()).toEqual(['big-point', 'urgent']);
  });

  it('prefers the longer term over a word inside it', () => {
    expect(ids('what is double sente')).toEqual(['double-sente']);
    expect(first('is this ryou-sente?')).toBe('double-sente');
    expect(first('what is gyaku sente')).toBe('reverse-sente');
    expect(first('reverse sente or gote?')).toBe('reverse-sente');
    expect(first('両先手とは')).toBe('double-sente');
    expect(first('when is saving stones worth a move?')).toBe('save-stones');
    expect(first('what is yose')).toBe('endgame');
    expect(ids('how many ko threats do I have')).toEqual(['ko-threats']);
    expect(ids('is this a false eye')).toEqual(['eyes']);
    expect(ids('the 3-3 invasion')).toEqual(['three-three-invasion']);
  });

  it('does not fire on everyday uses of common words', () => {
    expect(ids("I'm in bad shape today")).toEqual([]);
    expect(ids('Can you help me get in shape before the tournament next month?')).toEqual([]);
    expect(ids('What should I play here?')).toEqual([]);
    expect(ids('Explain this move')).toEqual([]);
    expect(ids('I want to reduce the time I spend on reading news every morning')).toEqual([]);
  });

  it('counts common Go words when the question is about Go', () => {
    expect(first('is my group in good shape?')).toBe('shape');
    expect(first('how should I attack this group')).toBe('attack');
    expect(first('what is a net')).toBe('net');
  });

  it('returns nothing for an empty question', () => {
    expect(ids('')).toEqual([]);
    expect(ids('   ')).toEqual([]);
  });
});

describe('concept examples', () => {
  it('belong to existing concepts and are attached to them', () => {
    for (const r of EXAMPLE_RECORDS) expect(conceptById(r.concept), r.concept).toBeDefined();
    const attached = CONCEPTS.reduce((n, c) => n + c.examples.length, 0);
    expect(attached).toBe(EXAMPLE_RECORDS.length);
  });

  it('positions and lines are legal on the board', () => {
    for (const c of CONCEPTS)
      for (const ex of c.examples) {
        const { size, setup, toPlay } = ex.position;
        expect([9, 13, 19]).toContain(size);
        const b = new Board(size);
        for (const m of setup) {
          expect(b.stones[m.loc], `${ex.title}: two stones on one point`).toBe(0);
          b.stones[m.loc] = m.color;
        }
        for (const g of b.groups()) expect(g.liberties.length, `${ex.title}: chain without liberties`).toBeGreaterThan(0);
        expect(ex.line.length, ex.title).toBeGreaterThan(0);
        expect(ex.line[0].color, ex.title).toBe(toPlay);
        ex.line.forEach((m, i) => {
          if (i) expect(m.color, ex.title).not.toBe(ex.line[i - 1].color);
          expect(b.isLegal(m.loc, m.color), `${ex.title}: move ${i + 1} illegal`).toBe(true);
          b.play(m.loc, m.color);
        });
      }
  });

  it('have a note, a source and a sane view', () => {
    for (const c of CONCEPTS)
      for (const ex of c.examples) {
        expect(ex.note.length, ex.title).toBeGreaterThan(20);
        expect(ex.source.length, ex.title).toBeGreaterThan(5);
        expect(ex.note, ex.title).not.toMatch(/\{\w+\}/);
        if (ex.view) {
          const [x0, y0, x1, y1] = ex.view;
          expect(x0 <= x1 && y0 <= y1 && x0 >= 0 && y0 >= 0 && x1 < ex.position.size && y1 < ex.position.size, ex.title).toBe(true);
        }
      }
  });
});
