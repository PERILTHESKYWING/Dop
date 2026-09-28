/**
 * Forge problems: the language model's part. Shared between the browser and the /api/llm
 * function.
 *
 * KataGo has already found every problem, proved the answer and searched out the
 * refutations (scripts/problem-bank.ts). The model gets those facts and does two things a
 * search cannot: it judges whether a problem is worth a player's time at their level, and
 * it writes the words: a 101weiqi-style task line, a hint that does not give the answer
 * away, and an explanation pitched at the player's level. Every coordinate it writes is
 * checked against KataGo's lines; a problem whose text cites anything else is sent back
 * once for correction, and otherwise shown with the app's own plain text.
 */
import { coordsIn } from './ask.js';

export interface ProblemFacts {
  id: string;
  /** "life and death", "tesuji", "endgame", "best move". */
  category: string;
  /** "Black to play and live". */
  task: string;
  toPlay: 'Black' | 'White';
  /** Problem level, "5k". */
  level: string;
  size: number;
  /** Rows of the problem window, top to bottom, with coordinates. X Black, O White, . empty. */
  diagram: string;
  /** The answer, move by move ("B R17", "W S18", ...). */
  answer: string[];
  /** Other first moves that also work. */
  alsoWorks: string[];
  /** Tempting first moves that fail, and how KataGo refutes them. */
  wrong: { move: string; refutation: string[] }[];
  /** Techniques found in the answer (throw-in, snapback, placement, ...). */
  techniques: string[];
  /** Points the answer is worth over the alternatives. */
  stakes: number;
  /** A few stones of the group the task is about. */
  group?: string[];
  /** Where it comes from: "a 5k game on Fox", "a professional game". */
  source: string;
}

export interface ForgeWriteRequest {
  task: 'forge-problems';
  /** The player's level, "3k". */
  playerLevel: string;
  problems: ProblemFacts[];
}

export interface ProblemText {
  id: string;
  /** False when the model judges the problem not worth asking (unclear lesson, trivial). */
  keep: boolean;
  /** 1 (little to learn) to 5 (a lesson every player at this level needs). */
  instructive: number;
  /** A short catchy name ("The throw-in that steals an eye"). */
  title: string;
  /** The task line with a nudge ("Black to play. The corner looks alive, is it?"). */
  question: string;
  /** One idea to look for, never the answer's coordinate. */
  hint: string;
  /** Why the answer works and the natural moves fail (2-4 sentences). */
  explanation: string;
  /** One sentence per tempting wrong move, keyed by its coordinate. */
  wrongNotes: Record<string, string>;
}

export interface ForgeWriteResponse {
  texts: ProblemText[];
  model: string;
  /** Problems whose text failed the checks and were left out. */
  rejected: string[];
}

export const MAX_PROBLEMS_PER_REQUEST = 12;

/**
 * The writing guide: what 101weiqi's problems do well (short tasks, level-aware hints,
 * concrete explanations) turned into rules. Only the style is borrowed; the problems are
 * KataGo's.
 */
export const FORGE_SYSTEM = `You write the text for Go (weiqi, baduk) problems in a training app, in the style of 101weiqi's problem sets.
KataGo found each problem in a real game and proved the answer; you get its facts. You never decide the answer yourself.

For each problem:
1. keep and instructive (1-5): would a player at the given level learn a reusable idea from it? Keep problems with a clear shape
   or technique (vital point, eye-stealing, throw-in, snapback, reducing eye space from outside, bent four, a net, the biggest
   endgame move with sente, a cut that works). Drop (keep=false) problems whose answer is a plain capture anyone sees, or whose
   lesson is unclear even with KataGo's lines. Be honest: most problems are 3.
2. title: 2 to 6 words, specific and a little playful ("Two hanes, one eye", "The corner's hidden weakness"). No coordinates.
3. question: the task as 101weiqi words it ("Black to play and live.", "White to play and kill.", "Black to play: find the tesuji.",
   "Black to play: the biggest endgame move.") followed by at most one short sentence of nudge. No coordinates, no answer.
4. hint: one sentence naming the idea to look for, pitched at the player's level. Never the answer's coordinate, never
   "play at ...". For kyu players name the concept plainly ("Make the eye space as small as possible first"); for dan players
   be subtler ("The first move is not where the fight is").
5. explanation: 2 to 4 sentences. What the first move does and why, what happens after the opponent's best resistance (use the
   answer line), and why the tempting move fails (use its refutation). Plain words for kyu players, standard Go terms for dan
   players. You may cite coordinates, but ONLY coordinates that appear in the facts.
6. wrongNotes: for each listed wrong move, one sentence on why it fails, from its refutation. Key = the move's coordinate.

Never invent moves, coordinates, winrates or point values. The only number you may use is the problem's stakes in points.
Answer with JSON only: {"texts":[{"id":"","keep":true,"instructive":3,"title":"","question":"","hint":"","explanation":"","wrongNotes":{}}]}`;

export function buildForgePrompt(req: ForgeWriteRequest, corrections?: Record<string, string[]>): string {
  const lines = [`Player level: ${req.playerLevel}.`, ''];
  for (const p of req.problems) {
    lines.push(`Problem ${p.id} (${p.category}, level ${p.level}, from ${p.source}): ${p.task}`);
    lines.push(p.diagram);
    lines.push(`Answer: ${p.answer.join(', ')}`);
    if (p.alsoWorks.length) lines.push(`Also works as the first move: ${p.alsoWorks.join(', ')}`);
    for (const w of p.wrong) lines.push(`Wrong: ${w.move}, refuted by ${w.refutation.join(', ') || 'the answer line'}`);
    if (p.techniques.length) lines.push(`Techniques in the answer: ${p.techniques.join(', ')}`);
    if (p.group?.length) lines.push(`The group at stake includes ${p.group.join(', ')}`);
    lines.push(`Stakes: ${p.stakes} points`);
    if (corrections?.[p.id]?.length) lines.push(`Your last text for this problem cited things not in the facts: ${corrections[p.id].join('; ')}. Fix them.`);
    lines.push('');
  }
  return lines.join('\n');
}

const str = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().replace(/\s+/g, ' ').slice(0, max) : '');

/** Coordinates a problem's text may cite: every move in KataGo's lines and the stones shown. */
export function allowedCoords(p: ProblemFacts): Set<string> {
  const out = new Set<string>();
  const add = (s: string) => {
    const m = /([A-HJ-T]\d{1,2})\s*$/i.exec(s.trim());
    if (m) out.add(m[1].toUpperCase());
  };
  p.answer.forEach(add);
  p.alsoWorks.forEach(add);
  for (const w of p.wrong) {
    add(w.move);
    w.refutation.forEach(add);
  }
  p.group?.forEach(add);
  for (const c of diagramStones(p.diagram)) out.add(c);
  return out;
}

/**
 * Stones in a diagram written by problemDiagram (src/lib/problems/text.ts): a header of
 * column letters, then rows "17 . X O ...".
 */
export function diagramStones(diagram: string): string[] {
  const rows = diagram.split('\n');
  const cols = (rows[0] ?? '').trim().split(/\s+/);
  const out: string[] = [];
  for (const row of rows.slice(1)) {
    const cells = row.trim().split(/\s+/);
    const n = Number(cells[0]);
    if (!Number.isFinite(n)) continue;
    cells.slice(1).forEach((c, i) => {
      if ((c === 'X' || c === 'O') && cols[i]) out.push(`${cols[i]}${n}`);
    });
  }
  return out;
}

/** Problems whose text breaks the rules, with what is wrong. */
export function checkText(t: ProblemText, p: ProblemFacts): string[] {
  const bad: string[] = [];
  const allowed = allowedCoords(p);
  const firstMoves = new Set([p.answer[0], ...p.alsoWorks].map((s) => /([A-HJ-T]\d{1,2})\s*$/i.exec(s ?? '')?.[1]?.toUpperCase()).filter(Boolean));
  for (const field of ['title', 'question', 'hint'] as const) {
    for (const c of coordsIn(t[field], p.size)) bad.push(`${field} names ${c}`);
  }
  for (const c of coordsIn(t.explanation, p.size)) if (!allowed.has(c)) bad.push(`explanation cites ${c}, which is in none of KataGo's lines`);
  for (const [k, v] of Object.entries(t.wrongNotes)) for (const c of coordsIn(v, p.size)) if (!allowed.has(c)) bad.push(`the note on ${k} cites ${c}`);
  for (const c of firstMoves) if (c && t.hint.toUpperCase().includes(c)) bad.push('the hint gives the answer away');
  const text = [t.question, t.hint, t.explanation, ...Object.values(t.wrongNotes)].join(' ');
  if (/\d+(?:\.\d+)?\s?%/.test(text)) bad.push('winrates are not part of the facts');
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(?:points?|pts)\b/gi)) {
    if (Math.abs(Number(m[1]) - p.stakes) > 1.01) bad.push(`"${m[0]}" does not match the stakes (${p.stakes} points)`);
  }
  return bad;
}

/** Parse and bound the model's answer; texts are checked against the facts. */
export function parseForgeReply(raw: string, req: ForgeWriteRequest): { texts: ProblemText[]; problems: Record<string, string[]> } {
  let j: unknown;
  try {
    j = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    const m = /\{[\s\S]*\}/.exec(raw);
    try {
      j = m ? JSON.parse(m[0]) : null;
    } catch {
      j = null;
    }
  }
  const list = j && typeof j === 'object' && Array.isArray((j as { texts?: unknown }).texts) ? ((j as { texts: unknown[] }).texts) : [];
  const facts = new Map(req.problems.map((p) => [p.id, p]));
  const texts: ProblemText[] = [];
  const problems: Record<string, string[]> = {};
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const p = facts.get(str(o.id, 40));
    if (!p) continue;
    const wrongNotes: Record<string, string> = {};
    if (o.wrongNotes && typeof o.wrongNotes === 'object') {
      const known = new Set(p.wrong.map((w) => /([A-HJ-T]\d{1,2})\s*$/i.exec(w.move)?.[1]?.toUpperCase()));
      for (const [k, v] of Object.entries(o.wrongNotes as Record<string, unknown>)) {
        const key = /([A-HJ-T]\d{1,2})/i.exec(k)?.[1]?.toUpperCase();
        if (key && known.has(key) && str(v, 300)) wrongNotes[key] = str(v, 300);
      }
    }
    const inst = typeof o.instructive === 'number' ? Math.max(1, Math.min(5, Math.round(o.instructive))) : 3;
    const t: ProblemText = {
      id: p.id,
      keep: o.keep !== false,
      instructive: inst,
      title: str(o.title, 80),
      question: str(o.question, 200),
      hint: str(o.hint, 240),
      explanation: str(o.explanation, 900),
      wrongNotes,
    };
    if (!t.question || !t.explanation) {
      problems[p.id] = ['missing question or explanation'];
      continue;
    }
    const bad = checkText(t, p);
    if (bad.length) problems[p.id] = bad;
    else texts.push(t);
  }
  return { texts, problems };
}

export function validForgeRequest(x: unknown): x is ForgeWriteRequest {
  if (!x || typeof x !== 'object') return false;
  const r = x as ForgeWriteRequest;
  return r.task === 'forge-problems' && typeof r.playerLevel === 'string' && Array.isArray(r.problems) && r.problems.every((p) => p && typeof p.id === 'string' && Array.isArray(p.answer) && typeof p.diagram === 'string');
}

type Generate = (prompt: { system: string; user: string; maxOutputTokens?: number }, budgetLeftMs: number) => Promise<{ ok: boolean; text?: string; model?: string; errors: string[] }>;

/** The /api/llm handler for 'forge-problems': write, check, send failures back once. */
export async function handleForgeWrite(raw: unknown, generate: Generate, budgetMs: number, now: () => number = Date.now): Promise<{ status: number; body: unknown }> {
  if (!validForgeRequest(raw)) return { status: 400, body: { error: 'invalid request' } };
  const req: ForgeWriteRequest = { ...raw, problems: raw.problems.slice(0, MAX_PROBLEMS_PER_REQUEST) };
  const start = now();
  const r = await generate({ system: FORGE_SYSTEM, user: buildForgePrompt(req), maxOutputTokens: 8192 }, budgetMs);
  if (!r.ok || !r.text) {
    const overloaded = r.errors.some((e) => /HTTP (429|503)/.test(e));
    return { status: 502, body: { error: overloaded ? 'Google says its Gemini models are overloaded right now. Try again in a minute.' : 'The Gemini call failed.', details: r.errors } };
  }
  let { texts, problems } = parseForgeReply(r.text, req);
  let model = r.model ?? 'gemini';
  const retry = req.problems.filter((p) => problems[p.id]);
  if (retry.length && budgetMs - (now() - start) > 15_000) {
    const sub: ForgeWriteRequest = { ...req, problems: retry };
    const r2 = await generate({ system: FORGE_SYSTEM, user: buildForgePrompt(sub, problems), maxOutputTokens: 6144 }, budgetMs - (now() - start));
    if (r2.ok && r2.text) {
      const second = parseForgeReply(r2.text, sub);
      texts = [...texts, ...second.texts];
      problems = second.problems;
      model = r2.model ?? model;
    }
  }
  const body: ForgeWriteResponse = { texts, model, rejected: Object.keys(problems) };
  return { status: 200, body };
}
