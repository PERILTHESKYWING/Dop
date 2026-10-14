import { parseSgfFile, toSgf, type ParsedGame } from './go/sgf';
import type { Color } from './go/types';
import type { GameRecord, GameSource } from './types';
import { hashString } from './util/hash';

const norm = (s: string) => s.trim().toLowerCase();

export function detectPlayerColor(g: Pick<ParsedGame, 'black' | 'white'>, names: string[]): Color | null {
  const set = new Set(names.map(norm).filter(Boolean));
  if (!set.size) return null;
  const b = set.has(norm(g.black));
  const w = set.has(norm(g.white));
  if (b && !w) return 1;
  if (w && !b) return 2;
  return null;
}

/** The side an opponent played in one of their games: the side the user chose, else the side named like them. */
export function opponentColorOf(g: Pick<GameRecord, 'black' | 'white' | 'opponentColor'>, names: Set<string>): Color | null {
  if (g.opponentColor) return g.opponentColor;
  return names.has(norm(g.black)) ? 1 : names.has(norm(g.white)) ? 2 : null;
}

export function gameId(g: ParsedGame): string {
  const moves = g.moves.map((m) => `${m.color}${m.loc}`).join(',');
  const setup = g.setup.map((m) => `${m.color}${m.loc}`).join(',');
  return 'g' + hashString(`${g.size}|${g.komi}|${setup}|${moves}|${g.black}|${g.white}|${g.date ?? ''}`);
}

export function gameFromParsed(g: ParsedGame, fileName: string, source: GameSource, playerNames: string[], sgf?: string): GameRecord {
  return {
    id: gameId(g),
    source,
    fileName,
    sgf: sgf ?? toSgf(g),
    size: g.size,
    komi: g.komi,
    handicap: g.handicap,
    setup: g.setup,
    moves: g.moves,
    black: g.black,
    white: g.white,
    blackRank: g.blackRank,
    whiteRank: g.whiteRank,
    result: g.result,
    date: g.date,
    event: g.event,
    rules: g.rules,
    playerColor: source === 'user' || source === 'demo' ? detectPlayerColor(g, playerNames) : null,
    importedAt: Date.now(),
    status: 'pending',
    warnings: g.warnings,
    progress: { fast: 0, deep: 0, deepTotal: 0, total: g.moves.length + 1 },
  };
}

export interface ImportResult {
  games: GameRecord[];
  errors: { file: string; message: string }[];
}

/** Parse SGF files (possibly several games each) into game records. Never throws. */
export function importSgfTexts(files: { name: string; text: string }[], source: GameSource, playerNames: string[]): ImportResult {
  const games: GameRecord[] = [];
  const errors: { file: string; message: string }[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const { games: parsed, errors: errs } = parseSgfFile(f.text);
    for (const e of errs) errors.push({ file: f.name, message: e });
    for (const p of parsed) {
      const rec = gameFromParsed(p, f.name, source, playerNames, parsed.length === 1 ? f.text : undefined);
      if (seen.has(rec.id)) continue;
      seen.add(rec.id);
      games.push(rec);
    }
  }
  return { games, errors };
}

/**
 * Guess the studied player's name: the name that appears in the most games.
 * Used when the user has not told us who they are.
 */
export function guessPlayerName(games: Pick<GameRecord, 'black' | 'white'>[]): string | null {
  const counts = new Map<string, number>();
  for (const g of games)
    for (const n of [g.black, g.white]) {
      if (!n || /^(black|white)$/i.test(n)) continue;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
  let best: string | null = null;
  let bestN = 0;
  for (const [n, c] of counts)
    if (c > bestN) {
      best = n;
      bestN = c;
    }
  return best && bestN >= Math.max(2, Math.ceil(games.length * 0.5)) ? best : null;
}

type Sides = Pick<GameRecord, 'black' | 'white' | 'playerColor' | 'source'>;

/**
 * Which side the opponent played in a game being moved to their profile: the side named
 * like them, else the side the user did not play (known colour, or the user's own names).
 * null when neither tells (a game between two other people, neither named like them).
 */
export function opponentSide(g: Sides, opponentNames: string[], myNames: string[]): Color | null {
  const theirs = detectPlayerColor(g, opponentNames);
  if (theirs) return theirs;
  if ((g.source === 'user' || g.source === 'demo') && g.playerColor) return g.playerColor === 1 ? 2 : 1;
  const mine = detectPlayerColor(g, myNames);
  return mine ? (mine === 1 ? 2 : 1) : null;
}

/** The likeliest opponent name for games uploaded as the user's by mistake (null if none). */
export function guessOpponentName(games: Sides[], myNames: string[]): string | null {
  const counts = new Map<string, number>();
  const add = (n: string, w: number) => {
    if (!n.trim() || /^(black|white|\?)$/i.test(n.trim())) return;
    counts.set(n, (counts.get(n) ?? 0) + w);
  };
  for (const g of games) {
    const side = opponentSide(g, [], myNames);
    if (side) add(side === 1 ? g.black : g.white, 2);
    else {
      add(g.black, 1);
      add(g.white, 1);
    }
  }
  // A tie (one game between two strangers) is no guess at all: the user picks, not "Black".
  const ranked = [...counts].sort((x, y) => y[1] - x[1]);
  return ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : null;
}
