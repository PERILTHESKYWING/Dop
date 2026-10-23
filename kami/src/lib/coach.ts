/**
 * The answer pipeline (the explain engine, answer checks, the writer), loaded on its own so the
 * first screen does not parse it. App imports it at the first question, or earlier when the
 * browser is idle (loadCoach), so asking stays as quick as before.
 */
export { answerQuestion } from './answer';
export { explain } from '../../../src/lib/coach/explain';
export { checkAnswer } from '../../../src/lib/coach/answerCheck';
export { findConcepts } from '../../../src/lib/coach/library';
