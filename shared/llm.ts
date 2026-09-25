/**
 * Shared between the browser and the /api/llm serverless function: the payload the
 * client sends (already compressed evidence, never raw games), the prompt, and strict
 * validation of the model's answer. No secrets here.
 */

export const AXES = [
  'opening',
  'fighting',
  'invasion',
  'attackDefence',
  'territoryInfluence',
  'tenuki',
  'sacrifice',
  'direction',
  'weakGroups',
  'endgame',
  'tactics',
] as const;

export interface EvidencePosition {
  id: string; // short id like "E7"
  game: string;
  move: number;
  phase: string;
  color: 'Black' | 'White';
  played: string;
  best: string;
  scoreLoss: number;
  winrateLoss: number;
  playedTraits: string[];
  bestTraits: string[];
  /** 9x9 ASCII window: X = player to move, O = opponent, 1 = played, 2 = KataGo, . empty, # off-board */
  diagram: string;
}

export interface EvidenceCluster {
  id: string; // "C3"
  signature?: string; // statistical signature id, if any
  label: string;
  opportunities: number;
  occurrences: number;
  games: number;
  avgScoreLoss: number;
  statConfidence: number;
  representatives: EvidencePosition[];
}

export interface DiscoveryRequest {
  task: 'discover-patterns';
  player: {
    games: number;
    moves: number;
    avgScoreLoss: number;
    accuracy: number;
    axes: { axis: string; accuracy: number; n: number; summary: string }[];
  };
  clusters: EvidenceCluster[];
}

export interface DiscoveredPattern {
  title: string;
  description: string;
  axis: (typeof AXES)[number];
  clusterId: string;
  evidenceIds: string[];
  confidence: number;
  trainingFocus: string;
}

export interface DiscoveryResponse {
  patterns: DiscoveredPattern[];
  model: string;
  rejected: number;
}

export const SYSTEM_PROMPT = `You are a Go (baduk) coach analysing ONE amateur player's recurring decision errors.
All numbers come from KataGo; never invent evaluations, coordinates or moves.
You receive clusters of the player's positions. Each cluster has statistics and representative positions with
diagrams (X = the player to move, O = opponent, 1 = move played, 2 = KataGo's move).

Task: describe the SPECIFIC recurring decision pattern behind each cluster that the evidence supports.
Good: "Frequently defends a locally safe group before resolving a larger weak-group attack."
Bad: "Bad at fighting." (too generic)

Rules:
- Every pattern must cite at least 3 evidence ids from ONE cluster, and only ids that exist.
- A pattern must be supported by repeated evidence, never a single bad move. Skip clusters that do not show a consistent pattern.
- confidence is 0..1 and must not exceed the cluster's statConfidence by more than 0.1.
- trainingFocus: one short sentence on what to look for at the board. No typing exercises.
- Use plain language, at most 2 sentences per description.
- axis must be one of: ${AXES.join(', ')}.
Answer with JSON only: {"patterns":[{"title":"","description":"","axis":"","clusterId":"","evidenceIds":[],"confidence":0,"trainingFocus":""}]}`;

export function buildUserPrompt(req: DiscoveryRequest): string {
  const lines: string[] = [];
  const p = req.player;
  lines.push(
    `Player: ${p.games} analysed games, ${p.moves} moves, accuracy ${(p.accuracy * 100).toFixed(0)}%, average loss ${p.avgScoreLoss.toFixed(2)} points per move.`,
  );
  lines.push('Player DNA by axis:');
  for (const a of p.axes) lines.push(`- ${a.axis}: accuracy ${(a.accuracy * 100).toFixed(0)}% over ${a.n} moves. ${a.summary}`);
  lines.push('');
  for (const c of req.clusters) {
    lines.push(
      `Cluster ${c.id}${c.signature ? ` [${c.signature}]` : ''}: ${c.label}. ${c.occurrences} errors in ${c.opportunities} similar decisions across ${c.games} games; avg loss ${c.avgScoreLoss.toFixed(1)} pts; statConfidence ${c.statConfidence.toFixed(2)}.`,
    );
    for (const e of c.representatives) {
      lines.push(
        `  ${e.id} (game ${e.game}, move ${e.move}, ${e.phase}, ${e.color} to play): played ${e.played} [${e.playedTraits.join(', ')}], KataGo ${e.best} [${e.bestTraits.join(', ')}], loss ${e.scoreLoss.toFixed(1)} pts / ${(e.winrateLoss * 100).toFixed(0)}% winrate`,
      );
      lines.push(e.diagram.split('\n').map((l) => '    ' + l).join('\n'));
    }
    lines.push('');
  }
  return lines.join('\n');
}

const clamp01 = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const str = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '');

/** Keep only well-formed patterns whose evidence exists in the request. */
export function validatePatterns(raw: unknown, req: DiscoveryRequest): { patterns: DiscoveredPattern[]; rejected: number } {
  const obj = typeof raw === 'string' ? safeJson(raw) : raw;
  const list = obj && typeof obj === 'object' && Array.isArray((obj as { patterns?: unknown }).patterns) ? (obj as { patterns: unknown[] }).patterns : [];
  const clusters = new Map(req.clusters.map((c) => [c.id, c]));
  const out: DiscoveredPattern[] = [];
  let rejected = 0;
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      rejected++;
      continue;
    }
    const it = item as Record<string, unknown>;
    const cluster = clusters.get(str(it.clusterId, 16));
    const ids = Array.isArray(it.evidenceIds) ? it.evidenceIds.map((x) => str(x, 16)) : [];
    const known = new Set(cluster?.representatives.map((r) => r.id) ?? []);
    const valid = [...new Set(ids.filter((id) => known.has(id)))];
    const axis = AXES.includes(it.axis as (typeof AXES)[number]) ? (it.axis as (typeof AXES)[number]) : null;
    const title = str(it.title, 120);
    const description = str(it.description, 400);
    const needed = Math.min(3, known.size);
    if (!cluster || !axis || !title || !description || valid.length < needed || cluster.occurrences < 3) {
      rejected++;
      continue;
    }
    out.push({
      title,
      description,
      axis,
      clusterId: cluster.id,
      evidenceIds: valid,
      confidence: Math.min(clamp01(it.confidence), cluster.statConfidence + 0.1),
      trainingFocus: str(it.trainingFocus, 200),
    });
  }
  return { patterns: out, rejected };
}

export function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    const m = /\{[\s\S]*\}/.exec(s);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Current Gemini models to try, best first. Google retires ids for new keys (for
 * example gemini-2.5-flash) and the newest Flash is often overloaded, so the chain
 * falls back to other Flash and Flash-Lite models.
 */
export const GEMINI_CHAIN = ['gemini-flash-latest', 'gemini-3-flash-preview', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite'];

/** Map env config to a concrete provider/model. "Gemini" alone is not a model id. */
export function resolveLlmConfig(env: Record<string, string | undefined>) {
  const key = env.LLM_API_KEY?.trim() || '';
  const providerRaw = (env.LLM_PROVIDER || 'google').trim();
  const provider = /google|gemini|ai\s*studio/i.test(providerRaw) ? 'google' : providerRaw.toLowerCase();
  // Accept "gemini-3.5-flash", "models/gemini-3.5-flash" or "Gemini 3.5 Flash".
  const modelRaw = (env.LLM_MODEL || '').trim().toLowerCase().replace(/^models\//, '').replace(/\s+/g, '-');
  const models = /^gemini-[\w.-]+$/.test(modelRaw) ? [modelRaw, ...GEMINI_CHAIN] : GEMINI_CHAIN;
  return { key, provider, models: [...new Set(models)], configured: !!key && provider === 'google' };
}
