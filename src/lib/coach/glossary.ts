/**
 * Go terms and their short definitions, for hover tooltips in answer text (XIAO, 2026-10-16:
 * "The definitions of Go terms should appear when the user hovers over them, so beginners can
 * learn naturally without cluttering the explanation").
 *
 * Terms linked to the concept library take its `hover` (else its `short`) definition, so the
 * two never disagree; terms the library has no entry for carry their own. Every definition is
 * plain words, at most about 140 characters. `findTerms` finds them in English answer text.
 */
import { conceptById } from './library';

export interface GlossaryEntry {
  /** The main term, as it is usually written in English Go text ("double sente", "keima"). */
  term: string;
  /** Other ways to write it ("ryou-sente", "knight's move"). Matched like the term. */
  aliases: string[];
  /** The hover text, at most about 140 characters. */
  def: string;
  /** The concept library entry that explains it in depth, when there is one. */
  concept?: string;
}

/** One term found in a text: [start, end) in the text as given. */
export interface TermHit {
  start: number;
  end: number;
  entry: GlossaryEntry;
}

interface Spec {
  term: string;
  aliases?: string[];
  concept?: string;
  /** Own definition; absent: the concept's hover (else its short answer). */
  def?: string;
}

const SPECS: Spec[] = [
  // Tempo
  { term: 'sente', concept: 'sente' },
  { term: 'gote', concept: 'gote' },
  {
    term: 'double sente',
    aliases: ['ryou-sente', 'ryousente', 'ryo-sente', 'ryōsente', 'mutual sente'],
    concept: 'double-sente',
    def: 'Double sente: a large point that either player can take first to gain sente.',
  },
  { term: 'reverse sente', aliases: ['gyaku-sente', 'gyakusente'], concept: 'reverse-sente' },
  { term: 'miai', concept: 'miai' },
  { term: 'tenuki', concept: 'tenuki' },
  { term: 'kikashi', concept: 'kikashi' },
  { term: 'aji', concept: 'aji' },
  { term: 'honte', aliases: ['proper move'], def: 'Honte (proper move): a solid move that removes a weakness; it looks slow, but later fights go better for it.' },
  // Life, death and capturing
  { term: 'liberty', concept: 'liberties', def: 'Liberty: an empty point next to a stone or chain. A chain with no liberties left is captured.' },
  { term: 'atari', concept: 'liberties', def: 'Atari: a stone or chain with only one liberty left, so it can be captured on the next move.' },
  { term: 'eye', aliases: ['real eye', 'true eye'], concept: 'eyes' },
  { term: 'false eye', concept: 'eyes', def: 'False eye: looks like an eye, but the opponent can capture the stones around it, so it does not count.' },
  { term: 'vital point', concept: 'life-and-death', def: 'Vital point: the key point of a shape, often the one that decides whether a group can make two eyes.' },
  { term: 'life and death', aliases: ['life-and-death'], concept: 'life-and-death' },
  { term: 'tsumego', concept: 'life-and-death', def: 'Tsumego: a life-and-death problem; find the move that saves or kills a group.' },
  { term: 'seki', concept: 'seki' },
  { term: 'ko', aliases: ['ko fight'], concept: 'ko' },
  { term: 'ko threat', concept: 'ko-threats' },
  { term: 'semeai', aliases: ['capturing race'], concept: 'capturing-race' },
  { term: 'ladder', aliases: ['shicho', 'shichō'], concept: 'ladder' },
  { term: 'net', aliases: ['geta'], concept: 'net' },
  { term: 'snapback', aliases: ['snap-back'], concept: 'snapback' },
  { term: 'throw-in', aliases: ['horikomi'], concept: 'sacrifice', def: "Throw-in: a stone played inside the opponent's shape to be captured, to ruin an eye or take away liberties." },
  { term: 'tesuji', concept: 'tesuji' },
  { term: 'dragon', concept: 'weak-group', def: 'Dragon: a long group of stones stretching across the board, often still without two eyes.' },
  // Shape and moves
  { term: 'hane', def: "Hane: a move that bends around the end of the opponent's stones, diagonally from your own stone." },
  { term: 'tsuke', aliases: ['attachment', 'contact play'], def: "Tsuke (attachment): a stone placed directly against an opponent's stone, often to settle or to see how they answer." },
  { term: 'kosumi', aliases: ['diagonal move', 'diagonal play'], def: 'Kosumi (diagonal move): a stone placed diagonally next to your own; slow, but solid and hard to cut.' },
  { term: 'keima', aliases: ["knight's move", 'small knight', 'kogeima'], def: "Keima (knight's move): a stone one line across and two lines along from your own, like a knight in chess." },
  { term: 'ogeima', aliases: ["large knight's move", 'large knight', 'oogeima', 'ōgeima'], def: "Ogeima (large knight's move): a stone one line across and three along from your own; wider, but easier to cut." },
  { term: 'one-space jump', aliases: ['ikken tobi'], def: 'One-space jump: a stone two points from your own in a straight line, with one empty point between; quick and hard to cut.' },
  { term: 'shoulder hit', def: "Shoulder hit: a move diagonally above an opponent's stone, pressing it low while you build outside." },
  { term: 'empty triangle', concept: 'empty-triangle' },
  { term: "tiger's mouth", concept: 'tigers-mouth' },
  { term: 'bamboo joint', concept: 'bamboo-joint' },
  { term: 'sabaki', concept: 'sabaki' },
  // Opening and strategy
  { term: 'joseki', concept: 'joseki' },
  { term: 'star point', aliases: ['hoshi'], def: 'Star point (hoshi): a marked point on the board; in a corner, the 4-4 point, quick to claim but open underneath.' },
  { term: 'kakari', aliases: ['approach', 'approach move', 'corner approach'], def: "Kakari (approach): a move next to the opponent's lone corner stone, so they cannot easily enclose the corner." },
  { term: 'shimari', aliases: ['enclosure', 'corner enclosure'], def: 'Shimari (enclosure): a second stone in your own corner that makes it hard for the opponent to approach or invade.' },
  { term: 'hasami', aliases: ['pincer'], def: 'Hasami (pincer): a move that attacks an approaching stone from the far side, so it cannot extend comfortably.' },
  { term: '3-3 invasion', aliases: ['three-three invasion', '3-3 point', 'three-three point', 'san-san', 'sansan'], concept: 'three-three-invasion' },
  { term: 'invasion', aliases: ['invade', 'invading', 'invaded'], concept: 'invasion' },
  { term: 'reduction', aliases: ['reducing move'], concept: 'reduction' },
  { term: 'moyo', aliases: ['framework'], concept: 'moyo' },
  { term: 'thickness', concept: 'thickness' },
  { term: 'influence', concept: 'influence' },
  { term: 'big point', concept: 'big-point' },
  { term: 'overconcentration', aliases: ['overconcentrated'], concept: 'overconcentration' },
  { term: 'probe', aliases: ['probing move'], concept: 'probe' },
  // Endgame
  { term: 'yose', aliases: ['endgame'], concept: 'endgame', def: 'Yose (endgame): the last stage of the game, when the borders between territories are settled, biggest moves first.' },
  { term: 'dame', def: 'Dame: neutral points that belong to neither side; they are filled at the very end.' },
];

function entryOf(s: Spec): GlossaryEntry {
  const c = s.concept ? conceptById(s.concept) : undefined;
  if (s.concept && !c) throw new Error(`glossary: no library entry ${s.concept}`);
  const def = s.def ?? c?.hover ?? c?.short ?? '';
  return { term: s.term, aliases: s.aliases ?? [], def, ...(s.concept ? { concept: s.concept } : {}) };
}

export const GLOSSARY: GlossaryEntry[] = SPECS.map(entryOf);

// ---------------------------------------------------------------------------------------
// Matching. Whole words, any case; a hyphen and a space are the same ("ryou-sente" matches
// "ryou sente"), the last word may take a plural. Variation refs ([[v1]], [[d2]]) and board
// points (Q16) are blanked out first so a term is never found inside them.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD = '\\p{L}\\p{N}';

/** Regex source for one way of writing a term. */
function source(form: string): string {
  const words = form.toLowerCase().split(/[\s\-‐‑]+/).filter(Boolean);
  const last = words.pop()!;
  const plurals = new Set([last, `${last}s`, `${last}es`]);
  if (/[^aeiou]y$/.test(last)) plurals.add(`${last.slice(0, -1)}ies`);
  const tail = `(?:${[...plurals].sort((a, b) => b.length - a.length).map(escape).join('|')})`;
  return [...words.map(escape), tail].join('[\\s\\-‐‑]+').replace(/'/g, "['’]");
}

const MATCHERS: { entry: GlossaryEntry; re: RegExp }[] = GLOSSARY.flatMap((entry) =>
  [entry.term, ...entry.aliases].map((form) => ({ entry, re: new RegExp(`(?<![${WORD}])${source(form)}(?![${WORD}])`, 'giu') })),
);

/** Everyday phrases that use a Go word in its ordinary sense. */
const IDIOMS = /(?<![\p{L}\p{N}])(?:net\s+(?:gain|loss|losses|result|effect|change|value|score)s?|keep(?:s|ing)?\s+an\s+eye\s+on|eye\s+to\s+eye)(?![\p{L}\p{N}])/giu;
/** [[v1]] / [[d1]] chips and board points like Q16 or q4. */
const REFS = /\[\[[^\]]*\]\]|(?<![\p{L}\p{N}])[A-HJ-Ta-hj-t](?:1[0-9]|[1-9])(?![\p{L}\p{N}])/gu;

/**
 * Glossary terms in `text`, in order: case-insensitive whole words, the longest match first
 * where two overlap ("double sente" over "sente", "ko threat" over "ko"), never overlapping,
 * never inside a [[v1]] / [[d1]] reference or a board point.
 */
export function findTerms(text: string): TermHit[] {
  if (!text) return [];
  const hit = cache.get(text);
  if (hit) return hit;
  if (cache.size > 2000) cache.clear();
  const found = scan(text);
  cache.set(text, found);
  return found;
}

/** Answers re-render on every board hover, so each text is scanned once. */
const cache = new Map<string, TermHit[]>();

function scan(text: string): TermHit[] {
  const blank = (m: string) => ' '.repeat(m.length);
  const t = text.replace(REFS, blank).replace(IDIOMS, blank);
  const all: TermHit[] = [];
  for (const { entry, re } of MATCHERS) {
    re.lastIndex = 0;
    for (let m = re.exec(t); m; m = re.exec(t)) all.push({ start: m.index, end: m.index + m[0].length, entry });
  }
  all.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const taken: typeof all = [];
  for (const h of all) if (!taken.some((o) => h.start < o.end && o.start < h.end)) taken.push(h);
  return taken.sort((a, b) => a.start - b.start);
}
