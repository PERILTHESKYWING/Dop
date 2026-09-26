import { create } from 'zustand';
import { kvGet, kvSet } from '../lib/db/db';
import { findShowing, winnerOf, type LiveGame, type Schedule } from '../lib/broadcast/schedule';
import { uid } from '../lib/util/hash';

/**
 * Betting on the live broadcast, with virtual coins kept in this browser. No real money:
 * coins can't be bought or cashed out. Odds are fixed when the bet is placed, from the
 * engine's winrate at that moment, with a 5% margin; a bet settles when its game ends.
 */

export interface Bet {
  id: string;
  /** The showing (schedule.ts LiveGame.key) and the pool game it shows. */
  key: string;
  gameId: string;
  table: number;
  black: string;
  white: string;
  side: 1 | 2;
  stake: number;
  /** Decimal odds: a win pays stake * odds (stake included). */
  odds: number;
  /** Move number and the side's winrate when the bet was placed. */
  atMove: number;
  winrate: number;
  placedAt: number;
  endsAt: number;
  status: 'open' | 'won' | 'lost' | 'refunded';
  payout?: number;
  result?: string;
}

export interface Wallet {
  coins: number;
  bets: Bet[];
  /** Day (YYYY-MM-DD, local) the daily bonus was last claimed. */
  bonusDay?: string;
  /** Coins won and lost over all settled bets. */
  won: number;
  lost: number;
}

export const START_COINS = 1000;
export const DAILY_BONUS = 100;
export const MARGIN = 0.95;
const KEY = 'broadcast.wallet';

interface State {
  loaded: boolean;
  wallet: Wallet;
}

export const useWallet = create<State>(() => ({ loaded: false, wallet: { coins: START_COINS, bets: [], won: 0, lost: 0 } }));

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

let loading: Promise<void> | null = null;
export function loadWallet() {
  if (!loading)
    loading = kvGet<Wallet>(KEY)
      .then((w) => {
        if (w) useWallet.setState({ wallet: { ...w, won: w.won ?? 0, lost: w.lost ?? 0 } });
      })
      .catch(() => undefined)
      .finally(() => useWallet.setState({ loaded: true }));
  return loading;
}

function save(w: Wallet) {
  useWallet.setState({ wallet: w });
  void kvSet(KEY, w).catch(() => undefined);
}

/** Decimal odds offered on `side` when it has winrate `p`. */
export function oddsFor(p: number): number {
  const q = Math.min(0.97, Math.max(0.03, p));
  return Math.max(1.01, Math.floor((MARGIN / q) * 100) / 100);
}

export function placeBet(g: LiveGame, side: 1 | 2, stake: number, sideWinrate: number): string | null {
  const w = useWallet.getState().wallet;
  stake = Math.floor(stake);
  if (!(stake > 0)) return 'Enter a stake.';
  if (stake > w.coins) return 'Not enough coins.';
  if (g.shown >= g.total) return 'This game has finished.';
  const bet: Bet = {
    id: uid('bet-'),
    key: g.key,
    gameId: g.game.id,
    table: g.table,
    black: g.black,
    white: g.white,
    side,
    stake,
    odds: oddsFor(sideWinrate),
    atMove: g.shown,
    winrate: sideWinrate,
    placedAt: Date.now(),
    endsAt: g.end,
    status: 'open',
  };
  save({ ...w, coins: w.coins - stake, bets: [bet, ...w.bets].slice(0, 300) });
  return null;
}

/** Settle every open bet whose game has ended. Returns the bets settled now. */
export function settleBets(s: Schedule, now = Date.now()): Bet[] {
  const w = useWallet.getState().wallet;
  const done: Bet[] = [];
  let { coins, won, lost } = w;
  const bets = w.bets.map((b) => {
    if (b.status !== 'open' || now < b.endsAt) return b;
    const showing = findShowing(s, b.key, b.gameId);
    let nb: Bet;
    if (!showing) {
      // The broadcast games were replaced since the bet was placed.
      nb = { ...b, status: 'refunded', payout: b.stake };
      coins += b.stake;
    } else if (winnerOf(showing.game) === b.side) {
      const payout = Math.floor(b.stake * b.odds);
      nb = { ...b, status: 'won', payout, result: showing.game.result };
      coins += payout;
      won += payout - b.stake;
    } else {
      nb = { ...b, status: 'lost', payout: 0, result: showing.game.result };
      lost += b.stake;
    }
    done.push(nb);
    return nb;
  });
  if (done.length) save({ ...w, coins, won, lost, bets });
  return done;
}

export const canClaimBonus = (w: Wallet) => w.bonusDay !== today();

export function claimBonus() {
  const w = useWallet.getState().wallet;
  if (!canClaimBonus(w)) return;
  save({ ...w, coins: w.coins + DAILY_BONUS, bonusDay: today() });
}

/** Out of coins with nothing riding: start again with a fresh stack. */
export function refill() {
  const w = useWallet.getState().wallet;
  if (w.coins >= 10 || w.bets.some((b) => b.status === 'open')) return;
  save({ ...w, coins: START_COINS / 2 });
}
