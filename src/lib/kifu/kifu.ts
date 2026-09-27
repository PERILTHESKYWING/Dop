import { extractGame, parseSgfCollection, type SgfNode } from '../go/sgf';
import { locToSgf, sgfToLoc } from '../go/coords';
import { type Color, type Move } from '../go/types';
import { uid } from '../util/hash';

/**
 * A kifu on the study board: a game record with variations. Nodes live in a flat array
 * (index = id); node 0 is the root, before the first move. Functions here never mutate:
 * they return a new kifu.
 */

export interface KNode {
  id: number;
  parent: number | null;
  /** The move leading to this node (none at the root). */
  move: Move | null;
  /** Variations, the main line first. */
  children: number[];
  comment?: string;
  /** Removed nodes stay in the array (ids are indexes) but are unreachable. */
  gone?: boolean;
}

export interface Kifu {
  id: string;
  title: string;
  size: number;
  komi: number;
  /** 'chinese' (area) or 'japanese' (territory); see go/rules.ts. */
  rules: string;
  black: string;
  white: string;
  result?: string;
  date?: string;
  event?: string;
  /** Stones placed before the first move, and who plays first. */
  setup: Move[];
  first: Color;
  nodes: KNode[];
  /** The node on the board when last saved. */
  cursor: number;
  createdAt: number;
  updatedAt: number;
  /** Where it came from: 'blank', 'live', 'review', 'sgf'. */
  source: string;
  /** Saved to the kifu library (otherwise a draft). */
  saved?: boolean;
}

export function blankKifu(size = 19, komi = 7.5, rules = 'chinese'): Kifu {
  const now = Date.now();
  return {
    id: uid('kifu-'),
    title: 'Untitled study',
    size,
    komi,
    rules,
    black: 'Black',
    white: 'White',
    setup: [],
    first: 1,
    nodes: [{ id: 0, parent: null, move: null, children: [] }],
    cursor: 0,
    createdAt: now,
    updatedAt: now,
    source: 'blank',
  };
}

/** A kifu whose main line is `moves`, with the board at move `at`. */
export function kifuFromMoves(base: Partial<Kifu> & { size: number; komi: number }, setup: Move[], moves: Move[], at = moves.length): Kifu {
  let k: Kifu = { ...blankKifu(base.size, base.komi, base.rules ?? 'chinese'), ...base, setup, first: moves[0]?.color ?? base.first ?? 1 };
  let cur = 0;
  const path = [0];
  for (const m of moves) {
    [k, cur] = addMove(k, cur, m);
    path.push(cur);
  }
  return { ...k, cursor: path[Math.max(0, Math.min(at, moves.length))] };
}

export function pathTo(k: Kifu, id: number): number[] {
  const out: number[] = [];
  let n: KNode | undefined = k.nodes[id];
  while (n) {
    out.push(n.id);
    n = n.parent === null ? undefined : k.nodes[n.parent];
  }
  return out.reverse();
}

export function movesTo(k: Kifu, id: number): Move[] {
  return pathTo(k, id)
    .map((i) => k.nodes[i].move)
    .filter((m): m is Move => m !== null);
}

/** The node reached by following the main line (first child) from `id`. */
export function lineEnd(k: Kifu, id: number): number {
  let n = k.nodes[id];
  while (n.children.length) n = k.nodes[n.children[0]];
  return n.id;
}

/** The path from the root through `id` and on along the main line below it. */
export function lineThrough(k: Kifu, id: number): number[] {
  const out = pathTo(k, id);
  let n = k.nodes[id];
  while (n.children.length) {
    n = k.nodes[n.children[0]];
    out.push(n.id);
  }
  return out;
}

export function toPlayAt(k: Kifu, id: number): Color {
  const m = k.nodes[id].move;
  return m ? (m.color === 1 ? 2 : 1) : k.first;
}

const touch = (k: Kifu, nodes: KNode[]): Kifu => ({ ...k, nodes, updatedAt: Date.now() });

/** Play `m` after node `at`: follows an existing variation with that move, or starts one. */
export function addMove(k: Kifu, at: number, m: Move): [Kifu, number] {
  const node = k.nodes[at];
  const same = node.children.find((c) => {
    const cm = k.nodes[c].move!;
    return cm.loc === m.loc && cm.color === m.color;
  });
  if (same !== undefined) return [k, same];
  const id = k.nodes.length;
  const nodes = k.nodes.slice();
  nodes[at] = { ...node, children: [...node.children, id] };
  nodes.push({ id, parent: at, move: m, children: [] });
  return [touch(k, nodes), id];
}

/** Remove a node and everything after it. Returns the kifu and the node to show next. */
export function removeNode(k: Kifu, id: number): [Kifu, number] {
  const node = k.nodes[id];
  if (node.parent === null) return [k, id];
  const nodes = k.nodes.slice();
  const parent = nodes[node.parent];
  nodes[node.parent] = { ...parent, children: parent.children.filter((c) => c !== id) };
  const stack = [id];
  while (stack.length) {
    const i = stack.pop()!;
    stack.push(...nodes[i].children);
    nodes[i] = { ...nodes[i], gone: true, children: [] };
  }
  return [touch(k, nodes), node.parent];
}

/** Make the variation through `id` the main line at every branch above it. */
export function promote(k: Kifu, id: number): Kifu {
  const nodes = k.nodes.slice();
  for (const i of pathTo(k, id)) {
    const p = nodes[i].parent;
    if (p === null) continue;
    const kids = nodes[p].children;
    if (kids[0] !== i) nodes[p] = { ...nodes[p], children: [i, ...kids.filter((c) => c !== i)] };
  }
  return touch(k, nodes);
}

export function setComment(k: Kifu, id: number, comment: string): Kifu {
  const nodes = k.nodes.slice();
  nodes[id] = { ...nodes[id], comment: comment || undefined };
  return touch(k, nodes);
}

/** Number of moves from the root to the node. */
export const depthOf = (k: Kifu, id: number) => pathTo(k, id).length - 1;

export function countMoves(k: Kifu): number {
  return k.nodes.filter((n) => !n.gone && n.move).length;
}

// ------------------------------------------------------------------ SGF

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/]/g, '\\]');

export function kifuToSgf(k: Kifu): string {
  const sz = k.size;
  let root = `;GM[1]FF[4]CA[UTF-8]AP[DOPPELGANGER]SZ[${sz}]KM[${k.komi}]RU[${k.rules === 'japanese' ? 'Japanese' : 'Chinese'}]`;
  root += `PB[${esc(k.black)}]PW[${esc(k.white)}]GN[${esc(k.title)}]`;
  if (k.result) root += `RE[${esc(k.result)}]`;
  if (k.date) root += `DT[${esc(k.date)}]`;
  if (k.event) root += `EV[${esc(k.event)}]`;
  const ab = k.setup.filter((m) => m.color === 1).map((m) => `[${locToSgf(m.loc, sz)}]`);
  const aw = k.setup.filter((m) => m.color === 2).map((m) => `[${locToSgf(m.loc, sz)}]`);
  if (ab.length) root += 'AB' + ab.join('');
  if (aw.length) root += 'AW' + aw.join('');
  if (k.setup.length && k.first === 2 && !k.nodes[0].children.length) root += 'PL[W]';
  if (k.nodes[0].comment) root += `C[${esc(k.nodes[0].comment)}]`;

  const node = (id: number): string => {
    const n = k.nodes[id];
    let s = `;${n.move!.color === 1 ? 'B' : 'W'}[${locToSgf(n.move!.loc, sz)}]`;
    if (n.comment) s += `C[${esc(n.comment)}]`;
    return s + tail(n);
  };
  const tail = (n: KNode): string => {
    if (n.children.length === 1) return node(n.children[0]);
    return n.children.map((c) => `(${node(c)})`).join('');
  };
  return `(${root}${tail(k.nodes[0])})`;
}

/** Read the first game of an SGF file, with its variations and comments. */
export function kifuFromSgf(text: string, name = 'Imported kifu'): Kifu {
  const trees = parseSgfCollection(text);
  if (!trees.length) throw new Error('no game in this SGF');
  const tree = trees[0];
  const g = extractGame(tree);
  const pl = tree.props.PL?.[0];
  let k: Kifu = {
    ...blankKifu(g.size, g.komi, g.rules && /jap|kor|territory/i.test(g.rules) ? 'japanese' : 'chinese'),
    title: tree.props.GN?.[0]?.trim() || (g.black !== 'Black' || g.white !== 'White' ? `${g.black} vs ${g.white}` : name),
    black: g.black,
    white: g.white,
    result: g.result,
    date: g.date,
    event: g.event,
    setup: g.setup,
    first: g.moves[0]?.color ?? (pl === 'W' ? 2 : 1),
    source: 'sgf',
  };
  const walk = (n: SgfNode, at: number) => {
    let cur = at;
    for (const key of ['B', 'W'] as const) {
      const v = n.props[key]?.[0];
      if (v !== undefined) [k, cur] = addMove(k, cur, { color: key === 'B' ? 1 : 2, loc: sgfToLoc(v.trim(), g.size) });
    }
    const c = n.props.C?.[0];
    if (c) k = setComment(k, cur, [k.nodes[cur].comment, c].filter(Boolean).join('\n'));
    for (const kid of n.children) walk(kid, cur);
  };
  walk(tree, 0);
  return { ...k, cursor: 0 };
}
