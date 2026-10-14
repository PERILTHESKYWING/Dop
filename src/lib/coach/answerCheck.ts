/**
 * Checks a written answer (Gemini's, Kami's own model's, or a training sample) against the
 * explanation it was written from. Shared by the Kami site (Myoshu falls back to the engine's
 * own text when an answer fails), scripts/coachlm/verify.ts and the training kit's scores.
 *
 * STUB: thread "coach/lm-factory" replaces the body. Until then it throws, and callers must
 * treat a throw as "unchecked" and fall back to the engine's text.
 */
import type { Explanation } from './explain/types';

export interface AnswerScore {
  /** 0–1: share of coordinates, numbers and [[vN]] refs that exist in the explanation. 1 = nothing invented. */
  truth: number;
  /** 0–1: share of the key facts, concepts and variations the answer uses. */
  coverage: number;
  /** 0–1: how far it goes past restating numbers (why, consequences, concepts), by simple checkable signals. */
  depth: number;
  /** The coordinates, numbers or refs that were not in the explanation. */
  unsupported: string[];
  /** truth === 1 and the answer is usable. */
  pass: boolean;
}

export function checkAnswer(_ex: Explanation, _text: string): AnswerScore {
  throw new Error('checkAnswer is not built yet');
}
