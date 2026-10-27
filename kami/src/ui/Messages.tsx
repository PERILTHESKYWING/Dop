import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import type { GlossaryEntry } from '../../../src/lib/coach/glossary';
import { CONCEPTS, conceptById, type ConceptEntry, type ConceptExample } from '../../../src/lib/coach/library';
import { type ConceptHit, type Explanation, type ExplainPosition, type ThoughtStep, type Variation } from '../../../src/lib/coach/explain/types';
import { locToGtp } from '../../../src/lib/go/coords';
import { colorName } from '../../../src/lib/go/types';
import { blocks, engineText, plainText, splitChips, type Inline } from '../lib/chips';
import { boardFromPosition, hasPosition, toPlayAt, type BoardState } from '../lib/position';
import type { Answer, ChatMessage } from '../lib/store';
import { pointView } from '../lib/points';
import { cutAbove, cutBelow } from '../lib/cutLine';
import { useSetting } from '../lib/settings';
import { firstTerms, splitRich, type RichPart } from '../lib/terms';
import { levelOfMessage, longerLevel } from '../lib/levels';
import { NOTES } from '../lib/writer';
import { LevelName, UltraGo } from './UltraGo';
import type { Preview } from './BoardPanel';
import { Icon } from './Icon';
import { Calligraphy, Logo } from './Logo';
import { AskContext, Term } from './Term';

export interface Running {
  convId: string;
  msgId: string;
  stage: 'engine' | 'thinking' | 'writing';
  steps: ThoughtStep[];
  t0: number;
}

/** What a message needs to drive the board. */
export interface BoardLink {
  onHover: (p: Preview | null) => void;
  onPin: (p: Preview | null) => void;
  pinnedKey: string | null;
}

const KIND: Record<Variation['kind'], string> = {
  best: 'best line',
  refutation: 'refutation',
  consequence: 'what follows',
  'what-if': 'what if',
  alternative: 'alternative',
};

const round1 = (x: number) => Math.round(x * 10) / 10;

function variationPreview(key: string, ex: Explanation, v: Variation, pinned: boolean, extra?: { highlight?: number[]; note?: string }): Preview {
  const notes = [extra?.note, v.note, v.scoreLoss !== undefined && v.scoreLoss > 0 ? `Loses ${round1(v.scoreLoss)} points against the best line.` : ''].filter(Boolean);
  return {
    key,
    base: ex.position,
    line: v.moves,
    highlight: [...(v.highlight ?? []), ...(extra?.highlight ?? [])],
    title: `${v.label} · ${KIND[v.kind]}${v.moves.length > 1 ? `, ${v.moves.length} moves` : ''}`,
    note: notes.join(' '),
    pinned,
    ...(ex.view ? { view: ex.view } : {}),
  };
}

/** Where the board points in a text show on the board: a position, its lines, and the part that matters. */
interface PointSrc {
  /** Preview keys start with this (the message id, or the message's example). */
  key: string;
  base: ExplainPosition;
  variations: Variation[];
  view?: [number, number, number, number];
}

const answerSrc = (ex: Explanation, msgId: string): PointSrc => ({ key: msgId, base: ex.position, variations: ex.variations, view: ex.view });

/** A library example as a point source: its line is the one points are looked up in. */
const exampleSrc = (x: ConceptExample, key: string): PointSrc => ({
  key,
  base: x.position,
  variations: x.line.length ? [{ id: 'x', label: x.title, kind: 'best', moves: x.line }] : [],
  view: x.view,
});

/** Which glossary terms a text may underline: those first seen there (a set), or none (null). */
type Terms = ReadonlySet<GlossaryEntry> | null;

/**
 * A hover (mouse), keyboard focus or tap (touch, pinned) target that shows something on the
 * board. Keyboard focus opens it exactly as a hover does (the hover setting is about the
 * pointer only), Tab away or Escape closes it, Enter pins it.
 */
function BoardChip({ preview, link, className, children }: { preview: (pinned: boolean) => Preview; link: BoardLink; className?: string; children: ReactNode }) {
  const hoverOn = useSetting<boolean>('board.hoverPreview');
  const p = preview(false);
  const on = link.pinnedKey === p.key;
  return (
    <button
      type="button"
      className={`${className ?? 'chip'}${on ? ' on' : ''}`}
      onPointerEnter={(e) => hoverOn && e.pointerType === 'mouse' && link.onHover(p)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && link.onHover(null)}
      onFocus={(e) => e.currentTarget.matches(':focus-visible') && link.onHover(p)}
      onBlur={() => link.onHover(null)}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        // closes this line (and only this one), and keeps the Escape from closing a graph too
        e.preventDefault();
        link.onHover(null);
        if (on) link.onPin(null);
      }}
      onClick={() => link.onPin(on ? null : preview(true))}
      title={p.note || p.title}
    >
      {children}
    </button>
  );
}

/** A position Kami built to show an idea; it reaches the chat only after passing KataGo's checks. */
interface Illustration {
  id: string;
  label?: string;
  base: Preview['base'];
  line: Preview['line'];
  highlight: Preview['highlight'];
  title: string;
  note?: string;
  view?: [number, number, number, number];
}
const illustrationsOf = (ex: Explanation): Illustration[] => (ex as Explanation & { illustrations?: Illustration[] }).illustrations ?? [];

function VariationChip({ id, ex, msgId, link }: { id: string; ex: Explanation; msgId: string; link: BoardLink }) {
  if (id.startsWith('d')) {
    const d = illustrationsOf(ex).find((x) => x.id === id);
    if (!d) return null;
    return (
      <BoardChip
        preview={(pinned) => ({
          key: `${msgId}:${d.id}`,
          base: d.base,
          line: d.line,
          highlight: d.highlight,
          title: d.title,
          note: d.note,
          pinned,
          ...(d.view ? { view: d.view } : {}),
        })}
        link={link}
        className="chip diagram"
      >
        <Icon name="stones" size={13} />
        {d.label || 'Diagram'}
      </BoardChip>
    );
  }
  const v = ex.variations.find((x) => x.id === id);
  if (!v) return null;
  return (
    <BoardChip preview={(pinned) => variationPreview(`${msgId}:${id}`, ex, v, pinned)} link={link}>
      <Icon name="board" size={13} />
      {v.label}
    </BoardChip>
  );
}

/** A board point in text ("R16"): hovering shows it on the board, as the line it starts or is part of. */
function PointChip({ text, loc, src, link }: { text: string; loc: number; src: PointSrc; link: BoardLink }) {
  const preview = (pinned: boolean): Preview => {
    const pv = pointView(loc, src.base, src.variations);
    const v = pv.variation;
    return {
      key: `${src.key}:p${loc}`,
      base: src.base,
      line: pv.line,
      highlight: pv.highlight,
      title: !v ? text : v.label === text ? `${text} · ${KIND[v.kind]}` : `${text} · in ${v.label} · ${KIND[v.kind]}`,
      note: v?.note,
      pinned,
      ...(src.view ? { view: src.view } : {}),
    };
  };
  return (
    <BoardChip className="pt" preview={preview} link={link}>
      {text}
    </BoardChip>
  );
}

/** Text pieces: plain text, board points (shown on the board) and Go terms (a definition on hover). */
function Parts({ parts, src, link }: { parts: RichPart[]; src: PointSrc | null; link: BoardLink }) {
  return (
    <>
      {parts.map((p, i) =>
        p.type === 'term' ? (
          <Term key={i} entry={p.entry}>
            {p.text}
          </Term>
        ) : p.type === 'point' && src ? (
          <PointChip key={i} text={p.text} loc={p.loc} src={src} link={link} />
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** One line of plain text (a fact, a thought, a note) with its points and terms. */
function Line({ text, src, link, terms }: { text: string; src: PointSrc | null; link: BoardLink; terms: Terms }) {
  return <Parts parts={splitRich(text, src?.base.size ?? null, terms ? { allow: terms, seen: new Set() } : null)} src={src} link={link} />;
}

/**
 * Writer text: paragraphs, lists, headings, **bold**, [[vN]] / [[dN]] chips, board points (when
 * `src` gives a position) and Go terms (`terms`: the ones that first appear in this text).
 */
function RichText({ text, ex, msgId, link, src = ex ? answerSrc(ex, msgId) : null, terms }: { text: string; ex?: Explanation; msgId: string; link: BoardLink; src?: PointSrc | null; terms: Terms }) {
  // One set for the whole text, filled in reading order: each term gets one hover.
  const seen = new Set<GlossaryEntry>();
  const split = (t: string) => splitRich(t, src?.base.size ?? null, terms ? { allow: terms, seen } : null);
  // "play P5 [[v1]]" or "Q12 is a little worse [[v2]]": the point already shows the line it
  // starts, so a chip that only repeats it in the same sentence is left out.
  const repeats = (prev: Inline | undefined, id: string) => {
    const raw = ex?.variations.find((v) => v.id === id)?.label;
    // "after Q12" names the same point as "Q12"
    const label = raw?.replace(/^after\s+(?=[A-HJ-T]\d{1,2}$)/i, '');
    if (!label || !prev || prev.type === 'chip') return false;
    const sentence = prev.text.split(/[.!?]\s/).pop() ?? '';
    return new RegExp(`(^|[^A-Za-z0-9])${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`).test(sentence);
  };
  /** The pieces of `s`, with repeated chips dropped and the space before them closed up. */
  const pieces = (s: string): Inline[] => {
    const all = splitChips(s);
    const out: Inline[] = [];
    all.forEach((part, i) => {
      if (part.type === 'chip' && ex && repeats(all[i - 1], part.id)) {
        const prev = out[out.length - 1];
        const next = all[i + 1];
        if (prev && prev.type !== 'chip' && next && next.type !== 'chip' && /^[.,;:!?)]/.test(next.text)) out[out.length - 1] = { ...prev, text: prev.text.trimEnd() };
        return;
      }
      out.push(part);
    });
    return out;
  };
  const inline = (s: string) =>
    pieces(s).map((part, i) =>
      part.type === 'chip' ? (
        ex ? (
          <VariationChip key={i} id={part.id} ex={ex} msgId={msgId} link={link} />
        ) : null
      ) : part.type === 'bold' ? (
        <strong key={i}>
          <Parts parts={split(part.text)} src={src} link={link} />
        </strong>
      ) : (
        <Parts key={i} parts={split(part.text)} src={src} link={link} />
      ),
    );
  return (
    <div className="rich">
      {blocks(text).map((b, i) =>
        b.type === 'h' ? (
          <h4 key={i}>{inline(b.text)}</h4>
        ) : b.type === 'ul' ? (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>{inline(it)}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{inline(b.text)}</p>
        ),
      )}
    </div>
  );
}

const secs = (ms: number) => (ms < 1000 ? 'under 1 s' : `${Math.round(ms / 1000)} s`);

/** Seconds since `t0`, ticking, so a read that has not reported a step yet still visibly runs. */
function Elapsed({ t0, bare }: { t0: number; bare?: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 200);
    return () => window.clearInterval(id);
  }, []);
  const t = `${((Date.now() - t0) / 1000).toFixed(1)} s`;
  return bare ? <>{t}</> : <span className="meta">{t}</span>;
}

function Thoughts({ steps, live, ms, ex, msgId, link, stage, ultra }: { steps: ThoughtStep[]; live: boolean; ms: number; ex?: Explanation; msgId: string; link: BoardLink; stage?: Running['stage']; ultra?: boolean }) {
  const src = ex ? answerSrc(ex, msgId) : null;
  const plan = live ? null : firstTerms(steps.map((s) => s.text));
  // Done, it says what was done: how many positions KataGo read (its largest step's visits).
  const most = steps.reduce((n, s) => Math.max(n, s.visits ?? 0), 0);
  // "KataGo read 207 positions · 13 s · 16 a second on this device": the work, the wait, and
  // the device's speed, all measured (critics, round 2).
  const positions = ex?.totalVisits || most;
  const rate = positions && ms >= 1000 ? Math.round(positions / (ms / 1000)) : 0;
  // On a phone the folded line is just "225 positions · 2 s" (one row by the chevron); the
  // rest shows when the card is open (styles.css .th-wide).
  const done = positions ? (
    <span>
      <span className="th-wide">KataGo read </span>
      {positions.toLocaleString()} positions · {secs(ms)}
      {rate ? <span className="th-wide"> · {rate.toLocaleString()} a second on this device</span> : null}
    </span>
  ) : (
    `Read for ${secs(ms)}`
  );
  const text = live ? (stage === 'engine' ? 'Starting KataGo…' : stage === 'writing' ? 'Writing…' : 'Reading…') : done;
  // ultraGO says so while it works: its name in the running rainbow before the stage.
  const label = live && ultra && stage !== 'engine' ? (
    <>
      <UltraGo /> {typeof text === 'string' ? text.toLowerCase() : text}
    </>
  ) : (
    text
  );
  const t0 = useRef(Date.now() - ms).current;
  return (
    <details className={`thoughts${live ? ' live' : ''}${live && ultra ? ' think-live ultra' : ''}`} open={live || undefined}>
      <summary>
        {live && <span className="dive" aria-hidden="true" />}
        {label}
        <Icon name="down" size={14} />
      </summary>
      <ol>
        {steps.map((s, i) => (
          <li key={i}>
            <span>
              <Line text={s.text} src={src} link={link} terms={plan?.[i] ?? null} />
            </span>
            {live && i === steps.length - 1 ? (
              // The step still reading: its time ticks (a fixed "0.0 s" read as frozen).
              <span className="meta">
                {s.visits ? `${s.visits.toLocaleString()} positions · ` : ''}
                <Elapsed t0={t0} bare />
              </span>
            ) : (
              <span className="meta">
                {s.visits ? `${s.visits.toLocaleString()} positions` : ''}
                {s.ms >= 50 ? `${s.visits ? ' · ' : ''}${(s.ms / 1000).toFixed(1)} s` : ''}
              </span>
            )}
            {s.variation && ex && <VariationChip id={s.variation} ex={ex} msgId={msgId} link={link} />}
          </li>
        ))}
        {!steps.length &&
          (live ? (
            <li className="wait">
              <span>KataGo is reading the position…</span>
              <Elapsed t0={t0} />
            </li>
          ) : (
            <li className="meta">No steps were recorded.</li>
          ))}
      </ol>
      {ex && !live && (
        <p className="meta">
          {ex.reads} {ex.reads === 1 ? 'read' : 'reads'} · {ex.totalVisits.toLocaleString()} positions · {(ex.ms / 1000).toFixed(1)} s
        </p>
      )}
    </details>
  );
}

/** Plain titles for the idea chips (the rest are Go terms as they are: sente, miai, ko…). */
const TAG_TITLES: Partial<Record<ConceptHit['id'], string>> = {
  attack: 'pressure on',
  'weak-group': 'weak group',
  'dead-group': 'dead stones',
  'big-point': 'big point',
  'save-stones': 'saves the stones',
  'double-sente': 'double sente',
  'reverse-sente': 'reverse sente',
};

function ConceptTags({ hits, ex, msgId, link }: { hits: ConceptHit[]; ex: Explanation; msgId: string; link: BoardLink }) {
  if (!hits.length) return null;
  const size = ex.position.size;
  return (
    <div className="tags" aria-label="Ideas found">
      {hits.map((h, i) => {
        const v = h.variation ? ex.variations.find((x) => x.id === h.variation) : undefined;
        // "attack Q10 Q11" said nothing: the chip names the stones under pressure.
        const at = (h.id === 'attack' ? h.at.slice(1) : h.at).map((l) => locToGtp(l, size)).join(' ');
        const key = `${msgId}:c${i}`;
        const preview = (pinned: boolean): Preview =>
          v
            ? variationPreview(key, ex, v, pinned, {
                highlight: h.at,
                note: h.evidence,
              })
            : {
                key,
                base: ex.position,
                line: [],
                highlight: h.at,
                title: `${h.id}${at ? ` at ${at}` : ''}`,
                note: h.evidence,
                pinned,
                ...(ex.view ? { view: ex.view } : {}),
              };
        return (
          <BoardChip key={i} className="tag" preview={preview} link={link}>
            {TAG_TITLES[h.id] ?? h.id.replace(/-/g, ' ')}
            {at && <span className="tag-at">{at}</span>}
          </BoardChip>
        );
      })}
    </div>
  );
}

function ExplainAnswer({ a, msg, link, onReadLonger }: { a: Extract<Answer, { type: 'explain' }>; msg: ChatMessage; link: BoardLink; onReadLonger?: () => void }) {
  const ex = a.explanation;
  const w = a.writing;
  const src = answerSrc(ex, msg.id);
  // Each fact once (critics, round 2): the numbers live in the one list below, so the engine's
  // "KataGo's numbers" section is not shown again above it, and a rounded restatement of the
  // first sentence ("White leads by about 11 points") is not listed.
  const sections = ex.sections.filter((s) => s.title !== 'KataGo’s numbers' && s.title !== "KataGo's numbers");
  const facts = ex.facts.filter((f) => !f.quiet);
  // Each Go term is underlined once: where it first appears in the answer, then in the facts.
  const plan = firstTerms(w.text ? [w.text] : [ex.summary, ...sections.map((s) => s.text)]);
  const factPlan = firstTerms(facts.map((f) => f.text));
  const longer = longerLevel(msg.level ?? levelOfMessage(msg)?.id);
  return (
    <>
      <Thoughts steps={ex.thoughts} live={false} ms={ex.ms} ex={ex} msgId={msg.id} link={link} />
      {w.text ? (
        <RichText text={w.text} ex={ex} msgId={msg.id} link={link} terms={plan[0]} />
      ) : (
        <>
          <RichText text={ex.summary} ex={ex} msgId={msg.id} link={link} terms={plan[0]} />
          {sections.map((s, i) => (
            <section key={i} className="ans-section">
              <h4>{s.title}</h4>
              <RichText text={s.text} ex={ex} msgId={msg.id} link={link} terms={plan[i + 1]} />
            </section>
          ))}
        </>
      )}
      {w.note && <p className="note">{w.note}</p>}
      {w.text && <p className="note">{w.by === 'local' ? 'Worded by Kiai’s local model' : 'Worded by ultraGO'}, checked against KataGo’s facts.</p>}
      {longer && ex.totalVisits > 0 && (
        // A quick read says so, with its real size, and offers the longer one (critics 3 and 9).
        <p className="note quick-read">
          Quick read ({ex.totalVisits.toLocaleString()} positions). A longer read can change the pick.{' '}
          {onReadLonger && (
            <button type="button" className="text-btn" onClick={onReadLonger}>
              Read longer
            </button>
          )}
        </p>
      )}
      <ConceptTags hits={ex.concepts} ex={ex} msgId={msg.id} link={link} />
      {facts.length > 0 && (
        <details className="facts" open>
          <summary>
            KataGo’s numbers ({facts.length}) <Icon name="down" size={14} />
          </summary>
          <ul>
            {facts.map((f, i) => (
              <li key={f.id}>
                <Line text={f.text} src={src} link={link} terms={factPlan[i]} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function ConceptAnswer({
  a,
  msg,
  link,
  onAsk,
  onShowBoard,
}: {
  a: Extract<Answer, { type: 'concept' }>;
  msg: ChatMessage;
  link: BoardLink;
  onAsk: (t: string) => void;
  onShowBoard: (b: BoardState) => void;
}) {
  const entries = a.ids.map((id) => conceptById(id)).filter((e): e is ConceptEntry => !!e);
  if (!entries.length) {
    return (
      <div className="rich">
        <p>
          {CONCEPTS.length
            ? 'I didn’t find a Go idea I know in that. Ask about one, like “What is miai?”, or set up a position on the board and ask about it.'
            : 'Kiai’s concept library is still being written, so I can’t answer concept questions yet.'}
        </p>
        <p>To ask about a position, set it up on the board (click to play, paste an SGF or open a file), then ask “What should Black play?” or about a move like R16.</p>
      </div>
    );
  }
  const [e, ...others] = entries;
  // Terms are underlined once each, in reading order; the entry's own term is not.
  const texts = [e.short, a.expansion?.text ?? '', ...e.body.map((s) => s.text), ...e.mistakes, ...e.examples.map((x) => x.note)];
  const plan = firstTerms(texts, (g) => g.concept === e.id);
  const at = { body: 2, mistakes: 2 + e.body.length, examples: 2 + e.body.length + e.mistakes.length };
  return (
    <div className="concept">
      <h3>
        {e.name} <span className="level">{e.level}</span>
      </h3>
      <p className="lead">
        <Line text={e.short} src={null} link={link} terms={plan[0]} />
      </p>
      {a.expansion?.text && (
        <section className="ans-section">
          <h4>In more depth</h4>
          <RichText text={a.expansion.text} msgId={msg.id} link={link} terms={plan[1]} />
          <p className="note">Worded by ultraGO from the library entry.</p>
        </section>
      )}
      {a.expansion?.note && <p className="note">{a.expansion.note}</p>}
      {e.body.map((s, i) => (
        <section key={i} className="ans-section">
          <h4>{s.title}</h4>
          <RichText text={s.text} msgId={msg.id} link={link} terms={plan[at.body + i]} />
        </section>
      ))}
      {e.mistakes.length > 0 && (
        <section className="ans-section">
          <h4>Common mistakes</h4>
          <ul>
            {e.mistakes.map((m, i) => {
              // "Playing too early: defending one point..." shows its label in bold.
              const label = m.match(/^([^:.]{3,40}):\s+(.*)$/);
              return (
                <li key={i}>
                  {label && <strong>{label[1]}: </strong>}
                  <Line text={label ? label[2] : m} src={null} link={link} terms={plan[at.mistakes + i]} />
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {e.examples.length > 0 && (
        <section className="ans-section">
          <h4>Examples</h4>
          <div className="examples">
            {e.examples.map((x, i) => {
              const key = `${msg.id}:x${i}`;
              return (
                <div key={i} className="example">
                  <div className="ex-title">{x.title}</div>
                  <p>
                    <Line text={x.note} src={exampleSrc(x, key)} link={link} terms={plan[at.examples + i]} />
                  </p>
                  <div className="ex-foot">
                    <span className="meta">{x.source}</span>
                    <button
                      type="button"
                      className={`chip${link.pinnedKey === key ? ' on' : ''}`}
                      onClick={() => {
                        onShowBoard(boardFromPosition(x.position, x.title));
                        link.onPin({
                          key,
                          base: x.position,
                          line: x.line,
                          highlight: [],
                          title: x.title,
                          note: x.note,
                          pinned: true,
                          ...(x.view ? { view: x.view } : {}),
                        });
                      }}
                    >
                      <Icon name="board" size={13} />
                      Show on board
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {(e.related.length > 0 || others.length > 0) && (
        <div className="tags">
          <span className="meta">Related:</span>
          {[...others.map((o) => o.id), ...e.related]
            .filter((id, i, all) => all.indexOf(id) === i)
            .map((id) => conceptById(id))
            .filter((r): r is ConceptEntry => !!r)
            .map((r) => (
              <button key={r.id} type="button" className="tag" onClick={() => onAsk(`What is ${r.name}?`)}>
                {r.name}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function copyText(m: ChatMessage): string {
  const a = m.answer;
  if (!a) return m.text;
  if (a.type === 'error') return a.text;
  if (a.type === 'explain') return plainText(a.writing.text ?? engineText(a.explanation), a.explanation);
  const e = a.ids.map((id) => conceptById(id)).find(Boolean);
  if (!e) return '';
  return [e.name, e.short, a.expansion?.text ?? '', ...e.body.map((s) => `${s.title}\n${s.text}`)].filter(Boolean).join('\n\n');
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn sm"
      aria-label={done ? 'Copied' : 'Copy'}
      title={done ? 'Copied' : 'Copy'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={15} />
    </button>
  );
}

const UserMessage = memo(function UserMessage({ m, canEdit, onEdit }: { m: ChatMessage; canEdit: boolean; onEdit: (t: string) => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  if (edit !== null) {
    return (
      <form
        className="msg user editing"
        onSubmit={(e) => {
          e.preventDefault();
          if (edit.trim()) onEdit(edit);
          setEdit(null);
        }}
      >
        <textarea autoFocus value={edit} onChange={(e) => setEdit(e.target.value)} aria-label="Edit message" rows={3} />
        <div className="paste-row">
          <button type="button" className="text-btn" onClick={() => setEdit(null)}>
            Cancel
          </button>
          <button type="submit" className="pill">
            Send
          </button>
        </div>
      </form>
    );
  }
  return (
    <div className="msg user">
      <div className="bubble">{m.text}</div>
      <div className="msg-tools">
        <CopyButton text={m.text} />
        {canEdit && (
          <button type="button" className="icon-btn sm" aria-label="Edit" title="Edit" onClick={() => setEdit(m.text)}>
            <Icon name="edit" size={15} />
          </button>
        )}
      </div>
    </div>
  );
});

const KamiMessage = memo(function KamiMessage({
  m,
  running,
  isLast,
  link,
  onRegenerate,
  onAsk,
  onShowBoard,
  busy,
  onReadLonger,
}: {
  m: ChatMessage;
  running: Running | null;
  isLast: boolean;
  link: BoardLink;
  onRegenerate: () => void;
  onReadLonger?: () => void;
  onAsk: (t: string) => void;
  onShowBoard: (b: BoardState) => void;
  busy: boolean;
}) {
  const lvl = levelOfMessage(m);
  const live = running?.msgId === m.id;
  const a = m.answer;
  return (
    <div className="msg kami">
      <div className="who">
        <Logo size={20} />
        Kiai
        {lvl && !(a && a.type === 'concept' && lvl.id !== 'ultrago') ? (
          <span className="meta">
            {' · '}
            <LevelName level={lvl} />
          </span>
        ) : null}
      </div>
      {live && !a && <Thoughts steps={running!.steps} live ms={Date.now() - running!.t0} msgId={m.id} link={link} stage={running!.stage} ultra={lvl?.id === 'ultrago'} />}
      {!live && !a && <p className="note">Stopped.</p>}
      {a?.type === 'explain' && <ExplainAnswer a={a} msg={m} link={link} onReadLonger={isLast && !busy && !live ? onReadLonger : undefined} />}
      {a?.type === 'concept' && <ConceptAnswer a={a} msg={m} link={link} onAsk={onAsk} onShowBoard={onShowBoard} />}
      {a?.type === 'error' && <p className="note">{a.text}</p>}
      {live && a?.type === 'concept' && <p className="note">{NOTES.polishing}</p>}
      {a && !live && (
        <div className="msg-tools">
          <CopyButton text={copyText(m)} />
          {isLast && !busy && (
            <button type="button" className="icon-btn sm" aria-label="Regenerate" title="Regenerate" onClick={onRegenerate}>
              <Icon name="redo" size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  );
});

interface Props {
  messages: ChatMessage[];
  running: Running | null;
  /** The board, for the empty chat's suggestions (null once there are messages: they do not need it). */
  board: BoardState | null;
  link: BoardLink;
  onAsk: (text: string) => void;
  onRegenerate: () => void;
  onEdit: (text: string) => void;
  onShowBoard: (b: BoardState) => void;
  busy: boolean;
  /** Ask the last question again with a longer read (the quick-read line's "Read longer"). */
  onReadLonger?: () => void;
}

/** 気合 writes itself the first time the empty chat shows; after that it is simply there. */
let helloWritten = false;
function HelloMark() {
  const [write] = useState(() => !helloWritten);
  useEffect(() => {
    helloWritten = true;
  }, []);
  return (
    <div className="hello-mark">
      <Calligraphy height={80} layout="h" write={write} />
    </div>
  );
}

export function Messages({ messages, running, board, link, onAsk, onRegenerate, onEdit, onShowBoard, busy, onReadLonger }: Props) {
  const end = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const steps = running?.steps.length ?? 0;
  const last = messages[messages.length - 1];
  const answeredId = last?.role === 'kami' && last.answer ? last.id : null;
  const placed = useRef<string | null>(null);
  useEffect(() => {
    // While KataGo's steps stream, follow the end. When an answer arrives that is taller than the
    // pane (a phone), open it at its first line instead of its last; after that, leave the reader's
    // place alone.
    const first = answeredId !== null && placed.current !== answeredId;
    placed.current = answeredId;
    const box = pane.current;
    if (answeredId && box) {
      const all = box.querySelectorAll<HTMLElement>('.msg.kami');
      const el = all[all.length - 1];
      if (el && el.offsetHeight > box.clientHeight) {
        if (first) {
          box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8;
          // ...and end the pane on a whole line: a line of text cut in half at the composer read
          // as hidden behind it (critics, round 4). The answer moves down by less than a line.
          const bottom = box.getBoundingClientRect().bottom;
          const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          const range = document.createRange();
          let cut = Infinity;
          for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            if (!n.textContent?.trim()) continue;
            range.selectNodeContents(n);
            for (const r of range.getClientRects()) if (r.top < bottom && r.bottom > bottom + 1) cut = Math.min(cut, r.top);
          }
          const by = bottom - cut;
          if (by > 0 && by < 48) box.scrollTop -= by;
        }
        return;
      }
    }
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, steps, last?.answer, answeredId]);

  // A line of text cut in half at the pane's bottom or top edge stays hidden until it scrolls fully
  // into view (lib/cutLine.ts), so the pane ends on a whole line above the composer and starts on
  // one under the board, in every state (critics, 2026-10-27 round 1: while KataGo read, the
  // question's bubble showed sliced in half at the top), not only when an answer first opens.
  const hasMessages = messages.length > 0;
  useEffect(() => {
    const box = pane.current;
    if (!box) return;
    let frame = 0;
    const trim = () => {
      frame = 0;
      const range = document.createRange();
      range.selectNodeContents(box);
      const lines = [...range.getClientRects()];
      const edge = box.getBoundingClientRect();
      const bubbles = [...box.querySelectorAll('.bubble')].map((b) => b.getBoundingClientRect());
      const cut = cutBelow(lines, edge.bottom);
      const top = cutAbove(lines, edge.top, bubbles);
      const next = cut > 0 || top > 0 ? `inset(${top}px 0 ${cut}px 0)` : '';
      if (box.style.clipPath !== next) box.style.clipPath = next;
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(trim);
    };
    later();
    box.addEventListener('scroll', later, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later);
    ro?.observe(box);
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(later);
    mo?.observe(box, { childList: true, subtree: true, characterData: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      box.removeEventListener('scroll', later);
      ro?.disconnect();
      mo?.disconnect();
      box.style.clipPath = '';
    };
  }, [hasMessages]);

  if (!messages.length && board) {
    const side = colorName(toPlayAt(board));
    const ideas = hasPosition(board)
      ? [`What should ${side} play here?`, 'Explain this position', 'What is miai?']
      : [`What should ${side} play here?`, `Is ${'ABCDEFGHJKLMNOPQRST'[board.size - 4]}${board.size - 3} a good first move?`, 'What is sente?'];
    return (
      <div className="messages empty">
        <div className="hello">
          <HelloMark />
          <p className="hello-line">
            <span className="on-mouse">Click</span>
            <span className="on-touch">Tap</span> {hasPosition(board) ? 'a point or ask about this position.' : 'a point to play, or ask about any Go idea.'}
          </p>
          <p className="ideas">
            {ideas.map((t, i) => (
              <span key={t}>
                {i > 0 && (
                  <span className="idea-sep" aria-hidden="true">
                    {' · '}
                  </span>
                )}
                <button type="button" className="idea" onClick={() => onAsk(t)}>
                  {t}
                </button>
              </span>
            ))}
          </p>
        </div>
      </div>
    );
  }
  let lastUser = -1;
  messages.forEach((m, i) => m.role === 'user' && (lastUser = i));
  return (
    <AskContext.Provider value={busy ? null : onAsk}>
      <div className="messages" aria-live="polite" ref={pane}>
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <UserMessage key={m.id} m={m} canEdit={i === lastUser && !busy} onEdit={onEdit} />
          ) : (
            <KamiMessage key={m.id} m={m} running={running?.msgId === m.id ? running : null} isLast={i === messages.length - 1} link={link} onRegenerate={onRegenerate} onAsk={onAsk} onShowBoard={onShowBoard} busy={i === messages.length - 1 && busy} onReadLonger={onReadLonger} />
          ),
        )}
        <div ref={end} />
      </div>
    </AskContext.Provider>
  );
}
