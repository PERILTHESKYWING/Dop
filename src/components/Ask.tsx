import { useEffect, useRef, useState } from 'react';
import type { AskTurn, ProbeResult } from '../../shared/ask';
import { askPosition } from '../lib/coach/ask';
import { buildFacts, type FactInput } from '../lib/coach/facts';
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
export function AskPanel({ positionKey, facts, base, hasPlayed }: { positionKey: string; facts: () => FactInput | null; base: () => ProbeBase | null; hasPlayed?: boolean }) {
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
    setBusy('Reading KataGo’s analysis…');
    setError(null);
    try {
      const f = buildFacts({ ...input, level: level ? `about ${rankLabel(level.overall.rank)}` : undefined });
      const out = await askPosition(
        question.trim(),
        f,
        async (p) => {
          if (keyRef.current === key) setBusy(`KataGo is checking ${p.moves.join(' ')}…`);
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

  const off = !useLlm ? 'The language model is switched off in Settings.' : llm && !llm.configured ? 'The language model is not configured on the server (LLM_API_KEY).' : null;
  const quick = [
    'Why is KataGo’s top move best here?',
    ...(hasPlayed ? ['What was wrong with the move played?'] : []),
    'Which groups are weak, and what should each side do about them?',
    'What should I be thinking about in this position?',
  ];

  return (
    <div className="panel stack ask">
      <div className="spread">
        <h3>Ask about this position</h3>
        {turns.length > 0 && (
          <button className="btn small ghost" onClick={() => setTurns([])}>
            Clear
          </button>
        )}
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
                  KataGo checked:{' '}
                  {t.probes
                    .map((p) => (p.legal && p.blackWinrate !== undefined ? `${p.moves.join(' ')} → Black ${p.blackWinrate.toFixed(0)}%, ${p.blackLead! >= 0 ? 'B' : 'W'}+${Math.abs(p.blackLead!).toFixed(1)}` : `${p.moves.join(' ')} (${p.note ?? 'not playable'})`))
                    .join(' · ')}
                </div>
              )}
              {t.unsupported.length > 0 && (
                <div className="tiny warn-text">Not found in KataGo’s analysis, treat with care: {t.unsupported.join(', ')}</div>
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
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Is my group at D16 alive?" maxLength={500} aria-label="Your question" />
                <button className="btn small primary" disabled={!q.trim()}>
                  Ask
                </button>
              </form>
            </>
          )}
          {error && <div className="tiny bad-text">{error}</div>}
          <p className="tiny muted">Answers use only KataGo’s numbers and lines; figures it can’t find there are flagged.</p>
        </>
      )}
    </div>
  );
}
