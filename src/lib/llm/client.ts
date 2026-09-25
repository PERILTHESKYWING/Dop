import type { DiscoveryRequest, DiscoveryResponse, EvidenceCluster, EvidencePosition } from '../../../shared/llm';
import type { Corpus } from '../corpus';
import { locToGtp, xy } from '../go/coords';
import { PASS, type Loc } from '../go/types';
import type { AxisStats, MoveRecord, PointFeatures, Weakness } from '../types';
import { betaSurvival, mean } from '../util/stats';
import { fingerprintOf } from '../forge/generator';
import { similarity } from '../search/similarity';

export interface LlmTest {
  ok: boolean;
  model?: string;
  ms?: number;
  errors: string[];
}

export interface LlmStatus {
  available: boolean;
  configured: boolean;
  model?: string;
  models?: string[];
  error?: string;
  /** Result of a live call through the model chain, when one was made. */
  test?: LlmTest;
}

/** Server status; with `live`, the server also makes a tiny real call to prove the key and models work. */
export async function llmStatus(live = false): Promise<LlmStatus> {
  try {
    const res = await fetch(live ? '/api/llm?test=1' : '/api/llm', { method: 'GET', headers: { accept: 'application/json' } });
    if (!res.ok) return { available: false, configured: false, error: `the /api/llm function answered HTTP ${res.status}` };
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) return { available: false, configured: false, error: 'this host has no /api/llm function (static hosting)' };
    const j = (await res.json()) as { configured: boolean; model?: string; models?: string[]; test?: LlmTest };
    const available = !!j.configured && (j.test ? j.test.ok : true);
    const error = !j.configured
      ? 'LLM_API_KEY is not set on the server'
      : j.test && !j.test.ok
        ? j.test.errors[j.test.errors.length - 1] ?? 'the live check failed'
        : undefined;
    return { available, configured: !!j.configured, model: j.test?.model ?? j.model, models: j.models, test: j.test, error };
  } catch (e) {
    return { available: false, configured: false, error: (e as Error).message };
  }
}

export function traits(p: PointFeatures): string[] {
  const t: string[] = [];
  t.push(`line ${p.line}`, p.region);
  if (p.local) t.push('local reply');
  if (p.tenuki) t.push('tenuki');
  if (p.contact) t.push('contact');
  if (p.captures) t.push(`captures ${p.captures}`);
  if (p.atari) t.push('atari');
  if (p.selfAtari) t.push('self-atari');
  if (p.savesAtari) t.push('saves stones in atari');
  if (p.extendsSmallWeak) t.push('extends small weak stones');
  if (p.nearOwnWeak) t.push('near own weak group');
  if (p.nearOppWeak) t.push('near enemy weak group');
  if (p.nearOwnSafe) t.push('next to own safe group');
  if (p.invasion) t.push('invasion');
  if (p.reduction) t.push('reduction');
  return t;
}

/** 9x9 window around the played/best moves. X = mover, O = opponent. */
export function diagram(corpus: Corpus, r: MoveRecord): string {
  const board = corpus.boards(r.gameId)[r.index];
  const n = board.size;
  const focus: Loc = r.loc !== PASS ? r.loc : r.bestLoc;
  const [fx, fy] = xy(focus, n);
  const [bx, by] = r.bestLoc !== PASS ? xy(r.bestLoc, n) : [fx, fy];
  const cx = Math.round((fx + bx) / 2);
  const cy = Math.round((fy + by) / 2);
  const x0 = Math.max(0, Math.min(n - 9, cx - 4));
  const y0 = Math.max(0, Math.min(n - 9, cy - 4));
  const rows: string[] = [];
  for (let y = y0; y < y0 + 9 && y < n; y++) {
    let row = '';
    for (let x = x0; x < x0 + 9 && x < n; x++) {
      const l = y * n + x;
      const c = board.stones[l];
      if (l === r.loc) row += '1';
      else if (l === r.bestLoc) row += '2';
      else row += c === 0 ? '.' : c === r.color ? 'X' : 'O';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

function toEvidence(corpus: Corpus, r: MoveRecord, id: string): EvidencePosition {
  const g = corpus.games.get(r.gameId)!;
  return {
    id,
    game: `${g.black} vs ${g.white}${g.date ? ` ${g.date}` : ''}`,
    move: r.index + 1,
    phase: r.features.phase,
    color: r.color === 1 ? 'Black' : 'White',
    played: locToGtp(r.loc, r.size),
    best: locToGtp(r.bestLoc, r.size),
    scoreLoss: Math.round(r.scoreLoss * 10) / 10,
    winrateLoss: Math.round(r.winrateLoss * 100) / 100,
    playedTraits: traits(r.features.played),
    bestTraits: traits(r.features.best),
    diagram: diagram(corpus, r),
  };
}

/** Greedy diverse representatives: the costliest error, then the most different ones. */
export function representatives(corpus: Corpus, rs: MoveRecord[], k: number): MoveRecord[] {
  if (rs.length <= k) return rs;
  const sorted = [...rs].sort((a, b) => b.scoreLoss - a.scoreLoss).slice(0, 40);
  const fps = sorted.map((r) => fingerprintOf(corpus, r));
  const chosen = [0];
  while (chosen.length < k) {
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < sorted.length; i++) {
      if (chosen.includes(i)) continue;
      const maxSim = Math.max(...chosen.map((j) => similarity(fps[i], fps[j])));
      const s = (1 - maxSim) + 0.05 * Math.log1p(sorted[i].scoreLoss);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    if (best < 0) break;
    chosen.push(best);
  }
  return chosen.map((i) => sorted[i]);
}

const clusterKey = (r: MoveRecord) => {
  const p = r.features.played;
  const b = r.features.best;
  return [r.features.phase, p.local ? 'local' : p.tenuki ? 'tenuki' : 'mid', b.local ? 'best-local' : 'best-away', p.contact ? 'contact' : 'loose', b.nearOwnWeak || b.nearOppWeak ? 'weak-groups' : 'calm'].join('|');
};

/**
 * Compress the corpus into clusters of similar decisions with a few representative
 * positions each. Only this summary goes to the LLM, never all moves.
 */
export interface BuiltRequest {
  req: DiscoveryRequest;
  /** Evidence id (E1...) -> move record id. Stays in the browser. */
  ids: Map<string, string>;
}

export function buildDiscoveryRequest(corpus: Corpus, weaknesses: Weakness[], axes: AxisStats[]): BuiltRequest {
  const player = corpus.playerRecords();
  const ids = new Map<string, string>();
  const ev = (r: MoveRecord, id: string) => {
    ids.set(id, r.id);
    return toEvidence(corpus, r, id);
  };
  const clusters: EvidenceCluster[] = [];
  let eid = 1;
  let cid = 1;
  for (const w of weaknesses.slice(0, 8)) {
    const occ = w.evidence.map((e) => corpus.byId.get(e.moveId)).filter((r): r is MoveRecord => !!r);
    const reps = representatives(corpus, occ, 5);
    clusters.push({
      id: `C${cid++}`,
      signature: w.signature,
      label: w.title,
      opportunities: w.opportunities,
      occurrences: w.occurrences,
      games: w.games,
      avgScoreLoss: w.avgScoreLoss,
      statConfidence: w.confidence,
      representatives: reps.map((r) => ev(r, `E${eid++}`)),
    });
  }
  // Mistakes no signature explains: cluster by coarse decision shape.
  const unexplained = player.filter((r) => r.errors.length === 0 && (r.severity === 'mistake' || r.severity === 'blunder'));
  const groups = new Map<string, MoveRecord[]>();
  for (const r of unexplained) {
    const k = clusterKey(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const baseline = player.length ? unexplained.length / player.length : 0;
  const ranked = [...groups.entries()].filter(([, rs]) => rs.length >= 3 && new Set(rs.map((r) => r.gameId)).size >= 2).sort((a, b) => b[1].length - a[1].length);
  for (const [key, rs] of ranked.slice(0, 5)) {
    const opp = player.filter((r) => clusterKey(r) === key).length;
    clusters.push({
      id: `C${cid++}`,
      label: `Unexplained mistakes: ${key.replace(/\|/g, ', ')}`,
      opportunities: opp,
      occurrences: rs.length,
      games: new Set(rs.map((r) => r.gameId)).size,
      avgScoreLoss: mean(rs.map((r) => r.scoreLoss)),
      statConfidence: betaSurvival(rs.length + 1, opp - rs.length + 1, Math.max(0.02, baseline)),
      representatives: representatives(corpus, rs, 4).map((r) => ev(r, `E${eid++}`)),
    });
  }
  const acc = player.length ? player.filter((r) => r.scoreLoss < 1).length / player.length : 0;
  const req: DiscoveryRequest = {
    task: 'discover-patterns',
    player: {
      games: new Set(player.map((r) => r.gameId)).size,
      moves: player.length,
      avgScoreLoss: mean(player.map((r) => r.scoreLoss)),
      accuracy: acc,
      axes: axes.filter((a) => a.n > 0).map((a) => ({ axis: a.axis, accuracy: a.accuracy, n: a.n, summary: a.summary })),
    },
    clusters,
  };
  return { req, ids };
}

export async function discoverPatterns(req: DiscoveryRequest): Promise<DiscoveryResponse> {
  const res = await fetch('/api/llm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) throw new Error('this host has no /api/llm function');
  const j = (await res.json().catch(() => ({}))) as DiscoveryResponse & { error?: string; details?: string[] };
  if (!res.ok) {
    const detail = j.details?.length ? ` (${j.details[j.details.length - 1]})` : '';
    throw new Error((j.error || `LLM request failed (HTTP ${res.status})`) + detail);
  }
  return j;
}

/**
 * Merge LLM patterns into the statistical weaknesses. A pattern about a statistical
 * cluster refines its wording; a pattern about an unexplained cluster becomes a new
 * weakness with the cluster's evidence. Confidence never exceeds the statistics.
 */
export function mergePatterns(corpus: Corpus, built: BuiltRequest, resp: DiscoveryResponse, weaknesses: Weakness[]): Weakness[] {
  const out = weaknesses.map((w) => ({ ...w }));
  const byCluster = new Map(built.req.clusters.map((c) => [c.id, c]));
  const evidenceMove = (id: string) => {
    const mid = built.ids.get(id);
    return mid ? corpus.byId.get(mid) : undefined;
  };
  const now = Date.now();
  for (const p of resp.patterns) {
    const c = byCluster.get(p.clusterId);
    if (!c) continue;
    const llm = { title: p.title, description: p.description, confidence: Math.min(p.confidence, c.statConfidence + 0.1), trainingFocus: p.trainingFocus, model: resp.model };
    const existing = c.signature ? out.find((w) => w.signature === c.signature) : undefined;
    if (existing) {
      existing.llm = llm;
      continue;
    }
    const recs = p.evidenceIds.map((id) => evidenceMove(id)).filter((r): r is MoveRecord => !!r);
    if (recs.length < 3) continue;
    const key = `llm-${c.id}-${p.title.toLowerCase().replace(/[^a-z]+/g, '-').slice(0, 30)}`;
    out.push({
      id: `w-${key}`,
      signature: key,
      category: p.axis,
      title: p.title,
      description: p.description,
      opportunities: c.opportunities,
      occurrences: c.occurrences,
      games: c.games,
      errorRate: c.occurrences / Math.max(1, c.opportunities),
      baselineRate: 0,
      avgScoreLoss: c.avgScoreLoss,
      totalScoreLoss: c.avgScoreLoss * c.occurrences,
      confidence: llm.confidence,
      evidence: recs.map((r) => ({ moveId: r.id, gameId: r.gameId, index: r.index, scoreLoss: r.scoreLoss, winrateLoss: r.winrateLoss })),
      llm,
      trend: { older: 0, newer: 0 },
      status: 'active',
      discoveredAt: now,
      updatedAt: now,
    });
  }
  return out;
}
