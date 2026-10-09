/**
 * Pick games above Fox's amateur ranks for the level corpus, newest first, with a rank for
 * each side: 10 for professionals, 11 for top professionals (the humans who took on the
 * AI accounts on Fox, all 9 dan or pro there), 12 for AI. Used by
 * .github/workflows/coach-training.yml; scripts/rank-corpus.ts --jsonl measures them.
 *
 *   npx tsx scripts/elite-pick.ts --fox-pro-dir sgf/Pro --ai-dir computer-go-dataset/AI \
 *     --pro-lines pro.txt --kata-dir katago-sgfs --seen seen.txt --per-rank 300 --out elite.jsonl
 *
 * Every source is optional. Output: one JSON line per game, {file, b, w, date, sgf}, with
 * b/w the sides' ranks (null: not measured).
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { hashString } from '../src/lib/util/hash';
import { AI_RANK, parseRank, PRO_RANK, TOP_PRO_RANK } from '../src/lib/level/ranks';

const args = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};

/**
 * Folders of yenw/computer-go-dataset/AI whose programs were clearly stronger than the best
 * humans: AlphaGo, the Fox accounts of FineArt (绝艺), Golaxy (金毛测试), and the 2018+
 * world AI championships. Older or weaker programs are left out.
 */
const STRONG_AI = new Set([
  'AlphaGo Zero',
  'AlphaGo 2.0',
  'master',
  'FineArt',
  'Jin Mao Ce Shi',
  'Li Long',
  'Xing Tian',
  '2018 Tencent World AI WEIQI Competition',
  '2019 China Securities Cup World AI WEIQI Open',
  '2020 World GO AI Championship',
  'Berry Genomics Cup 2018 World AI Weiqi Competition',
  'Berry Genomics Cup 2019 World AI Weiqi Competition',
]);

interface Pick {
  file: string;
  b: number | null;
  w: number | null;
  date: string;
  sgf: string;
}

const tag = (sgf: string, k: string) => sgf.slice(0, 3000).match(new RegExp(`\\b${k}\\[([^\\]]*)\\]`))?.[1]?.trim();
const dateOf = (sgf: string, fallback = '') => (tag(sgf, 'DT') ?? fallback).replace(/[./]/g, '-').slice(0, 10);
const moveCount = (sgf: string) => sgf.match(/;\s*[BW]\[[a-s]{2}\]/g)?.length ?? 0;
/** 19x19, even, a real game. */
const playable = (sgf: string) => (tag(sgf, 'SZ') ?? '19') === '19' && ['0', '1', undefined].includes(tag(sgf, 'HA')) && !/\bAB\[/.test(sgf.slice(0, 3000)) && moveCount(sgf) >= 80;
/** A human strong enough to count as a top pro: 9 dan on Fox, or a professional. */
const topHuman = (rank: string | undefined) => !!rank && /^(9\s*(d|段|dan)|p\d|\d+p|pro|职业|職業)/i.test(rank.trim());

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n.toLowerCase().endsWith('.sgf')) out.push(p);
  }
  return out;
}

const seen = new Set(existsSync(arg('seen', '') ?? '') ? readFileSync(arg('seen')!, 'utf8').split('\n').filter(Boolean) : []);
const all: Pick[] = [];
const add = (p: Pick) => {
  if (!seen.has(p.file) && (p.b !== null || p.w !== null) && playable(p.sgf)) all.push(p);
};

// AI: tournament folders are AI against AI; Fox account folders are one AI against humans.
const aiDir = arg('ai-dir');
if (aiDir && existsSync(aiDir))
  for (const folder of readdirSync(aiDir)) {
    if (!STRONG_AI.has(folder)) continue;
    const files = walk(path.join(aiDir, folder)).map((f) => ({ f, sgf: readFileSync(f, 'utf8') }));
    const names = new Map<string, number>();
    for (const { sgf } of files) for (const k of ['PB', 'PW']) names.set(tag(sgf, k) ?? '', (names.get(tag(sgf, k) ?? '') ?? 0) + 1);
    const [top, count] = [...names].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    const account = files.length >= 20 && count >= files.length * 0.8 ? top : null;
    for (const { f, sgf } of files) {
      const rankOf = (k: 'PB' | 'PW', r: 'BR' | 'WR') => (!account || tag(sgf, k) === account ? AI_RANK : topHuman(tag(sgf, r)) ? TOP_PRO_RANK : null);
      const date = dateOf(sgf, path.basename(f).match(/^\d{4}[.-]\d{2}[.-]\d{2}/)?.[0] ?? folder.match(/20\d\d/)?.[0] ?? '');
      add({ file: `ai:${folder}/${path.basename(f)}`, b: rankOf('PB', 'BR'), w: rankOf('PW', 'WR'), date, sgf });
    }
  }

// Fox's professional games (the same server as the amateur ranks): ranks from BR/WR, so a
// professional (P9段) is 10 and their 9 dan opponents stay 9.
const foxPro = arg('fox-pro-dir');
if (foxPro && existsSync(foxPro))
  for (const f of walk(foxPro)) {
    const sgf = readFileSync(f, 'utf8');
    const unix = Number(path.basename(f).slice(0, 10));
    const date = Number.isFinite(unix) && unix > 1e9 ? new Date(unix * 1000).toISOString().slice(0, 10) : dateOf(sgf);
    add({ file: path.basename(f), b: parseRank(tag(sgf, 'BR')), w: parseRank(tag(sgf, 'WR')), date, sgf });
  }

// Professionals: one game per line.
const proLines = arg('pro-lines');
if (proLines && existsSync(proLines))
  for (const l of readFileSync(proLines, 'utf8').split('\n')) {
    if (!l.startsWith('(')) continue;
    add({ file: `elite-pro:${hashString(l)}`, b: PRO_RANK, w: PRO_RANK, date: dateOf(l), sgf: l });
  }

// KataGo's own rating games (katagotraining.org): AI on both sides, the newest there are.
const kataDir = arg('kata-dir');
if (kataDir && existsSync(kataDir))
  for (const f of walk(kataDir)) {
    const sgf = readFileSync(f, 'utf8');
    add({ file: `kata:${path.basename(f)}`, b: AI_RANK, w: AI_RANK, date: dateOf(sgf, path.basename(f).match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ''), sgf });
  }

// Newest first, at most --per-rank sides per rank.
const perRank = Number(arg('per-rank', '300'));
all.sort((a, b) => b.date.localeCompare(a.date));
const count = new Map<number, number>();
const kept: Pick[] = [];
for (const p of all) {
  const ranks = [p.b, p.w].filter((r): r is number => r !== null);
  if (ranks.every((r) => (count.get(r) ?? 0) >= perRank)) continue;
  for (const r of ranks) count.set(r, (count.get(r) ?? 0) + 1);
  kept.push({ ...p, sgf: p.sgf.replace(/\r?\n/g, ' ') });
}
writeFileSync(arg('out')!, kept.map((p) => JSON.stringify(p)).join('\n') + '\n');
console.log(
  `${kept.length} games picked from ${all.length}, newest ${kept[0]?.date ?? '-'}:`,
  [...count].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' '),
);
