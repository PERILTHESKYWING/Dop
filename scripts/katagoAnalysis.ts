/**
 * Native KataGo (the `katago analysis` JSON engine) for build-time scripts. The problem bank
 * (scripts/problem-bank.ts) needs thousands of searched positions; the browser's WASM build
 * manages about 6 visits a second under Node, native KataGo about 160 on 4 CPU cores, so the
 * scripts use the official Linux binary (eigen/AVX2 build) with the same bundled network.
 *
 * Every value is reported from Black's perspective (reportAnalysisWinratesAs = BLACK):
 * winrate, scoreLead and ownership (+1 = Black's).
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

export interface KgMoveInfo {
  move: string;
  visits: number;
  winrate: number;
  scoreLead: number;
  prior: number;
  order: number;
  pv: string[];
}

export interface KgResult {
  id: string;
  turnNumber: number;
  moveInfos: KgMoveInfo[];
  rootInfo: { winrate: number; scoreLead: number; visits: number; currentPlayer: 'B' | 'W' };
  ownership?: number[];
  policy?: number[];
}

export interface KgQuery {
  /** [color, gtp] pairs. */
  initialStones?: [string, string][];
  moves?: [string, string][];
  initialPlayer?: 'B' | 'W';
  komi: number;
  rules?: string;
  boardXSize?: number;
  boardYSize?: number;
  maxVisits: number;
  includeOwnership?: boolean;
  includePolicy?: boolean;
  analyzeTurns?: number[];
  /** Search only these moves at the root (KataGo's allowMoves). */
  allowMoves?: { player: 'B' | 'W'; moves: string[]; untilDepth: number }[];
}

export interface KataGo {
  query(q: KgQuery): Promise<KgResult>;
  /** One result per analysed turn. */
  queryTurns(q: KgQuery & { analyzeTurns: number[] }): Promise<KgResult[]>;
  close(): Promise<void>;
  /** Visits searched so far (for speed reports). */
  visits(): number;
}

export interface KataGoOptions {
  binary: string;
  model: string;
  /** Queries searched at once (one search thread each). */
  threads?: number;
  logDir?: string;
  /** Evaluate each position under one symmetry, no noise (raw network output at one visit). */
  oneSymmetry?: boolean;
  /** Extra config lines. */
  extra?: string[];
}

export function startKataGo(opts: KataGoOptions): KataGo {
  const dir = mkdtempSync(path.join(tmpdir(), 'kg-'));
  const threads = opts.threads ?? 4;
  const cfg = path.join(dir, 'analysis.cfg');
  writeFileSync(
    cfg,
    [
      `logDir = ${opts.logDir ?? path.join(dir, 'logs')}`,
      `numAnalysisThreads = ${threads}`,
      'numSearchThreadsPerAnalysisThread = 1',
      `nnMaxBatchSize = ${Math.max(8, threads * 2)}`,
      'nnCacheSizePowerOfTwo = 21',
      'nnMutexPoolSizePowerOfTwo = 17',
      'numNNServerThreadsPerModel = 1',
      `numEigenThreadsPerModel = ${threads}`,
      'reportAnalysisWinratesAs = BLACK',
      // Tsumego and exact problems: no randomness at the root.
      'wideRootNoise = 0.0',
      'rootPolicyTemperature = 1.0',
      ...(opts.oneSymmetry ? ['rootNumSymmetriesToSample = 1'] : []),
      ...(opts.extra ?? []),
      '',
    ].join('\n'),
  );
  const proc: ChildProcessWithoutNullStreams = spawn(opts.binary, ['analysis', '-config', cfg, '-model', opts.model, '-quit-without-waiting'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  proc.stderr.on('data', (d) => {
    stderr = (stderr + d.toString()).slice(-4000);
  });
  const pending = new Map<string, { want: number; got: KgResult[]; resolve: (r: KgResult[]) => void; reject: (e: Error) => void }>();
  let seq = 0;
  let visits = 0;
  let dead: Error | null = null;
  createInterface({ input: proc.stdout }).on('line', (line) => {
    let j: KgResult & { error?: string; warning?: string; field?: string };
    try {
      j = JSON.parse(line);
    } catch {
      return;
    }
    const p = pending.get(j.id);
    if (!p) return;
    if (j.error) {
      pending.delete(j.id);
      p.reject(new Error(`katago: ${j.error}${j.field ? ` (${j.field})` : ''}`));
      return;
    }
    if (j.warning) return;
    visits += j.rootInfo?.visits ?? 0;
    p.got.push(j);
    if (p.got.length >= p.want) {
      pending.delete(j.id);
      p.resolve(p.got.sort((a, b) => a.turnNumber - b.turnNumber));
    }
  });
  proc.on('exit', (code) => {
    dead = new Error(`katago exited (${code}): ${stderr.slice(-800)}`);
    for (const p of pending.values()) p.reject(dead);
    pending.clear();
  });

  const send = (q: KgQuery, turns: number): Promise<KgResult[]> => {
    if (dead) return Promise.reject(dead);
    const id = `q${++seq}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { want: turns, got: [], resolve, reject });
      proc.stdin.write(JSON.stringify({ rules: 'chinese', boardXSize: 19, boardYSize: 19, ...q, id }) + '\n');
    });
  };

  return {
    query: async (q) => (await send(q, 1))[0],
    queryTurns: (q) => send(q, q.analyzeTurns.length),
    visits: () => visits,
    close: async () => {
      proc.stdin.end();
      await new Promise((r) => proc.once('exit', r));
    },
  };
}
