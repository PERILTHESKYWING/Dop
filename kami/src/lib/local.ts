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

type Generator = (input: unknown, opts: Record<string, unknown>) => Promise<unknown>;
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

/** The local model's answer for one writer prompt. */
export async function localWrite(prompt: string, signal?: AbortSignal, onProgress?: (pct: number) => void): Promise<string> {
  const gen = await load(onProgress);
  if (signal?.aborted) throw new DOMException('stopped', 'AbortError');
  const out = (await gen(
    [
      { role: 'system', content: LM_SYSTEM },
      { role: 'user', content: prompt },
    ],
    { max_new_tokens: LOCAL_MODEL.maxNewTokens, do_sample: false, return_full_text: false },
  )) as { generated_text: string | { role: string; content: string }[] }[];
  const g = out?.[0]?.generated_text;
  const text = typeof g === 'string' ? g : Array.isArray(g) ? (g[g.length - 1]?.content ?? '') : '';
  if (!text.trim()) throw new Error('the local model gave no text');
  return text.trim();
}
