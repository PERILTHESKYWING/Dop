import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DopnetRuntime, parseDopnet, type StudentOutput } from '../src/lib/student/runtime';

// The runtime (built by tools/student/build.sh) against PyTorch reference outputs of a
// random-weight network (scripts/student/export.py --random).
const file = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url));
const wasm = file('public/student/dopnet.wasm');
const net = file('tests/fixtures/student/random.dopnet');
interface Fixture {
  board: number[];
  toPlay: 1 | 2;
  komi: number;
  exitPolicy: number[];
  exitValue: number[];
  policy: number[];
  value: number[];
  own: number[];
}
const fixtures = (JSON.parse(file('tests/fixtures/student/random.json').toString('utf8')) as { positions: Fixture[] }).positions;

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Largest violation of |a - b| <= max(abs, rel * |b|), as a multiple of the allowance (<= 1 passes). */
function worst(a: ArrayLike<number>, b: ArrayLike<number>, abs: number, rel = 0): number {
  expect(a.length).toBe(b.length);
  let w = 0;
  for (let i = 0; i < b.length; i++) {
    const r = Math.abs(a[i] - b[i]) / Math.max(abs, rel * Math.abs(b[i]));
    w = Number.isNaN(r) ? Infinity : Math.max(w, r);
  }
  return w;
}

describe('DopNet runtime vs PyTorch', () => {
  it('full trunk matches policy, value and ownership', async () => {
    const rt = await DopnetRuntime.create(wasm, net);
    expect(rt.header.C).toBe(64);
    for (const p of fixtures) {
      const out = rt.evaluate(Uint8Array.from(p.board), p.toPlay, p.komi, { allowExit: false, ownership: true });
      expect(out.exited).toBe(false);
      expect(worst(out.policyLogits, p.policy, 2e-3, 1e-3)).toBeLessThanOrEqual(1);
      expect(worst([out.winLogit, out.lead / 20], p.value, 2e-3, 1e-3)).toBeLessThanOrEqual(1);
      expect(out.ownership).not.toBeNull();
      expect(worst(out.ownership!, p.own, 2e-3, 1e-3)).toBeLessThanOrEqual(1);
      // the exit heads still ran, so the confidence is reported
      expect(Math.abs(out.exitError - sigmoid(p.exitValue[2]))).toBeLessThan(1e-4);
    }
    expect(rt.stats()).toMatchObject({ evals: fixtures.length, exits: 0 });
  });

  it('exit path matches the exit heads', async () => {
    const rt = await DopnetRuntime.create(wasm, net);
    for (const p of fixtures) {
      const out = rt.evaluate(Uint8Array.from(p.board), p.toPlay, p.komi, { exitThreshold: 1, ownership: true });
      expect(out.exited).toBe(true);
      expect(out.ownership).toBeNull();
      expect(worst(out.policyLogits, p.exitPolicy, 2e-3, 1e-3)).toBeLessThanOrEqual(1);
      expect(worst([out.winLogit, out.lead / 20], p.exitValue.slice(0, 2), 2e-3, 1e-3)).toBeLessThanOrEqual(1);
      expect(Math.abs(out.exitError - sigmoid(p.exitValue[2]))).toBeLessThan(1e-4);
    }
    expect(rt.stats()).toMatchObject({ evals: fixtures.length, exits: fixtures.length });
  });

  it('exits exactly when sigmoid(error) is below the threshold', async () => {
    const rt = await DopnetRuntime.create(wasm, net);
    const p = fixtures[0];
    const board = Uint8Array.from(p.board);
    const err = sigmoid(p.exitValue[2]);
    expect(rt.evaluate(board, p.toPlay, p.komi, { exitThreshold: 0 }).exited).toBe(false);
    expect(rt.evaluate(board, p.toPlay, p.komi, { exitThreshold: err + 1e-3 }).exited).toBe(true);
    expect(rt.evaluate(board, p.toPlay, p.komi, { exitThreshold: err - 1e-3 }).exited).toBe(false);
    expect(rt.evaluate(board, p.toPlay, p.komi, { exitThreshold: 1, allowExit: false }).exited).toBe(false);
    // default: header.exitThreshold
    expect(rt.evaluate(board, p.toPlay, p.komi).exited).toBe(err < rt.header.exitThreshold);
  });

  it('returns fresh arrays', async () => {
    const rt = await DopnetRuntime.create(wasm, net);
    const [a, b] = fixtures;
    const first = rt.evaluate(Uint8Array.from(a.board), a.toPlay, a.komi, { allowExit: false, ownership: true });
    const keep = Float32Array.from(first.policyLogits);
    rt.evaluate(Uint8Array.from(b.board), b.toPlay, b.komi, { allowExit: false, ownership: true });
    expect(Array.from(first.policyLogits)).toEqual(Array.from(keep));
  });
});

describe('incremental stem', () => {
  /** Deterministic PRNG (mulberry32). */
  function rng(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** A chain of boards, each a few byte edits from the last (not legal Go, just inputs). */
  function chain(count: number) {
    const rand = rng(12345);
    const pick = (n: number) => Math.floor(rand() * n);
    const pointsWhere = (b: Uint8Array, f: (v: number) => boolean) => [...b.keys()].filter((i) => f(b[i]));
    let board = Uint8Array.from(fixtures[0].board);
    let toPlay: 1 | 2 = fixtures[0].toPlay;
    const out: { board: Uint8Array; toPlay: 1 | 2; komi: number; edits: string[] }[] = [];
    for (let k = 0; k < count; k++) {
      board = Uint8Array.from(board);
      const edits: string[] = [];
      const n = 1 + pick(3);
      for (let e = 0; e < n; e++) {
        const kind = pick(6);
        if (kind === 0) {
          // place a stone (colour, liberties)
          const empty = pointsWhere(board, (v) => (v & 3) === 0);
          const p = empty[pick(empty.length)];
          board[p] = (board[p] & ~0x1f) | (1 + pick(2)) | (pick(4) << 2);
          edits.push('place');
        } else if (kind === 1) {
          // remove a stone (keeps any recency mark)
          const stones = pointsWhere(board, (v) => (v & 3) !== 0);
          const p = stones[pick(stones.length)];
          board[p] &= ~0x0f;
          edits.push('remove');
        } else if (kind === 2) {
          // liberties of a few stones change
          const stones = pointsWhere(board, (v) => (v & 3) !== 0);
          for (let j = 0; j < 4; j++) {
            const p = stones[pick(stones.length)];
            board[p] = (board[p] & ~0x0c) | (pick(4) << 2);
          }
          edits.push('libs');
        } else if (kind === 3) {
          // the recency marks move
          for (let p = 0; p < 361; p++) board[p] &= ~0x60;
          for (let r = 1; r <= 3; r++) board[pick(361)] |= r << 5;
          edits.push('recency');
        } else if (kind === 4) {
          // ko point moves
          for (let p = 0; p < 361; p++) board[p] &= ~0x10;
          if (rand() < 0.7) board[pick(361)] |= 0x10;
          edits.push('ko');
        } else {
          toPlay = toPlay === 1 ? 2 : 1;
          edits.push('toPlay');
        }
      }
      out.push({ board, toPlay, komi: [7.5, 6.5, 0, -3][pick(4)], edits });
    }
    return out;
  }

  const compare = (a: StudentOutput, b: StudentOutput) => {
    expect(a.exited).toBe(b.exited);
    expect(worst(a.policyLogits, b.policyLogits, 1e-4)).toBeLessThanOrEqual(1);
    expect(worst([a.winLogit, a.lead / 20, a.exitError], [b.winLogit, b.lead / 20, b.exitError], 1e-4)).toBeLessThanOrEqual(1);
    if (b.ownership) expect(worst(a.ownership!, b.ownership, 1e-4)).toBeLessThanOrEqual(1);
  };

  it('matches evaluating each board from scratch', async () => {
    const boards = chain(80);
    // An unrelated board in the middle (from scratch again) and an exact repeat (taken as is).
    boards.splice(40, 0, { board: Uint8Array.from(fixtures[3].board), toPlay: fixtures[3].toPlay, komi: fixtures[3].komi, edits: ['jump'] });
    boards.splice(41, 0, { ...boards[38], edits: ['repeat'] });
    const rt = await DopnetRuntime.create(wasm, net);
    for (const [i, b] of boards.entries()) {
      const got = rt.evaluate(b.board, b.toPlay, b.komi, { allowExit: false, ownership: true });
      const fresh = await DopnetRuntime.create(wasm, net);
      const want = fresh.evaluate(b.board, b.toPlay, b.komi, { allowExit: false, ownership: true });
      expect(fresh.stats()).toMatchObject({ incremental: 0, full: 1 });
      try {
        compare(got, want);
      } catch (e) {
        throw new Error(`board ${i} (${b.edits.join(', ')}): ${(e as Error).message}`);
      }
    }
    const st = rt.stats();
    expect(st.evals).toBe(boards.length);
    expect(st.incremental + st.full).toBe(boards.length);
    expect(st.incremental).toBeGreaterThan(boards.length * 0.8);
    // the first board, the jump, and at least one refresh after MAX_CHAIN (32) chained updates
    expect(st.full).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('exit path and the cache switch agree with the full computation', async () => {
    const boards = chain(20);
    const rt = await DopnetRuntime.create(wasm, net);
    const ref = await DopnetRuntime.create(wasm, net);
    ref.setIncremental(false);
    for (const b of boards) {
      compare(rt.evaluate(b.board, b.toPlay, b.komi, { exitThreshold: 1 }), ref.evaluate(b.board, b.toPlay, b.komi, { exitThreshold: 1 }));
    }
    expect(ref.stats()).toMatchObject({ incremental: 0, full: boards.length });
    expect(rt.stats().incremental).toBeGreaterThan(0);
  });
});

describe('.dopnet parser', () => {
  it('reads the header', () => {
    const { header, blob } = parseDopnet(net);
    expect(header).toMatchObject({ format: 1, size: 19, planes: 13, C: 64, N: 6, E: 3, G: [2, 4, 6], policyC: 32, valueC: 64, exitValueC: 32 });
    expect(header.tensors['block1.conv1']).toMatchObject({ dtype: 't2', shape: [64, 64, 3, 3] });
    expect(blob.length).toBeGreaterThan(0);
  });

  it('rejects a bad magic', async () => {
    const bad = Uint8Array.from(net);
    bad[0] = 0x58; // "XOPN"
    expect(() => parseDopnet(bad)).toThrow(/magic/);
    await expect(DopnetRuntime.create(wasm, bad)).rejects.toThrow(/magic/);
  });

  it('rejects a bad version, a truncated file and a missing tensor', () => {
    const v2 = Uint8Array.from(net);
    new DataView(v2.buffer).setUint32(4, 2, true);
    expect(() => parseDopnet(v2)).toThrow(/version/);
    expect(() => parseDopnet(net.subarray(0, net.length - 1000))).toThrow(/outside the file/);
    const { header } = parseDopnet(net);
    delete (header.tensors as Record<string, unknown>)['head.own.w'];
    const json = new TextEncoder().encode(JSON.stringify(header));
    const padded = new Uint8Array(Math.ceil(json.length / 4) * 4).fill(0x20);
    padded.set(json);
    const blob = parseDopnet(net).blob;
    const f = new Uint8Array(12 + padded.length + blob.length);
    f.set(net.subarray(0, 4));
    new DataView(f.buffer).setUint32(4, 1, true);
    new DataView(f.buffer).setUint32(8, padded.length, true);
    f.set(padded, 12);
    f.set(blob, 12 + padded.length);
    expect(() => parseDopnet(f)).toThrow(/missing tensor head.own.w/);
  });
});
