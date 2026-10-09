import { useEffect, useRef, useState } from 'react';
import type { AskTurn, ProbeResult } from '../../shared/ask';
import { askPosition } from '../lib/coach/ask';
import { buildFacts, type ExtraFacts, type FactInput } from '../lib/coach/facts';
import { rankLabel } from '../lib/level/ranks';
import { runProbe, type ProbeBase } from '../state/coach';
import { useStore } from '../state/store';
import { useLevelOf, usePlayerTargets } from './Level';
import { BrandSpinner } from './Brand';
import './ask.css';

interface Turn extends AskTurn {
  unsupported: string[];
  probes: ProbeResult[];
  model?: string;
}

/**
 * Questions about the position on screen, answered by the language model from KataGo's
 * analysis only (see shared/ask.ts). `facts` is read when a question is asked, so the
 * answer uses the deepest analysis available at that moment.
 */
export function AskPanel({
  positionKey,
  facts,
  extra,
  base,
  hasPlayed,
  chatHref,
}: {
  positionKey: string;
  facts: () => FactInput | null;
  /** Move insights, pro games and comments, gathered when a question is asked. */
  extra?: () => Promise<ExtraFacts>;
  base: () => ProbeBase | null;
  hasPlayed?: boolean;
  /** Opens this position in the Go Coach chat. */
  chatHref?: string;
}) {
  const llm = useStore((s) => s.llm);
  const useLlm = useStore((s) => s.settings.useLlm);
  const { level } = useLevelOf(usePlayerTargets());
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef(positionKey);

  useEffect(() => {
    keyRef.current = positionKey;
    setTurns([]);
    setError(null);
    setBusy(null);
  }, [positionKey]);

  const ask = async (question: string) => {
    const input = facts();
    const b = base();
    if (!input || !b || !question.trim()) return;
    const key = positionKey;
    setBusy('Reading…');
    setError(null);
    try {
      const more = extra ? await extra().catch(() => ({})) : {};
      const f = { ...buildFacts({ ...input, level: level ? `about ${rankLabel(level.overall.rank)}` : undefined }), ...more };
      const out = await askPosition(
        question.trim(),
        f,
        async (p) => {
          if (keyRef.current === key) setBusy(`Checking ${p.moves.join(' ')}…`);
          return runProbe(b, p);
        },
        turns.map(({ question, answer }) => ({ question, answer })),
      );
      if (keyRef.current !== key) return;
      setTurns((t) => [...t, { question: question.trim(), answer: out.answer, unsupported: out.unsupported, probes: out.probes, model: out.model }]);
      setQ('');
    } catch (e) {
      if (keyRef.current === key) setError((e as Error).message);
    } finally {
      if (keyRef.current === key) setBusy(null);
    }
  };

  const off = !useLlm ? 'LLM is off in Settings.' : llm && !llm.configured ? 'LLM_API_KEY is not set on the server.' : null;
  const quick = [
    'Why is the top move best?',
    ...(hasPlayed ? ['How good was the played move?'] : []),
    'Is there an only move here?',
    'Which groups are weak?',
    'What matters here?',
    'Key moments of this game?',
  ];

  return (
    <div className="panel stack ask">
      <div className="spread">
        <h3>Ask</h3>
        <div className="row">
          {chatHref && (
            <a className="btn small ghost" href={chatHref} title="Open in Coach">
              Coach
            </a>
          )}
          {turns.length > 0 && (
            <button className="btn small ghost" onClick={() => setTurns([])}>
              Clear
            </button>
          )}
        </div>
      </div>
      {off ? (
        <p className="small dim">{off}</p>
      ) : (
        <>
          {turns.map((t, i) => (
            <div key={i} className="ask-turn">
              <div className="ask-q small">{t.question}</div>
              <div className="ask-a small">{t.answer}</div>
              {t.probes.length > 0 && (
                <div className="tiny muted">
                  Checked:{' '}
                  {t.probes
                    .map((p) => (p.legal && p.blackWinrate !== undefined ? `${p.moves.join(' ')} → Black ${p.blackWinrate.toFixed(0)}%, ${p.blackLead! >= 0 ? 'B' : 'W'}+${Math.abs(p.blackLead!).toFixed(1)}` : `${p.moves.join(' ')} (${p.note ?? 'not playable'})`))
                    .join(' · ')}
                </div>
              )}
              {t.unsupported.length > 0 && (
                <div className="tiny warn-text">Unverified: {t.unsupported.join(', ')}</div>
              )}
            </div>
          ))}
          {busy ? (
            <div className="small row">
              <BrandSpinner /> {busy}
            </div>
          ) : (
            <>
              <div className="row wrap ask-quick">
                {quick.map((x) => (
                  <button key={x} className="chip" onClick={() => void ask(x)}>
                    {x}
                  </button>
                ))}
              </div>
              <form
                className="row ask-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(q);
                }}
              >
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Is D16 alive?" maxLength={500} aria-label="Question" />
                <button className="btn small primary" disabled={!q.trim()}>
                  Ask
                </button>
              </form>
            </>
          )}
          {error && <div className="tiny bad-text">{error}</div>}
        </>
      )}
    </div>
  );
}
