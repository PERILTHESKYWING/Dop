/**
 * The teacher's voice. text.ts states what KataGo found as checked facts; this file turns the
 * same reads into an answer a person would give, following XIAO's critique of 28 answers
 * (2026-10-16, eval/coach/rubric.json):
 *
 * - Answer first, then the Go reason (shape, territory against a framework, sente, a key
 *   point both sides want, stones that die), numbers only as support and only when they mean
 *   something. No tenth-of-a-point comparisons; no winrates in life and death.
 * - The voice follows the situation (situation.ts): relaxed and "play your style" in a wide
 *   open opening, a short celebration for a good move, a cheeky one-liner for a blunder,
 *   Yes/No first for "can I kill it?", the board's picture first for "explain this position".
 * - Move order is checked honestly: when the two lines meet again, it says so ("plot twist").
 * - Every move and number comes from the reads (planner.ts, concepts.ts, effects.ts) and every
 *   number is also in a fact, so the guard in text.ts and checkAnswer still hold.
 */
import { chebyshev, zoneOf } from '../../go/coords';
import { other, PASS, type Color, type Loc } from '../../go/types';
import { boardPicture, purposes, strongNear, type Purpose } from './effects';
import { keyPointOf, localR, movePurposes, type ConceptContext } from './concepts';
import { colorAdj, colorWord, coord, fmt1, groupOwn, looseGroups, pct, sideLead, zoneName } from './geometry';
import type { Findings } from './planner';
import { shapeOf, STYLE_WORDS, styleOf, type MoveStyle } from './shapes';
import type { ConceptHit, Fact, LifeDeathVerdict, Situation, StudentProfile } from './types';

export interface Teaching {
  summary: string;
  sections: { title: string; text: string }[];
  /** Facts for numbers the teacher text uses that text.ts did not state (rounded leads, stone counts). */
  facts: Fact[];
  /** The concepts the text actually teaches (a textbook diagram is only built for one of these). */
  topics: string[];
}

export interface TeachInput {
  f: Findings;
  ctx: ConceptContext;
  concepts: ConceptHit[];
  situation: Situation;
  /** text.ts's facts (the teacher text reuses their wording for the numbers section). */
  facts: Fact[];
  student?: StudentProfile;
  ld?: LifeDeathVerdict | null;
}

/** A small stable hash so the same position always gets the same wording, and others vary. */
function seedOf(f: Findings): number {
  let h = f.pos.moves.length * 31 + f.pos.size;
  for (const l of [f.best?.loc, f.asked?.loc, ...f.pos.moves.slice(-3).map((m) => m.loc)]) h = (h * 131 + ((l ?? 7) + 11)) >>> 0;
  return h;
}

/** "in the upper left", "on the right side", "at the top". */
export function inRegion(region: string): string {
  if (region === 'top' || region === 'bottom') return `at the ${region}`;
  if (region.endsWith('side')) return `on the ${region}`;
  return `in the ${region}`;
}

const STYLE_IF: Record<MoveStyle, string> = {
  territory: 'If you like territory',
  fighting: "If you'd rather pick a fight",
  influence: 'If you like building outward',
  solid: 'For a solid, safe move',
};

const STYLE_YOU: Record<MoveStyle, string> = {
  territory: 'territory',
  fighting: 'fighting',
  influence: 'building frameworks',
  solid: 'solid, safe moves',
};

export function teach(input: TeachInput): Teaching {
  const { f, concepts, situation: sit, student } = input;
  const size = f.pos.size;
  const C = (l: Loc) => coord(l, size);
  const mover = f.mover;
  const opp = other(mover);
  const me = colorWord(mover);
  const them = colorWord(opp);
  const best = f.best!;
  const level = student?.level ?? 'intermediate';
  const facts: Fact[] = [];
  const fact = (text: string) => {
    facts.push({ id: `t${facts.length + 1}`, text });
    return text;
  };
  const ref = (id?: string) => (id ? ` [[${id}]]` : '');
  let seed = seedOf(f);
  const pick = <T,>(xs: readonly T[]): T => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return xs[seed % xs.length];
  };
  const hit = (id: string) => concepts.find((h) => h.id === id);
  const groups = input.ctx.groups;
  /** A Go term, glossed in plain words the first time for beginners (the site's hover does the rest). */
  const glossed = new Set<string>();
  const gloss = (term: string, plain: string) => {
    if (level !== 'beginner' || glossed.has(term)) return term;
    glossed.add(term);
    return `${term} (${plain})`;
  };
  const shapeName = (l: Loc, c: Color = mover) => {
    if (l === PASS) return 'a pass';
    const s = shapeOf(f.board, l, c);
    return s ? `${s.name} at ${C(l)}` : C(l);
  };

  /** A purpose in words: "takes territory in the upper left" (verb) or "taking…" (ing). */
  const purpose = (p: Purpose, form: 'verb' | 'ing', who: Color = mover): string => {
    const W = colorWord(who);
    const O = colorWord(other(who));
    const v = (verb: string, ing: string) => (form === 'verb' ? verb : ing);
    switch (p.kind) {
      case 'territory': {
        const corner = /^(upper|lower) (left|right)$/.test(p.region);
        if (corner) return p.from ? `${v('takes', 'taking')} the ${p.region.replace(' ', '-')} corner away from ${O}` : `${v('secures', 'securing')} the ${p.region.replace(' ', '-')} corner`;
        return `${v('takes', 'taking')} territory ${inRegion(p.region)}${p.from ? ` from ${O}` : ''}`;
      }
      case 'framework':
        return `${v('builds', 'building')} up ${W}'s ${gloss('framework', 'moyo: a large area that is not territory yet')} ${inRegion(p.region)}`;
      case 'reduce':
        topics.push('reduction');
        return `${v('trims', 'trimming')} ${O}'s area ${inRegion(p.region)}`;
      case 'press':
        return `${v('puts', 'putting')} pressure on ${O}'s ${p.stones > 1 ? 'stones' : 'stone'} at ${C(p.at)}`;
      case 'secure':
        return p.saved ? `${v('saves', 'saving')} the ${colorAdj(who)} stones at ${C(p.at)}` : `${v('makes', 'making')} the ${colorAdj(who)} group at ${C(p.at)} safer`;
    }
  };
  /** One or two purposes: "expands Black's framework on the right side while putting pressure on…". */
  const purposeLine = (ps: Purpose[], who: Color = mover): string => {
    if (!ps.length) return '';
    const [a, b] = ps;
    if (!b) return purpose(a, 'verb', who);
    if (b.kind === 'press' || b.kind === 'secure') return `${purpose(a, 'verb', who)} while ${purpose(b, 'ing', who)}`;
    if (a.kind === 'press' || a.kind === 'secure') return `${purpose(b, 'verb', who)} while ${purpose(a, 'ing', who)}`;
    return `${purpose(a, 'verb', who)} and ${purpose(b, 'verb', who)}`;
  };
  const twoBirds = (ps: Purpose[]) => ps.length >= 2 && ps.some((p) => p.kind === 'press') && ps.some((p) => p.kind !== 'press');

  const bestRead = f.afterBest ?? f.consequence?.b.checkpoints.find((c) => c.ply === 1)?.read ?? null;
  const bestPs = movePurposes(input.ctx, best.loc, bestRead);
  const sections: { title: string; text: string }[] = [];
  const summary: string[] = [];
  const topics: string[] = [];

  // Facts already stated by text.ts, found by what they say, for the numbers section.
  const factLike = (re: RegExp) => input.facts.find((x) => re.test(x.text))?.text;
  // Numbers support the teaching; they are left out where they would only add noise (a wide
  // open position, two practically equal moves, a beginner) and never shown for a problem.
  // One fact at most, with one winrate at most (XIAO: numbers as support, not a report).
  const numbersSection = (...texts: (string | undefined)[]) => {
    const t = texts.find(Boolean);
    if (!t || sit.tsumego || sit.tone === 'relaxed' || sit.tone === 'celebrate' || level === 'beginner') return;
    if (sit.phase === 'opening' && !f.asked && (sit.gap === 'negligible' || sit.gap === 'none')) return;
    sections.push({ title: "KataGo's numbers", text: t });
  };
  const bestFact = factLike(/^KataGo's best move for/);

  // ---------------------------------------------------------------------------------------
  // Life and death: the answer, the vital point, what happens if it is missed. No winrates.
  if (sit.tsumego) {
    tsumego();
    return { summary: summary.join(' '), sections, facts, topics: [...new Set(topics)] };
  }

  switch (sit.tone) {
    case 'overview':
      overview();
      break;
    case 'blunder':
      blunder();
      break;
    case 'celebrate':
      celebrate();
      break;
    case 'relaxed':
      if (f.asked && f.asked.legal && !f.asked.isBest) whyNot();
      else relaxed();
      break;
    default:
      if (f.asked && f.asked.legal && !f.asked.isBest && f.asked.read) whyNot();
      else bestMove();
  }
  return { summary: summary.join(' '), sections, facts, topics: [...new Set(topics)] };

  // ---------------------------------------------------------------------------------------

  function tsumego() {
    const ld = input.ld;
    const intent = f.question.intent;
    const lineVar = f.vars.best;
    const missVar = f.vars.threat;
    const vital = best.loc;
    const saved = hit('save-stones');
    const weak = weakNear(vital);
    // Whose group: the solver's target, the stones the move saves, else the weak group next to it.
    const owner: Color = ld?.owner ?? (saved && intent !== 'kill' ? mover : intent === 'kill' ? opp : intent === 'live' ? mover : (weak?.color ?? mover));
    const attacking = owner !== mover;
    const target = ld?.target[0] ?? (saved && !attacking ? saved.at[0] : weak?.stones[0]);
    const stones = ld?.target ?? (target !== undefined ? (groups.find((g) => g.stones.includes(target))?.stones ?? [target]) : []);
    const n = stones.length;
    const groupWords = target !== undefined ? `the ${colorAdj(owner)} group at ${C(target)}` : `the ${colorAdj(owner)} group`;
    const key = ld?.key ?? vital;
    const near = (l: Loc | undefined) => l !== undefined && l !== PASS && (chebyshev(l, key, size) <= localR(size) + 1 || stones.some((q) => chebyshev(q, l, size) <= 2));
    const proven = !!ld?.proven && ld.result !== 'unresolved';
    // The solver's verdict, else KataGo's: the group's ownership after the key move.
    const own = endOwn(lineVar, target);
    const fate = ld && ld.result !== 'unresolved' ? ld.result : own === null ? 'unresolved' : own >= 0.5 ? 'alive' : own <= -0.5 ? 'dead' : 'unresolved';
    // A ko only counts when KataGo's own line takes a stone right at the group.
    const koLine = hit('ko');
    const koNear = !!koLine && koLine.variation === lineVar && stones.some((q) => chebyshev(q, koLine.at[0], size) <= 2);
    const isKo = fate === 'ko' || (fate === 'unresolved' && koNear);
    const unsure = ld && !proven ? " (that's KataGo's reading; the solver could not finish this one)" : '';
    const koG = gloss('ko', 'a capture both sides can take back in turn');
    const vitalG = gloss('vital point', 'the point that decides life or death');
    const press = bestPs.find((p) => p.kind === 'press');

    let missSaid = false;
    let koSentence = '';
    if (saved && !attacking && intent !== 'live') {
      // Stones that die unless saved now (XIAO, items 15 and 18), and what else the move does.
      const big = n >= 6;
      const missAt = ld?.missLine[0] ?? f.threat?.move;
      const dieWhen = missAt === vital ? `if ${them} plays there first${ref(missVar)}` : `without it${ref(missVar)}`;
      missSaid = true;
      summary.push(
        big
          ? `${cap(groupWords)} isn't alive yet! ${C(vital)}${ref(lineVar)} saves it: ${dieWhen}, the ${n} stones die.`
          : `${C(vital)}${ref(lineVar)} is the move: it saves the ${count(n, `${colorAdj(mover)} stone`)} at ${C(saved.at[0])}, which ${n > 1 ? 'die' : 'dies'} ${dieWhen}.`,
      );
      if (press && press.kind === 'press') {
        const whose = press.stones >= 8 ? `${them}'s big group at ${C(press.at)}` : `${them}'s stones at ${C(press.at)}`;
        summary.push(`And it keeps the pressure on ${whose}: two jobs with one move.`);
      }
      if (isKo || koNear) {
        // XIAO (item 15): saving the group is only the start; say what the ko is worth.
        const lives = endOwn(lineVar, target);
        const who = lives !== null && lives >= 0.5 ? `KataGo expects ${me} to come out on top, but ` : '';
        const threats = koThreatGroups(stones);
        koSentence = `Saving ${big ? 'it' : 'them'} is only the start: the line runs into a ${koG}${koLine ? ` at ${C(koLine.at[0])}` : ''}${ref(lineVar)}, right next to the group, so the ${n} stones ride on it. ${cap(who)}${who ? 'count' : 'Count'} your ko threats before it starts${threats ? `: they will come from ${threats}` : ''}.`;
      }
    } else if (intent === 'kill' || (attacking && intent !== 'live')) {
      // "Can I kill this group?": Yes / No / It depends, first (item 17).
      if (isKo) summary.push(`**It depends on a ${koG}.** ${me} starts with ${C(key)}${ref(lineVar)}: if ${me} wins the ko, ${groupWords} dies; if ${them} wins it, the group lives.`);
      else if (fate === 'dead') summary.push(`**Yes!** ${me} can kill ${groupWords}${unsure}. The ${vitalG} is ${C(key)}${ref(lineVar)}.`);
      else if (fate === 'alive' || fate === 'seki') summary.push(`**No**, not by force: ${groupWords} ${fate === 'seki' ? `ends in ${gloss('seki', 'both sides alive without two eyes')}` : 'lives'} even if ${me} plays first${unsure}. ${C(key)}${ref(lineVar)} is the most ${me} can do here.`);
      else summary.push(`**It depends.** ${C(key)}${ref(lineVar)} is the ${vitalG}, but the fight isn't settled after it: read the next moves out carefully.`);
    } else {
      if (isKo) summary.push(`${cap(groupWords)} is not alive yet: ${C(key)}${ref(lineVar)} is the try, and it comes down to a ${koG}. Win it and the group lives; lose it and it dies.`);
      else if (fate === 'alive' || fate === 'seki') summary.push(`${me} lives with ${C(key)}${ref(lineVar)}, the ${vitalG}${unsure}.${fate === 'seki' ? ` It ends in ${gloss('seki', 'both sides alive without two eyes')}.` : ''}`);
      else if (fate === 'dead') summary.push(`This one is hard: ${groupWords} does not live by force${unsure}. ${C(key)}${ref(lineVar)} is the best try.`);
      else summary.push(`${C(key)}${ref(lineVar)} is the ${vitalG} for ${groupWords}, but the fight isn't settled after it: read the next moves out carefully.`);
    }
    // The opponent's strongest answer, kept to the local fight.
    const line = ld?.line.length ? ld.line : (f.variations.find((v) => v.id === lineVar)?.moves.map((m) => m.loc) ?? []);
    if (near(line[1])) summary.push(`${them}'s strongest answer is ${C(line[1])}${near(line[2]) ? `, and ${me} follows with ${C(line[2])}` : ''}.`);
    if (koSentence) summary.push(koSentence);
    // What happens if the key move is missed: the solver's line, else KataGo's, only when it is local.
    const t = f.threat;
    const missMove = ld?.missLine[0] ?? t?.move;
    if (missMove !== undefined && near(missMove)) {
      let outcome: 'lives' | 'dies' | null = null;
      if (ld && ld.ifOtherFirst !== 'unresolved') outcome = ld.ifOtherFirst === 'dead' ? 'dies' : ld.ifOtherFirst === 'ko' ? null : 'lives';
      else if (t?.read.ownership && target !== undefined) {
        const g = groups.find((x) => x.stones.includes(target));
        const v = g ? groupOwn(g, t.read.ownership) : null;
        outcome = v === null ? null : v <= -0.5 ? 'dies' : v >= 0.5 ? 'lives' : null;
      }
      const matters = attacking ? outcome === 'lives' : outcome === 'dies';
      const where = missMove === key ? 'there' : chebyshev(missMove, key, size) <= 1 ? `right next to it at ${C(missMove)}` : `at ${C(missMove)}`;
      if (matters && !missSaid) summary.push(`If ${me} misses it, ${them} plays ${where}${ref(missVar)} and the group ${outcome}.`);
    }
    topics.push(...(isKo || (koNear && missSaid) ? ['ko'] : []));
    sections.push({
      title: 'How sure is this',
      text: proven
        ? `Kami's life-and-death reader checked every move in this corner for both sides: the result above is proven, not just KataGo's opinion.`
        : ld
          ? `Kami's life-and-death reader could not settle every line here, so this rests on KataGo's reading. Treat it as very likely, not proven.`
          : `The area around this group is too big for Kami's life-and-death reader to check every move, so this rests on KataGo's reading.`,
    });
  }

  function overview() {
    const own = f.root?.ownership;
    const pic = own ? boardPicture(f.board, own, groups) : null;
    const bLead = f.root!.bLead;
    const leader: Color = bLead >= 0 ? 1 : 2;
    const trailer = other(leader);
    const abs = Math.abs(bLead);
    const rounded = Math.round(abs);
    const L = colorWord(leader);
    const T = colorWord(trailer);
    const ahead = f.question.intent === 'ahead';
    const leadLine = abs < 2 ? `The game is close: ${L} is only slightly ahead.` : `${L} is ${abs < 6 ? 'a little' : abs < 15 ? 'clearly' : 'far'} ahead.`;
    const countLine = abs >= 2 ? `In all, that's about ${rounded} points for ${L}.` : '';
    if (abs >= 2) fact(`Rounded, ${L}'s lead is about ${rounded} points.`);

    // The board's picture: who has what, what is still open, which groups are weak.
    const why: string[] = [];
    if (pic) {
      const sureL = pic.sure.filter((s) => s.color === leader).map((s) => s.region);
      const sureT = pic.sure.filter((s) => s.color === trailer).map((s) => s.region);
      const frL = pic.frameworks.filter((s) => s.color === leader).map((s) => s.region);
      const frT = pic.frameworks.filter((s) => s.color === trailer).map((s) => s.region);
      if (sureL.length) why.push(`${L} has secure territory ${regionsIn(sureL.slice(0, 2))}`);
      if (sureT.length) why.push(`${T}'s ${sureL.length ? '' : 'secure '}territory is ${regionsIn(sureT.slice(0, 2))}`);
      if (frL.length) why.push(`${L}${sureL.length ? ' also' : ''} has a ${gloss('framework', 'moyo: a large area that is not territory yet')} ${regionsIn(frL.slice(0, 1))}`);
      if (frT.length) why.push(`${T}'s best hope is the framework ${regionsIn(frT.slice(0, 1))}`);
    }
    const weak = pic?.weak.slice(0, 2) ?? [];
    const dead = pic?.dead.slice(0, 1) ?? [];
    const weakLine = weak.length ? `${weak.map((w) => `the ${colorAdj(w.color)} group at ${C(w.at)}`).join(' and ')} ${weak.length > 1 ? 'are' : 'is'} still weak` : '';
    const deadLine = dead.length ? `the ${colorAdj(dead[0].color)} stones at ${C(dead[0].at)} are already dead` : '';
    const picture = [why.join('; '), weakLine, deadLine].filter(Boolean).join('; ');

    // What each side should do.
    const plan: string[] = [];
    if (abs >= 6) {
      const lw = weak.find((w) => w.color === leader);
      plan.push(`${L} should keep it simple: ${lw ? `look after the group at ${C(lw.at)} and ` : ''}avoid needless fights.`);
      const tw = weak.find((w) => w.color === leader);
      const target = tw ? `attack the weak group at ${C(tw.at)}` : pic?.frameworks.find((s) => s.color === leader) ? `get into ${L}'s framework ${regionsIn([pic.frameworks.find((s) => s.color === leader)!.region])}` : 'look for a fight where it can win something big';
      plan.push(`${T} needs to make something happen: ${target}.`);
    } else if (weak.length) {
      plan.push(`Both sides have work to do, and the weak ${weak.length > 1 ? 'groups decide' : 'group decides'} the game.`);
    } else {
      plan.push(`It's a game of big points now: whoever takes the larger areas first stays ahead.`);
    }
    const next = bestReason();
    const nextLine = `For ${me} now, KataGo's move is ${shapeName(best.loc)}${ref(f.vars.best)}${next ? `: it ${next}` : ''}.`;

    if (ahead) {
      summary.push(leadLine);
      if (picture) summary.push(`${cap(picture)}.`);
      if (countLine) summary.push(countLine);
      summary.push(...plan, nextLine);
    } else {
      // "Explain this position": the picture first, then the balance.
      const phase = sit.phase === 'opening' ? 'an opening' : sit.phase === 'endgame' ? 'an endgame (yose)' : 'a middle-game';
      summary.push(`This is ${phase} position${picture ? `: ${picture}` : ''}.`);
      summary.push(countLine ? leadLine.replace(/\.$/, `, by about ${rounded} points.`) : leadLine, ...plan, nextLine);
    }
    numbersSection(factLike(/^Before /), bestFact);
  }

  function blunder() {
    const a = f.asked!;
    const lost = concepts.find((h) => h.id === 'dead-group' && h.variation === f.vars.asked && f.board.stones[h.at[0]] === mover);
    const won = concepts.find((h) => h.id === 'dead-group' && h.variation === f.vars.asked && f.board.stones[h.at[0]] !== mover);
    const reply = a.reply !== undefined && a.reply !== PASS ? a.reply : null;
    const n = lost ? stonesIn(lost.evidence) : null;
    const opener = pick(['Oops!', 'Ouch!', 'Uh-oh.']);
    const grab = won ? `${C(a.loc)} captures the stones at ${C(won.at[0])}, but` : `${C(a.loc)}`;
    if (lost) {
      const what = n !== null && n >= 10 ? 'an entire dragon 🐉🎁' : `${n ? `${n} stones` : 'a whole group'} 🎁`;
      summary.push(`${opener} ${grab} ${won ? 'it ' : ''}hands ${them} ${what}: ${them} answers ${reply !== null ? C(reply) : 'at once'}${ref(f.vars.asked)} and the ${colorAdj(mover)} stones at ${C(lost.at[0])} die.`);
      const far = chebyshev(a.loc, lost.at[0], size) > localR(size) + 2;
      summary.push(won ? 'Before grabbing small captures, check that your big groups are safe.' : far ? "Next time, check your groups' liberties and escape routes before playing elsewhere." : 'Next time, read out the liberties first: this group had no time to spare.');
      const saves = chebyshev(best.loc, lost.at[0], size) <= localR(size) + 2;
      summary.push(`${saves ? `${C(best.loc)}${ref(f.vars.best)} keeps the group alive.` : `${C(best.loc)}${ref(f.vars.best)} was the move.`}`);
    } else {
      summary.push(`${opener} ${C(a.loc)} is a big mistake: ${them} answers ${reply !== null ? C(reply) : 'elsewhere'}${ref(f.vars.asked)} and ${me} loses far more than the move gains.`);
      summary.push(`Play ${C(best.loc)}${ref(f.vars.best)} instead.`);
    }
    numbersSection(factLike(/ is [\d.]+ points worse than /));
  }

  function celebrate() {
    const a = f.asked!;
    const askedPs = a.isBest ? bestPs : movePurposes(input.ctx, a.loc, a.read);
    const birds = twoBirds(askedPs);
    const opener = birds ? pick(['Nice move!', 'Lovely move!']) : pick(['Look at you! 🎯', 'Nice move! 🎯', 'Good eye! 🎯']);
    const o = f.other ?? (a.isBest ? f.alternatives[0] : undefined);
    // Both lines reaching the same stones within a few moves: "you arrive at the same position anyway".
    const meet = !a.isBest && sameSoon(f.vars.asked, f.vars.best);
    if (a.isBest) {
      summary.push(`${opener} ${C(a.loc)} is exactly KataGo's choice here${ref(f.vars.best)}.`);
    } else if (meet) {
      summary.push(`${opener} ${C(a.loc)}${ref(f.vars.asked)} is just as good as KataGo's favourite ${C(best.loc)}, and you arrive at the same position anyway${ref(f.vars.best)}. No need to copy the engine's homework when yours gets the same result!`);
    } else if (a.loss <= -0.5) {
      summary.push(`${opener} ${C(a.loc)}${ref(f.vars.asked)} is every bit as good as KataGo's own choice, ${C(best.loc)}${ref(f.vars.best)}: in KataGo's reads it even does a little better.`);
    } else {
      summary.push(`${opener} You found a move just as good as KataGo's favourite: ${C(a.loc)}${ref(f.vars.asked)} and ${C(best.loc)}${ref(f.vars.best)} are practically equal, so no need to copy the engine's homework.`);
    }
    // Two good moves with different characters get the "peaceful or fight" line instead (it names the purposes itself).
    const choice = sit.styleChoice && !a.isBest && !meet;
    if (askedPs.length && !choice) summary.push(`${C(a.loc)} ${purposeLine(askedPs)}.${birds ? ' Two birds with one stone! 🐦' : ''}`);
    const sente = concepts.find((h) => (h.id === 'sente' || h.id === 'double-sente') && h.at[0] === a.loc);
    if (sente && !choice) summary.push(`And it keeps ${gloss('sente', 'the opponent has to answer, so you move first again')}: ${them} has to answer it.`);
    if (choice) {
      styleChoice(a.loc, best.loc);
    } else if (!a.isBest && !meet && askedPs.length && bestPs.length && purpose(bestPs[0], 'verb') !== purpose(askedPs[0], 'verb')) {
      // Same value, different plans: say what the other one does, and leave the choice to them.
      summary.push(`${C(best.loc)}${ref(f.vars.best)} ${purposeLine(bestPs.slice(0, 1))} instead. Pick whichever plan you prefer.`);
    } else if (!a.isBest && !meet) {
      summary.push('Pick whichever you prefer.');
    } else if (o && a.isBest) {
      const g = o.lead !== undefined ? best.lead - o.lead : 0;
      if (g < 0.5) summary.push(`${C(o.loc)}${ref(f.vars.other ?? f.vars.alts[0])} is just as good, so play whichever you like.`);
    }
    numbersSection(bestFact);
  }

  /** "Peaceful game or a fight ⚔️?" for two good moves with different characters (XIAO, item 20). */
  function styleChoice(x: Loc, y: Loc) {
    const sx = styleOf(f.board, x, mover);
    const sy = styleOf(f.board, y, mover);
    if (sx !== 'fighting' && sy !== 'fighting') {
      // Two calm moves of different kinds: what each one does, then the choice.
      const say = (l: Loc, st: MoveStyle) => {
        const ps = movePurposes(input.ctx, l, l === best.loc ? bestRead : f.asked?.read);
        return ps.length ? `${C(l)} ${purposeLine(ps.slice(0, 1))}` : `${shapeName(l)} is ${STYLE_WORDS[st]}`;
      };
      const [tx, ty] = [say(x, sx), say(y, sy)];
      // The same job in the same words is no choice at all.
      if (tx.slice(C(x).length) === ty.slice(C(y).length)) return;
      summary.push(`They make different games, though: ${tx}, while ${ty}. Which kind of game do you prefer?`);
      const you = student?.style;
      const fit = you ? [x, y].find((_, i) => [sx, sy][i] === you) : undefined;
      if (fit !== undefined) summary.push(`You usually like ${STYLE_YOU[you!]}, so ${C(fit)} may suit you.`);
      return;
    }
    const fight = sx === 'fighting' ? x : y;
    const calm = fight === x ? y : x;
    const fightPs = movePurposes(input.ctx, fight, fight === best.loc ? f.afterBest : f.asked?.read);
    const calmPs = movePurposes(input.ctx, calm, calm === best.loc ? f.afterBest : f.asked?.read);
    const calmWhy = calmPs.length ? ` ${C(calm)} ${purposeLine(calmPs)}, a calmer game.` : ` ${C(calm)} keeps the game calmer.`;
    const press = fightPs.find((p) => p.kind === 'press');
    const fightWhy = press && press.kind === 'press' ? ` ${C(fight)} goes straight after the stones at ${C(press.at)}, and things can get messy quickly.` : ` ${C(fight)} starts a fight that needs careful reading.`;
    summary.push(`They make different games, though.${calmWhy}${fightWhy} Peaceful game or a fight ⚔️? Your call.`);
    const you = student?.style;
    if (you === 'fighting') summary.push(`You like fighting, so ${C(fight)} may suit you.`);
    else if (you === 'solid' || you === 'territory') summary.push(`You usually like ${STYLE_YOU[you]}, so ${C(calm)} may suit you.`);
  }

  function relaxed() {
    const handicap = sit.handicap;
    const n = stoneTotal();
    if (handicap) {
      const moveNo = f.pos.moves.length + 1;
      fact(`This is move ${moveNo} of a handicap game.`);
      summary.push(`Honestly, it's only move ${moveNo} of a handicap game, so don't stress 😊. There are plenty of good answers here.`);
    } else {
      fact(`There are ${n} stones on the board.`);
      summary.push(`${pick(['The board is still wide open!', 'Plenty of room to play here!', "It's still early, so relax!"])} With only ${n} stones down there's no single correct move, so play to your style${n <= 6 ? ' 😊' : ''}.`);
    }
    // A few good options, each with the kind of game it makes.
    const options: { loc: Loc; id?: string; style: MoveStyle; ps: Purpose[]; fav: boolean }[] = [];
    const add = (loc: Loc, id: string | undefined, ps: Purpose[], fav: boolean) => {
      if (loc === PASS || options.some((o) => o.loc === loc)) return;
      options.push({ loc, id, style: styleOf(f.board, loc, mover), ps, fav });
    };
    const ta = f.teachAlt;
    if (ta && handicap) add(ta.loc, f.vars.teach, [], false);
    add(best.loc, f.vars.best, bestPs, true);
    // The calm shape second: "you could play a keima for a solid approach" (XIAO, items 22 and 23).
    if (ta && !handicap) add(ta.loc, f.vars.teach, [], false);
    f.alternatives.slice(0, 2).forEach((alt, i) => {
      if (best.lead - alt.lead < 1.5) add(alt.loc, f.vars.alts[i], [], false);
    });
    const you = student?.style ?? null;
    const lines: string[] = [];
    const plain: string[] = [];
    const seen = new Set<MoveStyle>();
    for (const o of options.slice(0, 3)) {
      const what = shapeName(o.loc);
      const does = o.ps.length ? purposeLine(o.ps.slice(0, 1)) : shapeDoes(o.loc);
      const fav = o.fav && options.length > 1 ? ", KataGo's favourite by a hair" : '';
      if (handicap && o === options[0] && ta && o.loc === ta.loc) {
        lines.push(`A solid choice is ${what}${ref(o.id)}: it's not KataGo's very first pick, but it keeps things simple and safe, and you don't need the engine's exact moves to play good Go.`);
        continue;
      }
      if (!does) {
        // Nothing to say about it but that it works: listed together at the end.
        plain.push(`${what}${ref(o.id)}`);
        continue;
      }
      if (seen.has(o.style)) lines.push(`Or ${what}${ref(o.id)} ${does}${fav}.`);
      else lines.push(`${STYLE_IF[o.style]}, ${what}${ref(o.id)} ${does}${fav}.`);
      seen.add(o.style);
    }
    if (plain.length) lines.push(`${cap(plain.join(' and '))} ${plain.length > 1 ? 'are' : 'is'} fine too.`);
    summary.push(...lines);
    const match = you ? options.find((o) => o.style === you) : undefined;
    const calm = !handicap && ta && options.some((o) => o.loc === ta.loc) ? ta.loc : null;
    if (match) summary.push(`Since you tend to like ${STYLE_YOU[you!]}, ${C(match.loc)} fits you nicely.`);
    else if (!you && calm !== null) summary.push(`I'd lean towards ${C(calm)} if you like keeping things steady, but there's no need to hunt for one perfect move.`);
    else if (!you && options.length > 1) summary.push('What kind of game do you feel like?');
    numbersSection(bestFact, ...f.vars.alts.slice(0, 1).map(() => factLike(/ is (about as good as|[\d.]+ points worse than) /)));
  }

  function bestMove() {
    const reason = bestReason();
    const t = f.threat;
    const keyBoth = t && chebyshev(t.move, best.loc, size) <= 1;
    const saved = hit('save-stones');
    const ds = hit('double-sente');
    const rs = hit('reverse-sente');
    const big = f.question.intent === 'biggest';
    const react = reaction();
    summary.push(`${react ? `${react} ` : ''}${big ? `The biggest move is ${shapeName(best.loc)}` : `${me} should play ${shapeName(best.loc)}`}${ref(f.vars.best)}${reason ? `: it ${reason}` : ''}.`);
    if (saved) {
      summary.push(`Without it, ${them} plays ${C(t!.move)}${ref(f.vars.threat)} and the stones at ${C(saved.at[0])} die.`);
    } else if (ds) {
      topics.push('double-sente');
      summary.push(`It's ${gloss('double sente', 'ryou-sente: whoever plays it first keeps sente')} (ryou-sente): if ${them} ignores it, ${me} follows up at ${C(f.ignore?.move ?? best.loc)}${ref(f.vars.ignore)}, and if ${me} skips it, ${them} takes it with sente${ref(f.vars.threat)}.`);
    } else if (rs) {
      topics.push('reverse-sente');
      summary.push(`It's ${gloss('reverse sente', 'gyaku-sente: gote for you, but it stops a sente move of the opponent')}: gote for ${me}, but if ${them} gets there first${ref(f.vars.threat)}, ${me} has to answer.`);
    } else if (keyBoth) {
      summary.push(`It's the key point for both sides: if ${me} doesn't take it, ${them} plays ${t!.move === best.loc ? 'there' : `right next to it at ${C(t!.move)}`}${ref(f.vars.threat)}.`);
    }
    const sente = hit('sente');
    if (sente && sente.at[0] === best.loc && !ds) {
      summary.push(
        f.ignore
          ? `It's ${gloss('sente', 'the opponent has to answer')}: if ${them} ignores it, ${me} follows up at ${C(f.ignore.move)}${ref(f.vars.ignore)}.`
          : `It's ${gloss('sente', 'the opponent has to answer')}, so ${me} keeps the initiative.`,
      );
    }
    alternativesLine();
    if (big && f.moveOrder && f.other) {
      // Two moves that end in the same place: say so, and why one first is still a good habit (item 14).
      summary.push(`Honestly, ${C(f.other.loc)}${ref(f.vars.lineA)} and ${C(best.loc)}${ref(f.vars.lineB)} end up in practically the same position, so neither is wrong.${sente ? ` I'd still play ${C(best.loc)} first: it's a good habit to play an obvious sente move before ${them} gets the chance to ignore it.` : ''}`);
    }
    gameContext();
    numbersSection(bestFact, f.other ? factLike(new RegExp(`^${C(f.other.loc)} is `)) : undefined);
  }

  /** The runner-up, in words that match the gap (never a tenth-of-a-point comparison). */
  function alternativesLine() {
    const o = f.other ?? f.alternatives[0];
    if (!o || f.moveOrder) return;
    const id = f.other ? f.vars.lineA : f.vars.alts[0];
    const g = best.lead - o.lead;
    if (g < 0.5) {
      summary.push(`${C(o.loc)}${ref(id)} is just as good: we're splitting hairs here, so play your style.`);
      return;
    }
    if (g < 2) {
      summary.push(`${C(o.loc)}${ref(id)} is fine too, just a little less efficient.`);
      return;
    }
    const tp = f.consequence?.turning;
    summary.push(`${C(o.loc)}${ref(id)} is clearly worse${tp ? `: by move ${tp.moveNumber} it costs ${me} ${inRegion(tp.region).replace(/^(in|on|at) /, 'in ')}` : ''}.`);
  }

  /** Where the game stands, in a line (XIAO, item 14: "give the player some context"). */
  function gameContext() {
    if (sit.phase !== 'endgame' && sit.phase !== 'middle') return;
    const lead = best.lead;
    const abs = Math.abs(lead);
    const L = lead >= 0 ? me : them;
    const weakMine = (f.root?.ownership ? boardPicture(f.board, f.root.ownership, groups).weak : []).find((w) => w.color === mover);
    const watch = weakMine ? ` Keep an eye on your group at ${C(weakMine.at)}.` : '';
    if (abs < 2) summary.push(`The game is close, so every point counts from here.${watch}`);
    else if (abs >= 10) {
      fact(`Rounded, ${L}'s lead is about ${Math.round(abs)} points.`);
      summary.push(lead > 0 ? `${me} is well ahead (about ${Math.round(abs)} points), so keep it safe and simple.${watch}` : `${me} is behind by about ${Math.round(abs)} points, so look for chances, but take the big points first.${watch}`);
    } else if (watch) summary.push(watch.trim());
  }

  function whyNot() {
    const a = f.asked!;
    const A = C(a.loc);
    const B = C(best.loc);
    const key = keyPointOf(f);
    const ds = hit('double-sente');
    const rs = hit('reverse-sente');
    const sac = hit('sacrifice');
    const order = f.moveOrder;
    const lineB = f.vars.lineB ?? f.vars.best;
    const aRead = a.read;
    // What each move gets that the other does not (both with the opponent to play).
    const bOwn = f.afterBest?.ownership ?? (f.consequence?.b.checkpoints.find((c) => c.ply === 1)?.read.ownership ?? null);
    const aOwn = aRead?.ownership ?? null;
    const bGets = bOwn && aOwn ? purposes(f.board, best.loc, mover, bOwn, aOwn, groups) : [];
    const aGets = bOwn && aOwn ? purposes(f.board, a.loc, mover, aOwn, bOwn, groups) : [];
    const bSente = concepts.find((h) => h.id === 'sente' && h.at[0] === best.loc);
    const aGote = concepts.find((h) => h.id === 'gote' && h.at[0] === a.loc);
    const aBig = concepts.some((h) => h.id === 'big-point' && h.at[0] === a.loc) || aGets.some((p) => p.kind === 'territory' || p.kind === 'framework');
    const aHas = aBig || aGets.length > 0;
    const gap = sit.gap;

    // 1. The recommendation, plainly.
    if (sac) {
      topics.push('sacrifice', 'tenuki');
      const still = /still only/.test(sac.evidence);
      const reply = f.mode === 'refutation' && a.reply !== undefined && a.reply !== PASS ? `: ${them} simply answers ${C(a.reply)}${ref(f.vars.asked)}` : '';
      summary.push(`${A} tries to look after the stones at ${C(sac.at[0])}, but ${still ? "they're still not safe after it" : "they're hard to save"}${reply}. KataGo leaves them and plays ${B}${ref(f.vars.best)} elsewhere: ${gloss('tenuki', 'playing elsewhere instead of answering locally')}.`);
    } else if (ds) {
      topics.push('double-sente');
      const why = bGets.length ? `it ${purposeLine(bGets.slice(0, 1))}, and ` : '';
      summary.push(`${A} is ${aHas ? 'a big point' : 'playable'}, but ${B} is even bigger here! ${B}${ref(f.vars.best)} is ${gloss('double sente', 'ryou-sente: whoever plays it first keeps sente')} (ryou-sente): ${why}whoever plays there first keeps sente.`);
    } else if (rs) {
      topics.push('reverse-sente');
      const answer = f.oppAt?.read.candidates[0]?.loc;
      summary.push(`${A} is ${aHas ? 'a big point' : 'playable'}, but ${B}${ref(f.vars.best)} is even bigger here! It's ${gloss('reverse sente', 'gyaku-sente: gote for you, but it stops a sente move of the opponent')}: gote for ${me}, but if ${them} gets there first${ref(key?.exact ? f.vars.asked : f.vars.threat)}, ${me} has to answer${answer !== undefined && answer !== PASS ? ` at ${C(answer)}` : ''}.`);
    } else if (sit.tone === 'relaxed') {
      summary.push(`It's still the opening, so no need to judge ${A} harshly: it's playable, just a little slow.`);
    } else if (gap === 'big') {
      summary.push(`${A} is a real mistake here; ${B}${ref(f.vars.best)} is the move.`);
    } else if (aBig && key) {
      summary.push(`${A} is a big point, but ${B} is even bigger here!`);
    } else if (!(bSente && aGote)) {
      summary.push(`${B} is the better choice here${ref(f.vars.best)}.`);
    }

    // 2. The reason, from the board.
    if (key && !ds && !rs) {
      summary.push(`After ${A}, ${them} takes ${key.exact ? `${B} itself` : `${C(key.reply)}, right next to ${B}`}${ref(f.vars.asked)}: that point matters to both sides.`);
    } else if (f.mode === 'refutation' && a.reply !== undefined && a.reply !== PASS && !sac) {
      const dead = concepts.find((h) => h.id === 'dead-group' && h.variation === f.vars.asked && f.board.stones[h.at[0]] === mover);
      summary.push(`${them} answers ${C(a.reply)}${ref(f.vars.asked)}${dead ? ` and the stones at ${C(dead.at[0])} die` : ''}.`);
    }
    if (bSente && aGote && !ds && !rs) {
      // "M5 reduces White's moyo and may finish in sente" (XIAO, item 9): the purpose, then the tempo.
      const red = bGets.find((p) => p.kind === 'reduce') ?? bestPs.find((p) => p.kind === 'reduce');
      const does = red ? purpose(red, 'verb') : bGets.length ? purposeLine(bGets.slice(0, 1)) : '';
      const lead = sit.tone === 'relaxed' || gap === 'small' ? `${B} is a little more efficient` : `${B} is the better choice here`;
      summary.push(`${lead}: it ${does ? `${does} and ` : ''}can finish in ${gloss('sente', 'the opponent has to answer, so you move first again')}, so ${me} may get to play elsewhere first${ref(lineB)}. ${A} ends in gote, and ${them} moves first elsewhere.`);
    } else if (bGets.length && !sac && !ds) {
      const trade = aGets.length ? `${A} ${purposeLine(aGets.slice(0, 1))}, but ` : '';
      summary.push(`${cap(trade)}${trade ? B : `${B}`} ${purposeLine(bGets.slice(0, 2))}${trade ? ', which is worth more here' : ''}.`);
    }
    // The outside a move builds is worth less next to the opponent's strength (item 7).
    const outside = aGets.find((p) => p.kind === 'framework');
    const corner = (p: Purpose) => p.kind === 'territory' && /^(upper|lower) (left|right)$/.test(p.region);
    const givesCorner = !outside && key?.exact && bGets.some(corner) && !aGets.some((p) => p.kind === 'territory');
    const own = f.root?.ownership;
    const wall = (outside || givesCorner) && own ? strongNear(groups, own, a.loc, opp, size, 6) : null;
    if (wall) {
      summary.push(
        givesCorner
          ? `${A} gives up the corner for the outside, but ${them}'s strong stones at ${C(wall.stones[0])} make the outside worth less here.`
          : `The outside ${A} aims for faces ${them}'s strong stones at ${C(wall.stones[0])}, so it can't grow into much.`,
      );
    }
    if (sac) {
      const firmer = sac.at[2];
      summary.push(
        `${firmer !== undefined ? `Meanwhile ${them}'s stones at ${C(firmer)} get stronger${ref(f.vars.asked)}, so the exchange helps ${them} more than ${me}. ` : ''}Saving every group isn't always worth it: when a group still needs more moves after you help it, the bigger move is often to accept the loss and play elsewhere.`,
      );
    }
    const aLine = f.variations.find((v) => v.id === f.vars.asked)?.moves ?? [];
    if (ds && key?.exact && aLine[1]?.loc === best.loc && aLine[2] && aLine[2].loc !== PASS && chebyshev(aLine[2].loc, best.loc, size) <= localR(size)) {
      // The proof from the asked move's own line: the opponent takes the point and the mover must answer.
      summary.push(`That's exactly what happens after ${A}: ${them} takes ${B} at once${ref(f.vars.asked)}, and ${me} has to answer at ${C(aLine[2].loc)}.`);
    } else if (ds && (f.vars.ignore || f.vars.threat)) {
      const answer = f.oppAt?.first === PASS ? f.oppAt.read.candidates[0]?.loc : undefined;
      summary.push(`${f.vars.ignore ? `If ${them} ignores ${B}, ${me} follows up${ref(f.vars.ignore)}. ` : ''}Let ${them} take it first${ref(f.vars.threat)} and ${me} is the one who has to answer${answer !== undefined && answer !== PASS ? ` at ${C(answer)}` : ''}.`);
    }

    // 3. Move order, honestly (items 3 and 14).
    if (order) {
      const where = order.bPlaysA ? `KataGo's ${B} line comes back to ${A} a few moves later${ref(lineB)}` : `the ${A} line comes back to ${B} later${ref(f.vars.lineA)}`;
      if (order.kind === 'same') {
        summary.push(`Plot twist: ${where}, and both lines end up in practically the same position${ref(f.vars.lineA)}. ${A} isn't a mistake; ${B} first is a small engine preference.`);
      } else {
        const diff = order.bPlaysA ? firstExchange(order.bPlaysA, lineB, a.loc) : '';
        summary.push(`Plot twist: ${where}, so this is really about move order.${diff ? ` ${diff}` : (() => {
          const d = diffWords(order);
          return d ? ` What changes is what happens in between: ${d}.` : '';
        })()}`);
      }
    }

    // 4. How big the difference is, in honest words, with one number at most.
    const lossFact = factLike(new RegExp(`^${A} is [\\d.]+ points worse than ${B}`));
    if (gap === 'small' && sit.tone !== 'relaxed') summary.push(`The difference is small, so ${A} is ${order ? 'fine' : 'less efficient, not a mistake'}.`);
    else if (gap === 'clear' && lossFact) summary.push(`That's a real difference, about ${fmt1(a.loss)} points.`);
    else if (gap === 'big' && lossFact) summary.push(`That costs about ${fmt1(a.loss)} points.`);
    if (!/ \[\[v\d+\]\]/.test(summary.join(' '))) summary.push(sit.tone === 'relaxed' ? `${B}${ref(lineB)} is the more efficient choice.` : `Play ${B}${ref(lineB)} instead.`);

    // Details for the curious: the slow consequence, for stronger players.
    const later = factLike(/^In the .* line, against the .* line, /);
    if (later && level === 'strong' && !order) sections.push({ title: 'What changes later', text: `${later}${ref(f.vars.lineA)}${ref(f.vars.lineB)}` });
    numbersSection(bestFact);
  }

  // ---- helpers ---------------------------------------------------------------------------

  /** A short reaction to the position before the answer (XIAO, item 23: "react to it!"). */
  function reaction(): string {
    const lead = best.lead;
    if (sit.phase !== 'opening' && lead <= -15) return pick(["It's a tough spot, but let's make the most of it.", 'Not an easy position! Let\'s find the best try.']);
    if (sit.phase !== 'opening' && lead >= 15) return pick(["You're in great shape here.", 'Things look good for you!']);
    const sh = shapeOf(f.board, best.loc, mover)?.id;
    const fight = (sh === 'cut' || sh === 'atari' || sh === 'hane' || sh === 'pincer' || sh === 'attach') && bestPs.some((p) => p.kind === 'press');
    if (fight) return pick(['Time for some action! ⚔️', 'Ooh, a fighting moment ⚔️.']);
    return '';
  }

  /** What a move does from its shape alone, for options KataGo did not read further. */
  function shapeDoes(l: Loc): string {
    const sh = shapeOf(f.board, l, mover);
    const corner = `the ${zoneName(zoneOf(l, size)).replace(' ', '-')} corner`;
    switch (sh?.id) {
      case 'three-three':
        return `takes ${corner} from ${them}`;
      case 'enclosure':
        return `makes ${corner} solid`;
      case 'approach':
        return `starts working on ${them}'s corner`;
      case 'pincer':
        return `attacks ${them}'s stone straight away`;
      case 'keima':
      case 'one-space-jump':
      case 'two-space-jump':
      case 'kosumi':
        return 'keeps things calm and flexible';
      case 'open-point':
        return 'claims a big open point';
      default:
        return '';
    }
  }

  /** What the best move does, in words, from the reads (key point, saved stones, purposes). */
  function bestReason(): string {
    if (!bestPs.length) return '';
    return purposeLine(bestPs.slice(0, 2));
  }

  function stoneTotal(): number {
    let n = 0;
    for (const s of f.board.stones) if (s) n++;
    return n;
  }

  /**
   * What the better move's line does before it comes back to the asked move (item 3): when
   * that sequence ends with the opponent's move, the mover still gets the asked move next, so
   * playing it first was a free exchange in sente. Only said when the line shows it.
   */
  function firstExchange(at: number, varId: string | undefined, asked: Loc): string {
    const moves = f.variations.find((v) => v.id === varId)?.moves;
    if (!moves || at < 3) return '';
    const pre = moves.slice(0, at - 1);
    if (pre.length % 2 !== 0 || pre.some((m) => m.loc === PASS)) return '';
    if (moves[at - 1]?.loc !== asked || moves[at - 1]?.color !== mover) return '';
    const zones = new Map<string, number>();
    for (const m of pre) zones.set(zoneName(zoneOf(m.loc, size)), (zones.get(zoneName(zoneOf(m.loc, size))) ?? 0) + 1);
    const [region, n] = [...zones.entries()].sort((x, y) => y[1] - x[1])[0];
    const where = n >= pre.length - 1 ? ` ${inRegion(region)}` : '';
    return `${C(best.loc)} first settles things${where} and ends with ${them}'s move, so ${me} still gets ${C(asked)} afterwards: the exchange comes for free, in ${gloss('sente', 'the opponent has to answer, so you move first again')}. Good habit: play your sente moves first.`;
  }

  /** Two variations reach the same stones within their first few moves (a transposition). */
  function sameSoon(x?: string, y?: string): boolean {
    const vx = f.variations.find((v) => v.id === x)?.moves;
    const vy = f.variations.find((v) => v.id === y)?.moves;
    if (!vx || !vy) return false;
    for (const k of [3, 4, 5, 6]) {
      if (vx.length < k || vy.length < k) break;
      const key = (ms: typeof vx) => ms.slice(0, k).map((m) => `${m.color}:${m.loc}`).sort().join(',');
      if (key(vx) === key(vy)) return true;
    }
    return false;
  }

  /** Weak groups away from a ko, where its threats will come from: "Black's stones at D4 and White's at Q10". */
  function koThreatGroups(target: Loc[]): string {
    const own = f.root?.ownership;
    if (!own) return '';
    const far = (at: Loc) => !target.some((q) => chebyshev(q, at, size) <= 4);
    const weak = boardPicture(f.board, own, groups).weak.filter((w) => w.stones >= 3 && far(w.at)).slice(0, 2);
    if (!weak.length) return '';
    return weak.map((w, i) => (i === 0 ? `${colorWord(w.color)}'s weak stones at ${C(w.at)}` : `${colorWord(w.color)}'s at ${C(w.at)}`)).join(' and ');
  }

  /** The weak group next to a point (for the tsumego text when the solver did not run). */
  function weakNear(l: Loc) {
    const own = f.root?.ownership;
    if (!own || l === PASS) return null;
    return looseGroups(f.board)
      .filter((g) => g.stones.length >= 2 && g.stones.some((q) => chebyshev(q, l, size) <= 2) && Math.abs(groupOwn(g, own)) < 0.9)
      .sort((a, b) => b.stones.length - a.stones.length)[0] ?? null;
  }

  /** A group's ownership (for its owner) at the end of a variation, from the read there. */
  function endOwn(varId: string | undefined, stone: Loc | undefined): number | null {
    if (!varId || stone === undefined) return null;
    const own = varId === f.vars.best ? f.afterBest?.ownership : null;
    if (!own) return null;
    const c = f.board.stones[stone];
    if (!c) return null;
    const g = looseGroups(f.board).find((x) => x.stones.includes(stone));
    return g ? groupOwn(g, own) : null;
  }

  function stonesIn(evidence: string): number | null {
    const m = /\((\d+) stones\)| the (\d+) (?:black|white) stones/.exec(evidence);
    return m ? Number(m[1] ?? m[2]) : null;
  }

  function regionsIn(regions: string[]): string {
    if (!regions.length) return '';
    if (regions.length === 1) return inRegion(regions[0]);
    return `${inRegion(regions[0])} and ${inRegion(regions[1])}`;
  }

  /** The stones only one line has, in words: "in the C15 line Black gets C15 and C12; in the L17 line White gets M16". */
  function diffWords(order: NonNullable<Findings['moveOrder']>): string {
    const a = f.asked?.loc ?? f.other?.loc;
    if (a === undefined) return '';
    const name = (ms: { color: Color; loc: Loc }[]) => {
      const by = new Map<Color, Loc[]>();
      for (const m of ms) by.set(m.color, [...(by.get(m.color) ?? []), m.loc]);
      return [...by.entries()]
        .filter(([, ls]) => ls.length <= 3)
        .map(([c, ls]) => `${colorWord(c)} gets ${ls.map(C).join(' and ')}`)
        .join(', ');
    };
    const inA = name(order.onlyA);
    const inB = name(order.onlyB);
    if (!inA && !inB) return '';
    return [inB ? `in the ${C(best.loc)} line ${inB}` : '', inA ? `in the ${C(a)} line ${inA}` : ''].filter(Boolean).join('; ');
  }
}

const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** "two black stones", "12 white stones", "one stone". */
const count = (n: number, noun: string) => `${NUM[n] ?? n} ${noun}${n === 1 ? '' : 's'}`;
const cap = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** Not used by teach() itself: the lead in words, for callers that want it ("White leads by 2.3"). */
export const leadWords = (lead: number, c: Color) => `${colorWord(c)} ${lead >= 0 ? 'leads' : 'trails'} by ${fmt1(Math.abs(lead))}`;
export { pct, sideLead };
