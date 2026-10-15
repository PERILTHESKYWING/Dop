/**
 * Kami's concept library: answers to concept questions ("what is miai?", "when is thickness
 * worth more than territory?") with real example positions checked by KataGo. Used by the
 * Kami site, and by scripts/coachlm/factory.ts to make concept training tasks.
 *
 * STUB: thread "coach/concept-library" fills CONCEPTS and improves findConcepts. Keep the
 * exported names and shapes.
 */
import type { Move } from '../../go/types';
import type { ExplainPosition } from '../explain/types';

export type ConceptLevel = 'beginner' | 'intermediate' | 'advanced';

export interface ConceptExample {
  title: string;
  position: ExplainPosition;
  /** The move or line that shows the idea, from `position`. */
  line: Move[];
  /** One or two sentences; any number in it comes from KataGo (scripts/concept-examples.ts). */
  note: string;
  /** Where the position came from: 'problem bank', 'pro game: <players, year>', 'opening book'. */
  source: string;
}

export interface ConceptEntry {
  /** Stable id, kebab-case; ids that match ConceptId in explain/types.ts mean the same idea. */
  id: string;
  name: string;
  /** Other names people type: 'mutual alternatives', '見合い', 'miai points'. */
  aliases: string[];
  level: ConceptLevel;
  /** One-sentence answer. */
  short: string;
  /** The deep explanation, in sections. */
  body: { title: string; text: string }[];
  /** Common misunderstandings. */
  mistakes: string[];
  /** Ids of related concepts. */
  related: string[];
  examples: ConceptExample[];
}

export const CONCEPTS: ConceptEntry[] = [];

/** Concepts a question is about, best match first (empty when it names none). */
export function findConcepts(text: string): ConceptEntry[] {
  const t = text.toLowerCase();
  return CONCEPTS.filter((c) => [c.name, c.id, ...c.aliases].some((n) => t.includes(n.toLowerCase())));
}

export function conceptById(id: string): ConceptEntry | undefined {
  return CONCEPTS.find((c) => c.id === id);
}
