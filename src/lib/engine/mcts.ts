import type { Board } from '../go/board';
import { PASS, type Color, type Loc, type Move, other } from '../go/types';
import { NNCache, positionHash } from './nncache';
import { processRawOutput, type NetEval, type RawNetOutput } from './parse';
import type { EngineBackend } from './types';

/**
 * Monte Carlo tree search over KataGo network evaluations, modelled on KataGo's own
 * search: PUCT selection with KataGo's exploration constants, first-play urgency
 * reduction, a utility that mixes winrate with a bounded score term, and values
 * averaged over every visit below a node. The tree persists between calls, so a
 * search can keep thinking (pondering) and follow the game move by move.
 *
 * The network runs in a worker (or in Node for scripts); the tree lives here.
 */

/** One position the search wants evaluated. */
export interface LeafRequest {
  size: number;
  komi: number;
  /** Every move from the start of the game (setup stones first), as kataeval replays them. */
  moves: Move[];
  toPlay: Color;
  board: Board;
  ownership: boolean;
  /** Average the network over this many board symmetries (the root, for accuracy). */
  symmetries?: number;
  /** Moves from the search's root to this position (0 = the root). */
  depth?: number;
}

/**
 * A stronger judge for a few positions near the root ("big brain at the top, small brain
 * below"): a bigger network on the GPU, the PC, or the opening book. It answers null when
 * it has nothing to say about a position. `policy` false: use only its value (the book
 * knows the moves it searched, not a full policy).
 */
export type AnchorSource = (req: LeafRequest) => Promise<{ eval: NetEval; policy: boolean } | null>;

/**
 * Evaluates positions for the search (several at once when the backend batches).
 * `batch`, when present, says how many leaves are worth sending per call right now.
 */
export type LeafEvaluator = ((leaves: LeafRequest[]) => Promise<NetEval[]>) & {
  batch?: () => number;
  rootSymmetries?: () => number;
  /** Calls worth having in flight at once (EngineBackend.pipeline); `batch` is spread over them. */
  pipeline?: () => number;
};

export interface RootPosition {
  size: number;
  komi: number;
  /** Engine moves up to the root (setup stones first). */
  moves: Move[];
  toPlay: Color;
  board: Board;
}

export interface SearchParams {
  cpuct: number;
  cpuctLog: number;
  cpuctBase: number;
  fpuRoot: number;
  fpu: number;
  /** Weights of the score terms in the utility (the winrate term has weight 1). */
  staticScore: number;
  dynamicScore: number;
  /** Leaves evaluated per network call; virtual loss spreads them over the tree. */
  batch: number;
  /** Candidate moves kept per node below the root. */
  maxChildren: number;
  maxDepth: number;
  /** Stop growing the tree past this many nodes (memory guard for long pondering). */
  maxNodes: number;
  /** Network symmetries averaged at the root (1 = KataGo's default single evaluation). */
  rootSymmetries: number;
  /** Leaves per network call grow as batchGrowth * sqrt(root visits), up to the engine's batch. */
  batchGrowth: number;
  /**
   * How hard leaves in flight push the next ones elsewhere (1 = a full loss each, KataGo's
   * default). Measured against native KataGo at 100 visits (public/engine/bench-positions.json),
   * a full virtual loss cost score accuracy (3.1 vs 2.0 points error) for 13% more speed; 0
   * matched the one-leaf-at-a-time search.
   */
  virtualLoss: number;
  /** Root moves (most visited first) the anchor source judges, besides the root itself. */
  anchorChildren: number;
  /**
   * How much of the anchor's correction carries into the small network's evaluations below
   * a root move (1 = all of it): the small network's error in a position tends to persist
   * in the positions that follow from it, so the measured gap is applied to all of them.
   * Half measured better than all of it (scripts/ai-eval.ts anchors, 30 positions against
   * b40: 43% vs 43% best moves found with b6 under b10, 37% vs 33% with b10 under b20).
   */
  anchorWeight: number;
  /**
   * Gumbel root search (Danihelka et al. 2022, "Policy improvement by planning with Gumbel")
   * for small budgets: the root considers the network's `gumbel` most likely moves, gives
   * them equal visits in rounds, keeps the better half after each round (sequential
   * halving), and picks by prior plus searched value instead of by visit count. Below the
   * root the search is unchanged. 0 = off (PUCT everywhere, KataGo's way).
   *
   * Off by default: measured with b10 on 120 positions against an 800-visit search
   * (scripts/search-eval.ts), 8 candidates gave up 0.3% less win rate per move at 32 visits
   * (95% interval 0.04-0.58%), no clear difference at 16, 64 or 128, and 0.3% more at 8.
   * Its root value is also further off (the halving spends visits on weaker moves).
   */
  gumbel: number;
  /** Gumbel root search only for runs with at most this many visits (bigger ones use PUCT). */
  gumbelMaxVisits: number;
  /**
   * KataGo's exploration scaled by how much the values under a node disagree
   * (cpuctUtilityStdevScale / Prior / PriorWeight in KataGo's search parameters): a node
   * whose visits all agree explores less, a sharp one (a fight, a ko) explores more. 0 = off.
   *
   * On (KataGo's 0.85): measured with b10 on 180 positions against native KataGo at 2000
   * visits (scripts/search-eval.ts refs --native), it found KataGo's best move more often at
   * every budget (32 visits 59.4% -> 65.6%, 64: 63.3 -> 67.8%, 256: 66.7 -> 71.1%) and gave
   * up fewer points (256 visits 0.39 -> 0.30), win rate given up about the same.
   */
  cpuctStdevScale: number;
  cpuctStdevPrior: number;
  cpuctStdevPriorWeight: number;
}

export const DEFAULT_SEARCH: SearchParams = {
  cpuct: 1.0,
  cpuctLog: 0.45,
  cpuctBase: 500,
  fpuRoot: 0.1,
  fpu: 0.2,
  staticScore: 0.1,
  dynamicScore: 0.3,
  batch: 1,
  maxChildren: 64,
  maxDepth: 80,
  maxNodes: 400_000,
  rootSymmetries: 1,
  batchGrowth: 2,
  virtualLoss: 0,
  anchorChildren: 6,
  anchorWeight: 0.5,
  gumbel: 0,
  gumbelMaxVisits: 0,
  cpuctStdevScale: 0.85,
  cpuctStdevPrior: 0.4,
  cpuctStdevPriorWeight: 2,
};

export interface SearchCandidate {
  loc: Loc;
  visits: number;
  /** Winrate and score lead for the side to move at the root after this move. */
  winrate: number;
  scoreLead: number;
  prior: number;
  /** Principal variation starting with this move. */
  pv: Loc[];
}

export interface SearchSnapshot {
  toPlay: Color;
  /** Visits at the root, including the root's own evaluation. */
  visits: number;
  /** The root's value averaged over the whole tree, Black's perspective. */
  bWin: number;
  bLead: number;
  /** Visited moves, most visits first. */
  candidates: SearchCandidate[];
  /** Root policy over size*size + 1 (pass last). */
  policy: Float32Array | null;
  /** Root ownership, Black positive (network output at the root). */
  ownership: Float32Array | null;
  nodes: number;
  evalsPerSec: number;
  elapsedMs: number;
  /** The run ended early because more visits could not change the best move. */
  settled?: boolean;
}

export interface RunOptions {
  /** Stop when the root has this many visits (counting visits kept from earlier runs). */
  visits: number;
  maxMs?: number;
  shouldStop?: () => boolean;
  onUpdate?: (s: SearchSnapshot) => void;
  updateMs?: number;
  /** Give this root move a share of the visits even if the search dislikes it (the played move). */
  forced?: Loc;
  forcedShare?: number;
  /** Also evaluate root ownership (one extra evaluation when the root came from a reused tree). */
  ownership?: boolean;
  /**
   * Stop as soon as the most-visited move can no longer change: its lead in visits over
   * the runner-up exceeds the visits left (KataGo's "futile visits" check). The answer is
   * the same as with the full budget; the time saved goes to the next position.
   */
  earlyStop?: boolean;
}

class SNode {
  /** Candidate moves by prior, highest first (PASS = -1), and their priors. */
  moves: Int16Array | null = null;
  priors: Float32Array | null = null;
  /** Children aligned with `moves`; created in prior order as the search reaches them. */
  kids: (SNode | undefined)[] = [];
  /** One past the highest index with a created child. */
  span = 0;
  visits = 0;
  inflight = 0;
  /** Sums of Black's winrate and score lead over every visit. */
  winSum = 0;
  leadSum = 0;
  /** Sum of the squared utility of every visit (for the spread of values under the node). */
  utilSqSum = 0;
  nnWin = 0.5;
  nnLead = 0;
  evaluated = false;
  /** Evaluated but never expanded: game over (two passes) or too deep. */
  leafOnly = false;
  /** Anchor state: 0 not asked, 1 asked, 2 judged (or nothing to say). */
  anchored = 0;
  /** The small network's own value here, before an anchor replaced it. */
  smallWin = 0;
  smallLead = 0;
  /** Correction (anchor minus small network) for every evaluation below this root move. */
  biasWin = 0;
  biasLead = 0;
  constructor(readonly move: Loc) {}
}

/** Sequential halving at the root for one run's budget (Gumbel root search). */
interface GumbelPlan {
  root: SNode;
  budget: number;
  /** Root move indices still in the running. */
  remaining: number[];
  /** Visits each remaining move gets before the next halving. */
  target: number;
  /** Visits per round. */
  roundBudget: number;
}

interface Leaf {
  path: SNode[];
  node: SNode;
  req: LeafRequest;
  leafOnly: boolean;
}

const sv = (x: number) => (2 / Math.PI) * Math.atan(x);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** More than the points of any board plus pass (19x19 + 1 = 362). */
const KEY_SPAN = 1024;

/**
 * The positive entries of a policy as sortable numbers, ascending: the float's bits times
 * KEY_SPAN plus (KEY_SPAN - 1 - point), so equal priors put the lower point last (first
 * when read from the end). Exact in a double (bits < 2^31).
 */
function sortKeys(policy: Float32Array): Float64Array {
  const bits = new Uint32Array(policy.buffer, policy.byteOffset, policy.length);
  const keys = new Float64Array(policy.length);
  let n = 0;
  for (let i = 0; i < policy.length; i++) if (policy[i] > 0) keys[n++] = bits[i] * KEY_SPAN + (KEY_SPAN - 1 - i);
  return keys.subarray(0, n).sort();
}

export class Search {
  readonly params: SearchParams;
  private evaluator: LeafEvaluator;
  private pos: RootPosition;
  private root = new SNode(PASS);
  private nodes = 1;
  private center = 0;
  private scoreScale = 38;
  private dynScale = 14.25;
  private rootPolicy: Float32Array | null = null;
  private rootOwnership: Float32Array | null = null;
  private running: Promise<SearchSnapshot> | null = null;
  private stopFlag = false;
  private evalCount = 0;
  private evalTime = 0;
  private callsOut = 0;
  private busySince = 0;
  private anchor: AnchorSource | null = null;
  private anchorsInFlight = 0;
  private plan: GumbelPlan | null = null;
  /** Positions the anchor source judged, and how many changed the small network's view. */
  anchorStats = { asked: 0, judged: 0 };

  constructor(evaluator: LeafEvaluator, pos: RootPosition, params: Partial<SearchParams> = {}) {
    this.params = { ...DEFAULT_SEARCH, rootSymmetries: evaluator.rootSymmetries?.() ?? 1, ...params };
    this.evaluator = evaluator;
    this.pos = pos;
    this.setScales(pos.size);
  }

  private setScales(size: number) {
    // KataGo scales its score utility by the board's side length.
    this.scoreScale = 2 * size;
    this.dynScale = 0.75 * size;
  }

  get position(): RootPosition {
    return this.pos;
  }

  /** Let a stronger judge correct the root and its main moves (see AnchorSource). */
  setAnchor(a: AnchorSource | null) {
    this.anchor = a;
  }

  get rootVisits() {
    return this.root.visits;
  }

  get isRunning() {
    return this.running !== null;
  }

  /**
   * Move the search to another position. When the position continues the current one
   * along moves the tree has already explored, that subtree (and its visits) is kept.
   * Returns true when the tree was reused.
   */
  setPosition(pos: RootPosition): boolean {
    if (this.running) throw new Error('stop the search before moving it');
    const reused = this.tryReuse(pos);
    this.pos = pos;
    this.plan = null;
    if (!reused) {
      this.root = new SNode(PASS);
      this.nodes = 1;
      this.rootOwnership = null;
      this.rootPolicy = null;
      this.setScales(pos.size);
    }
    return reused;
  }

  private tryReuse(pos: RootPosition): boolean {
    const cur = this.pos;
    if (pos.size !== cur.size || pos.komi !== cur.komi) return false;
    if (pos.moves.length < cur.moves.length) return false;
    for (let i = 0; i < cur.moves.length; i++) {
      if (pos.moves[i].loc !== cur.moves[i].loc || pos.moves[i].color !== cur.moves[i].color) return false;
    }
    const extra = pos.moves.slice(cur.moves.length);
    if (!extra.length) return pos.toPlay === cur.toPlay;
    let node = this.root;
    let pla = cur.toPlay;
    for (const m of extra) {
      if (m.color !== pla || !node.moves) return false;
      const i = node.moves.indexOf(m.loc);
      const kid = i >= 0 ? node.kids[i] : undefined;
      if (!kid || !kid.evaluated || kid.leafOnly) return false;
      node = kid;
      pla = other(pla);
    }
    if (pla !== pos.toPlay) return false;
    this.root = node;
    this.nodes = countNodes(node);
    this.rootOwnership = null;
    this.rootPolicy = null;
    return true;
  }

  /** Ask a running search to finish its current batch and return. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.stopFlag = true;
    try {
      await this.running;
    } catch {
      // the caller of run() handles errors
    }
  }

  run(opts: RunOptions): Promise<SearchSnapshot> {
    if (this.running) throw new Error('search already running');
    this.stopFlag = false;
    const p = this.loop(opts).finally(() => {
      this.running = null;
    });
    this.running = p;
    return p;
  }

  private async loop(opts: RunOptions): Promise<SearchSnapshot> {
    const t0 = now();
    let settled = false;
    let lastUpdate = t0;
    const updateMs = opts.updateMs ?? 250;
    let shown = this.root.visits >= 4;
    if (opts.ownership && this.root.evaluated && !this.rootOwnership) {
      const [ev] = await this.evaluate([this.rootRequest(true)]);
      this.rootOwnership = ev.ownership ?? null;
    }
    if (this.root.visits > 0) this.center = 0.8 * (this.root.leadSum / this.root.visits);
    // Several engine workers: keep a network call in flight on each, collecting the next
    // leaves while the others are evaluated, instead of waiting for every batch to return.
    const depth = Math.max(1, this.evaluator.pipeline?.() ?? 1);
    const pending = new Set<Promise<void>>();
    let failure: unknown = null;
    const dispatch = (leaves: Leaf[]) => {
      const p: Promise<void> = this.evaluate(leaves.map((l) => l.req))
        .then((evals) => {
          for (let i = 0; i < leaves.length; i++) this.apply(leaves[i], evals[i]);
          if (this.root.visits === 1) this.center = 0.8 * this.root.nnLead;
        })
        .catch((e) => {
          for (const l of leaves) for (const n of l.path) n.inflight--;
          failure ??= e;
        })
        .finally(() => pending.delete(p));
      pending.add(p);
    };
    try {
      while (!this.stopFlag && failure === null) {
        if (this.root.visits >= opts.visits) break;
        if (opts.maxMs !== undefined && now() - t0 >= opts.maxMs) break;
        if (opts.shouldStop?.()) break;
        if (this.nodes >= this.params.maxNodes) break;
        if (opts.earlyStop && !pending.size && this.futile(opts)) {
          settled = true;
          break;
        }
        while (pending.size < depth && this.root.visits + this.root.inflight < opts.visits) {
          const leaves = this.collect(opts, depth);
          if (!leaves.length) break;
          dispatch(leaves);
          if (!this.root.evaluated) break; // the root's own evaluation goes alone
        }
        if (pending.size) await Promise.race(pending);
        if (failure !== null) break;
        if (this.anchor) this.pumpAnchors();
        const t = now();
        // The first candidates of a new position show as soon as there are any, instead of
        // after a full update interval; later updates keep to the interval.
        const firstLook = !shown && this.root.visits >= 4;
        if (opts.onUpdate && (t - lastUpdate >= updateMs || firstLook)) {
          lastUpdate = t;
          shown = true;
          opts.onUpdate(this.snapshot(t - t0));
        }
      }
    } finally {
      // Calls still out come back into the tree before the search returns.
      while (pending.size) await Promise.race(pending);
    }
    if (failure !== null) throw failure;
    const snap = this.snapshot(now() - t0);
    if (settled) snap.settled = true;
    opts.onUpdate?.(snap);
    return snap;
  }

  /** True when the visits left cannot overtake the most-visited root move. */
  private futile(opts: RunOptions): boolean {
    const r = this.root;
    const left = opts.visits - r.visits;
    if (this.gumbelOn(opts)) return false; // its rounds decide, not visit counts
    if (!r.moves || r.visits < Math.max(16, opts.visits * 0.25) || left <= 0) return false;
    let first = 0;
    let second = 0;
    let firstIdx = -1;
    for (let i = 0; i < r.span; i++) {
      const v = r.kids[i]?.visits ?? 0;
      if (v > first) {
        second = first;
        first = v;
        firstIdx = i;
      } else if (v > second) second = v;
    }
    if (first - second <= left) return false;
    // The played move still gets its share before the search may end.
    if (opts.forced !== undefined) {
      const i = r.moves.indexOf(opts.forced);
      const k = i >= 0 ? r.kids[i] : undefined;
      if (i !== firstIdx && (!k || k.visits < Math.floor((opts.forcedShare ?? 0.15) * (opts.visits - 1)))) return false;
    }
    return true;
  }

  private async evaluate(reqs: LeafRequest[]): Promise<NetEval[]> {
    // Wall time with at least one call out: with several engine workers the calls overlap,
    // so summing each call's own time would understate the speed by the number of workers.
    if (this.callsOut++ === 0) this.busySince = now();
    try {
      const out = await this.evaluator(reqs);
      this.evalCount += reqs.length;
      return out;
    } finally {
      if (--this.callsOut === 0) this.evalTime += now() - this.busySince;
    }
  }

  private rootRequest(ownership: boolean): LeafRequest {
    const { size, komi, moves, toPlay, board } = this.pos;
    return { size, komi, moves, toPlay, board, ownership };
  }

  /**
   * Select up to `batch` leaves (a `depth`-th of it per call when that many calls are kept
   * in flight), applying virtual loss so they differ.
   */
  private collect(opts: RunOptions, depth = 1): Leaf[] {
    const out: Leaf[] = [];
    // A wide batch spreads leaves with virtual loss, which wastes visits in a small tree:
    // grow it with the tree (about 2*sqrt(visits)), up to what the engine can take. Leaves
    // already in flight count against both.
    const cap = this.evaluator.batch?.() ?? this.params.batch;
    const grow = Math.max(1, Math.floor(this.params.batchGrowth * Math.sqrt(this.root.visits)));
    const room = Math.min(cap, grow) - this.root.inflight;
    const want = Math.min(Math.ceil(cap / depth), room, opts.visits - this.root.visits - this.root.inflight);
    if (want < 1) return out;
    for (let b = 0; b < want; b++) {
      const leaf = this.descend(opts);
      if (leaf === 'collision') break;
      if (leaf === null) continue; // an already-evaluated leaf was backed up directly
      out.push(leaf);
      if (!this.root.evaluated) break; // the root's own evaluation goes alone
    }
    return out;
  }

  private descend(opts: RunOptions): Leaf | 'collision' | null {
    const root = this.root;
    const path: SNode[] = [root];
    let node = root;
    let pla = this.pos.toPlay;
    let board: Board | null = null;
    const line: Move[] = [];
    const hist = this.pos.moves;
    let lastPass = hist.length > 0 && hist[hist.length - 1].loc === PASS;
    let leafOnly = false;
    while (node.evaluated && !node.leafOnly && node.moves && node.moves.length) {
      let idx = -1;
      if (node === root && opts.forced !== undefined) idx = this.forcedIndex(opts.forced, opts.forcedShare ?? 0.15);
      if (idx < 0 && node === root && this.gumbelOn(opts)) {
        idx = this.gumbelSelect(opts);
        if (idx < 0) return 'collision';
      }
      if (idx < 0) idx = this.select(node, pla, node === root);
      if (idx < 0) break;
      const loc = node.moves[idx];
      let kid = node.kids[idx];
      if (!kid) {
        kid = new SNode(loc);
        node.kids[idx] = kid;
        if (idx >= node.span) node.span = idx + 1;
        this.nodes++;
      }
      if (!board) board = this.pos.board.clone();
      board.play(loc, pla, true);
      line.push({ color: pla, loc });
      const pass = loc === PASS;
      leafOnly = (pass && lastPass) || line.length >= this.params.maxDepth;
      lastPass = pass;
      pla = other(pla);
      node = kid;
      path.push(node);
    }
    if (node.evaluated) {
      // Game over, too deep, or no moves: repeat the stored value.
      const u = this.utility(node.nnWin, node.nnLead);
      for (const n of path) {
        n.visits++;
        n.winSum += node.nnWin;
        n.leadSum += node.nnLead;
        n.utilSqSum += u * u;
      }
      return null;
    }
    if (node.inflight > 0) return 'collision';
    for (const n of path) n.inflight++;
    const isRoot = node === root;
    return {
      path,
      node,
      leafOnly,
      req: {
        size: this.pos.size,
        komi: this.pos.komi,
        moves: line.length ? [...hist, ...line] : hist,
        toPlay: pla,
        board: board ?? this.pos.board,
        ownership: isRoot,
        symmetries: isRoot ? this.params.rootSymmetries : undefined,
        depth: line.length,
      },
    };
  }

  private forcedIndex(loc: Loc, share: number): number {
    const r = this.root;
    if (!r.moves || r.visits < 2) return -1;
    let i = r.moves.indexOf(loc);
    if (i < 0) {
      if (loc !== PASS && !this.pos.board.isLegal(loc, this.pos.toPlay)) return -1;
      // Truncated list (a reused subtree): add the move with a tiny prior.
      const moves = new Int16Array(r.moves.length + 1);
      const priors = new Float32Array(r.moves.length + 1);
      moves.set(r.moves);
      priors.set(r.priors!);
      moves[r.moves.length] = loc;
      priors[r.moves.length] = 1e-4;
      r.moves = moves;
      r.priors = priors;
      i = r.moves.length - 1;
    }
    const k = r.kids[i];
    const n = k ? k.visits + k.inflight : 0;
    if (k && k.visits === 0 && k.inflight > 0) return -1;
    const want = Math.max(1, Math.floor(share * (r.visits - 1)));
    return n < want ? i : -1;
  }

  private gumbelOn(opts: RunOptions): boolean {
    const p = this.params;
    return p.gumbel > 1 && opts.visits <= p.gumbelMaxVisits && !!this.root.moves && this.root.moves.length > 1;
  }

  /**
   * The root move to visit next under sequential halving: the remaining move furthest below
   * this round's visits; when all have them, the worse half drops out. -1: every remaining
   * move is waiting for an evaluation already in flight.
   */
  private gumbelSelect(opts: RunOptions): number {
    const r = this.root;
    let g = this.plan;
    if (!g || g.root !== r || g.budget !== opts.visits) g = this.plan = this.makePlan(opts.visits);
    for (;;) {
      if (g.remaining.length === 1) return g.remaining[0];
      let pick = -1;
      let low = Infinity;
      let waiting = false;
      for (const i of g.remaining) {
        const k = r.kids[i];
        const n = k ? k.visits + k.inflight : 0;
        if (n < g.target && n < low) {
          low = n;
          pick = i;
        }
        if (k && k.visits === 0 && k.inflight > 0) waiting = true;
      }
      if (pick >= 0) return pick;
      if (waiting) return -1;
      const keep = Math.ceil(g.remaining.length / 2);
      g.remaining = this.gumbelRank(g.remaining).slice(0, keep);
      g.target += Math.max(1, Math.floor(g.roundBudget / keep));
    }
  }

  private makePlan(budget: number): GumbelPlan {
    const r = this.root;
    const left = Math.max(1, budget - r.visits);
    const m = Math.max(2, Math.min(this.params.gumbel, r.moves!.length, left));
    const rounds = Math.max(1, Math.ceil(Math.log2(m)));
    const roundBudget = Math.floor(left / rounds);
    // Without noise the most likely moves are the first m (moves are kept by prior).
    const remaining = Array.from({ length: m }, (_, i) => i);
    let base = Infinity;
    for (const i of remaining) base = Math.min(base, r.kids[i]?.visits ?? 0);
    return { root: r, budget, remaining, target: base + Math.max(1, Math.floor(roundBudget / m)), roundBudget };
  }

  /**
   * Root moves ordered best first by log(prior) + sigma(q), q the searched value scaled to
   * [0, 1] over the root's searched moves, sigma(q) = (50 + most visits) * 0.1 * q (the
   * paper's and mctx's constants). Unsearched moves take the root's own value.
   */
  private gumbelRank(idx: number[]): number[] {
    const r = this.root;
    const s = this.pos.toPlay === 1 ? 1 : -1;
    const rootQ = r.visits > 0 ? s * this.nodeUtility(r) : 0;
    let lo = Infinity;
    let hi = -Infinity;
    let maxN = 0;
    const q = new Map<number, number>();
    for (let i = 0; i < r.span; i++) {
      const k = r.kids[i];
      if (!k || k.visits === 0) continue;
      const v = s * this.nodeUtility(k);
      q.set(i, v);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      maxN = Math.max(maxN, k.visits);
    }
    lo = Math.min(lo, rootQ);
    hi = Math.max(hi, rootQ);
    const span = hi > lo ? hi - lo : 1;
    const sigma = (50 + maxN) * 0.1;
    const score = (i: number) => Math.log(Math.max(1e-9, r.priors![i])) + (sigma * ((q.get(i) ?? rootQ) - lo)) / span;
    return [...idx].sort((a, b) => score(b) - score(a));
  }

  /** The move Gumbel root search chose this run, or -1 when it was not used. */
  private gumbelChoice(): number {
    const g = this.plan;
    if (!g || g.root !== this.root) return -1;
    const searched = g.remaining.filter((i) => (this.root.kids[i]?.visits ?? 0) > 0);
    return searched.length ? this.gumbelRank(searched)[0] : -1;
  }

  /** Black-perspective utility of a node's average value. */
  private utility(win: number, lead: number): number {
    const p = this.params;
    return 2 * win - 1 + p.staticScore * sv(lead / this.scoreScale) + p.dynamicScore * sv((lead - this.center) / this.dynScale);
  }

  private nodeUtility(n: SNode): number {
    return this.utility(n.winSum / n.visits, n.leadSum / n.visits);
  }

  /** KataGo's parentUtilityStdevFactor: the spread of the values seen under a node, against a prior. */
  private stdevFactor(node: SNode, value: number): number {
    const p = this.params;
    const prior = p.cpuctStdevPrior;
    let sd = prior;
    if (node.visits > 1) {
      const sq = value * value;
      const sqAvg = Math.max(sq, node.utilSqSum / node.visits);
      const w = p.cpuctStdevPriorWeight;
      sd = Math.sqrt(Math.max(0, ((sq + prior * prior) * w + sqAvg * node.visits) / (w + node.visits - 1) - sq));
    }
    return 1 + p.cpuctStdevScale * (sd / prior - 1);
  }

  /** PUCT choice among a node's children; the best unvisited move stands for all unvisited ones. */
  private select(node: SNode, pla: Color, isRoot: boolean): number {
    const p = this.params;
    const moves = node.moves!;
    const priors = node.priors!;
    const s = pla === 1 ? 1 : -1;
    let childVisits = 0;
    let visitedMass = 0;
    for (let i = 0; i < node.span; i++) {
      const k = node.kids[i];
      if (!k) continue;
      childVisits += k.visits + k.inflight;
      if (k.visits > 0) visitedMass += priors[i];
    }
    const parentValue = node.visits > 0 ? s * this.nodeUtility(node) : 0;
    const fpuValue = parentValue - (isRoot ? p.fpuRoot : p.fpu) * Math.sqrt(visitedMass);
    let scale = (p.cpuct + p.cpuctLog * Math.log((childVisits + p.cpuctBase) / p.cpuctBase)) * Math.sqrt(childVisits + 0.01);
    if (p.cpuctStdevScale > 0) scale *= this.stdevFactor(node, parentValue);
    let best = -1;
    let bestScore = -Infinity;
    let sawUnvisited = false;
    const end = Math.min(moves.length, node.span + 1);
    for (let i = 0; i < end; i++) {
      const k = node.kids[i];
      let q: number;
      let n: number;
      if (!k) {
        if (sawUnvisited) continue;
        sawUnvisited = true;
        q = fpuValue;
        n = 0;
      } else {
        n = k.visits + k.inflight;
        if (k.visits > 0) {
          // Leaves in flight below this child count as losses (virtual loss), scaled by
          // virtualLoss: 1 spreads a batch widely, 0 keeps the child's value and only adds visits.
          const own = s * this.nodeUtility(k);
          q = (own * k.visits + k.inflight * (own - p.virtualLoss * (own + 1))) / n;
        }
        else q = k.inflight > 0 ? -1 : fpuValue;
      }
      const score = q + (scale * priors[i]) / (1 + n);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  private apply(leaf: Leaf, ev: NetEval) {
    const node = leaf.node;
    // Below a judged root move, the small network's view is corrected by the gap measured there.
    const top = leaf.path[1];
    if (top && top !== node && (top.biasWin || top.biasLead)) {
      ev = { ...ev, bWin: Math.min(1, Math.max(0, ev.bWin + top.biasWin)), bLead: ev.bLead + top.biasLead };
    }
    if (!node.evaluated) {
      node.evaluated = true;
      node.nnWin = ev.bWin;
      node.nnLead = ev.bLead;
      node.smallWin = ev.bWin;
      node.smallLead = ev.bLead;
      if (leaf.leafOnly) node.leafOnly = true;
      else this.expand(node, ev.policy, node === this.root);
      if (node === this.root) {
        this.rootPolicy = ev.policy;
        if (ev.ownership) this.rootOwnership = ev.ownership;
      }
    }
    const u = this.utility(ev.bWin, ev.bLead);
    for (const n of leaf.path) {
      n.inflight--;
      n.visits++;
      n.winSum += ev.bWin;
      n.leadSum += ev.bLead;
      n.utilSqSum += u * u;
    }
  }

  private expand(node: SNode, policy: Float32Array, isRoot: boolean) {
    const hw = policy.length - 1;
    // Moves by prior, highest first, ties by point (as a stable sort would leave them). A
    // positive float's bits order like its value, so (bits, reversed point) packed into one
    // number sorts natively in a typed array, instead of a comparator call per comparison
    // (that was about a third of the search's own time).
    const keys = sortKeys(policy);
    const idx = new Int32Array(keys.length);
    for (let j = 0; j < keys.length; j++) idx[j] = KEY_SPAN - 1 - (keys[keys.length - 1 - j] % KEY_SPAN);
    let keep = idx.length;
    if (!isRoot) {
      let mass = 0;
      keep = 0;
      for (const i of idx) {
        mass += policy[i];
        keep++;
        if (keep >= this.params.maxChildren || (mass >= 0.9995 && keep >= 4)) break;
      }
    }
    const moves = new Int16Array(keep);
    const priors = new Float32Array(keep);
    for (let j = 0; j < keep; j++) {
      moves[j] = idx[j] === hw ? PASS : idx[j];
      priors[j] = policy[idx[j]];
    }
    node.moves = moves;
    node.priors = priors;
  }

  /**
   * Ask the anchor source about the root and its most visited moves (a couple at a time, in
   * the background: the search does not wait). Each answer replaces the small network's
   * value there, and its gap to the small network corrects everything searched below that
   * move, including what was searched before the answer came.
   */
  private pumpAnchors() {
    const a = this.anchor;
    if (!a || this.anchorsInFlight >= 2) return;
    const root = this.root;
    const want: SNode[] = [];
    if (root.evaluated && !root.anchored) want.push(root);
    if (root.moves) {
      const kids: SNode[] = [];
      for (let i = 0; i < root.span; i++) {
        const k = root.kids[i];
        if (k && k.evaluated && !k.leafOnly && k.visits > 0) kids.push(k);
      }
      kids.sort((x, y) => y.visits - x.visits);
      for (const k of kids.slice(0, this.params.anchorChildren)) if (!k.anchored) want.push(k);
    }
    for (const node of want) {
      if (this.anchorsInFlight >= 2) break;
      node.anchored = 1;
      this.anchorsInFlight++;
      this.anchorStats.asked++;
      const req = this.requestFor(node);
      const atRoot = this.root;
      a(req)
        .then((r) => {
          if (r && this.root === atRoot) this.applyAnchor(node, node === atRoot, r.eval, r.policy);
        })
        .catch(() => {})
        .finally(() => {
          node.anchored = 2;
          this.anchorsInFlight--;
        });
    }
  }

  private requestFor(node: SNode): LeafRequest {
    if (node === this.root) return { ...this.rootRequest(false), depth: 0 };
    const { size, komi, moves, toPlay, board } = this.pos;
    const b = board.clone();
    b.play(node.move, toPlay, true);
    return { size, komi, moves: [...moves, { color: toPlay, loc: node.move }], toPlay: other(toPlay), board: b, ownership: false, depth: 1 };
  }

  private applyAnchor(node: SNode, isRoot: boolean, ev: NetEval, usePolicy: boolean) {
    this.anchorStats.judged++;
    const dWin = ev.bWin - node.smallWin;
    const dLead = ev.bLead - node.smallLead;
    // The node's own evaluation is replaced outright.
    let addWin = ev.bWin - node.nnWin;
    let addLead = ev.bLead - node.nnLead;
    node.nnWin = ev.bWin;
    node.nnLead = ev.bLead;
    if (!isRoot) {
      // Everything already searched below it moves by the same gap; later evaluations follow.
      const w = this.params.anchorWeight;
      const below = Math.max(0, node.visits - 1);
      addWin += below * (w * dWin - node.biasWin);
      addLead += below * (w * dLead - node.biasLead);
      node.biasWin = w * dWin;
      node.biasLead = w * dLead;
      node.winSum += addWin;
      node.leadSum += addLead;
    }
    this.root.winSum += addWin;
    this.root.leadSum += addLead;
    if (usePolicy && node.moves) this.reprior(node, ev.policy);
    if (isRoot && usePolicy) this.rootPolicy = ev.policy;
  }

  /** Reorder a node's moves by a better policy, keeping the children already searched. */
  private reprior(node: SNode, policy: Float32Array) {
    if (node === this.root) this.plan = null; // its move indices change
    const hw = policy.length - 1;
    const old = node.moves!;
    const kids = new Map<number, SNode>();
    for (let i = 0; i < node.span; i++) if (node.kids[i]) kids.set(old[i], node.kids[i]!);
    const idx = Array.from(old, (_, i) => i).sort((a, b) => {
      const pa = policy[old[a] === PASS ? hw : old[a]];
      const pb = policy[old[b] === PASS ? hw : old[b]];
      return pb - pa;
    });
    const moves = new Int16Array(old.length);
    const priors = new Float32Array(old.length);
    const kidsOut: (SNode | undefined)[] = [];
    let span = 0;
    idx.forEach((j, i) => {
      moves[i] = old[j];
      priors[i] = Math.max(1e-6, policy[old[j] === PASS ? hw : old[j]]);
      const k = kids.get(old[j]);
      if (k) {
        kidsOut[i] = k;
        span = i + 1;
      }
    });
    node.moves = moves;
    node.priors = priors;
    node.kids = kidsOut;
    node.span = span;
  }

  private pvFrom(node: SNode, max: number): Loc[] {
    const out: Loc[] = [];
    let n = node;
    while (out.length < max && n.moves) {
      let best: SNode | undefined;
      for (let i = 0; i < n.span; i++) {
        const k = n.kids[i];
        if (k && k.visits > 0 && (!best || k.visits > best.visits)) best = k;
      }
      if (!best) break;
      out.push(best.move);
      n = best;
    }
    return out;
  }

  snapshot(elapsedMs = 0): SearchSnapshot {
    const r = this.root;
    // Busy time so far, including a stretch of calls still going (with several workers the
    // calls can overlap without a break for the whole search).
    const busy = this.evalTime + (this.callsOut > 0 ? now() - this.busySince : 0);
    const toPlay = this.pos.toPlay;
    const candidates: SearchCandidate[] = [];
    if (r.moves) {
      for (let i = 0; i < r.span; i++) {
        const k = r.kids[i];
        if (!k || k.visits === 0) continue;
        const w = k.winSum / k.visits;
        const l = k.leadSum / k.visits;
        candidates.push({
          loc: k.move,
          visits: k.visits,
          winrate: toPlay === 1 ? w : 1 - w,
          scoreLead: toPlay === 1 ? l : -l,
          prior: r.priors![i],
          pv: [k.move, ...this.pvFrom(k, 23)],
        });
      }
    }
    candidates.sort((a, b) => b.visits - a.visits || b.winrate - a.winrate || b.scoreLead - a.scoreLead);
    // Gumbel root search: its choice leads, whatever the visit counts.
    const gi = this.gumbelChoice();
    if (gi >= 0) {
      const at = candidates.findIndex((c) => c.loc === r.moves![gi]);
      if (at > 0) candidates.unshift(...candidates.splice(at, 1));
    }
    let policy = this.rootPolicy;
    if (!policy && r.moves) {
      const hw = this.pos.size * this.pos.size;
      policy = new Float32Array(hw + 1);
      for (let i = 0; i < r.moves.length; i++) policy[r.moves[i] === PASS ? hw : r.moves[i]] = r.priors![i];
      this.rootPolicy = policy;
    }
    return {
      toPlay,
      visits: r.visits,
      bWin: r.visits ? r.winSum / r.visits : 0.5,
      bLead: r.visits ? r.leadSum / r.visits : 0,
      candidates,
      policy,
      ownership: this.rootOwnership,
      nodes: this.nodes,
      evalsPerSec: busy > 0 ? (this.evalCount * 1000) / busy : 0,
      elapsedMs,
    };
  }
}

function countNodes(n: SNode): number {
  let c = 1;
  for (let i = 0; i < n.span; i++) {
    const k = n.kids[i];
    if (k) c += countNodes(k);
  }
  return c;
}

const caches = new WeakMap<object, NNCache>();

/** The evaluation cache shared by every search on this engine. */
export function nnCacheFor(engine: object): NNCache {
  let c = caches.get(engine);
  if (!c) {
    c = new NNCache();
    caches.set(engine, c);
  }
  return c;
}

/** Symmetries spread over the 8 (identity first) for averaging k of them. */
const SYM_ORDER = [0, 7, 3, 4, 1, 6, 2, 5];

function average(evals: NetEval[]): NetEval {
  if (evals.length === 1) return evals[0];
  const n = evals.length;
  const policy = new Float32Array(evals[0].policy.length);
  let bWin = 0;
  let bLead = 0;
  const own = evals[0].ownership ? new Float32Array(evals[0].ownership.length) : undefined;
  for (const e of evals) {
    for (let i = 0; i < policy.length; i++) policy[i] += e.policy[i] / n;
    bWin += e.bWin / n;
    bLead += e.bLead / n;
    if (own && e.ownership) for (let i = 0; i < own.length; i++) own[i] += e.ownership[i] / n;
  }
  return { policy, bWin, bLead, ownership: own };
}

export interface EvaluatorOptions {
  /** Reuse evaluations across searches (default: the engine's shared cache). null: no cache. */
  cache?: NNCache | null;
  /** false: one network call per leaf, as before batching (the benchmark's baseline). */
  batched?: boolean;
}

/**
 * Evaluate leaves with a loaded engine. Positions already evaluated (or a mirror image of
 * one) come from the cache; the rest go to the engine together, with move history, spread
 * over its workers and network batches. Engines without batched evaluation get one call
 * per leaf.
 */
export function engineEvaluator(engine: EngineBackend, opts: EvaluatorOptions = {}): LeafEvaluator {
  const cache = opts.cache === undefined ? nnCacheFor(engine) : opts.cache;
  const finish = (l: LeafRequest, raw: RawNetOutput) => {
    const legal = l.board.legalMask(l.toPlay);
    return processRawOutput(raw, l.toPlay, (loc) => legal[loc] === 1, engine.postProcess);
  };
  const seq = opts.batched === false ? undefined : engine.evalSeqBatchRaw?.bind(engine);
  const evaluator: LeafEvaluator = async (leaves) => {
    const out: NetEval[] = new Array(leaves.length);
    const keys = leaves.map((l) => (cache ? positionHash(l.board, l.toPlay, l.moves, l.komi) : null));
    const misses: number[] = [];
    for (let i = 0; i < leaves.length; i++) {
      const k = keys[i];
      const hit = k && (leaves[i].symmetries ?? 1) <= 1 ? cache!.get(k, leaves[i].size, leaves[i].ownership) : null;
      if (hit) out[i] = hit;
      else misses.push(i);
    }
    if (misses.length) {
      if (seq) {
        const reqs: Parameters<typeof seq>[0] = [];
        const owner: number[] = [];
        for (const i of misses) {
          const l = leaves[i];
          const k = Math.max(1, Math.min(8, l.symmetries ?? 1));
          for (let s = 0; s < k; s++) {
            reqs.push({ size: l.size, komi: l.komi, moves: l.moves, toPlay: l.toPlay, ownership: l.ownership, symmetry: SYM_ORDER[s] });
            owner.push(i);
          }
        }
        const raws = await seq(reqs);
        const parts = new Map<number, NetEval[]>();
        raws.forEach((raw, j) => {
          const i = owner[j];
          const list = parts.get(i) ?? [];
          list.push(finish(leaves[i], raw));
          parts.set(i, list);
        });
        for (const [i, list] of parts) out[i] = average(list);
      } else {
        for (const i of misses) {
          const l = leaves[i];
          out[i] = finish(l, await engine.evalRaw({ size: l.size, komi: l.komi, moves: l.moves, toPlay: l.toPlay }, l.ownership));
        }
      }
      // Averaged evaluations are stored too: they are the better estimate of the same position.
      if (cache) for (const i of misses) cache.put(keys[i]!, leaves[i].size, out[i]);
    }
    return out;
  };
  evaluator.batch = () => (seq ? Math.max(1, engine.batch ?? 1) : 1);
  evaluator.pipeline = () => (seq ? Math.max(1, engine.pipeline ?? 1) : 1);
  // Averaging the root over symmetries costs one round of network calls when the engine
  // evaluates that many positions at once anyway.
  evaluator.rootSymmetries = () => {
    const b = evaluator.batch!();
    return b >= 8 ? 8 : b >= 4 ? 4 : b >= 2 ? 2 : 1;
  };
  return evaluator;
}
