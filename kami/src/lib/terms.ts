/**
 * Answer text split for rendering: board points (shown on the board when hovered) and Go
 * terms from the glossary (a short definition when hovered or tapped). Each term gets its
 * hover once per answer, where it first appears, so the text does not fill up with underlines.
 */
import { findTerms, type GlossaryEntry } from '../../../src/lib/coach/glossary';
import { conceptById } from '../../../src/lib/coach/library';
import type { Loc } from '../../../src/lib/go/types';
import { splitPoints } from './points';

export type RichPart = { type: 'text'; text: string } | { type: 'point'; text: string; loc: Loc } | { type: 'term'; text: string; entry: GlossaryEntry } | { type: 'fig'; text: string };

/**
 * A KataGo figure in an answer's text: a score gap or lead in points ("10.3 points", "1 point")
 * or a win chance ("61%", "<1%"). Move numbers, stone counts and board points are not figures.
 */
const FIG = /(?<![\p{L}\p{N}.,])(?:<\s?)?\d+(?:\.\d+)?(?:[  ]?%|[  ]points?(?![\p{L}\p{N}]))/gu;

/** `parts` with each KataGo figure in their plain text split out (HN critic, 2026-11-05 and 11-06: which numbers are KataGo's). */
export function splitFigures(parts: RichPart[]): RichPart[] {
  const out: RichPart[] = [];
  for (const p of parts) {
    if (p.type !== 'text') {
      out.push(p);
      continue;
    }
    let last = 0;
    FIG.lastIndex = 0;
    for (let m = FIG.exec(p.text); m; m = FIG.exec(p.text)) {
      if (m.index > last) out.push({ type: 'text', text: p.text.slice(last, m.index) });
      // one unit on the line: the figure never wraps away from its unit
      out.push({ type: 'fig', text: m[0].replace(/ /g, ' ') });
      last = m.index + m[0].length;
    }
    if (last < p.text.length) out.push(last ? { type: 'text', text: p.text.slice(last) } : p);
  }
  return out;
}

export interface TermPick {
  /** Entries that may get a hover in this text (absent: all of them). */
  allow?: ReadonlySet<GlossaryEntry>;
  /** Entries already given a hover in this text; each gets one, at its first occurrence. */
  seen?: Set<GlossaryEntry>;
}

/**
 * `text` as plain pieces, board points (when `size` is given) and glossary terms (when `terms`
 * is given). A `seen` set is filled as terms are used, so pass one set for one text.
 */
export function splitRich(text: string, size: number | null, terms: TermPick | null, figures = false): RichPart[] {
  const parts = splitTerms(text, size, terms);
  return figures ? splitFigures(parts) : parts;
}

function splitTerms(text: string, size: number | null, terms: TermPick | null): RichPart[] {
  const base: RichPart[] = size ? splitPoints(text, size) : [{ type: 'text', text }];
  if (!terms) return base;
  const out: RichPart[] = [];
  for (const p of base) {
    if (p.type !== 'text') {
      out.push(p);
      continue;
    }
    let last = 0;
    for (const t of findTerms(p.text)) {
      if (terms.allow && !terms.allow.has(t.entry)) continue;
      if (terms.seen) {
        if (terms.seen.has(t.entry)) continue;
        terms.seen.add(t.entry);
      }
      if (t.start > last) out.push({ type: 'text', text: p.text.slice(last, t.start) });
      out.push({ type: 'term', text: p.text.slice(t.start, t.end), entry: t.entry });
      last = t.end;
    }
    if (last < p.text.length) out.push({ type: 'text', text: p.text.slice(last) });
  }
  return out;
}

/**
 * For texts read in order (an answer's summary and sections, a list of facts), the glossary
 * entries whose first occurrence among all of them is in each one. `skip` leaves entries out
 * (a library answer does not underline its own term).
 */
export function firstTerms(texts: readonly string[], skip?: (e: GlossaryEntry) => boolean): Set<GlossaryEntry>[] {
  const seen = new Set<GlossaryEntry>();
  return texts.map((t) => {
    const here = new Set<GlossaryEntry>();
    for (const m of findTerms(t)) {
      if (seen.has(m.entry) || skip?.(m.entry)) continue;
      seen.add(m.entry);
      here.add(m.entry);
    }
    return here;
  });
}

/**
 * The tooltip's title and text. A definition written "Double sente: a large point..." is
 * split at its colon; otherwise the title is the library entry's name, or the term.
 */
export function termCard(e: GlossaryEntry): { title: string; text: string; names?: TermNames } {
  const names = TERM_NAMES[e.term];
  const m = e.def.match(/^([^:.!?]{2,40}):\s+([\s\S]*)$/);
  if (m) return { title: m[1], text: m[2][0].toUpperCase() + m[2].slice(1), ...(names ? { names } : {}) };
  const c = e.concept ? conceptById(e.concept) : undefined;
  return { title: c?.name ?? e.term[0].toUpperCase() + e.term.slice(1), text: e.def, ...(names ? { names } : {}) };
}

/** A Go term as Chinese (simplified, with its pinyin) and Japanese players write it. */
export interface TermNames {
  zh: string;
  /** Pinyin with tone marks, as printed beside the characters (Chinese 5d, 2026-11-06). */
  py: string;
  ja: string;
  /** A second Chinese word in common use for the same move (attach: 碰 and 靠; reverse sente: 逆收 and 逆先手). */
  also?: { zh: string; py: string };
}

/**
 * The standard Chinese and Japanese names of every glossary term, shown on its card (critics,
 * round 3: "bilingual hover on Go terms"; Chinese 5d, three rounds to 2026-11-09: every card with
 * Chinese, pinyin and Japanese). Keyed by the glossary's term; add nothing without a source.
 * Checked 2026-11-07 against Chinese and Japanese usage: aji is 味道 in Chinese (the Japanese 味
 * alone is not how Chinese players say it); attach is 碰 for a lone stone and 靠 when leaning on a
 * group, both in use, so the card shows both.
 * Added 2026-11-10 for the terms that had no card names: liberty 气 / ダメ (Japanese uses ダメ for
 * a liberty as well as for a neutral point), kikashi 先手便宜 / 利かし, vital point 要点 / 急所,
 * dragon 大龙 / 大石, bamboo joint 双 / タケフ (双 is the shape in the Chinese list of basic
 * moves: 长, 立, 尖, 双, 虎, 飞), reverse sente 逆收 (also 逆先手) / 逆先手, influence 外势 / 勢力,
 * overconcentration 重复 / 凝り形, probe 试应手 / 様子見 (yosu-miru). Chinese 5d, 2026-11-10: kikashi is
 * 先手便宜 and reverse sente 逆收 in Chinese speech (先手利 and 逆先手 read as translations).
 */
export const TERM_NAMES: Readonly<Record<string, TermNames>> = {
  hane: { zh: '扳', py: 'bān', ja: 'ハネ' },
  stretch: { zh: '长', py: 'cháng', ja: 'ノビ' },
  cut: { zh: '断', py: 'duàn', ja: 'キリ' },
  crosscut: { zh: '扭断', py: 'niǔduàn', ja: 'キリチガイ' },
  block: { zh: '挡', py: 'dǎng', ja: 'オサエ' },
  descent: { zh: '立', py: 'lì', ja: 'サガリ' },
  atari: { zh: '打吃', py: 'dǎchī', ja: 'アタリ' },
  ko: { zh: '劫', py: 'jié', ja: 'コウ' },
  ladder: { zh: '征子', py: 'zhēngzi', ja: 'シチョウ' },
  net: { zh: '枷', py: 'jiā', ja: 'ゲタ' },
  tenuki: { zh: '脱先', py: 'tuōxiān', ja: '手抜き' },
  sente: { zh: '先手', py: 'xiānshǒu', ja: '先手' },
  gote: { zh: '后手', py: 'hòushǒu', ja: '後手' },
  joseki: { zh: '定式', py: 'dìngshì', ja: '定石' },
  aji: { zh: '味道', py: 'wèidao', ja: '味' },
  'double sente': { zh: '双先', py: 'shuāngxiān', ja: '両先手' },
  miai: { zh: '见合', py: 'jiànhé', ja: '見合い' },
  honte: { zh: '本手', py: 'běnshǒu', ja: '本手' },
  eye: { zh: '眼', py: 'yǎn', ja: '眼' },
  'false eye': { zh: '假眼', py: 'jiǎyǎn', ja: '欠け眼' },
  'life and death': { zh: '死活', py: 'sǐhuó', ja: '死活' },
  tsumego: { zh: '死活题', py: 'sǐhuótí', ja: '詰碁' },
  seki: { zh: '双活', py: 'shuānghuó', ja: 'セキ' },
  'ko threat': { zh: '劫材', py: 'jiécái', ja: 'コウ材' },
  semeai: { zh: '对杀', py: 'duìshā', ja: '攻め合い' },
  snapback: { zh: '倒扑', py: 'dàopū', ja: 'ウッテガエシ' },
  'throw-in': { zh: '扑', py: 'pū', ja: 'ホウリコミ' },
  tesuji: { zh: '手筋', py: 'shǒujīn', ja: '手筋' },
  tsuke: { zh: '碰', py: 'pèng', ja: 'ツケ', also: { zh: '靠', py: 'kào' } },
  kosumi: { zh: '尖', py: 'jiān', ja: 'コスミ' },
  keima: { zh: '小飞', py: 'xiǎofēi', ja: 'ケイマ' },
  ogeima: { zh: '大飞', py: 'dàfēi', ja: '大ゲイマ' },
  'one-space jump': { zh: '单关', py: 'dānguān', ja: '一間トビ' },
  'shoulder hit': { zh: '尖冲', py: 'jiānchōng', ja: 'カタツキ' },
  'empty triangle': { zh: '空三角', py: 'kōngsānjiǎo', ja: 'アキ三角' },
  "tiger's mouth": { zh: '虎口', py: 'hǔkǒu', ja: '虎の口' },
  sabaki: { zh: '腾挪', py: 'téngnuó', ja: 'サバキ' },
  'star point': { zh: '星位', py: 'xīngwèi', ja: '星' },
  kakari: { zh: '挂角', py: 'guàjiǎo', ja: 'カカリ' },
  shimari: { zh: '守角', py: 'shǒujiǎo', ja: 'シマリ' },
  hasami: { zh: '夹击', py: 'jiājī', ja: 'ハサミ' },
  '3-3 invasion': { zh: '点三三', py: 'diǎn sānsān', ja: '三々入り' },
  invasion: { zh: '打入', py: 'dǎrù', ja: '打ち込み' },
  reduction: { zh: '浅消', py: 'qiǎnxiāo', ja: '消し' },
  moyo: { zh: '模样', py: 'móyàng', ja: '模様' },
  thickness: { zh: '厚味', py: 'hòuwèi', ja: '厚み' },
  'big point': { zh: '大场', py: 'dàchǎng', ja: '大場' },
  yose: { zh: '官子', py: 'guānzi', ja: 'ヨセ' },
  dame: { zh: '单官', py: 'dānguān', ja: 'ダメ' },
  liberty: { zh: '气', py: 'qì', ja: 'ダメ' },
  kikashi: { zh: '先手便宜', py: 'xiānshǒu piányi', ja: '利かし' },
  'vital point': { zh: '要点', py: 'yàodiǎn', ja: '急所' },
  dragon: { zh: '大龙', py: 'dàlóng', ja: '大石' },
  'bamboo joint': { zh: '双', py: 'shuāng', ja: 'タケフ' },
  'reverse sente': { zh: '逆收', py: 'nìshōu', ja: '逆先手', also: { zh: '逆先手', py: 'nìxiānshǒu' } },
  influence: { zh: '外势', py: 'wàishì', ja: '勢力' },
  overconcentration: { zh: '重复', py: 'chóngfù', ja: '凝り形' },
  probe: { zh: '试应手', py: 'shìyìngshǒu', ja: '様子見' },
};
