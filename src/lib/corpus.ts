import { computeMoveRecords } from './analysis/records';
import { allPositions, type Board } from './go/board';
import type { GameAnalysis, GameRecord, MoveRecord } from './types';

/**
 * Everything derived from the player's analysed games, kept in memory. Local-first
 * collections are small (hundreds of games), so this stays cheap.
 */
export class Corpus {
  games = new Map<string, GameRecord>();
  analyses = new Map<string, GameAnalysis>();
  records: MoveRecord[] = [];
  byId = new Map<string, MoveRecord>();
  private boardCache = new Map<string, Board[]>();

  constructor(games: GameRecord[], analyses: GameAnalysis[]) {
    for (const g of games) this.games.set(g.id, g);
    for (const a of analyses) this.analyses.set(a.gameId, a);
    for (const g of games) {
      const a = this.analyses.get(g.id);
      if (!a) continue;
      const { records } = computeMoveRecords(g, a);
      for (const r of records) {
        this.records.push(r);
        this.byId.set(r.id, r);
      }
    }
  }

  playerRecords(): MoveRecord[] {
    return this.records.filter((r) => r.isPlayer);
  }

  boards(gameId: string): Board[] {
    let b = this.boardCache.get(gameId);
    if (!b) {
      const g = this.games.get(gameId)!;
      b = allPositions(g.size, g.setup, g.moves);
      if (this.boardCache.size > 64) this.boardCache.clear();
      this.boardCache.set(gameId, b);
    }
    return b;
  }

  /** Game ids in chronological order (date, then import time). */
  gameOrder(filter: (g: GameRecord) => boolean = () => true): string[] {
    return [...this.games.values()]
      .filter(filter)
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.importedAt - b.importedAt)
      .map((g) => g.id);
  }
}
