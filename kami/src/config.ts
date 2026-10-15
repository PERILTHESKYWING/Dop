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
