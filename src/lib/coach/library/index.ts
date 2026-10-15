/**
 * Kami's concept library: answers to concept questions ("what is miai?", "when is thickness
 * worth more than territory?") with real example positions checked by KataGo. Used by the
 * Kami site, and by scripts/coachlm/factory.ts to make concept training tasks.
 *
 * WIP: thread "coach/concept-library" fills CONCEPTS and improves findConcepts. Keep the
 * exported names and shapes.
 */
import type { ConceptEntry } from './types';

export type { ConceptEntry, ConceptExample, ConceptLevel } from './types';

export const CONCEPTS: ConceptEntry[] = [];

/** Concepts a question is about, best match first (empty when it names none). */
export function findConcepts(text: string): ConceptEntry[] {
  const t = text.toLowerCase();
  return CONCEPTS.filter((c) => [c.name, c.id, ...c.aliases].some((n) => t.includes(n.toLowerCase())));
}

export function conceptById(id: string): ConceptEntry | undefined {
  return CONCEPTS.find((c) => c.id === id);
}
