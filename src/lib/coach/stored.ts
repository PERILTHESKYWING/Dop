import type { Loc } from '../go/types';
import type { Candidate } from '../types';

/** Stored candidates with values, most visits first (as the review panel lists them). */
export function fromStoredCandidates(cands: Candidate[] | undefined): { loc: Loc; winrate: number; scoreLead: number; visits: number }[] {
  return (cands ?? [])
    .filter((c) => c.winrate !== undefined && c.scoreLead !== undefined)
    .map((c) => ({ loc: c.loc, winrate: c.winrate!, scoreLead: c.scoreLead!, visits: c.visits ?? 0 }))
    .sort((a, b) => b.visits - a.visits || b.winrate - a.winrate);
}
