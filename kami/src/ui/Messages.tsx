import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GlossaryEntry } from '../../../src/lib/coach/glossary';
import { CONCEPTS, conceptById, type ConceptEntry, type ConceptExample } from '../../../src/lib/coach/library';
import { type ConceptHit, type Explanation, type ExplainPosition, type ThoughtStep, type Variation } from '../../../src/lib/coach/explain/types';
import { locToGtp } from '../../../src/lib/go/coords';
import { colorName } from '../../../src/lib/go/types';
import { blocks, engineText, plainText, splitChips, type Inline } from '../lib/chips';
import { boardFromPosition, hasPosition, toPlayAt, type BoardState } from '../lib/position';
import type { Answer, ChatMessage } from '../lib/store';
import { pointView } from '../lib/points';
import { useSetting } from '../lib/settings';
import { firstTerms, splitRich, type RichPart } from '../lib/terms';
import { levelOfMessage } from '../lib/levels';
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

/** A hover (mouse) or tap (touch, pinned) target that shows something on the board. */
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
      onFocus={(e) => hoverOn && e.currentTarget.matches(':focus-visible') && link.onHover(p)}
      onBlur={() => link.onHover(null)}
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
  // "play P5 [[v1]]": the point already shows the line, so a chip that repeats it is left out.
  const repeats = (prev: Inline | undefined, id: string) => {
    const label = ex?.variations.find((v) => v.id === id)?.label;
    return !!label && !!prev && prev.type !== 'chip' && prev.text.trimEnd().endsWith(label);
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

const secs = (ms: number) => (ms < 1000 ? '<1s' : `${Math.round(ms / 1000)}s`);

/** Seconds since `t0`, ticking, so a read that has not reported a step yet still visibly runs. */
function Elapsed({ t0 }: { t0: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 200);
    return () => window.clearInterval(id);
  }, []);
  return <span className="meta">{((Date.now() - t0) / 1000).toFixed(1)} s</span>;
}

function Thoughts({ steps, live, ms, ex, msgId, link, stage, ultra }: { steps: ThoughtStep[]; live: boolean; ms: number; ex?: Explanation; msgId: string; link: BoardLink; stage?: Running['stage']; ultra?: boolean }) {
  const src = ex ? answerSrc(ex, msgId) : null;
  const plan = live ? null : firstTerms(steps.map((s) => s.text));
  const text = live ? (stage === 'engine' ? 'Starting KataGo…' : stage === 'writing' ? 'Writing…' : 'Thinking…') : `Thought for ${secs(ms)}`;
  // ultraGO says so while it works: its name in the running rainbow before the stage.
  const label = live && ultra && stage !== 'engine' ? (
    <>
      <UltraGo /> {text.toLowerCase()}
    </>
  ) : (
    text
  );
  const t0 = useRef(Date.now() - ms).current;
  return (
    <details className={`thoughts${live ? ' live' : ''}${live && ultra ? ' think-live ultra' : ''}`} open={live || undefined}>
      <summary>
        {live ? <span className="dive" aria-hidden="true" /> : <Icon name="spark" size={15} />}
        {label}
        <Icon name="down" size={14} />
      </summary>
      <ol>
        {steps.map((s, i) => (
          <li key={i}>
            <span>
              <Line text={s.text} src={src} link={link} terms={plan?.[i] ?? null} />
            </span>
            <span className="meta">
              {s.visits ? `${s.visits} visits · ` : ''}
              {(s.ms / 1000).toFixed(1)} s
            </span>
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
          {ex.reads} {ex.reads === 1 ? 'read' : 'reads'} · {ex.totalVisits.toLocaleString()} visits · {(ex.ms / 1000).toFixed(1)} s
        </p>
      )}
    </details>
  );
}

function ConceptTags({ hits, ex, msgId, link }: { hits: ConceptHit[]; ex: Explanation; msgId: string; link: BoardLink }) {
  if (!hits.length) return null;
  const size = ex.position.size;
  return (
    <div className="tags" aria-label="Ideas found">
      {hits.map((h, i) => {
        const v = h.variation ? ex.variations.find((x) => x.id === h.variation) : undefined;
        const at = h.at.map((l) => locToGtp(l, size)).join(' ');
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
            {h.id.replace(/-/g, ' ')}
            {at && <span className="tag-at">{at}</span>}
          </BoardChip>
        );
      })}
    </div>
  );
}

function ExplainAnswer({ a, msg, link }: { a: Extract<Answer, { type: 'explain' }>; msg: ChatMessage; link: BoardLink }) {
  const ex = a.explanation;
  const w = a.writing;
  const src = answerSrc(ex, msg.id);
  // Each Go term is underlined once: where it first appears in the answer, then in the facts.
  const plan = firstTerms(w.text ? [w.text] : [ex.summary, ...ex.sections.map((s) => s.text)]);
  const factPlan = firstTerms(ex.facts.map((f) => f.text));
  return (
    <>
      <Thoughts steps={ex.thoughts} live={false} ms={ex.ms} ex={ex} msgId={msg.id} link={link} />
      {w.text ? (
        <RichText text={w.text} ex={ex} msgId={msg.id} link={link} terms={plan[0]} />
      ) : (
        <>
          <RichText text={ex.summary} ex={ex} msgId={msg.id} link={link} terms={plan[0]} />
          {ex.sections.map((s, i) => (
            <section key={i} className="ans-section">
              <h4>{s.title}</h4>
              <RichText text={s.text} ex={ex} msgId={msg.id} link={link} terms={plan[i + 1]} />
            </section>
          ))}
        </>
      )}
      {w.note && <p className="note">{w.note}</p>}
      {w.text && <p className="note">{w.by === 'local' ? 'Worded by Kiai’s local model' : 'Worded by ultraGO'}, checked against KataGo’s facts.</p>}
      <ConceptTags hits={ex.concepts} ex={ex} msgId={msg.id} link={link} />
      {ex.facts.length > 0 && (
        <details className="facts">
          <summary>
            Facts from KataGo ({ex.facts.length}) <Icon name="down" size={14} />
          </summary>
          <ul>
            {ex.facts.map((f, i) => (
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

function UserMessage({ m, canEdit, onEdit }: { m: ChatMessage; canEdit: boolean; onEdit: (t: string) => void }) {
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
}

function KamiMessage({
  m,
  running,
  isLast,
  link,
  onRegenerate,
  onAsk,
  onShowBoard,
  busy,
}: {
  m: ChatMessage;
  running: Running | null;
  isLast: boolean;
  link: BoardLink;
  onRegenerate: () => void;
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
      {live && <Thoughts steps={running!.steps} live ms={Date.now() - running!.t0} msgId={m.id} link={link} stage={running!.stage} ultra={lvl?.id === 'ultrago'} />}
      {!live && !a && <p className="note">Stopped.</p>}
      {a?.type === 'explain' && <ExplainAnswer a={a} msg={m} link={link} />}
      {a?.type === 'concept' && <ConceptAnswer a={a} msg={m} link={link} onAsk={onAsk} onShowBoard={onShowBoard} />}
      {a?.type === 'error' && <p className="note">{a.text}</p>}
      {a && (
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
}

interface Props {
  messages: ChatMessage[];
  running: Running | null;
  board: BoardState;
  link: BoardLink;
  onAsk: (text: string) => void;
  onRegenerate: () => void;
  onEdit: (text: string) => void;
  onShowBoard: (b: BoardState) => void;
  busy: boolean;
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

export function Messages({ messages, running, board, link, onAsk, onRegenerate, onEdit, onShowBoard, busy }: Props) {
  const end = useRef<HTMLDivElement>(null);
  const steps = running?.steps.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, steps, messages[messages.length - 1]?.answer]);

  if (!messages.length) {
    const side = colorName(toPlayAt(board));
    const ideas = hasPosition(board)
      ? [`What should ${side} play here?`, 'Explain this position', 'What is miai?']
      : [`What should ${side} play here?`, `Is ${'ABCDEFGHJKLMNOPQRST'[board.size - 4]}${board.size - 3} a good first move?`, 'What is sente?'];
    return (
      <div className="messages empty">
        <div className="hello">
          <HelloMark />
          <h1>What shall we read?</h1>
          <p>Ask about any Go position. KataGo reads it in your browser, and Kiai tells you why.</p>
          <div className="ideas">
            {ideas.map((t) => (
              <button key={t} type="button" className="idea" onClick={() => onAsk(t)}>
                <span className="idea-stone" aria-hidden="true" />
                {t}
              </button>
            ))}
          </div>
          <p className="meta">Set up a position: click the board, paste an SGF or open a file. Name a point like R16 to ask about it.</p>
        </div>
      </div>
    );
  }
  let lastUser = -1;
  messages.forEach((m, i) => m.role === 'user' && (lastUser = i));
  return (
    <AskContext.Provider value={busy ? null : onAsk}>
      <div className="messages" aria-live="polite">
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <UserMessage key={m.id} m={m} canEdit={i === lastUser && !busy} onEdit={onEdit} />
          ) : (
            <KamiMessage key={m.id} m={m} running={running} isLast={i === messages.length - 1} link={link} onRegenerate={onRegenerate} onAsk={onAsk} onShowBoard={onShowBoard} busy={busy} />
          ),
        )}
        <div ref={end} />
      </div>
    </AskContext.Provider>
  );
}
