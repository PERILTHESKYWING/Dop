/**
 * The Go chat ("ChatGPT for Go"): shared between the browser and the /api/llm function.
 *
 * The language model never reads the board on its own. Each turn it gets the conversation,
 * the student's profile (level, weaknesses, peer comparisons) and, when a board is
 * attached, KataGo's fact sheet (shared/ask.ts) with any lines KataGo has already checked.
 * The roles of the pipeline share as few calls as possible:
 *
 * - analyst: the browser pre-checks moves the student names, and the model may ask for up
 *   to three more lines in its first reply (then the second reply must answer);
 * - teacher: the answer, pitched to the student's level, citing only KataGo's figures;
 * - checker: code checks every coordinate, winrate and point figure, "only move" claims and
 *   life-and-death claims against the facts; a failing answer goes back once for correction.
 *   In deep mode a second model pass also reviews the answer's reasoning against the facts,
 *   but only when the answer makes checkable claims.
 *
 * So most turns are one model call; a turn that needs new lines is two.
 */
import { coordsIn, describeFacts, unsupportedFigures, type PositionFacts, type ProbeRequest, type ProbeResult } from './ask.js';

export interface ChatMessage {
  role: 'user' | 'coach';
  text: string;
}

/** What the app knows about the student, for tailoring advice. */
export interface StudentProfile {
  /** "about 3k (likely 5k to 1k)". */
  level?: string;
  phases?: { phase: string; level: string }[];
  games?: number;
  /** Comparisons with players of the same level ("KataGo's first choice 38%, peers 35%"). */
  peers?: string[];
  /** The costliest recurring decision errors, from the player's own analysed games. */
  weaknesses?: { title: string; detail: string; area: string; lossPerMove: number; share: string; trend?: string; focus?: string }[];
}

export interface ChatRequest {
  task: 'chat';
  /** The conversation, oldest first; the last message is the student's. */
  messages: ChatMessage[];
  /** KataGo's fact sheet for the attached board, if any. */
  position?: PositionFacts;
  /** Lines KataGo has checked for this turn. */
  probes?: ProbeResult[];
  profile?: StudentProfile;
  /** true: answer now, no more probes. */
  final?: boolean;
  /** Deep mode: a second model pass reviews the answer's reasoning. */
  deep?: boolean;
}

export interface ChatResponse {
  probes?: ProbeRequest[];
  answer?: string;
  /** Short follow-up questions the student might ask next. */
  followups?: string[];
  /** Figures and claims the checker could not verify, after correction. */
  unsupported?: string[];
  /** What the checker did, for the "how this answer was made" line. */
  checks?: { corrected: boolean; reviewed: boolean };
  model?: string;
  /** Model calls this reply took on the server. */
  calls?: number;
}

const ONLY_POINTS = 2;
const ONLY_WIN = 8;
const NEGATION = /\b(not|n't|no longer|never|if|unless|would|could|might|may|should|until|once|after|before|when|whether|try|tries|trying)\b/i;

/** The sentences of a text (newlines and sentence ends). */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Claims the numbers alone cannot catch: "X is the only move" when KataGo shows no clear gap
 * to the next move, and a group called dead, alive or weak when KataGo's ownership says
 * otherwise. Conditional or negated sentences are left alone.
 */
export function claimIssues(text: string, facts: PositionFacts): string[] {
  const out = new Set<string>();
  const onlyMoves = new Set<string>();
  const [c0, c1] = facts.candidates;
  if (c0 && (!c1 || c0.winrate - c1.winrate >= ONLY_WIN || c0.lead - c1.lead >= ONLY_POINTS)) onlyMoves.add(c0.move);
  for (const i of facts.insights ?? []) if (/great|brilliant/i.test(i.label) || (i.gap && (i.gap.points >= ONLY_POINTS || i.gap.winrate >= ONLY_WIN))) onlyMoves.add(i.move);
  for (const k of facts.keyMoments ?? []) if (k.kind === 'only move') onlyMoves.add(k.kataGo);
  const groupAt = (c: string) => facts.groups.find((g) => (g.all ?? g.at).includes(c));
  for (const s of sentences(text)) {
    if (NEGATION.test(s)) continue;
    if (!coordsIn(s, facts.size).length) continue;
    // "Q13 is the only move" / "the only move is Q13": the point named nearest the phrase.
    const only = /\bonly (?:good |real |playable )?move\b|\bthe only way\b/i.exec(s);
    if (only) {
      const c = coordsIn(s.slice(0, only.index), facts.size).pop() ?? coordsIn(s.slice(only.index), facts.size)[0];
      const known = c && (facts.candidates.some((x) => x.move === c) || facts.insights?.some((i) => i.move === c) || facts.keyMoments?.some((k) => k.kataGo === c));
      if (c && known && !onlyMoves.has(c)) out.add(`${c} called the only move, but KataGo shows other moves close to it`);
    }
    // Each status word is about the nearest point named before it in the sentence.
    for (const m of s.matchAll(/\b(dead|captured|alive|lives|living|safe|weak)\b/gi)) {
      const before = coordsIn(s.slice(0, m.index), facts.size);
      const c = before[before.length - 1];
      const g = c ? groupAt(c) : undefined;
      if (!g) continue;
      const status = m[1].toLowerCase();
      const want = status === 'dead' || status === 'captured' ? ['dead'] : status === 'weak' ? ['weak'] : ['safe', 'settled'];
      if (!want.includes(g.status)) out.add(`the ${g.color} group at ${c} called ${status}, but KataGo's ownership says ${g.status}`);
    }
  }
  return [...out];
}

/** Everything the checker can object to in an answer. */
export function checkAnswer(answer: string, req: Pick<ChatRequest, 'position' | 'probes' | 'messages'>): string[] {
  const question = req.messages[req.messages.length - 1]?.text ?? '';
  if (!req.position) {
    // Without a board there are no KataGo figures to quote: flag winrates presented as evaluations.
    const bad: string[] = [];
    for (const m of answer.matchAll(/(\d{1,3}(?:\.\d+)?)\s?%\s*(?:win\s?rate|winrate|chance to win)/gi)) if (!question.includes(m[0])) bad.push(m[0]);
    return bad;
  }
  return [...unsupportedFigures(answer, req.position, req.probes, question), ...claimIssues(answer, req.position)];
}

/** Whether an answer makes claims a review could check (so deep mode reviews it). */
export function checkable(answer: string, size: number): boolean {
  return coordsIn(answer, size).length > 0 || /\d\s?%|\bpoints?\b|\bonly move\b|\b(dead|alive|weak)\b/i.test(answer);
}

export const CHAT_SYSTEM = `You are DOPPELGÄNGER's Go (baduk) coach: a warm, precise teacher in a chat with one student.
You can talk about anything in Go: a position on the board, the student's games and weaknesses, training methods and study plans, concepts (shape, direction, sente, aji, thickness), joseki and fuseki ideas, life and death, the endgame, the pro world, and how to use this app.

Where your knowledge comes from:
- KataGo decides, you explain. When a board is attached you get KataGo's fact sheet; its numbers and lines are the only source of truth about that position. Use only coordinates, winrates and point figures that appear in the facts or the checked lines. Never invent a move, a line, a number or a life-and-death status.
- Do not read variations yourself. If the question needs a line KataGo has not checked, ask for it as a probe (first reply only) instead of guessing.
- Without a board you have no KataGo numbers: never quote winrates or scores then. You may discuss general principles, proverbs, well-known joseki and training methods from your own knowledge, and say when something is a rule of thumb rather than a fact.
- The student's profile (level, per-phase levels, recurring weaknesses measured by KataGo on their own games, and comparisons with players of the same level) is real data. Use it to tailor advice and training plans, and cite it when you do.
- Professional games (1940 to 2017) show what pros chose. Where KataGo and the pros differ, KataGo's numbers decide.
- Move labels (Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss, Blunder) come only from the facts.
- Commentary from game files is a person's opinion; KataGo's numbers win when they disagree.
- You will never be stronger than KataGo at reading. If the facts cannot settle a question, say so plainly and suggest what to check on the board.

How to answer:
- Pitch it to the student's level: simple words and one idea at a time for kyu players, more precise reasoning for dan players.
- Explain the idea in human terms (strength and weakness, territory and influence, tempo, shape, direction) and tie it to the facts.
- For training questions, give a concrete plan that targets the student's measured weaknesses, with what to do and how to tell it is working. Mention app features where they fit: Forge (drills built from their own mistakes), Blind Tests, Game Review, the Study Board, Doppelgänger (play a copy of themselves or an opponent).
- Coordinates: letters A to T without I, numbers from the bottom, e.g. Q16.
- Light markdown only: short paragraphs, "- " bullet lists, **bold** for key moves or ideas. No headings, no tables. Usually under 180 words; up to about 350 for study plans or when asked for depth.
- Keep the conversation going: offer up to 3 short follow-up questions the student might ask next (from their point of view, under 70 characters each).

Reply with JSON only, one of:
{"probes":[{"moves":["D4","C3"],"why":"short reason"}]}   (only with a board, only in your first reply, up to 3 lines of at most 8 moves alternating from the side to move)
{"answer":"your reply","followups":["...","..."]}`;

export const REVIEW_SYSTEM = `You check a Go coach's answer against KataGo's fact sheet before the student sees it.
Look for: moves, lines, winrates or scores not in the facts; a life-and-death status or "only move" the facts do not support; reasoning that contradicts KataGo's lines (for example saying a move works when KataGo's line shows it fails); advice aimed at the wrong side to move.
Do not rewrite for style. If the answer is sound, reply {"ok":true}. Otherwise reply {"ok":false,"issues":["..."],"answer":"the corrected answer, same tone and length, using only the facts"}.
JSON only.`;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

function profileText(p: StudentProfile): string {
  const lines: string[] = [];
  if (p.level) lines.push(`Estimated level: ${p.level}${p.games ? ` (from ${p.games} analysed games)` : ''}.`);
  if (p.phases?.length) lines.push(`By phase: ${p.phases.map((x) => `${x.phase} ${x.level}`).join(', ')}.`);
  if (p.peers?.length) lines.push(`Compared with players of the same level: ${p.peers.join('; ')}.`);
  if (p.weaknesses?.length)
    lines.push(
      'Recurring weaknesses (from KataGo on their games, costliest first):\n' +
        p.weaknesses
          .map((w) => `- ${w.title} (${w.area}): ${w.detail} Costs ${w.lossPerMove.toFixed(1)} points each time; happens ${w.share}.${w.trend ? ` ${w.trend}.` : ''}${w.focus ? ` Focus: ${w.focus}` : ''}`)
          .join('\n'),
    );
  return lines.join('\n');
}

export function buildChatPrompt(req: ChatRequest, correction?: string[]): string {
  const parts: string[] = [];
  if (req.profile && Object.keys(req.profile).length) parts.push(`About the student:\n${profileText(req.profile)}`);
  if (req.position) parts.push('A board is attached. KataGo\'s facts about it:\n\n' + describeFacts(req.position, req.probes).join('\n\n'));
  else parts.push('No board is attached to this message.');
  const history = req.messages.slice(0, -1).slice(-8);
  if (history.length) parts.push('Conversation so far:\n' + history.map((m) => `${m.role === 'user' ? 'Student' : 'Coach'}: ${clip(m.text, 1200)}`).join('\n'));
  parts.push(`Student: ${req.messages[req.messages.length - 1].text}`);
  if (req.final || !req.position) parts.push('Answer now (no probes).');
  if (correction?.length)
    parts.push(`Your previous answer had problems the checker found: ${correction.join('; ')}. Rewrite it using only the facts above; where the facts do not settle something, say so.`);
  return parts.join('\n\n');
}

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const j = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Parse and bound the model's reply. Probes only count without `final` and with a board. */
export function parseChatReply(raw: string, canProbe: boolean, size: number): { answer?: string; followups?: string[]; probes?: ProbeRequest[] } | null {
  const o = parseJson(raw);
  if (!o) return null;
  const answer = typeof o.answer === 'string' && o.answer.trim() ? o.answer.trim().slice(0, 4000) : undefined;
  const followups = Array.isArray(o.followups)
    ? o.followups.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, 120)).slice(0, 3)
    : undefined;
  if (answer) return { answer, followups: followups?.length ? followups : undefined };
  if (!canProbe || !Array.isArray(o.probes)) return null;
  const probes = o.probes
    .filter((p): p is { moves: unknown[]; why?: unknown } => !!p && typeof p === 'object' && Array.isArray((p as { moves?: unknown }).moves))
    .map((p) => ({
      moves: p.moves.filter((m): m is string => typeof m === 'string').map((m) => m.toUpperCase().trim()).filter((m) => m === 'PASS' || coordsIn(m, size).length === 1).slice(0, 8),
      why: typeof p.why === 'string' ? p.why.slice(0, 160) : undefined,
    }))
    .filter((p) => p.moves.length > 0)
    .slice(0, 3);
  return probes.length ? { probes } : null;
}

export function parseReview(raw: string): { ok: boolean; answer?: string; issues: string[] } | null {
  const o = parseJson(raw);
  if (!o || typeof o.ok !== 'boolean') return null;
  const issues = Array.isArray(o.issues) ? o.issues.filter((x): x is string => typeof x === 'string').slice(0, 6) : [];
  const answer = typeof o.answer === 'string' && o.answer.trim() ? o.answer.trim().slice(0, 4000) : undefined;
  return { ok: o.ok || !answer, answer, issues };
}

export function validChatRequest(x: unknown): x is ChatRequest {
  const r = x as ChatRequest;
  if (!r || r.task !== 'chat' || !Array.isArray(r.messages) || !r.messages.length) return false;
  if (!r.messages.every((m) => m && (m.role === 'user' || m.role === 'coach') && typeof m.text === 'string')) return false;
  const last = r.messages[r.messages.length - 1];
  if (last.role !== 'user' || !last.text.trim() || last.text.length > 2000) return false;
  if (r.position && (typeof r.position.diagram !== 'string' || !Array.isArray(r.position.candidates) || !Array.isArray(r.position.groups))) return false;
  return true;
}
