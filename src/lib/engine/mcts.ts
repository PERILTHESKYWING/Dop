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
export type LeafEvaluator = ((leaves: LeafRequest[]) => Promise<NetEval[]>) & { batch?: () => number; rootSymmetries?: () => number };

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
   */
  anchorWeight: number;
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
  anchorWeight: 1,
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

interface Leaf {
  path: SNode[];
  node: SNode;
  req: LeafRequest;
  leafOnly: boolean;
}

const sv = (x: number) => (2 / Math.PI) * Math.atan(x);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

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
  private anchor: AnchorSource | null = null;
  private anchorsInFlight = 0;
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
    if (opts.ownership && this.root.evaluated && !this.rootOwnership) {
      const [ev] = await this.evaluate([this.rootRequest(true)]);
      this.rootOwnership = ev.ownership ?? null;
    }
    if (this.root.visits > 0) this.center = 0.8 * (this.root.leadSum / this.root.visits);
    while (!this.stopFlag) {
      if (this.root.visits >= opts.visits) break;
      if (opts.maxMs !== undefined && now() - t0 >= opts.maxMs) break;
      if (opts.shouldStop?.()) break;
      if (this.nodes >= this.params.maxNodes) break;
      if (opts.earlyStop && this.futile(opts)) {
        settled = true;
        break;
      }
      const leaves = this.collect(opts);
      if (!leaves.length) continue;
      let evals: NetEval[];
      try {
        evals = await this.evaluate(leaves.map((l) => l.req));
      } catch (e) {
        for (const l of leaves) for (const n of l.path) n.inflight--;
        throw e;
      }
      for (let i = 0; i < leaves.length; i++) this.apply(leaves[i], evals[i]);
      if (this.root.visits === 1) this.center = 0.8 * this.root.nnLead;
      if (this.anchor) this.pumpAnchors();
      const t = now();
      if (opts.onUpdate && t - lastUpdate >= updateMs) {
        lastUpdate = t;
        opts.onUpdate(this.snapshot(t - t0));
      }
    }
    const snap = this.snapshot(now() - t0);
    if (settled) snap.settled = true;
    opts.onUpdate?.(snap);
    return snap;
  }

  /** True when the visits left cannot overtake the most-visited root move. */
  private futile(opts: RunOptions): boolean {
    const r = this.root;
    const left = opts.visits - r.visits;
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
    const t = now();
    const out = await this.evaluator(reqs);
    this.evalTime += now() - t;
    this.evalCount += reqs.length;
    return out;
  }

  private rootRequest(ownership: boolean): LeafRequest {
    const { size, komi, moves, toPlay, board } = this.pos;
    return { size, komi, moves, toPlay, board, ownership };
  }

  /** Select up to `batch` leaves, applying virtual loss so they differ. */
  private collect(opts: RunOptions): Leaf[] {
    const out: Leaf[] = [];
    // A wide batch spreads leaves with virtual loss, which wastes visits in a small tree:
    // grow it with the tree (about 2*sqrt(visits)), up to what the engine can take.
    const cap = this.evaluator.batch?.() ?? this.params.batch;
    const grow = Math.max(1, Math.floor(this.params.batchGrowth * Math.sqrt(this.root.visits)));
    const want = Math.max(1, Math.min(cap, grow, opts.visits - this.root.visits));
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
      for (const n of path) {
        n.visits++;
        n.winSum += node.nnWin;
        n.leadSum += node.nnLead;
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

  /** Black-perspective utility of a node's average value. */
  private utility(win: number, lead: number): number {
    const p = this.params;
    return 2 * win - 1 + p.staticScore * sv(lead / this.scoreScale) + p.dynamicScore * sv((lead - this.center) / this.dynScale);
  }

  private nodeUtility(n: SNode): number {
    return this.utility(n.winSum / n.visits, n.leadSum / n.visits);
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
    const scale = (p.cpuct + p.cpuctLog * Math.log((childVisits + p.cpuctBase) / p.cpuctBase)) * Math.sqrt(childVisits + 0.01);
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
    for (const n of leaf.path) {
      n.inflight--;
      n.visits++;
      n.winSum += ev.bWin;
      n.leadSum += ev.bLead;
    }
  }

  private expand(node: SNode, policy: Float32Array, isRoot: boolean) {
    const hw = policy.length - 1;
    const idx: number[] = [];
    for (let i = 0; i <= hw; i++) if (policy[i] > 0) idx.push(i);
    idx.sort((a, b) => policy[b] - policy[a]);
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
      evalsPerSec: this.evalTime > 0 ? (this.evalCount * 1000) / this.evalTime : 0,
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
  // Averaging the root over symmetries costs one round of network calls when the engine
  // evaluates that many positions at once anyway.
  evaluator.rootSymmetries = () => {
    const b = evaluator.batch!();
    return b >= 8 ? 8 : b >= 4 ? 4 : b >= 2 ? 2 : 1;
  };
  return evaluator;
}
