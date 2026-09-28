import type { PositionFacts, ProbeRequest, ProbeResult } from '../../../shared/ask';
import { coordsIn } from '../../../shared/ask';
import type { ChatMessage, ChatRequest, ChatResponse, StudentProfile } from '../../../shared/chat';
import type { PlayerLevel } from '../level/model';
import { rankLabel } from '../level/ranks';
import type { Weakness } from '../types';

export interface ChatOutcome {
  answer: string;
  followups: string[];
  unsupported: string[];
  /** Lines KataGo checked for this answer (the student's own moves first). */
  probes: ProbeResult[];
  corrected: boolean;
  reviewed: boolean;
  model?: string;
  /** Model calls the whole turn took. */
  calls: number;
}

type Post = (body: ChatRequest) => Promise<ChatResponse>;

async function postChat(body: ChatRequest): Promise<ChatResponse> {
  const res = await fetch('/api/llm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) throw new Error('this host has no /api/llm function');
  const j = (await res.json()) as ChatResponse & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j;
}

/**
 * Moves the student names that KataGo has not already looked at ("what about D4?"): they are
 * checked before the first call, so the model can answer at once instead of asking.
 */
export function namedMoves(text: string, facts: PositionFacts, isEmpty: (gtp: string) => boolean, max = 2): ProbeRequest[] {
  const known = new Set(facts.candidates.map((c) => c.move));
  const out: ProbeRequest[] = [];
  for (const c of new Set(coordsIn(text, facts.size))) {
    if (known.has(c) || !isEmpty(c)) continue;
    out.push({ moves: [c], why: 'named by the student' });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * One chat turn: pre-check the moves the student named, ask the model, run any lines it
 * wants KataGo to check (all in one batch), then ask for the final answer.
 */
export async function chatTurn(
  opts: {
    messages: ChatMessage[];
    position?: PositionFacts;
    profile?: StudentProfile;
    deep?: boolean;
    /** Lines to check before the first call. */
    pre?: ProbeRequest[];
  },
  runProbe: (p: ProbeRequest) => Promise<ProbeResult>,
  onStep: (text: string) => void = () => {},
  post: Post = postChat,
): Promise<ChatOutcome> {
  const probes: ProbeResult[] = [];
  if (opts.position)
    for (const p of opts.pre ?? []) {
      onStep(`KataGo is checking ${p.moves.join(' ')}…`);
      probes.push(await runProbe(p));
    }
  const base = { task: 'chat' as const, messages: opts.messages, position: opts.position, profile: opts.profile, deep: opts.deep };
  onStep(opts.deep ? 'The coach is reading the facts (deep mode)…' : 'The coach is reading the facts…');
  const first = await post({ ...base, probes: probes.length ? [...probes] : undefined });
  let calls = first.calls ?? 1;
  let reply = first;
  if (!first.answer && first.probes?.length && opts.position) {
    for (const p of first.probes) {
      onStep(`KataGo is checking ${p.moves.join(' ')}${p.why ? ` (${p.why})` : ''}…`);
      probes.push(await runProbe(p));
    }
    onStep(opts.deep ? 'Writing and double-checking the answer…' : 'Writing the answer…');
    reply = await post({ ...base, probes, final: true });
    calls += reply.calls ?? 1;
  }
  if (!reply.answer) throw new Error('the model gave no answer');
  return {
    answer: reply.answer,
    followups: reply.followups ?? [],
    unsupported: reply.unsupported ?? [],
    probes,
    corrected: !!reply.checks?.corrected,
    reviewed: !!reply.checks?.reviewed,
    model: reply.model,
    calls,
  };
}

const PHASE = { opening: 'opening', middlegame: 'middle game', endgame: 'endgame' } as const;
const AXIS: Record<string, string> = {
  opening: 'opening',
  fighting: 'fighting',
  invasion: 'invasions',
  attackDefence: 'attack and defence',
  territoryInfluence: 'territory vs influence',
  tenuki: 'tenuki',
  sacrifice: 'sacrifice',
  direction: 'direction of play',
  weakGroups: 'weak groups',
  endgame: 'endgame',
  tactics: 'tactics',
};

/** The student's profile for the chat: level, phases, peer numbers and costliest weaknesses. */
export function buildProfile(level: PlayerLevel | null, weaknesses: readonly Weakness[], games: number): StudentProfile {
  const p: StudentProfile = {};
  if (level) {
    const o = level.overall;
    p.level = `about ${rankLabel(o.rank)} (likely ${rankLabel(o.low)} to ${rankLabel(o.high)})`;
    p.phases = Object.entries(level.phases).map(([k, e]) => ({ phase: PHASE[k as keyof typeof PHASE] ?? k, level: rankLabel(e!.rank) }));
    const peer = level.peers?.features as { top1: number; loss: number; blunders: number } | undefined;
    if (peer) {
      const y = level.pooled;
      p.peers = [
        `plays KataGo's first choice ${Math.round(y.top1 * 100)}% of moves (peers ${Math.round(peer.top1 * 100)}%)`,
        `loses ${y.loss.toFixed(2)} points per move (peers ${peer.loss.toFixed(2)})`,
        `blunders (5+ points) on ${(y.blunders * 100).toFixed(1)}% of moves (peers ${(peer.blunders * 100).toFixed(1)}%)`,
      ];
    }
  }
  if (games) p.games = games;
  const active = weaknesses.filter((w) => w.status !== 'resolved').sort((a, b) => b.totalScoreLoss - a.totalScoreLoss).slice(0, 5);
  if (active.length)
    p.weaknesses = active.map((w) => ({
      title: w.llm?.title ?? w.title,
      detail: (w.llm?.description ?? w.description).slice(0, 300),
      area: AXIS[w.category] ?? w.category,
      lossPerMove: w.avgScoreLoss,
      share: `${w.occurrences} times in ${w.opportunities} similar decisions over ${w.games} games` + (w.peer ? `, ${w.peer.ratio >= 1 ? `${w.peer.ratio.toFixed(1)}x as often as` : `less often than`} players of the same level` : ''),
      trend: w.status === 'improving' ? 'Improving lately' : w.trend.newer > w.trend.older * 1.15 && w.trend.older > 0 ? 'Getting more frequent lately' : undefined,
      focus: w.llm?.trainingFocus,
    }));
  return p;
}
