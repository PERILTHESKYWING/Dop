/** Shapes of Kami's concept library (re-exported from ./index). */
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
  /**
   * Optional (added by the library thread, backwards compatible): the part of the board that
   * matters, [x0, y0, x1, y1] inclusive. Framed local diagrams fill the rest of the board with
   * settled stones (like Forge's tsumego frames), so a viewer should zoom to this window.
   */
  view?: [number, number, number, number];
}

/** An example as stored in examples.ts (generated); index.ts turns it into a ConceptExample. */
export interface ExampleRecord {
  concept: string;
  title: string;
  size: number;
  komi: number;
  toPlay: 'B' | 'W';
  /** Stones as SGF coordinates, concatenated ("ddpq..."), like public/problems/bank.json. */
  black: string;
  white: string;
  /** The line as SGF coordinates, alternating colours from toPlay. */
  line: string;
  note: string;
  source: string;
  view?: [number, number, number, number];
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

/** A concept as written in concepts/*.ts; examples are attached from examples.ts. */
export type ConceptText = Omit<ConceptEntry, 'examples'>;
