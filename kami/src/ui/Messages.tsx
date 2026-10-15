import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CONCEPTS, conceptById, type ConceptEntry } from '../../../src/lib/coach/library';
import { KAMI_VERSION, type ConceptHit, type Explanation, type ThoughtStep, type Variation } from '../../../src/lib/coach/explain/types';
import { locToGtp } from '../../../src/lib/go/coords';
import { colorName } from '../../../src/lib/go/types';
import { blocks, engineText, plainText, splitChips } from '../lib/chips';
import { boardFromPosition, hasPosition, toPlayAt, type BoardState } from '../lib/position';
import type { Answer, ChatMessage } from '../lib/store';
import { pickById } from '../lib/writer';
import type { Preview } from './BoardPanel';
import { Icon } from './Icon';

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
  };
}

/** A hover (mouse) or tap (touch, pinned) target that shows something on the board. */
function BoardChip({ preview, link, className, children }: { preview: (pinned: boolean) => Preview; link: BoardLink; className?: string; children: ReactNode }) {
  const p = preview(false);
  const on = link.pinnedKey === p.key;
  return (
    <button
      type="button"
      className={`${className ?? 'chip'}${on ? ' on' : ''}`}
      onPointerEnter={(e) => e.pointerType === 'mouse' && link.onHover(p)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && link.onHover(null)}
      onFocus={(e) => e.currentTarget.matches(':focus-visible') && link.onHover(p)}
      onBlur={() => link.onHover(null)}
      onClick={() => link.onPin(on ? null : preview(true))}
      title={p.note || p.title}
    >
      {children}
    </button>
  );
}

function VariationChip({ id, ex, msgId, link }: { id: string; ex: Explanation; msgId: string; link: BoardLink }) {
  const v = ex.variations.find((x) => x.id === id);
  if (!v) return null;
  return (
    <BoardChip preview={(pinned) => variationPreview(`${msgId}:${id}`, ex, v, pinned)} link={link}>
      <Icon name="board" size={13} />
      {v.label}
    </BoardChip>
  );
}

/** Writer text: paragraphs, lists, headings, **bold** and [[vN]] chips. */
function RichText({ text, ex, msgId, link }: { text: string; ex?: Explanation; msgId: string; link: BoardLink }) {
  const inline = (s: string) =>
    splitChips(s).map((part, i) =>
      part.type === 'chip' ? (
        ex ? <VariationChip key={i} id={part.id} ex={ex} msgId={msgId} link={link} /> : null
      ) : part.type === 'bold' ? (
        <strong key={i}>{part.text}</strong>
      ) : (
        <span key={i}>{part.text}</span>
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

function Thoughts({ steps, live, ms, ex, msgId, link, stage }: { steps: ThoughtStep[]; live: boolean; ms: number; ex?: Explanation; msgId: string; link: BoardLink; stage?: Running['stage'] }) {
  const label = live ? (stage === 'engine' ? 'Starting KataGo…' : stage === 'writing' ? 'Writing…' : 'Thinking…') : `Thought for ${secs(ms)}`;
  return (
    <details className={`thoughts${live ? ' live' : ''}`} open={live || undefined}>
      <summary>
        <Icon name="spark" size={15} />
        {label}
        <Icon name="down" size={14} />
      </summary>
      <ol>
        {steps.map((s, i) => (
          <li key={i}>
            <span>{s.text}</span>
            <span className="meta">
              {s.visits ? `${s.visits} visits · ` : ''}
              {(s.ms / 1000).toFixed(1)} s
            </span>
            {s.variation && ex && <VariationChip id={s.variation} ex={ex} msgId={msgId} link={link} />}
          </li>
        ))}
        {!steps.length && <li className="meta">{live ? 'Waiting for the engine…' : 'No steps were recorded.'}</li>}
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
            ? variationPreview(key, ex, v, pinned, { highlight: h.at, note: h.evidence })
            : { key, base: ex.position, line: [], highlight: h.at, title: `${h.id}${at ? ` at ${at}` : ''}`, note: h.evidence, pinned };
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
  return (
    <>
      <Thoughts steps={ex.thoughts} live={false} ms={ex.ms} ex={ex} msgId={msg.id} link={link} />
      {w.text ? (
        <RichText text={w.text} ex={ex} msgId={msg.id} link={link} />
      ) : (
        <>
          <RichText text={ex.summary} ex={ex} msgId={msg.id} link={link} />
          {ex.sections.map((s, i) => (
            <section key={i} className="ans-section">
              <h4>{s.title}</h4>
              <RichText text={s.text} ex={ex} msgId={msg.id} link={link} />
            </section>
          ))}
        </>
      )}
      {w.note && <p className="note">{w.note}</p>}
      {w.text && <p className="note">Worded by {w.by === 'local' ? 'Kami Local' : 'Gemini'}, checked against KataGo’s facts.</p>}
      <ConceptTags hits={ex.concepts} ex={ex} msgId={msg.id} link={link} />
      {ex.facts.length > 0 && (
        <details className="facts">
          <summary>
            Facts from KataGo ({ex.facts.length}) <Icon name="down" size={14} />
          </summary>
          <ul>
            {ex.facts.map((f) => (
              <li key={f.id}>{f.text}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function ConceptAnswer({ a, msg, link, onAsk, onShowBoard }: { a: Extract<Answer, { type: 'concept' }>; msg: ChatMessage; link: BoardLink; onAsk: (t: string) => void; onShowBoard: (b: BoardState) => void }) {
  const entries = a.ids.map((id) => conceptById(id)).filter((e): e is ConceptEntry => !!e);
  if (!entries.length) {
    return (
      <div className="rich">
        <p>
          {CONCEPTS.length
            ? 'I didn’t find a Go idea I know in that. Ask about one, like “What is miai?”, or set up a position on the board and ask about it.'
            : 'Kami’s concept library is still being written, so I can’t answer concept questions yet.'}
        </p>
        <p>To ask about a position, set it up on the board (click to play, paste an SGF or open a file), then ask “What should Black play?” or about a move like R16.</p>
      </div>
    );
  }
  const [e, ...others] = entries;
  return (
    <div className="concept">
      <h3>
        {e.name} <span className="level">{e.level}</span>
      </h3>
      <p className="lead">{e.short}</p>
      {a.expansion?.text && (
        <section className="ans-section">
          <h4>In more depth</h4>
          <RichText text={a.expansion.text} msgId={msg.id} link={link} />
          <p className="note">Worded by Gemini from the library entry.</p>
        </section>
      )}
      {a.expansion?.note && <p className="note">{a.expansion.note}</p>}
      {e.body.map((s, i) => (
        <section key={i} className="ans-section">
          <h4>{s.title}</h4>
          <RichText text={s.text} msgId={msg.id} link={link} />
        </section>
      ))}
      {e.mistakes.length > 0 && (
        <section className="ans-section">
          <h4>Common mistakes</h4>
          <ul>
            {e.mistakes.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
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
                  <p>{x.note}</p>
                  <div className="ex-foot">
                    <span className="meta">{x.source}</span>
                    <button
                      type="button"
                      className={`chip${link.pinnedKey === key ? ' on' : ''}`}
                      onClick={() => {
                        onShowBoard(boardFromPosition(x.position, x.title));
                        link.onPin({ key, base: x.position, line: x.line, highlight: [], title: x.title, note: x.note, pinned: true });
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

function KamiMessage({ m, running, isLast, link, onRegenerate, onAsk, onShowBoard, busy }: { m: ChatMessage; running: Running | null; isLast: boolean; link: BoardLink; onRegenerate: () => void; onAsk: (t: string) => void; onShowBoard: (b: BoardState) => void; busy: boolean }) {
  const tier = m.pick ? pickById(m.pick) : null;
  const live = running?.msgId === m.id;
  const a = m.answer;
  return (
    <div className="msg kami">
      <div className="who">
        {tier ? `${tier.name} ${KAMI_VERSION}` : 'Kami'}
        {m.thinking && m.thinking !== 'off' && !(a && a.type === 'concept') ? <span className="meta"> · thinking {m.thinking}</span> : null}
      </div>
      {live && <Thoughts steps={running!.steps} live ms={Date.now() - running!.t0} msgId={m.id} link={link} stage={running!.stage} />}
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
          <h1>Kami</h1>
          <p>Ask about a Go position. KataGo reads it on your device, and Kami shows you why.</p>
          <div className="ideas">
            {ideas.map((t) => (
              <button key={t} type="button" className="idea" onClick={() => onAsk(t)}>
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
  );
}
