/**
 * Loads and runs the DopNet student network (scripts/student/README.md) on the WebAssembly
 * runtime built from tools/student/dopnet.c. Works in a Web Worker and in Node: it only
 * needs the two files' bytes and `WebAssembly.instantiate`.
 *
 *   const rt = await DopnetRuntime.create(wasmBytes, dopnetBytes);
 *   const out = rt.evaluate(encodeBoard(board, recent), toPlay, komi);
 *
 * The runtime keeps the stem (first layer) of the last few boards it saw and derives a new
 * board's stem from the nearest one, so evaluating successive positions of a game on one
 * runtime is cheaper than unrelated positions. Not thread-safe: one runtime per worker.
 */

export interface DopnetTensor {
  shape: number[];
  dtype: 'f32' | 't2';
  offset: number;
  bytes: number;
}

export interface DopnetHeader {
  format: 1;
  name: string;
  size: 19;
  C: number;
  N: number;
  E: number;
  G: number[];
  policyC: number;
  valueC: number;
  exitValueC: number;
  exitThreshold: number;
  planes: 13;
  meta: Record<string, unknown>;
  tensors: Record<string, DopnetTensor>;
}

export interface StudentOutput {
  /** 362 logits, pass last, for the side to move (a fresh copy, safe to keep). */
  policyLogits: Float32Array;
  /** sigmoid -> the side to move's win rate. */
  winLogit: number;
  /** Points for the side to move (20 * the lead output). */
  lead: number;
  /** 361 pre-tanh ownership values for the side to move; only when asked and the full trunk ran. */
  ownership: Float32Array | null;
  /** Answered by the exit heads (the rest of the trunk was skipped). */
  exited: boolean;
  /** sigmoid(error logit) from the exit heads, 0..1 (NaN for a net without an exit point). */
  exitError: number;
}

export interface EvaluateOptions {
  ownership?: boolean;
  allowExit?: boolean;
  exitThreshold?: number;
}

const POINTS = 361;

/** Tensor table order shared with dopnet.c (enum T_*): name, shape, dtype. */
function tensorList(h: DopnetHeader): [string, number[], 'f32' | 't2'][] {
  const { C, policyC: P, valueC: V, exitValueC: EV } = h;
  const list: [string, number[], 'f32' | 't2'][] = [
    ['stem.w', [C, 13, 9, 9], 'f32'],
    ['stem.b', [C], 'f32'],
    ['stem.komi', [C], 'f32'],
    ['exit.policy.w', [C], 'f32'],
    ['exit.policy.b', [1], 'f32'],
    ['exit.pass.w', [2 * C], 'f32'],
    ['exit.pass.b', [1], 'f32'],
    ['exit.v1.w', [EV, 2 * C], 'f32'],
    ['exit.v1.b', [EV], 'f32'],
    ['exit.v2.w', [3, EV], 'f32'],
    ['exit.v2.b', [3], 'f32'],
    ['head.p1.w', [P, C], 'f32'],
    ['head.p1.b', [P], 'f32'],
    ['head.pg.w', [P, 2 * C], 'f32'],
    ['head.p2.w', [P], 'f32'],
    ['head.p2.b', [1], 'f32'],
    ['head.pass.w', [2 * C], 'f32'],
    ['head.pass.b', [1], 'f32'],
    ['head.v1.w', [V, 2 * C], 'f32'],
    ['head.v1.b', [V], 'f32'],
    ['head.v2.w', [2, V], 'f32'],
    ['head.v2.b', [2], 'f32'],
    ['head.own.w', [C], 'f32'],
    ['head.own.b', [1], 'f32'],
  ];
  for (let i = 1; i <= h.N; i++) {
    list.push(
      [`block${i}.conv1`, [C, C, 3, 3], 't2'],
      [`block${i}.s1`, [C], 'f32'],
      [`block${i}.b1`, [C], 'f32'],
      [`block${i}.conv2`, [C, C, 3, 3], 't2'],
      [`block${i}.s2`, [C], 'f32'],
      [`block${i}.b2`, [C], 'f32'],
    );
    if (h.G.includes(i)) list.push([`block${i}.gpool.w`, [C, 2 * C], 'f32'], [`block${i}.gpool.b`, [C], 'f32']);
    else list.push(['', [], 'f32'], ['', [], 'f32']); // no global pooling: null slots
  }
  return list;
}

function asBytes(b: ArrayBuffer | Uint8Array): Uint8Array {
  return ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b);
}

const isInt = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min;

/** Splits a .dopnet file into its JSON header and the tensor blob (a view, not a copy), and checks both. */
export function parseDopnet(bytes: ArrayBuffer | Uint8Array): { header: DopnetHeader; blob: Uint8Array } {
  const u8 = asBytes(bytes);
  if (u8.length < 12) throw new Error('dopnet: file too short');
  if (u8[0] !== 0x44 || u8[1] !== 0x4f || u8[2] !== 0x50 || u8[3] !== 0x4e) throw new Error('dopnet: bad magic (not a .dopnet file)');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const version = dv.getUint32(4, true);
  if (version !== 1) throw new Error(`dopnet: unsupported version ${version}`);
  const headerBytes = dv.getUint32(8, true);
  if (12 + headerBytes > u8.length) throw new Error('dopnet: truncated header');
  let header: DopnetHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(u8.subarray(12, 12 + headerBytes))) as DopnetHeader;
  } catch {
    throw new Error('dopnet: header is not valid JSON');
  }
  const blob = u8.subarray(12 + headerBytes);
  const h = header;
  if (h.format !== 1) throw new Error(`dopnet: unsupported format ${String(h.format)}`);
  if (h.size !== 19 || h.planes !== 13) throw new Error('dopnet: only 19x19 networks with 13 input planes are supported');
  if (!isInt(h.C, 4) || h.C % 4 !== 0 || h.C > 1024) throw new Error(`dopnet: C must be a multiple of 4 (got ${String(h.C)})`);
  if (!isInt(h.N, 1) || h.N > 64 || !isInt(h.E) || !isInt(h.policyC, 1) || !isInt(h.valueC, 1) || !isInt(h.exitValueC, 1))
    throw new Error('dopnet: bad network dimensions');
  if (!Array.isArray(h.G) || !h.G.every((g) => isInt(g, 1) && g <= h.N)) throw new Error('dopnet: bad global pooling block list');
  if (typeof h.exitThreshold !== 'number') throw new Error('dopnet: missing exitThreshold');
  if (!h.tensors || typeof h.tensors !== 'object') throw new Error('dopnet: missing tensor index');
  for (const [name, shape, dtype] of tensorList(h)) {
    if (!name) continue;
    const t = h.tensors[name];
    if (!t) throw new Error(`dopnet: missing tensor ${name}`);
    if (t.dtype !== dtype) throw new Error(`dopnet: ${name} should be ${dtype}, is ${t.dtype}`);
    if (!Array.isArray(t.shape) || t.shape.join(',') !== shape.join(','))
      throw new Error(`dopnet: ${name} has shape [${String(t.shape)}], expected [${shape.join(',')}]`);
    const count = shape.reduce((a, b) => a * b, 1);
    const want = dtype === 'f32' ? count * 4 : Math.ceil(count / 4);
    if (t.bytes !== want) throw new Error(`dopnet: ${name} has ${t.bytes} bytes, expected ${want}`);
    if (!isInt(t.offset) || t.offset % 4 !== 0 || t.offset + t.bytes > blob.length)
      throw new Error(`dopnet: ${name} lies outside the file`);
  }
  return { header, blob };
}

interface Exports {
  memory: WebAssembly.Memory;
  dn_alloc(n: number): number;
  dn_load(c: number, n: number, e: number, pc: number, vc: number, evc: number, table: number): number;
  dn_board(): number;
  dn_out_exit(): number;
  dn_out_final(): number;
  dn_eval(toPlay: number, komi: number): number;
  dn_finish(own: number): void;
  dn_stem(toPlay: number): void;
  dn_set_cache(on: number): void;
  dn_stats(which: number): number;
}

const LOAD_ERRORS: Record<number, string> = {
  [-1]: 'bad network configuration',
  [-2]: 'out of memory',
  [-3]: 'missing tensor',
  [-4]: 'bad ternary weight code',
};

export class DopnetRuntime {
  readonly header: DopnetHeader;
  private readonly ex: Exports;
  private readonly boardPtr: number;
  private readonly exitPtr: number;
  private readonly finalPtr: number;
  private f32: Float32Array;
  private u8: Uint8Array;
  private evals = 0;
  private exits = 0;

  private constructor(header: DopnetHeader, ex: Exports) {
    this.header = header;
    this.ex = ex;
    this.boardPtr = ex.dn_board();
    this.exitPtr = ex.dn_out_exit() >> 2;
    this.finalPtr = ex.dn_out_final() >> 2;
    this.f32 = new Float32Array(ex.memory.buffer);
    this.u8 = new Uint8Array(ex.memory.buffer);
  }

  /** wasm: public/student/dopnet.wasm; net: a .dopnet file. */
  static async create(wasm: ArrayBuffer | Uint8Array, net: ArrayBuffer | Uint8Array): Promise<DopnetRuntime> {
    const { header, blob } = parseDopnet(net);
    const { instance } = await WebAssembly.instantiate(asBytes(wasm) as Uint8Array<ArrayBuffer>, {});
    const ex = instance.exports as unknown as Exports;
    const blobPtr = ex.dn_alloc(blob.length);
    if (!blobPtr) throw new Error('dopnet: out of memory');
    new Uint8Array(ex.memory.buffer, blobPtr, blob.length).set(blob);
    const list = tensorList(header);
    const tablePtr = ex.dn_alloc(list.length * 4);
    if (!tablePtr) throw new Error('dopnet: out of memory');
    const table = new Uint32Array(ex.memory.buffer, tablePtr, list.length);
    list.forEach(([name], i) => {
      table[i] = name ? blobPtr + header.tensors[name].offset : 0;
    });
    const rc = ex.dn_load(header.C, header.N, header.E, header.policyC, header.valueC, header.exitValueC, tablePtr);
    if (rc !== 0) throw new Error(`dopnet: load failed: ${LOAD_ERRORS[rc] ?? rc}`);
    return new DopnetRuntime(header, ex);
  }

  private views(): void {
    if (this.f32.buffer !== this.ex.memory.buffer) {
      this.f32 = new Float32Array(this.ex.memory.buffer);
      this.u8 = new Uint8Array(this.ex.memory.buffer);
    }
  }

  private setBoard(board: Uint8Array): void {
    if (board.length !== POINTS) throw new Error(`dopnet: a board is ${POINTS} bytes (got ${board.length})`);
    this.views();
    this.u8.set(board, this.boardPtr);
  }

  /** board: 361 board bytes (README); exitThreshold defaults to header.exitThreshold; allowExit defaults to true. */
  evaluate(board: Uint8Array, toPlay: 1 | 2, komi: number, opts: EvaluateOptions = {}): StudentOutput {
    if (toPlay !== 1 && toPlay !== 2) throw new Error(`dopnet: toPlay must be 1 or 2 (got ${String(toPlay)})`);
    this.setBoard(board);
    const hasExit = this.ex.dn_eval(toPlay, komi) !== 0;
    this.evals++;
    const f = this.f32;
    let exitError = NaN;
    if (hasExit) {
      const o = this.exitPtr;
      exitError = 1 / (1 + Math.exp(-f[o + 364]));
      const thr = opts.exitThreshold ?? this.header.exitThreshold;
      if ((opts.allowExit ?? true) && (thr >= 1 || exitError < thr)) {
        this.exits++;
        return { policyLogits: f.slice(o, o + 362), winLogit: f[o + 362], lead: 20 * f[o + 363], ownership: null, exited: true, exitError };
      }
    }
    const own = opts.ownership === true;
    this.ex.dn_finish(own ? 1 : 0);
    const o = this.finalPtr;
    return {
      policyLogits: f.slice(o, o + 362),
      winLogit: f[o + 362],
      lead: 20 * f[o + 363],
      ownership: own ? f.slice(o + 364, o + 364 + POINTS) : null,
      exited: false,
      exitError,
    };
  }

  /** evals: evaluate() calls; exits: answered by the exit heads; incremental: stems derived from
   * a cached board (or reused as is); full: stems computed from scratch. */
  stats(): { evals: number; exits: number; incremental: number; full: number } {
    return { evals: this.evals, exits: this.exits, incremental: this.ex.dn_stats(0), full: this.ex.dn_stats(1) };
  }

  /** Turns the stem cache (incremental first layer) on or off; off computes every stem from scratch. */
  setIncremental(on: boolean): void {
    this.ex.dn_set_cache(on ? 1 : 0);
  }

  /** Benchmark aid: runs only the stem for this board (cache rules apply). */
  stemOnly(board: Uint8Array, toPlay: 1 | 2): void {
    this.setBoard(board);
    this.ex.dn_stem(toPlay);
  }
}
