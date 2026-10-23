/**
 * Kami site settings that change without code.
 *
 * Kami Local (beta) runs Kami's own small writer model in the browser (WebGPU, through
 * transformers.js loaded from a CDN only when picked). It stays hidden while `repo` is empty.
 * Set it to the Hugging Face repo the training kit's `export.py --upload` publishes:
 * '<your Hugging Face user>/kami-coach-web' (docs/handoff/kami-training.md), and redeploy.
 */
export const LOCAL_MODEL = {
  repo: '',
  /** Weight format in that repo (transformers.js dtype). */
  dtype: 'q4f16',
  maxNewTokens: 600,
} as const;

/** transformers.js, pinned. Loaded with a dynamic import only when Kami Local is used. */
export const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm';

/**
 * Where Kiai's account and sync calls go: Dop's /api/account (its Upstash store), called
 * cross-origin with no cookies. A URL, not a secret. `VITE_ACCOUNT_API` overrides it (for a
 * preview test: `VITE_ACCOUNT_API=/api/account npm run kami:build && npm run kami:preview`).
 * In dev, kami/vite.config.ts serves /api/account from memory. If the address is wrong, the
 * probe fails its shape check and no account UI shows (src/lib/account.ts).
 */
const viteEnv = (import.meta as unknown as { env?: Record<string, string | boolean | undefined> }).env ?? {};
export const ACCOUNT_API: string =
  (typeof viteEnv.VITE_ACCOUNT_API === 'string' && viteEnv.VITE_ACCOUNT_API) || (viteEnv.DEV ? '/api/account' : 'https://dop.vercel.app/api/account');
