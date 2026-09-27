/**
 * "Ask about this position": shared between the browser and the /api/llm function.
 *
 * KataGo decides, the language model explains. The browser sends a fact sheet made from
 * KataGo's analysis (candidates, values, lines, groups and their status). The model may
 * first ask for up to three extra lines to be checked ("probes"), which the browser
 * searches with KataGo; then it answers. Every coordinate, winrate and point figure in
 * the answer is checked against the facts, and an answer that cites anything else is
 * sent back once for correction and otherwise flagged.
 */

export interface FactCandidate {
  move: string;
  /** Winrate of the side to move after this move, 0–100. */
  winrate: number;
  /** Score lead of the side to move after this move (points, may be negative). */
  lead: number;
  visits: number;
  /** KataGo's expected continuation, starting with this move. */
  line: string[];
}

export interface FactGroup {
  color: 'Black' | 'White';
  stones: number;
  /** A few of its stones, for naming it. */
  at: string[];
  liberties: number;
  status: 'weak' | 'safe' | 'dead' | 'settled';
}

export interface PositionFacts {
  size: number;
  komi: number;
  moveNumber: number;
  toPlay: 'Black' | 'White';
  lastMove?: string;
  /** Rows top to bottom, with column letters and row numbers. X Black, O White, . empty, last move in lower case. */
  diagram: string;
  /** Black's winrate (0–100) and score lead now. */
  blackWinrate: number;
  blackLead: number;
  visits: number;
  candidates: FactCandidate[];
  groups: FactGroup[];
  /** Ownership estimate: points each side is expected to end up with (stones + territory). */
  area?: { black: number; white: number };
  /** The move played in the game here, when known, and what it cost the side to move. */
  played?: { move: string; winrateLoss: number; pointsLost: number; kataGoBest: string };
  /** The asker's estimated level, to pitch the explanation ("about 3k"). */
  level?: string;
  /** How good and how hard to find the played move and KataGo's move are. */
  insights?: MoveInsight[];
  /** What professionals played from this exact position (whole-board match). */
  pro?: ProFacts;
  /** Commentary written in the game file (a person's words, not KataGo's). */
  comments?: { lastMove?: string; nextMove?: string };
  /** The moments of the whole game that mattered most (for questions about the game). */
  keyMoments?: KeyMomentFact[];
}

export interface KeyMomentFact {
  /** Move number (1-based). */
  move: number;
  player: 'Black' | 'White';
  kind: 'turning point' | 'only move';
  played: string;
  kataGo: string;
  found: boolean;
  /** What the move played cost (winrate 0–100 and points). */
  winrateLoss: number;
  pointsLost: number;
  /** For only moves: how much worse the next-best move was. */
  gap?: { points: number; winrate: number };
}

export interface MoveInsight {
  move: string;
  role: 'played' | 'KataGo';
  /** Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss, Blunder. */
  label: string;
  /** For KataGo's move: how much worse the next-best move is, for the side to move. */
  gap?: { points: number; winrate: number };
  /** How often players of each level play this move here (0–100), from rank-labelled games. */
  findRates: { level: string; percent: number }[];
}

export interface ProFacts {
  /** Professional games that reached this position (1940 to 2017, before AI openings). */
  games: number;
  moves: { move: string; games: number; percent: number; winPercent: number }[];
}

export interface ProbeRequest {
  /** Moves from the current position, alternating from the side to move. */
  moves: string[];
  why?: string;
}

export interface ProbeResult {
  moves: string[];
  legal: boolean;
  /** After the sequence: whose turn, Black's winrate 0–100 and lead, KataGo's best continuation. */
  toPlay?: 'Black' | 'White';
  blackWinrate?: number;
  blackLead?: number;
  bestLine?: string[];
  visits?: number;
  note?: string;
}

export interface AskTurn {
  question: string;
  answer: string;
}

export interface AskRequest {
  task: 'ask-position';
  question: string;
  facts: PositionFacts;
  /** Present on the second round: KataGo's results for the requested probes. */
  probes?: ProbeResult[];
  /** Earlier questions and answers about the same position. */
  history?: AskTurn[];
  /** true: the model must answer now (no more probes). */
  final?: boolean;
}

export interface AskResponse {
  /** The model wants these lines checked before answering. */
  probes?: ProbeRequest[];
  answer?: string;
  /** Figures in the answer that are not in KataGo's facts (after one correction round). */
  unsupported?: string[];
  model?: string;
}

const COORD = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';

/** Coordinates like "Q16" mentioned in a text (for this board size). */
export function coordsIn(text: string, size: number): string[] {
  const letters = COORD.slice(0, size);
  const re = new RegExp(`(?<![A-Za-z0-9])([${letters}${letters.toLowerCase()}])(\\d{1,2})(?![A-Za-z0-9])`, 'g');
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const n = Number(m[2]);
    if (n >= 1 && n <= size) out.push(`${m[1].toUpperCase()}${n}`);
  }
  return out;
}

function allowedFigures(facts: PositionFacts, probes: readonly ProbeResult[] = []) {
  const coords = new Set<string>();
  const add = (s?: string) => s && s !== 'pass' && coords.add(s.toUpperCase());
  add(facts.lastMove);
  for (const c of facts.candidates) c.line.forEach(add);
  for (const g of facts.groups) g.at.forEach(add);
  if (facts.played) {
    add(facts.played.move);
    add(facts.played.kataGoBest);
  }
  for (const p of probes) {
    p.moves.forEach(add);
    p.bestLine?.forEach(add);
  }
  for (const i of facts.insights ?? []) add(i.move);
  for (const k of facts.keyMoments ?? []) {
    add(k.played);
    add(k.kataGo);
  }
  for (const m of facts.pro?.moves ?? []) add(m.move);
  for (const c of [facts.comments?.lastMove, facts.comments?.nextMove]) if (c) coordsIn(c, facts.size).forEach(add);
  // Winrates in either player's view.
  const pct: number[] = [];
  const addPct = (x?: number) => {
    if (x === undefined || !Number.isFinite(x)) return;
    pct.push(x, 100 - x);
  };
  addPct(facts.blackWinrate);
  for (const c of facts.candidates) addPct(c.winrate);
  for (const p of probes) addPct(p.blackWinrate);
  if (facts.played) pct.push(facts.played.winrateLoss);
  for (const i of facts.insights ?? []) {
    for (const r of i.findRates) pct.push(r.percent);
    if (i.gap) pct.push(i.gap.winrate);
  }
  for (const m of facts.pro?.moves ?? []) pct.push(m.percent, m.winPercent, 100 - m.winPercent);
  for (const k of facts.keyMoments ?? []) {
    pct.push(k.winrateLoss);
    if (k.gap) pct.push(k.gap.winrate);
  }
  // Differences between winrates are fair to quote too.
  const base = [facts.blackWinrate, ...facts.candidates.map((c) => (facts.toPlay === 'Black' ? c.winrate : 100 - c.winrate)), ...probes.map((p) => p.blackWinrate ?? NaN)].filter(Number.isFinite);
  for (const a of base) for (const b of base) pct.push(Math.abs(a - b));
  // Points: leads in either view, differences between them, losses, areas.
  const leads = [facts.blackLead, ...facts.candidates.map((c) => (facts.toPlay === 'Black' ? c.lead : -c.lead)), ...probes.map((p) => p.blackLead ?? NaN)].filter(Number.isFinite);
  const pts: number[] = [];
  for (const a of leads) {
    pts.push(Math.abs(a));
    for (const b of leads) pts.push(Math.abs(a - b));
  }
  if (facts.played) pts.push(facts.played.pointsLost);
  for (const i of facts.insights ?? []) if (i.gap) pts.push(i.gap.points);
  for (const k of facts.keyMoments ?? []) {
    pts.push(k.pointsLost);
    if (k.gap) pts.push(k.gap.points);
  }
  if (facts.area) pts.push(facts.area.black, facts.area.white, Math.abs(facts.area.black - facts.area.white));
  pts.push(facts.komi);
  return { coords, pct, pts };
}

/**
 * Figures in `text` that the facts do not support: unknown coordinates, winrates not
 * within 1.5 of a KataGo winrate (or a difference of two), point figures not within 0.6
 * of a KataGo score figure. Figures that appear in the question are allowed.
 */
export function unsupportedFigures(text: string, facts: PositionFacts, probes: readonly ProbeResult[] = [], question = ''): string[] {
  const { coords, pct, pts } = allowedFigures(facts, probes);
  for (const c of coordsIn(question, facts.size)) coords.add(c);
  const bad = new Set<string>();
  for (const c of coordsIn(text, facts.size)) if (!coords.has(c)) bad.add(c);
  for (const m of text.matchAll(/(\d{1,3}(?:\.\d+)?)\s?%/g)) {
    const v = Number(m[1]);
    if (question.includes(m[0])) continue;
    if (!pct.some((p) => Math.abs(p - v) <= 1.5)) bad.add(m[0].trim());
  }
  for (const m of text.matchAll(/(\d{1,3}(?:\.\d+)?)\s*(?:more\s+|fewer\s+|extra\s+)?(?:points?|pts)\b/gi)) {
    const v = Number(m[1]);
    if (v <= 1 || question.includes(m[1])) continue;
    if (!pts.some((p) => Math.abs(p - v) <= 0.6)) bad.add(m[0].trim());
  }
  return [...bad];
}

/** Parse and bound the model's JSON. Probes are dropped on a final round. */
export function parseAskReply(raw: string, final: boolean, size: number): { answer?: string; probes?: ProbeRequest[] } | null {
  let j: unknown;
  try {
    j = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object') return null;
  const o = j as { answer?: unknown; probes?: unknown };
  const answer = typeof o.answer === 'string' && o.answer.trim() ? o.answer.trim().slice(0, 2400) : undefined;
  let probes: ProbeRequest[] | undefined;
  if (!final && Array.isArray(o.probes)) {
    probes = o.probes
      .filter((p): p is { moves: unknown; why?: unknown } => !!p && typeof p === 'object' && Array.isArray((p as { moves?: unknown }).moves))
      .map((p) => ({
        moves: (p.moves as unknown[]).filter((m): m is string => typeof m === 'string').map((m) => m.toUpperCase().trim()).filter((m) => coordsIn(m, size).length === 1 || m === 'PASS').slice(0, 8),
        why: typeof p.why === 'string' ? p.why.slice(0, 160) : undefined,
      }))
      .filter((p) => p.moves.length > 0)
      .slice(0, 3);
    if (!probes.length) probes = undefined;
  }
  if (!answer && !probes) return null;
  return probes && !answer ? { probes } : { answer, probes: undefined };
}

export const ASK_SYSTEM = `You are a patient, precise Go (baduk) teacher answering a student's question about a position or the game it comes from.
KataGo has analysed the position (and, when key moments are given, the whole game); its numbers are the only source of truth. You explain, KataGo decides.

Rules:
- Use only coordinates, winrates and point figures that appear in the facts (or the probe results). Never invent a move, a line, a number or a life-and-death status.
- Do not read variations yourself. If the question needs a line KataGo has not checked, ask for it as a probe instead of guessing.
- When the facts cannot settle the question, say so plainly.
- Explain the idea behind KataGo's choice in human terms (strength, weakness, territory, influence, tempo, shape) and tie it to the facts (group status, liberties, the lines).
- Pitch the explanation to the student's level when it is given: simple words and one idea for kyu players, more precise reasoning for dan players.
- Move labels come from KataGo: Brilliant (an only move strong amateurs rarely find), Great (the only good move), Best (KataGo's choice), Excellent, Good, Book (a common professional choice in the opening), Inaccuracy, Mistake, Miss (failed to punish the opponent's error), Blunder. Never give a move a label other than the one in the facts.
- Difficulty: the find rates say how often players of each level play that move in this position (measured on real games). Use them to say how hard the move is for the student's level, and why it is hard to see (it looks unnatural, the point only shows after a few moves, and so on).
- Professional games (1940 to 2017, before AI changed the openings) show what pros chose here. When KataGo and the pros disagree, say so; KataGo's numbers decide what is better.
- For questions about the whole game, use the key moments: turning points are where the game swung; only moves are where one move was needed. Name the move numbers.
- Commentary from the game file is a person's opinion. Use it for ideas and wording, but where it contradicts KataGo, KataGo's numbers win and you should say so.
- Coordinates: letters A–T without I, numbers 1–19 from the bottom, e.g. Q16. "Winrate" means the chance to win for the side named.
- Plain text, no markdown headings, at most about 170 words.

Reply with JSON only, one of:
{"probes":[{"moves":["D4","C3"],"why":"short reason"}]}   (up to 3 lines of at most 8 moves, alternating from the side to move; only when needed and only on the first round)
{"answer":"your explanation"}`;

export function buildAskPrompt(req: AskRequest, correction?: string[]): string {
  const f = req.facts;
  const parts: string[] = [];
  if (f.level) parts.push(`Student's level: ${f.level}.`);
  parts.push(`Position (move ${f.moveNumber}, ${f.toPlay} to play, komi ${f.komi}${f.lastMove ? `, last move ${f.lastMove}` : ''}):\n${f.diagram}`);
  parts.push(`KataGo (${f.visits} visits): Black's winrate ${f.blackWinrate.toFixed(1)}%, Black leads by ${f.blackLead.toFixed(1)} points (negative means White leads).`);
  parts.push(
    `KataGo's candidate moves for ${f.toPlay} (winrate and lead are ${f.toPlay}'s after the move):\n` +
      f.candidates.map((c, i) => `${i + 1}. ${c.move}: winrate ${c.winrate.toFixed(1)}%, lead ${c.lead.toFixed(1)}, ${c.visits} visits, expected line ${c.line.join(' ')}`).join('\n'),
  );
  if (f.groups.length)
    parts.push(
      'Groups (status from KataGo ownership):\n' +
        f.groups.map((g) => `- ${g.color} ${g.stones} stone${g.stones === 1 ? '' : 's'} at ${g.at.join(' ')}: ${g.liberties} liberties, ${g.status}`).join('\n'),
    );
  if (f.area) parts.push(`Expected area if play continued well: Black about ${f.area.black}, White about ${f.area.white} points.`);
  if (f.played)
    parts.push(`In the game ${f.toPlay} played ${f.played.move}; KataGo preferred ${f.played.kataGoBest}. It cost ${f.played.pointsLost.toFixed(1)} points and ${f.played.winrateLoss.toFixed(1)}% winrate.`);
  for (const i of f.insights ?? [])
    parts.push(
      `${i.role === 'played' ? 'Move played' : "KataGo's move"} ${i.move}: ${i.label}` +
        (i.gap ? ` (the next-best move is ${i.gap.points.toFixed(1)} points and ${i.gap.winrate.toFixed(1)}% worse)` : '') +
        (i.findRates.length ? `. Players play it here: ${i.findRates.map((r) => `${r.level} ${r.percent}%`).join(', ')}.` : '.'),
    );
  if (f.pro)
    parts.push(
      `Professional games reaching this exact position: ${f.pro.games}. They played: ` +
        f.pro.moves.map((m) => `${m.move} in ${m.games} games (${m.percent}%, the player won ${m.winPercent}%)`).join('; ') +
        '.',
    );
  if (f.keyMoments?.length)
    parts.push(
      'Key moments of the whole game (from KataGo):\n' +
        f.keyMoments
          .map(
            (k) =>
              `- Move ${k.move}, ${k.player}, ${k.kind}: played ${k.played}, KataGo ${k.kataGo}` +
              (k.kind === 'only move' ? (k.found ? ' (found it)' : ` (missed it: cost ${k.pointsLost.toFixed(1)} points, ${k.winrateLoss.toFixed(1)}% winrate)`) : `, cost ${k.pointsLost.toFixed(1)} points and ${k.winrateLoss.toFixed(1)}% winrate`) +
              (k.gap ? `; every other move was at least ${k.gap.points.toFixed(1)} points or ${k.gap.winrate.toFixed(1)}% worse` : ''),
          )
          .join('\n'),
    );
  if (f.comments?.lastMove) parts.push(`Commentary in the game file on the last move:\n${f.comments.lastMove}`);
  if (f.comments?.nextMove) parts.push(`Commentary in the game file on the move played here:\n${f.comments.nextMove}`);
  if (req.probes?.length)
    parts.push(
      'Lines you asked KataGo to check:\n' +
        req.probes
          .map((p) =>
            p.legal
              ? `- ${p.moves.join(' ')} → ${p.toPlay} to play, Black's winrate ${p.blackWinrate?.toFixed(1)}%, Black leads ${p.blackLead?.toFixed(1)}, KataGo continues ${p.bestLine?.join(' ') || '(nothing)'} (${p.visits} visits)`
              : `- ${p.moves.join(' ')} → not playable (${p.note ?? 'illegal'})`,
          )
          .join('\n'),
    );
  if (req.history?.length) parts.push('Earlier in this conversation:\n' + req.history.map((h) => `Q: ${h.question}\nA: ${h.answer}`).join('\n'));
  parts.push(`Question: ${req.question}`);
  if (req.final) parts.push('Answer now (no probes).');
  if (correction?.length)
    parts.push(`Your previous answer cited figures that are not in KataGo's facts: ${correction.join(', ')}. Rewrite it using only the facts above.`);
  return parts.join('\n\n');
}

export function validAskRequest(x: unknown): x is AskRequest {
  const r = x as AskRequest;
  return (
    !!r &&
    r.task === 'ask-position' &&
    typeof r.question === 'string' &&
    r.question.trim().length > 0 &&
    r.question.length <= 600 &&
    !!r.facts &&
    typeof r.facts.diagram === 'string' &&
    Array.isArray(r.facts.candidates) &&
    Array.isArray(r.facts.groups)
  );
}
