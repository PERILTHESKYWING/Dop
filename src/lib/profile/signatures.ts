import type { FingerprintAxis, MoveFeatures, PointFeatures } from '../types';

/**
 * A decision signature describes one specific kind of decision and one specific way of
 * getting it wrong. Weaknesses are signatures the player gets wrong repeatedly.
 *
 * - `context`: the decision arises in this position (judged from the position and
 *   KataGo's preferred move, so it can be counted for every position, right or wrong).
 * - `commits`: the played move shows the error pattern (e.g. answered locally).
 * - `decide`: labels a move's decision type. In training, a move is "concept-correct"
 *   when its label matches the label of KataGo's move, so superficially similar
 *   positions can require the opposite decision.
 */
export interface Signature {
  id: string;
  axis: FingerprintAxis;
  title: string;
  /** Sentence template; {rate}, {occ}, {opp}, {loss}, {where} are filled in. */
  template: string;
  focus: string;
  context: (f: MoveFeatures) => boolean;
  commits: (f: MoveFeatures) => boolean;
  decide?: (p: PointFeatures, f: MoveFeatures) => string;
  /** Minimum score loss for a committed move to count as the error. */
  minLoss?: number;
}

const early = (f: MoveFeatures) => f.phase !== 'endgame';
const hasLast = (f: MoveFeatures) => f.played.distLast < 99 || f.best.distLast < 99;
const tenukiLabel = (p: PointFeatures) => (p.local ? 'local' : p.tenuki ? 'tenuki' : 'nearby');

export const SIGNATURES: Signature[] = [
  {
    id: 'local_over_tenuki',
    axis: 'tenuki',
    title: 'Answers locally when the position calls for tenuki',
    template:
      'Answers the opponent locally when a bigger move elsewhere was available: in {occ} of {opp} such positions ({rate}) you replied nearby and lost {loss} points on average{where}.',
    focus: 'Before answering, ask whether the opponent\'s last move actually threatens anything. If not, look for the biggest point elsewhere.',
    context: (f) => hasLast(f) && f.best.tenuki && f.phase !== 'endgame',
    commits: (f) => f.played.local,
    decide: tenukiLabel,
  },
  {
    id: 'premature_tenuki',
    axis: 'tenuki',
    title: 'Tenukis while the local situation is still urgent',
    template:
      'Plays elsewhere while the local fight still needs an answer: {occ} of {opp} urgent local positions ({rate}), costing {loss} points on average{where}.',
    focus: 'Check what happens if the opponent plays twice locally. If it hurts, answer first.',
    context: (f) => hasLast(f) && f.best.local && f.phase !== 'opening',
    commits: (f) => f.played.tenuki,
    decide: tenukiLabel,
  },
  {
    id: 'safe_over_weak',
    axis: 'weakGroups',
    title: 'Defends a safe group before resolving a weak-group fight',
    template:
      'When the opponent probes a group that is already safe, you often answer there while a weak group (yours or the opponent\'s) is the real issue: {occ} of {opp} such positions ({rate}), {loss} points lost on average{where}.',
    focus: 'Find the weakest group on the board first. A move next to a group that is already alive is usually too slow.',
    context: (f) => f.lastNearOwnSafe && (f.best.nearOwnWeak || f.best.nearOppWeak) && !f.best.nearOwnSafe,
    commits: (f) => f.played.nearOwnSafe && !f.played.nearOwnWeak && !f.played.nearOppWeak,
    decide: (p) => (p.nearOwnWeak || p.nearOppWeak ? 'weak-group' : p.nearOwnSafe ? 'safe-group' : 'elsewhere'),
  },
  {
    id: 'missed_attack',
    axis: 'attackDefence',
    title: 'Lets a weak opponent group off the hook',
    template:
      'Misses chances to attack a weak opponent group and plays elsewhere: {occ} of {opp} attacking chances ({rate}), {loss} points lost on average{where}.',
    focus: 'When an opponent group has no base and few liberties, the attack is usually the biggest move. Attack from the side that builds your position.',
    context: (f) => f.best.nearOppWeak && !f.best.nearOwnWeak,
    commits: (f) => !f.played.nearOppWeak,
    decide: (p) => (p.nearOppWeak ? 'attack' : 'other'),
  },
  {
    id: 'neglected_weak_group',
    axis: 'weakGroups',
    title: 'Leaves an own weak group without help',
    template:
      'Leaves an own weak group unattended while playing elsewhere: {occ} of {opp} positions ({rate}), {loss} points lost on average{where}.',
    focus: 'Count the eyes and liberties of your weakest group before starting something new.',
    context: (f) => f.best.nearOwnWeak,
    commits: (f) => !f.played.nearOwnWeak && !f.played.nearOppWeak,
    decide: (p) => (p.nearOwnWeak ? 'defend' : p.nearOppWeak ? 'counter' : 'elsewhere'),
  },
  {
    id: 'too_low',
    axis: 'territoryInfluence',
    title: 'Plays too low when height matters',
    template:
      'Chooses low, territorial moves when a higher move was better: {occ} of {opp} positions ({rate}), {loss} points lost on average{where}.',
    focus: 'Ask whether the move needs to secure territory now or whether building toward the centre is bigger.',
    context: (f) => early(f) && f.best.line >= 4 && !f.best.contact,
    commits: (f) => f.played.line <= 3 && !f.played.contact,
    decide: (p) => (p.line <= 3 ? 'low' : 'high'),
  },
  {
    id: 'too_high',
    axis: 'territoryInfluence',
    title: 'Plays too high when territory was urgent',
    template:
      'Plays high and loose when a solid, lower move was needed: {occ} of {opp} positions ({rate}), {loss} points lost on average{where}.',
    focus: 'When the opponent can slide under or invade, secure the base first.',
    context: (f) => early(f) && f.best.line <= 3 && !f.best.contact,
    commits: (f) => f.played.line >= 4 && !f.played.contact,
    decide: (p) => (p.line <= 3 ? 'low' : 'high'),
  },
  {
    id: 'clinging_to_stones',
    axis: 'sacrifice',
    title: 'Saves small stones that should be sacrificed',
    template:
      'Rescues small, low-liberty stones instead of giving them up: {occ} of {opp} positions ({rate}), {loss} points lost on average{where}.',
    focus: 'Are these stones important, or just stones? Letting them go often gains sente and outside strength.',
    context: (f) => f.ownSmallWeakGroups > 0 && !f.best.extendsSmallWeak && !f.best.savesAtari,
    commits: (f) => f.played.extendsSmallWeak || f.played.savesAtari,
    decide: (p) => (p.extendsSmallWeak || p.savesAtari ? 'save' : 'let-go'),
  },
  {
    id: 'overplayed_invasion',
    axis: 'invasion',
    title: 'Invades too deeply',
    template:
      'Invades deep into the opponent\'s area when it does not work: {occ} of {opp} invasion decisions ({rate}), {loss} points lost on average{where}.',
    focus: 'Before invading, check whether a reduction from outside gains nearly as much without the risk.',
    context: (f) => f.played.invasion || f.best.invasion || f.best.reduction,
    commits: (f) => f.played.invasion && !f.best.invasion,
    decide: (p) => (p.invasion ? 'invade' : p.reduction ? 'reduce' : 'other'),
  },
  {
    id: 'missed_reduction',
    axis: 'invasion',
    title: 'Lets the opponent\'s framework grow',
    template:
      'Does not enter or reduce the opponent\'s framework when it was the biggest point: {occ} of {opp} positions ({rate}), {loss} points lost on average{where}.',
    focus: 'Compare the size of the opponent\'s potential area with the move you want to play.',
    context: (f) => (f.best.invasion || f.best.reduction) && f.phase !== 'endgame',
    commits: (f) => !f.played.invasion && !f.played.reduction,
    decide: (p) => (p.invasion ? 'invade' : p.reduction ? 'reduce' : 'other'),
  },
  {
    id: 'direction_error',
    axis: 'direction',
    title: 'Chooses the wrong side of the board',
    template:
      'Plays in a different area of the board from where the game is decided: {occ} of {opp} positions ({rate}), {loss} points lost on average{where}.',
    focus: 'Look at the whole board: which side is bigger or more urgent, and which direction makes your strength work?',
    context: (f) => early(f) && !f.best.local && f.moveNumber <= 120,
    commits: (f) => !f.sameZoneAsBest && f.distToBest >= 6 && !f.played.local,
    decide: (p) => `zone-${p.zone}`,
  },
  {
    id: 'tactical_oversight',
    axis: 'tactics',
    title: 'Misses a local tactic',
    template:
      'Misses captures, ataris or rescues that decide a local fight: {occ} of {opp} tactical positions ({rate}), {loss} points lost on average{where}.',
    focus: 'Scan for groups with one or two liberties, yours and the opponent\'s, before choosing a move.',
    context: (f) => f.hasTactics,
    commits: (f) =>
      (f.best.captures > 0 && f.played.captures === 0) ||
      (f.best.savesAtari && !f.played.savesAtari) ||
      (f.best.atari && !f.played.atari && f.distToBest > 1) ||
      f.played.selfAtari,
    decide: (p) => (p.captures > 0 ? 'capture' : p.savesAtari ? 'save' : p.atari ? 'atari' : 'other'),
    minLoss: 2.5,
  },
  {
    id: 'avoids_contact_fight',
    axis: 'fighting',
    title: 'Backs away from a contact fight',
    template:
      'Backs away when the position calls for a direct contact move: {occ} of {opp} positions ({rate}), {loss} points lost on average{where}.',
    focus: 'Hane and cuts are often the only moves. Read the direct move before choosing a loose one.',
    context: (f) => f.phase === 'middlegame' && f.best.contact && f.best.local,
    commits: (f) => !f.played.contact && f.distToBest >= 2,
    decide: (p) => (p.contact ? 'contact' : 'loose'),
  },
  {
    id: 'settled_area_opening',
    axis: 'opening',
    title: 'Plays in settled areas during the opening',
    template:
      'In the opening, adds a move to an area that is already settled while bigger open areas remain: {occ} of {opp} opening positions ({rate}), {loss} points lost on average{where}.',
    focus: 'In the opening, the biggest point is usually where neither side is strong yet.',
    context: (f) => f.phase === 'opening' && Math.abs(f.best.ownership) < 0.45,
    commits: (f) => Math.abs(f.played.ownership) >= 0.6,
    decide: (p) => (Math.abs(p.ownership) >= 0.6 ? 'settled' : 'open'),
  },
  {
    id: 'endgame_value',
    axis: 'endgame',
    title: 'Misjudges the size of endgame moves',
    template:
      'Picks a smaller endgame move when a bigger one was available: {occ} of {opp} endgame positions ({rate}), {loss} points lost on average{where}.',
    focus: 'Compare gote and sente values: count what each side gains if they play there first.',
    context: (f) => f.phase === 'endgame',
    commits: () => true,
    minLoss: 1.2,
  },
];

export const signatureById = new Map(SIGNATURES.map((s) => [s.id, s]));

export const MISTAKE_SCORE = 1.5;
export const MISTAKE_WINRATE = 0.05;

export function isMistake(scoreLoss: number, winrateLoss: number, minLoss = MISTAKE_SCORE) {
  return scoreLoss >= minLoss || (winrateLoss >= MISTAKE_WINRATE && scoreLoss >= minLoss * 0.5);
}

/** Contexts present and errors committed for one move. */
export function classifyMove(f: MoveFeatures, scoreLoss: number, winrateLoss: number) {
  const contexts: string[] = [];
  const errors: string[] = [];
  for (const s of SIGNATURES) {
    if (!s.context(f)) continue;
    contexts.push(s.id);
    if (s.commits(f) && isMistake(scoreLoss, winrateLoss, s.minLoss)) errors.push(s.id);
  }
  return { contexts, errors };
}
