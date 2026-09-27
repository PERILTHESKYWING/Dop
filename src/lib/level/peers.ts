import type { Weakness } from '../types';
import type { PlayerLevel } from './model';

/**
 * Compare a player's decision errors with players of their own level. A weakness that
 * every player at this rank shares is still worth fixing, but one the player makes much
 * more often than their rank peers is what sets them back, so it is trained first.
 *
 * Both sides are counted on the network pass (see level/stats.ts), so the rates compare.
 */
export interface PeerComparison {
  /** Rank bucket the peers come from. */
  rank: number;
  /** Error rate of the peers when this decision arose. */
  peerRate: number;
  /** The player's error rate, counted the same way. */
  playerRate: number;
  /** playerRate / peerRate, smoothed. Above 1: worse than peers. */
  ratio: number;
  opportunities: number;
}

const MIN_PLAYER_CONTEXTS = 8;
const MIN_PEER_CONTEXTS = 30;

export function peerComparison(level: PlayerLevel, signature: string): PeerComparison | null {
  const peers = level.peers;
  if (!peers) return null;
  const mine = level.signatures[signature];
  const theirs = peers.signatures[signature];
  if (!mine || !theirs || mine[0] < MIN_PLAYER_CONTEXTS || theirs[0] < MIN_PEER_CONTEXTS) return null;
  const peerRate = theirs[1] / theirs[0];
  // Shrink the player's rate towards the peers' with a prior worth 10 decisions.
  const playerRate = (mine[1] + 10 * peerRate) / (mine[0] + 10);
  const ratio = (playerRate + 0.01) / (peerRate + 0.01);
  return { rank: peers.rank, peerRate, playerRate: mine[1] / mine[0], ratio, opportunities: mine[0] };
}

/** Weaknesses with their peer comparison attached (when the level is known). */
export function withPeers(ws: readonly Weakness[], level: PlayerLevel | null): Weakness[] {
  return ws.map((w) => {
    const p = level ? peerComparison(level, w.signature) : null;
    return p ? { ...w, peer: p } : { ...w, peer: undefined };
  });
}

/**
 * Training priority: points the weakness costs, how sure we are, and how unusual it is
 * for the player's level (at most doubled or halved by the comparison).
 */
export function weaknessPriority(w: Weakness): number {
  const base = w.totalScoreLoss * w.confidence;
  const f = w.peer ? Math.max(0.5, Math.min(2, w.peer.ratio)) : 1;
  return base * f;
}
