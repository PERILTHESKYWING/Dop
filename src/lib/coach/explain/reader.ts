/**
 * The planner's way to the engine: every read goes through here, so the budget (reads and
 * wall clock), the abort signal and the "thinking" steps are enforced in one place.
 */
import type { Budget, EngineRead, ExplainPosition, Prober, ThoughtStep } from './types';

/** Below this much time left a read is not worth starting. */
export const MIN_READ_MS = 120;

export interface ReaderOptions {
  signal?: AbortSignal;
  onThought?: (t: ThoughtStep) => void;
  /** Clock, for tests. */
  now?: () => number;
}

export function abortError(signal?: AbortSignal): unknown {
  if (signal?.reason !== undefined) return signal.reason;
  const e = new Error('The explanation was stopped.');
  e.name = 'AbortError';
  return e;
}

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class Reader {
  reads = 0;
  visits = 0;
  readonly thoughts: ThoughtStep[] = [];
  readonly t0: number;
  readonly deadline: number;
  private lastMs = 0;
  private lastVisits = 0;
  private readonly now: () => number;

  constructor(
    private readonly prober: Prober,
    readonly budget: Budget,
    private readonly opts: ReaderOptions = {},
  ) {
    this.now = opts.now ?? clock;
    this.t0 = this.now();
    this.deadline = this.t0 + budget.maxMs;
  }

  elapsed(): number {
    return this.now() - this.t0;
  }

  timeLeft(): number {
    return this.deadline - this.now();
  }

  /** Reads still allowed by the budget (0 when the time is gone). */
  readsLeft(): number {
    if (this.timeLeft() < MIN_READ_MS) return 0;
    return Math.max(0, this.budget.reads - this.reads);
  }

  checkAbort(): void {
    if (this.opts.signal?.aborted) throw abortError(this.opts.signal);
  }

  /**
   * One engine read, or null when the budget is spent or the engine gave nothing.
   * The read gets the share of the time left that its visits are of `plannedVisits`, the
   * visits of every read still planned (this one included). By default every read left in
   * the budget is assumed to be a line read.
   */
  async read(pos: ExplainPosition, visits: number, plannedVisits?: number): Promise<EngineRead | null> {
    this.checkAbort();
    const left = this.readsLeft();
    if (left <= 0) return null;
    const planned = Math.max(visits, plannedVisits ?? visits + (left - 1) * (this.budget.lineVisits || this.budget.visits));
    const maxMs = Math.max(MIN_READ_MS, Math.floor((this.timeLeft() * visits) / planned));
    const t = this.now();
    const signal = this.opts.signal;
    let onAbort: (() => void) | undefined;
    const aborted = signal
      ? new Promise<never>((_, reject) => {
          onAbort = () => reject(abortError(signal));
          signal.addEventListener('abort', onAbort, { once: true });
        })
      : null;
    let r: EngineRead | null;
    try {
      const p = this.prober.read(pos, { visits: Math.max(1, Math.round(visits)), maxMs });
      r = aborted ? await Promise.race([p, aborted]) : await p;
    } finally {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    }
    this.checkAbort();
    this.reads++;
    this.lastMs = Math.round(this.now() - t);
    this.lastVisits = r?.visits ?? 0;
    this.visits += this.lastVisits;
    return r;
  }

  /** A thinking step for the read just made (or, with `noRead`, for a comparison step). */
  think(text: string, variation?: string, noRead = false): void {
    const step: ThoughtStep = { text, ms: noRead ? 0 : this.lastMs, visits: noRead ? 0 : this.lastVisits };
    if (variation) step.variation = variation;
    this.thoughts.push(step);
    this.opts.onThought?.(step);
  }
}
