import { isTerritoryScoring, standardKomi } from './rules';
import { sgfToLoc, locToSgf } from './coords';
import { PASS, type Color, type Move } from './types';

export type SgfProps = Record<string, string[]>;
export interface SgfNode {
  props: SgfProps;
  children: SgfNode[];
}

export class SgfError extends Error {}

/** Parse an SGF collection into game trees. Tolerant of whitespace and junk between trees. */
export function parseSgfCollection(text: string): SgfNode[] {
  let i = 0;
  const n = text.length;
  const skipWs = () => {
    while (i < n && /\s/.test(text[i])) i++;
  };

  function parseTree(): SgfNode {
    // at '('
    i++;
    skipWs();
    let root: SgfNode | null = null;
    let cur: SgfNode | null = null;
    while (i < n) {
      skipWs();
      const ch = text[i];
      if (ch === ';') {
        i++;
        const node: SgfNode = { props: parseProps(), children: [] };
        if (!root) root = node;
        else cur!.children.push(node);
        cur = node;
      } else if (ch === '(') {
        const sub = parseTree();
        if (!root) {
          root = sub;
          cur = sub;
        } else cur!.children.push(sub);
      } else if (ch === ')') {
        i++;
        if (!root) throw new SgfError('empty game tree');
        return root;
      } else if (ch === undefined) break;
      else throw new SgfError(`unexpected character '${ch}' at offset ${i}`);
    }
    throw new SgfError('unterminated game tree');
  }

  function parseProps(): SgfProps {
    const props: SgfProps = {};
    for (;;) {
      skipWs();
      const m = /^[A-Za-z]+/.exec(text.slice(i, i + 32));
      if (!m) break;
      // Old SGF allows lowercase letters in identifiers (e.g. "AddBlack"); keep only capitals.
      const id = m[0].replace(/[a-z]/g, '');
      i += m[0].length;
      skipWs();
      const values: string[] = [];
      while (text[i] === '[') {
        i++;
        let v = '';
        while (i < n && text[i] !== ']') {
          if (text[i] === '\\') {
            i++;
            if (text[i] === '\n' || text[i] === '\r') {
              // soft line break
              if (text[i] === '\r' && text[i + 1] === '\n') i++;
              i++;
              continue;
            }
          }
          v += text[i++];
        }
        if (i >= n) throw new SgfError('unterminated property value');
        i++; // ]
        values.push(v);
        skipWs();
      }
      if (!values.length) throw new SgfError(`property ${id} has no value`);
      if (id) props[id] = (props[id] || []).concat(values);
    }
    return props;
  }

  const trees: SgfNode[] = [];
  while (i < n) {
    const next = text.indexOf('(', i);
    if (next < 0) break;
    i = next;
    // Must be followed by ';' (ignoring whitespace) to count as a game tree.
    let j = i + 1;
    while (j < n && /\s/.test(text[j])) j++;
    if (text[j] !== ';') {
      i++;
      continue;
    }
    trees.push(parseTree());
  }
  if (!trees.length) throw new SgfError('no SGF game found');
  return trees;
}

/** Expand compressed point lists like "aa:cc". */
function expandPoints(values: string[], size: number): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (v.includes(':')) {
      const [a, b] = v.split(':');
      const x1 = a.charCodeAt(0) - 97, y1 = a.charCodeAt(1) - 97;
      const x2 = b.charCodeAt(0) - 97, y2 = b.charCodeAt(1) - 97;
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
        for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) out.push(y * size + x);
    } else {
      const l = sgfToLoc(v, size);
      if (l !== PASS) out.push(l);
    }
  }
  return out;
}

export interface ParsedGame {
  size: number;
  komi: number;
  handicap: number;
  setup: Move[];
  moves: Move[];
  black: string;
  white: string;
  blackRank?: string;
  whiteRank?: string;
  result?: string;
  date?: string;
  event?: string;
  rules?: string;
  /** Warnings about things we ignored or fixed (e.g. setup stones mid-game). */
  warnings: string[];
}

const first = (p: SgfProps, k: string) => (p[k] && p[k][0] !== undefined ? p[k][0].trim() : undefined);

/** Extract the main line (first child at each node) of a game tree as a flat game. */
export function extractGame(root: SgfNode): ParsedGame {
  const p = root.props;
  const szRaw = first(p, 'SZ') ?? '19';
  if (szRaw.includes(':')) throw new SgfError(`rectangular boards (${szRaw}) are not supported`);
  const size = parseInt(szRaw, 10);
  if (!Number.isFinite(size) || size < 5 || size > 19) throw new SgfError(`unsupported board size ${szRaw}`);
  const gm = first(p, 'GM');
  if (gm && gm !== '1') throw new SgfError('not a Go game (GM is not 1)');

  const handicap = parseInt(first(p, 'HA') ?? '0', 10) || 0;
  const rules = first(p, 'RU');
  const warnings: string[] = [];
  const komi = readKomi(first(p, 'KM'), handicap, size, rules, first(p, 'AP') ?? '', warnings);

  const setup: Move[] = [];
  const moves: Move[] = [];
  let node: SgfNode | undefined = root;
  let depth = 0;
  while (node) {
    const np = node.props;
    const ab = np.AB ? expandPoints(np.AB, size) : [];
    const aw = np.AW ? expandPoints(np.AW, size) : [];
    if (ab.length || aw.length) {
      if (moves.length === 0) {
        for (const l of ab) setup.push({ color: 1, loc: l });
        for (const l of aw) setup.push({ color: 2, loc: l });
      } else warnings.push(`ignored setup stones after move ${moves.length}`);
    }
    for (const key of ['B', 'W'] as const) {
      if (np[key]) {
        const color: Color = key === 'B' ? 1 : 2;
        moves.push({ color, loc: sgfToLoc(np[key][0].trim(), size) });
      }
    }
    node = node.children[0];
    if (++depth > 5000) throw new SgfError('game too long');
  }

  return {
    size,
    komi,
    handicap,
    setup,
    moves,
    black: first(p, 'PB') || 'Black',
    white: first(p, 'PW') || 'White',
    blackRank: first(p, 'BR'),
    whiteRank: first(p, 'WR'),
    result: first(p, 'RE'),
    date: first(p, 'DT'),
    event: first(p, 'EV') || first(p, 'GN'),
    rules,
    warnings,
  };
}

/**
 * Komi as the game was played. Fox (foxwq) writes KM[0] for even games, KM[375] for
 * Chinese 3.75 stones (7.5 points) and KM[650] for 6.5; a komi of 0 in an even 19x19
 * game is almost always such a missing value, and analysing with it tilts every
 * winrate towards Black by about 7 points.
 */
export function readKomi(km: string | undefined, handicap: number, size: number, rules: string | undefined, app: string, warnings: string[]): number {
  let komi = parseFloat(km ?? '');
  const even = handicap < 2;
  if (!Number.isFinite(komi)) {
    komi = even ? standardKomi(rules) : 0.5;
    warnings.push(`no komi given, assuming ${komi}`);
    return komi;
  }
  if (Math.abs(komi) > 150) {
    const k = komi / 100;
    // Chinese komi counted in stones: 3.75 stones = 7.5 points.
    komi = (k === 3.75 || k === 3.25 || k === 2.75) && !isTerritoryScoring(rules, 0) ? k * 2 : k;
    warnings.push(`komi was stored as ${km}, read as ${komi}`);
    return komi;
  }
  if (komi === 0 && even && size === 19) {
    komi = standardKomi(rules);
    warnings.push(`komi was 0 in an even game${/fox/i.test(app) ? ' (Fox writes 0 when komi is missing)' : ''}, using ${komi}; change it in the game list if the game really had no komi`);
  }
  return komi;
}

/** Parse every game in an SGF file. Bad games are reported, not thrown. */
export function parseSgfFile(text: string): { games: ParsedGame[]; errors: string[] } {
  const errors: string[] = [];
  const games: ParsedGame[] = [];
  let trees: SgfNode[];
  try {
    trees = parseSgfCollection(text);
  } catch (e) {
    return { games, errors: [(e as Error).message] };
  }
  trees.forEach((t, idx) => {
    try {
      const g = extractGame(t);
      if (g.moves.length === 0) errors.push(`game ${idx + 1}: no moves`);
      else games.push(g);
    } catch (e) {
      errors.push(`game ${idx + 1}: ${(e as Error).message}`);
    }
  });
  return { games, errors };
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/]/g, '\\]');

/** Serialize a flat game back to SGF. */
export function toSgf(g: Omit<ParsedGame, 'warnings'>): string {
  let s = `(;GM[1]FF[4]CA[UTF-8]SZ[${g.size}]KM[${g.komi}]`;
  if (g.handicap) s += `HA[${g.handicap}]`;
  s += `PB[${esc(g.black)}]PW[${esc(g.white)}]`;
  if (g.blackRank) s += `BR[${esc(g.blackRank)}]`;
  if (g.whiteRank) s += `WR[${esc(g.whiteRank)}]`;
  if (g.result) s += `RE[${esc(g.result)}]`;
  if (g.date) s += `DT[${esc(g.date)}]`;
  if (g.event) s += `EV[${esc(g.event)}]`;
  const ab = g.setup.filter((m) => m.color === 1).map((m) => `[${locToSgf(m.loc, g.size)}]`);
  const aw = g.setup.filter((m) => m.color === 2).map((m) => `[${locToSgf(m.loc, g.size)}]`);
  if (ab.length) s += 'AB' + ab.join('');
  if (aw.length) s += 'AW' + aw.join('');
  for (const m of g.moves) s += `;${m.color === 1 ? 'B' : 'W'}[${locToSgf(m.loc, g.size)}]`;
  return s + ')';
}
