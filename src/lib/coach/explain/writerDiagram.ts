/**
 * The writer may ask for one diagram of its own: a small local set-up that shows the idea
 * better than the game does. It writes a block at the end of its answer:
 *
 *   DIAGRAM
 *   to play: Black
 *   black: C3 D3 E3
 *   white: C4 D4 E4 F3
 *   best: B2
 *   worse: B1          (optional: a tempting move that fails)
 *   idea: eye shape    (optional)
 *   END
 *
 * and refers to it in the text as [[dN]] (the id given in the prompt). Code never trusts it:
 * the block is parsed here, framed (the rest of the board settled), and goes through every
 * check in illustrate.ts with KataGo's final read last. If any check fails, the block and
 * every sentence that refers to it are removed before the answer is checked.
 */
import { gtpToLoc, locToGtp, xy } from '../../go/coords';
import { type Color, type Loc, type Move } from '../../go/types';
import { problemWindow } from '../../problems/frame';
import type { DiagramSpec } from './illustrate';
import type { Explanation, Illustration } from './types';

const BLOCK = /\n?[ \t]*DIAGRAM[ \t]*\n([\s\S]*?)\n[ \t]*END[ \t]*(?:\n|$)/i;

export interface WriterDiagram {
  /** The text without the block. */
  text: string;
  spec?: DiagramSpec;
  /** Why the block could not become a spec. */
  error?: string;
  /** Whether the text had a block at all. */
  found: boolean;
}

function points(s: string | undefined, size: number): Loc[] | string {
  if (!s) return [];
  const out: Loc[] = [];
  for (const t of s.split(/[\s,;]+/).filter(Boolean)) {
    let l: Loc;
    try {
      l = gtpToLoc(t.toUpperCase(), size);
    } catch {
      return `"${t}" is not a point`;
    }
    if (l < 0) return `"${t}" is not a point`;
    out.push(l);
  }
  return out;
}

/** The block, parsed into a framed DiagramSpec (not checked yet). */
export function parseWriterDiagram(answer: string, size: number): WriterDiagram {
  const m = answer.match(BLOCK);
  if (!m) return { text: answer, found: false };
  const text = (answer.slice(0, m.index) + '\n' + answer.slice(m.index! + m[0].length)).trim();
  const fields = new Map<string, string>();
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^\s*([a-z ]+?)\s*:\s*(.*)$/i);
    if (kv) fields.set(kv[1].toLowerCase().trim(), kv[2].trim());
  }
  const bad = (error: string): WriterDiagram => ({ text, error, found: true });
  const toPlayWord = (fields.get('to play') ?? '').toLowerCase();
  const toPlay: Color | null = /^b/.test(toPlayWord) ? 1 : /^w/.test(toPlayWord) ? 2 : null;
  if (!toPlay) return bad('no side to play');
  const black = points(fields.get('black'), size);
  const white = points(fields.get('white'), size);
  const best = points(fields.get('best'), size);
  const worse = points(fields.get('worse'), size);
  for (const p of [black, white, best, worse]) if (typeof p === 'string') return bad(p);
  const B = black as Loc[], W = white as Loc[], best1 = best as Loc[], worse1 = worse as Loc[];
  if (best1.length !== 1) return bad('needs exactly one best move');
  if (worse1.length > 1) return bad('at most one worse move');
  if (B.length + W.length < 3 || B.length + W.length > 40) return bad('needs 3 to 40 stones');
  const stones: Move[] = [...B.map((loc) => ({ color: 1 as Color, loc })), ...W.map((loc) => ({ color: 2 as Color, loc }))];
  const rect = problemWindow(size, [...B, ...W, ...best1, ...worse1], 1);
  if (!rect) return bad('the stones must sit in one corner or on one side');
  // The side whose stones sit further from the edges surrounds the shape.
  const edgeDist = (l: Loc) => {
    const [x, y] = xy(l, size);
    return Math.min(x, y, size - 1 - x, size - 1 - y);
  };
  const avg = (ls: Loc[]) => (ls.length ? ls.reduce((a, l) => a + edgeDist(l), 0) / ls.length : -1);
  const attackerWord = (fields.get('attacker') ?? '').toLowerCase();
  const attacker: Color = /^b/.test(attackerWord) ? 1 : /^w/.test(attackerWord) ? 2 : avg(B) > avg(W) ? 1 : 2;
  const idea = fields.get('idea')?.slice(0, 60);
  return {
    text,
    found: true,
    spec: {
      size,
      stones,
      toPlay,
      frame: { rect, attacker },
      claim: { best: best1[0], ...(worse1.length ? { worse: worse1[0] } : {}) },
      title: idea ? `A diagram: ${idea}` : 'A diagram',
      label: idea ? idea : 'diagram',
      ...(idea ? { concept: idea } : {}),
      source: 'writer',
    },
  };
}

/** The text without any sentence (or list item) that refers to [[id]]. */
export function dropDiagramRefs(text: string, id: string): string {
  const ref = new RegExp(`\\[\\[\\s*${id}\\s*\\]\\]`);
  return text
    .split(/\n/)
    .map((line) => {
      if (!ref.test(line)) return line;
      const parts = line.split(/(?<=[.!?])\s+/);
      const kept = parts.filter((p) => !ref.test(p));
      return kept.join(' ');
    })
    .filter((line, i, all) => line.trim() || (i > 0 && all[i - 1].trim()))
    .join('\n')
    .trim();
}

/** A checked diagram written back as the writer's DIAGRAM block (window stones only; the frame is code's). */
export function diagramBlock(d: Illustration): string | null {
  if (!d.view || !d.line.length) return null;
  const size = d.base.size;
  const [x0, y0, x1, y1] = d.view;
  const inView = (l: number) => {
    const [x, y] = xy(l, size);
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  };
  const stones = d.base.setup.filter((m) => inView(m.loc));
  const g = (l: number) => locToGtp(l, size);
  const black = stones.filter((m) => m.color === 1).map((m) => g(m.loc));
  const white = stones.filter((m) => m.color === 2).map((m) => g(m.loc));
  if (black.length + white.length < 3 || black.length + white.length > 40) return null;
  const lines = ['DIAGRAM', `to play: ${d.base.toPlay === 1 ? 'Black' : 'White'}`, `black: ${black.join(' ')}`, `white: ${white.join(' ')}`, `best: ${g(d.line[0].loc)}`];
  if (d.highlight[1] !== undefined) lines.push(`worse: ${g(d.highlight[1])}`);
  if (d.concept) lines.push(`idea: ${String(d.concept).replace(/-/g, ' ')}`);
  lines.push('END');
  return lines.join('\n');
}

/** The explanation without its diagrams, their facts and their section (for "ask for your own" tasks). */
export function withoutDiagrams(ex: Explanation): Explanation {
  const ids = new Set((ex.illustrations ?? []).map((d) => d.id));
  const refers = (t: string) => [...ids].some((id) => t.includes(`[[${id}]]`));
  const { illustrations: _drop, ...rest } = ex;
  return { ...rest, facts: ex.facts.filter((f) => !refers(f.text)), sections: ex.sections.filter((s) => !refers(s.text)) };
}
