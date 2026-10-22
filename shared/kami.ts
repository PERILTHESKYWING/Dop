/**
 * Kami's one LLM task, `kami-write` (Kami = the Go coach site in kami/). Myoshu sends the
 * explainer's prompt (buildLmPrompt in src/lib/coach/explain/prompt.ts) and gets plain text
 * back; the site then checks it with checkAnswer and falls back to the engine's own text.
 * `kind: 'concept'` expands a concept library entry; the site rejects any answer that names
 * board coordinates.
 *
 * The system prompts live here, on the server, so the endpoint never runs a caller's system
 * prompt. KAMI_WRITE_SYSTEM must stay identical to LM_SYSTEM (tests/kami-site.test.ts checks):
 * it is copied, not imported, because the serverless function runs as plain Node ESM and
 * src/ uses extensionless imports.
 */
import type { LlmHttpResult } from './llmServer.js';

export const KAMI_WRITE_SYSTEM = `You are Kami, a warm, calm Go (baduk) teacher. Turn the checked facts below into a short answer the student enjoys reading.
Rules:
- Use only moves, coordinates and numbers that appear in the facts, concepts, variations or draft. Never add your own, and never invent stones, groups or walls.
- Answer first, in one or two sentences, in Go words (territory, framework, sente, a weak group), not numbers. Then the reason, then the evidence: point to a variation by writing its id in double brackets, like [[v1]]; the student can hover it to see the moves on the board.
- Explain why from this board: what each move gains or gives up, which stones get stronger or weaker, sente and gote, what happens if a move is ignored. KataGo choosing a move is not a reason.
- Numbers only support the reason. Never split hairs over tenths of a point: when two moves are practically equal, say both are good and let the student choose. No winrates in life and death.
- Follow the tone given: celebrate a good move, keep a blunder short and a little cheeky, stay relaxed in a wide-open opening ("play your style"), answer Yes, No or It depends first when asked whether a group can be killed or saved, give the whole-board picture first when asked about the position.
- Pitch it at the student's level and style. Say each thing once.
- The draft is Kiai's own checked answer. Write in Kiai's voice: the draft's plain, exact sentences in the draft's order, only clearer, better connected and better reasoned. Keep its facts and its [[v1]] links.
- No chat habits: no greeting, no praise for the question, no "Certainly" or "Let's dive in", no closing offer or recap, no headings, no bullet lists unless the draft has them, no dashes between clauses, and an emoji only where the draft has one. Never name yourself or any AI.
- Diagrams are textbook positions checked by KataGo; show one by writing its id, like [[d1]].`;

export const KAMI_CONCEPT_SYSTEM = `You are Kami, a Go (baduk) teacher. Below is a checked library entry about one Go concept and the student's question.
Explain the idea more deeply for the student, in plain language, in two to four short paragraphs.
Rules:
- Use only the ideas in the entry. Do not invent positions, moves or numbers.
- Never write board coordinates (like D4 or Q16).
- Answer the student's question first, then go deeper.`;

export type KamiWriteKind = 'explain' | 'concept';

export interface KamiWriteRequest {
  task: 'kami-write';
  kind?: KamiWriteKind;
  /** buildLmPrompt(explanation) for 'explain'; the library entry and question for 'concept'. */
  prompt: string;
}

export interface KamiWriteResponse {
  text: string;
  model?: string;
}

const MAX_PROMPT = 14_000;

export function validKamiWrite(x: unknown): x is KamiWriteRequest {
  const r = x as KamiWriteRequest | null;
  return (
    !!r &&
    r.task === 'kami-write' &&
    typeof r.prompt === 'string' &&
    r.prompt.trim().length > 0 &&
    r.prompt.length <= MAX_PROMPT &&
    (r.kind === undefined || r.kind === 'explain' || r.kind === 'concept')
  );
}

/** Board coordinates like D4, q16 or T19 (GTP letters skip I). */
export const COORD_RE = /\b[A-HJ-Ta-hj-t](?:1[0-9]|[1-9])\b/;

export const hasCoordinates = (text: string) => COORD_RE.test(text);

type Generate = (prompt: { system: string; user: string; maxOutputTokens?: number; text?: boolean; thinking?: 'minimal' | 'low' }) => Promise<{
  ok: boolean;
  text?: string;
  model?: string;
  errors: string[];
}>;

/** One model call, plain text out. Errors come back as the same 502 shape the other tasks use. */
export async function handleKamiWrite(raw: unknown, generate: Generate): Promise<LlmHttpResult> {
  if (!validKamiWrite(raw)) return { status: 400, body: { error: 'invalid request' } };
  const system = raw.kind === 'concept' ? KAMI_CONCEPT_SYSTEM : KAMI_WRITE_SYSTEM;
  // A rewrite of checked facts, not a search: minimal thinking is the fastest first word, and
  // the answer is a few short paragraphs (concept: two to four), well inside these caps.
  const r = await generate({ system, user: raw.prompt, maxOutputTokens: raw.kind === 'concept' ? 1024 : 2048, text: true, thinking: 'minimal' });
  if (!r.ok || !r.text?.trim()) {
    const quota = r.errors.some((e) => /HTTP 429/.test(e) && /quota|per day|per minute|rate/i.test(e));
    const overloaded = r.errors.some((e) => /HTTP (429|503)/.test(e));
    return {
      status: 502,
      body: {
        error: quota ? 'The free Gemini quota is used up for the moment.' : overloaded ? 'Gemini is overloaded right now.' : 'The Gemini call failed.',
        details: r.errors,
      },
    };
  }
  const body: KamiWriteResponse = { text: r.text.trim(), model: r.model };
  return { status: 200, body };
}
