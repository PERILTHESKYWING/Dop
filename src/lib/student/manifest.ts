/**
 * public/student/manifest.json: the current student network and how it measured against
 * the built-in network (scripts/student/gate.ts). Written by the nightly AI training.
 */
export interface StudentGate {
  /** When it was measured, the reference (network and visits) and the positions. */
  at: string;
  reference: string;
  positions: number;
  /** Time per position given to each side's search. */
  ms: number;
  /** Best-move agreement with the reference, and mean win-rate error, at equal time. */
  student: { top1: number; winError: number; evalsPerSec: number };
  baseline: { name: string; top1: number; winError: number; evalsPerSec: number };
  /** Its own network evaluations a second over the baseline's. */
  speedup: number;
  passed: boolean;
}

export interface StudentManifest {
  version: 1;
  /** Network file in public/student/ and its name. */
  file: string;
  name: string;
  /** Use it by default (the gate passed). */
  enabled: boolean;
  gate?: StudentGate;
  /** Training so far: samples seen, records, teacher. */
  trained?: { samples: number; records: number; teacher: string; minds?: number; nights?: number };
  updated: string;
}
