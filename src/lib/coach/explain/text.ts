/**
 * Words from findings. Every checked statement is one Fact; the summary and sections reuse
 * those statements (or number-free glue around them), so every number the student reads is
 * in a fact, a concept's evidence or a variation note, and came from a read. The writer
 * prompt (prompt.ts) and checkAnswer rely on that. A last guard drops any sentence whose
 * numbers are not in that pool.
 */
import { other, PASS, type Loc } from '../../go/types';
import { ownerWords, turnPhrase, type TurningPoint } from './consequence';
import { colorWord, coord, fmt1, leadPhrase, pct, sideLead } from './geometry';
import { EQUAL_PTS, sideLeadPhrase, type Findings } from './planner';
import type { ConceptHit, Fact } from './types';

export interface TextOut {
  summary: string;
  sections: { title: string; text: string }[];
  facts: Fact[];
}

/** Numbers in a text, leaving out [[vN]] refs and board coordinates (Q16). */
export function numbersIn(text: string): string[] {
  const t = text.replace(/\[\[v\d+\]\]/g, ' ').replace(/\b[A-HJ-Z](?:2[0-5]|1\d|[1-9])\b/g, ' ');
  return (t.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));
}

const ref = (id?: string) => (id ? ` [[${id}]]` : '');

/** The turning point for the summary. */
function turnSummary(tp: TurningPoint, mover: 1 | 2): string {
  const t = turnPhrase(tp, mover);
  return tp.ply > 1 ? `Nothing breaks at once; the difference shows later: ${t}` : t.charAt(0).toUpperCase() + t.slice(1);
}

export function buildText(f: Findings, concepts: ConceptHit[]): TextOut {
  const facts: Fact[] = [];
  const fact = (text: string) => {
    facts.push({ id: `f${facts.length + 1}`, text });
    return text;
  };
  const size = f.pos.size;
  const C = (l: Loc) => coord(l, size);
  const mover = f.mover;
  const me = colorWord(mover);
  const them = colorWord(other(mover));
  const root = f.root;
  const best = f.best;

  if (!root || !best) {
    return { summary: 'KataGo could not read this position.', sections: [], facts };
  }

  const pts = (lead: number) => `${sideLeadPhrase(lead, mover)}${Math.round(lead * 10) === 0 ? '' : ' points'}`;
  const sections: { title: string; text: string }[] = [];
  const summary: string[] = [];

  // Facts every answer can lean on.
  const fBest = fact(`KataGo's best move for ${me} is ${C(best.loc)}: ${me}'s winrate ${pct(best.win)}, ${pts(best.lead)}.`);
  const altFacts = f.vars.alts.map((id, i) => {
    const alt = f.alternatives[i];
    const loss = best.lead - alt.lead;
    return {
      id,
      alt,
      loss,
      text: fact(
        loss >= 0.05
          ? `${C(alt.loc)} is ${fmt1(loss)} points worse than ${C(best.loc)} (${me}'s winrate ${pct(alt.win)}).`
          : `${C(alt.loc)} is about as good as ${C(best.loc)} (${fmt1(Math.abs(loss))} points apart).`,
      ),
    };
  });

  // Concepts as short, number-free phrases for the summary, and their evidence for "Ideas".
  const shortOf = (h: ConceptHit): string => {
    const at = h.at.map(C);
    switch (h.id) {
      case 'sente':
        return `${at[0]} is sente: ${them} has to answer it.`;
      case 'gote':
        return `${at[0]} is gote: afterwards ${them} plays first elsewhere.`;
      case 'urgent':
        return `${at[0]} is urgent: a weak group next to it needs it now.`;
      case 'big-point':
        return `${at[0]} is a big point in open space.`;
      case 'tenuki':
        return `${at[0]} plays elsewhere (tenuki).`;
      case 'miai':
        return `${at[0]} and ${at[1]} are miai: if one side takes one, the other takes the other.`;
      case 'territory':
        return `${at[0]} takes territory.`;
      case 'influence':
        return `${at[0]} builds influence toward the center.`;
      case 'weak-group':
        return `The group at ${at[0]} is weak.`;
      case 'dead-group':
        return h.evidence.includes('already dead') ? `The stones at ${at[0]} are already dead.` : `The stones at ${at[0]} die${ref(h.variation)}.`;
      default:
        return '';
    }
  };
  const ideas = concepts.map((h) => `${h.evidence}${ref(h.variation)}`);
  /** Up to n short concept lines, one per kind (two "sente" lines say no more than one). */
  const conceptLines = (n: number, skip: (h: ConceptHit) => boolean = () => false) => {
    const seen = new Set<string>();
    return concepts
      .filter((h) => !skip(h) && !seen.has(h.id) && seen.add(h.id))
      .slice(0, n)
      .map(shortOf)
      .filter(Boolean);
  };

  const cons = f.consequence;
  const tp = cons?.turning ?? null;
  /** Facts for a consequence search between lines A and B. */
  const consequenceFacts = (a: Loc, b: Loc, loss: number) => {
    if (!cons) return { turn: '', text: '' };
    const lastCommon = cons.common[cons.common.length - 1];
    const parts: string[] = [];
    if (lastCommon !== undefined) {
      parts.push(fact(`Both lines were played out with KataGo's best moves for both sides, to move ${f.pos.moves.length + lastCommon}.`));
    }
    let turn = '';
    if (tp) {
      turn = turnPhrase(tp, mover);
      parts.push(fact(`In the ${C(a)} line, against the ${C(b)} line, ${turn}.`));
      const trade = tp.gain ? `, and about ${fmt1(tp.gain.gap)} more in the ${tp.gain.region}` : '';
      parts.push(fact(`At move ${tp.shownMove} that is about ${fmt1(-tp.gap)} points less for ${me} in the ${tp.region}${trade}; ${pts(tp.leadA)} in the ${C(a)} line and ${pts(tp.leadB)} in the ${C(b)} line.`));
    } else if (lastCommon !== undefined) {
      const ca = cons.a.checkpoints.find((c) => c.ply === lastCommon)!.read;
      const cb = cons.b.checkpoints.find((c) => c.ply === lastCommon)!.read;
      parts.push(fact(`No single area flips between the two lines: the ${fmt1(Math.max(0, loss))} points are spread over the board.`));
      parts.push(fact(`At move ${f.pos.moves.length + lastCommon}, ${pts(sideLead(ca.bLead, mover))} in the ${C(a)} line and ${pts(sideLead(cb.bLead, mover))} in the ${C(b)} line.`));
    }
    return { turn, text: parts.join(' ') };
  };

  const asked = f.asked;
  const replyText = (reply: Loc | undefined) => (reply === undefined ? '' : reply === PASS ? `${them} passes` : `${them} answers ${C(reply)}`);

  switch (f.mode) {
    case 'best':
    case 'overview':
    case 'illegal': {
      if (f.mode === 'illegal' && asked) {
        summary.push(fact(`${C(asked.loc)} cannot be played here (the point is taken or the move is illegal).`));
      }
      if (f.mode === 'overview') {
        const fPos = fact(`Before ${me}'s move, ${leadPhrase(root.bLead)}${Math.round(root.bLead * 10) === 0 ? '' : ' points'} (Black's winrate ${pct(root.bWin)}).`);
        summary.push(`${fPos} ${me} to play; KataGo's best move is ${C(best.loc)}${ref(f.vars.best)}.`);
        const groupLines = concepts.filter((h) => h.id === 'weak-group' || h.id === 'dead-group').map((h) => h.evidence);
        sections.push({ title: 'The position', text: [fPos, ...groupLines].join(' ') });
      } else {
        summary.push(`${me} should play ${C(best.loc)}${ref(f.vars.best)}: ${pts(best.lead)} after it.`);
      }
      summary.push(...conceptLines(2, (h) => f.mode === 'overview' && (h.id === 'weak-group' || h.id === 'dead-group')));
      if (f.other && cons) {
        const c = consequenceFacts(f.other.loc, best.loc, f.other.loss);
        const lossFact = altFacts.find((a) => a.alt.loc === f.other!.loc)?.text ?? fact(`${C(f.other.loc)} is ${fmt1(f.other.loss)} points worse than ${C(best.loc)}.`);
        summary.push(
          tp
            ? `If ${me} plays ${C(f.other.loc)} instead${ref(f.vars.lineA)}, ${c.turn}${ref(f.vars.lineB)}.`
            : `${C(f.other.loc)}${ref(f.vars.lineA)} is ${fmt1(f.other.loss)} points worse, spread over the board.`,
        );
        sections.push({ title: `Why not ${C(f.other.loc)}`, text: `${lossFact} ${c.text}${ref(f.vars.lineA)}${ref(f.vars.lineB)}` });
      } else if (altFacts.length) {
        const a = altFacts[0];
        summary.push(a.loss >= 0.05 ? `${C(a.alt.loc)}${ref(a.id)} is ${fmt1(a.loss)} points worse.` : `${C(a.alt.loc)}${ref(a.id)} is about as good.`);
      }
      sections.push({ title: 'The best move', text: `${fBest}${ref(f.vars.best)}` });
      if (altFacts.length) sections.push({ title: 'Other moves', text: altFacts.map((a) => `${a.text}${ref(a.id)}`).join(' ') });
      break;
    }
    case 'unchecked': {
      if (!asked) break;
      summary.push(`There was no time to read ${C(asked.loc)}.`);
      const cand = root.candidates.find((c) => c.loc === asked.loc);
      if (cand) summary.push(fact(`KataGo's first look puts ${C(asked.loc)} ${fmt1(Math.max(0, asked.loss))} points behind ${C(best.loc)}.`));
      summary.push(`KataGo's best move is ${C(best.loc)}${ref(f.vars.best)}.`);
      sections.push({ title: 'The best move', text: `${fBest}${ref(f.vars.best)}` });
      break;
    }
    case 'good': {
      if (!asked) break;
      summary.push(`${C(asked.loc)} is KataGo's best move${ref(f.vars.best)}: ${pts(best.lead)} after it.`);
      if (asked.read && asked.reply !== undefined) {
        sections.push({ title: 'The move', text: `${fBest} ${fact(`After ${C(asked.loc)}, ${them}'s best answer is ${C(asked.reply)}.`)}${ref(f.vars.best)}` });
      } else {
        sections.push({ title: 'The move', text: `${fBest}${ref(f.vars.best)}` });
      }
      summary.push(...conceptLines(2));
      const o = f.other;
      if (o) {
        const lossFact = fact(o.loss >= 0.05 ? `The next best move, ${C(o.loc)}, is ${fmt1(o.loss)} points worse.` : `The next best move, ${C(o.loc)}, is about as good (${fmt1(Math.abs(o.loss))} points apart).`);
        if (cons) {
          const c = consequenceFacts(o.loc, asked.loc, o.loss);
          summary.push(tp ? `The next best, ${C(o.loc)}, is ${fmt1(o.loss)} points worse: ${c.turn}${ref(f.vars.lineA)}.` : `The next best, ${C(o.loc)}${ref(f.vars.lineA)}, is ${fmt1(o.loss)} points worse, spread over the board.`);
          sections.push({ title: `Against ${C(o.loc)}`, text: `${lossFact} ${c.text}${ref(f.vars.lineA)}${ref(f.vars.lineB)}` });
        } else {
          summary.push(`${lossFact.replace(/\.$/, '')}${ref(f.vars.other)}.`);
        }
      }
      break;
    }
    case 'equal':
    case 'whatif':
    case 'refutation':
    case 'consequence': {
      if (!asked) break;
      const loss = asked.loss;
      const fReply = asked.reply !== undefined ? fact(`After ${C(asked.loc)}, ${them}'s best answer is ${C(asked.reply)}; then ${pts(asked.lead)} (${me}'s winrate ${pct(asked.win)}).`) : '';
      if (f.mode === 'equal' && loss <= -EQUAL_PTS) {
        // The asked move read better than KataGo's first look at its own choice.
        const ab = f.afterBest;
        const fAfterBest = ab ? fact(`After ${C(best.loc)}, ${pts(sideLead(ab.bLead, mover))}.`) : '';
        summary.push(
          `${C(asked.loc)} is a good move: in KataGo's reads it does at least as well as ${C(best.loc)}${ref(f.vars.best)}. After it ${replyText(asked.reply)}${ref(f.vars.asked)} and ${pts(asked.lead)}${ab ? `; after ${C(best.loc)}, ${pts(sideLead(ab.bLead, mover))}` : ''}.`,
        );
        sections.push({ title: `After ${C(asked.loc)}`, text: `${fReply} ${fAfterBest}${ref(f.vars.asked)}`.trim() });
      } else if (f.mode === 'equal') {
        const fGap = fact(`${C(asked.loc)} and ${C(best.loc)} are ${fmt1(Math.abs(loss))} points apart.`);
        summary.push(`${C(asked.loc)} is about as good as ${C(best.loc)}${ref(f.vars.best)}: ${replyText(asked.reply)}${ref(f.vars.asked)}, and the two are ${fmt1(Math.abs(loss))} points apart.`);
        sections.push({ title: `After ${C(asked.loc)}`, text: `${fReply} ${fGap}${ref(f.vars.asked)}`.trim() });
      } else {
        const fLoss = fact(`${C(asked.loc)} is ${fmt1(loss)} points worse than ${C(best.loc)}.`);
        if (f.mode === 'refutation' || f.mode === 'whatif') {
          const rf = f.refutation;
          const deadHits = concepts.filter((h) => h.id === 'dead-group' && h.variation === f.vars.asked);
          const dead = deadHits.find((h) => f.board.stones[h.at[0]] === mover);
          const won = deadHits.find((h) => f.board.stones[h.at[0]] !== mover);
          const end: string[] = [];
          let damage = '';
          if (rf?.region) {
            const where = rf.against === 'best' ? `after ${C(best.loc)}` : 'now';
            end.push(fact(`At the end of the ${f.mode === 'refutation' ? 'refutation' : 'line'} the ${rf.region.region} is ${ownerWords(rf.region.ownA)}; ${where} it is ${ownerWords(rf.region.ownB)}.`));
            damage = `the ${rf.region.region} turns ${ownerWords(rf.region.ownA)}`;
          }
          if (rf?.extended) end.push(fact(`At move ${f.pos.moves.length + rf.moves.length} of that line, ${pts(sideLead(rf.endRead.bLead, mover))}.`));
          if (dead) damage = `the stones at ${C(dead.at[0])} die`;
          if (f.mode === 'refutation') {
            const gain = won ? `${C(asked.loc)} captures the stones at ${C(won.at[0])}, but ` : '';
            const reply = replyText(asked.reply) || `${them} answers`;
            summary.push(`${C(asked.loc)} loses ${fmt1(loss)} points against ${C(best.loc)}. ${gain}${reply}${ref(f.vars.asked)}${damage ? ` and ${damage}` : ''}.`);
          } else {
            summary.push(`${C(asked.loc)} is ${fmt1(loss)} points worse than ${C(best.loc)}. After it, ${replyText(asked.reply) || `${them} plays`}${ref(f.vars.asked)}${damage ? ` and ${damage}` : ''}.`);
          }
          sections.push({ title: f.mode === 'refutation' ? 'The refutation' : `After ${C(asked.loc)}`, text: [fLoss, fReply, ...end].filter(Boolean).join(' ') + ref(f.vars.asked) });
        } else {
          const c = consequenceFacts(asked.loc, best.loc, loss);
          summary.push(
            tp
              ? `${C(asked.loc)} is ${fmt1(loss)} points slower than ${C(best.loc)}. ${turnSummary(tp, mover)}${ref(f.vars.lineA)}${ref(f.vars.lineB)}.`
              : `${C(asked.loc)} is ${fmt1(loss)} points worse than ${C(best.loc)}, but no single area flips: the loss is spread over the board${ref(f.vars.lineA)}.`,
          );
          sections.push({ title: 'What goes wrong later', text: [fLoss, fReply, c.text].filter(Boolean).join(' ') + ref(f.vars.lineA) + ref(f.vars.lineB) });
        }
      }
      summary.push(...conceptLines(2, (h) => h.id === 'dead-group'));
      if (f.mode !== 'equal') summary.push(`Play ${C(best.loc)}${ref(f.vars.lineB && f.mode === 'consequence' ? f.vars.lineB : f.vars.best)} instead.`);
      sections.push({ title: 'The better move', text: `${fBest}${ref(f.vars.best)}` });
      break;
    }
    default:
      break;
  }
  if (ideas.length) sections.push({ title: 'Ideas', text: ideas.join(' ') });

  // Guard: a number that is not in a fact, a concept or a variation note never reaches the student.
  const pool = new Set<string>();
  for (const t of [...facts.map((x) => x.text), ...concepts.map((h) => h.evidence), ...f.variations.flatMap((v) => [v.note ?? '', v.label, v.scoreLoss !== undefined ? fmt1(v.scoreLoss) : ''])]) {
    for (const n of numbersIn(t)) pool.add(n);
  }
  const clean = (text: string) =>
    text
      .split(/(?<=[.!?])\s+/)
      .filter((s) => numbersIn(s).every((n) => pool.has(n)))
      .join(' ')
      .trim();
  return {
    summary: clean(summary.filter(Boolean).join(' ')) || `KataGo's best move is ${C(best.loc)}${ref(f.vars.best)}.`,
    sections: sections.map((s) => ({ title: s.title, text: clean(s.text) })).filter((s) => s.text),
    facts,
  };
}
