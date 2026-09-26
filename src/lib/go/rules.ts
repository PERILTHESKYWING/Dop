/**
 * Rules and komi. KataGo in the browser always scores by area (Tromp-Taylor style), so
 * games played under territory scoring (Japanese, Korean) are given a komi that makes
 * area scoring match them on average.
 */

const TERRITORY = /territory|jap|kor|\bjp\b|日本|韓|韩|한국/i;
const AREA = /area|chin|\bcn\b|中国|中國|\baga\b|\bnz\b|new ?zealand|tromp|\bing\b|应氏|應氏/i;

/** Territory scoring: explicit Japanese/Korean rules, or no rules with the Japanese/Korean komi of 6.5. */
export function isTerritoryScoring(rules: string | undefined, komi: number): boolean {
  const scoring = rules?.match(/score(area|territory)/i)?.[1];
  if (scoring) return /territory/i.test(scoring);
  if (rules && TERRITORY.test(rules)) return true;
  if (rules && AREA.test(rules)) return false;
  return komi === 6.5;
}

/**
 * The komi to give KataGo. Area scoring counts the stones on the board, so the side that
 * fills the last neutral point gains a point that territory scoring ignores; on average
 * Black gets half a point more. Japanese 6.5 therefore corresponds to area 7. (On a game
 * analysed by Lizzie with Japanese rules, the built-in network's scores matched best with
 * this half point added.)
 */
export function engineKomi(komi: number, rules: string | undefined): number {
  return isTerritoryScoring(rules, komi) ? komi + 0.5 : komi;
}

/** The usual komi for an even 19x19 game under these rules. */
export function standardKomi(rules: string | undefined): number {
  return rules && TERRITORY.test(rules) ? 6.5 : 7.5;
}
