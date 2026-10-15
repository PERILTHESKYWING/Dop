/**
 * Kami Local (beta): Kami's own small writer model in the browser on WebGPU. transformers.js
 * comes from a CDN with a dynamic import, only when this writer is used, so it is never in
 * the site's bundle. Same prompt as Gemini (LM_SYSTEM + buildLmPrompt), same checkAnswer gate.
 */
import { LM_SYSTEM } from '../../../src/lib/coach/explain/prompt';
import { LOCAL_MODEL, TRANSFORMERS_URL } from '../config';

export const localConfigured = () => !!LOCAL_MODEL.repo;

export function localAvailable(): boolean {
  return localConfigured() && typeof navigator !== 'undefined' && 'gpu' in navigator;
}

type Generator = ((input: unknown, opts: Record<string, unknown>) => Promise<unknown>) & {
  tokenizer?: { apply_chat_template: (messages: unknown, opts: Record<string, unknown>) => unknown };
};
let generator: Promise<Generator> | null = null;

function load(onProgress?: (pct: number) => void): Promise<Generator> {
  generator ??= (async () => {
    const mod = (await import(/* @vite-ignore */ TRANSFORMERS_URL)) as { pipeline: (task: string, model: string, opts: Record<string, unknown>) => Promise<Generator> };
    return mod.pipeline('text-generation', LOCAL_MODEL.repo, {
      device: 'webgpu',
      dtype: LOCAL_MODEL.dtype,
      progress_callback: (p: { status?: string; progress?: number }) => {
        if (p.status === 'progress' && typeof p.progress === 'number') onProgress?.(p.progress);
      },
    });
  })();
  generator.catch(() => (generator = null));
  return generator;
}

/** Qwen3 "thinking" blocks, in case a model writes one anyway. */
const THINK = /<think>[\s\S]*?<\/think>\s*/g;

/**
 * The local model's answer for one writer prompt. The prompt is built exactly as in training
 * (scripts/coachlm/generate.py): the tokenizer's chat template with enable_thinking false,
 * which Qwen3 needs or it answers in its "thinking" format the model was never trained on.
 */
export async function localWrite(prompt: string, signal?: AbortSignal, onProgress?: (pct: number) => void): Promise<string> {
  const gen = await load(onProgress);
  if (signal?.aborted) throw new DOMException('stopped', 'AbortError');
  const messages = [
    { role: 'system', content: LM_SYSTEM },
    { role: 'user', content: prompt },
  ];
  const input = gen.tokenizer ? gen.tokenizer.apply_chat_template(messages, { tokenize: false, add_generation_prompt: true, enable_thinking: false }) : messages;
  const out = (await gen(input, { max_new_tokens: LOCAL_MODEL.maxNewTokens, do_sample: false, return_full_text: false })) as { generated_text: string | { role: string; content: string }[] }[];
  const g = out?.[0]?.generated_text;
  const raw = typeof g === 'string' ? g : Array.isArray(g) ? (g[g.length - 1]?.content ?? '') : '';
  const text = raw.replace(THINK, '').trim();
  if (!text) throw new Error('the local model gave no text');
  return text;
}
