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

export const KAMI_WRITE_SYSTEM = `You are Kami, a Go (baduk) teacher. Turn the checked facts below into a clear, deep explanation for the student.
Rules:
- Use only moves, coordinates and numbers that appear in the facts, concepts or variations. Never add your own.
- Point to variations by writing their id in double brackets, like [[v1]]; the student can hover them to see the moves on the board.
- Explain why: the ideas behind the numbers (shape, weak groups, sente and gote, territory against influence, what happens later).
- Start with a direct answer in one or two sentences, then go deeper. Plain language, pitched at the student's level.`;

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

const MAX_PROMPT = 12_000;

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

type Generate = (prompt: { system: string; user: string; maxOutputTokens?: number; text?: boolean }) => Promise<{
  ok: boolean;
  text?: string;
  model?: string;
  errors: string[];
}>;

/** One model call, plain text out. Errors come back as the same 502 shape the other tasks use. */
export async function handleKamiWrite(raw: unknown, generate: Generate): Promise<LlmHttpResult> {
  if (!validKamiWrite(raw)) return { status: 400, body: { error: 'invalid request' } };
  const system = raw.kind === 'concept' ? KAMI_CONCEPT_SYSTEM : KAMI_WRITE_SYSTEM;
  const r = await generate({ system, user: raw.prompt, maxOutputTokens: 2048, text: true });
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
