import { useMemo, useState } from 'react';
import { LevelPanel, usePlayerTargets } from '../components/Level';
import { usesDemoData } from '../state/actions';
import { rankLabel } from '../lib/level/ranks';
import { useStore } from '../state/store';
import { corpus, rebuildProfile, runLlmDiscovery } from '../state/actions';
import { Bar, fmtPct, MoveThumb } from '../components/common';
import { AXIS_LABEL } from '../lib/profile/fingerprint';
import { buildExample, describeWeights, predict } from '../lib/profile/doppel';
import { buildContext } from '../lib/go/features';
import { decodeOwnership } from '../lib/engine/parse';
import { locToGtp } from '../lib/go/coords';
import { go, href } from '../router';
import type { AxisStats, MoveRecord, Weakness } from '../lib/types';

function Radar({ axes }: { axes: AxisStats[] }) {
  const shown = axes.filter((a) => a.n >= 8);
  const N = shown.length;
  if (N < 3) return <p className="small muted">Needs more analysed moves.</p>;
  const R = 100, cx = 200, cy = 140;
  const pt = (i: number, v: number) => {
    const a = (Math.PI * 2 * i) / N - Math.PI / 2;
    return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v] as const;
  };
  const poly = shown.map((a, i) => pt(i, Math.max(0.05, a.accuracy)).join(',')).join(' ');
  return (
    <svg viewBox="-40 0 480 285" style={{ width: '100%', maxWidth: 520 }}>
      {[0.25, 0.5, 0.75, 1].map((r) => (
        <polygon key={r} points={shown.map((_, i) => pt(i, r).join(',')).join(' ')} fill="none" stroke="var(--line)" />
      ))}
      {shown.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line)" />;
      })}
      <polygon points={poly} fill="rgba(212,166,86,0.2)" stroke="var(--you)" strokeWidth={1.5} />
      {shown.map((a, i) => {
        const [x, y] = pt(i, 1.14);
        const anchor = Math.abs(x - cx) < 8 ? 'middle' : x > cx ? 'start' : 'end';
        return (
          <text key={a.axis} x={x} y={y} fill="var(--ink-2)" fontSize={9.5} textAnchor={anchor} dominantBaseline="middle">
            {a.label}
          </text>
        );
      })}
    </svg>
  );
}

function DoppelSection() {
  const doppel = useStore((s) => s.doppel);
  const version = useStore((s) => s.corpusVersion);
  const games = useStore((s) => s.games);
  const examples = useMemo(() => {
    if (!doppel) return [];
    const c = corpus();
    const out: { r: MoveRecord; dop: number; p: number }[] = [];
    for (const r of c.playerRecords()) {
      if (out.length >= 6) break;
      const e = c.analyses.get(r.gameId)?.evals[r.index];
      if (!e || r.index % 3) continue;
      const g = c.games.get(r.gameId)!;
      const ctx = buildContext(c.boards(r.gameId)[r.index], decodeOwnership(e.ownership));
      const prev = r.index > 0 ? g.moves[r.index - 1] : null;
      const ex = buildExample(ctx, e.policy, r.color, prev && prev.color !== r.color ? prev.loc : null, null);
      if (!ex) continue;
      const top = predict(doppel, ex)[0];
      if (top.loc !== r.bestLoc && top.p > 0.3 && r.scoreLoss > 1) out.push({ r, dop: top.loc, p: top.p });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doppel, version]);
  if (!doppel) return <p className="small muted">The Doppelgänger is trained once at least 30 of your moves are analysed.</p>;
  const m = doppel.metrics;
  const habits = describeWeights(doppel);
  return (
    <div className="stack">
      <p className="dim small">
        A behavioural model of which move you choose, learned from {doppel.trainedOn} of your moves (version {doppel.version}). It starts from KataGo's move probabilities and learns how you deviate from them. It
        predicts habits, not thoughts.
      </p>
      <div className="grid cols-3">
        <div className="panel">
          <div className="stat">
            <div className="v doppel">{fmtPct(m.top1)}</div>
            <div className="l">predicts your exact move</div>
            <div className="small muted">KataGo policy alone: {fmtPct(m.baselineTop1)}</div>
          </div>
        </div>
        <div className="panel">
          <div className="stat">
            <div className="v doppel">{fmtPct(m.top3)}</div>
            <div className="l">your move in its top 3</div>
            <div className="small muted">KataGo policy alone: {fmtPct(m.baselineTop3)}</div>
          </div>
        </div>
        <div className="panel">
          <div className="stat">
            <div className="v">{m.testSize}</div>
            <div className="l">held-out test moves</div>
            <div className="small muted">from games it did not train on</div>
          </div>
        </div>
      </div>
      {habits.length > 0 && (
        <div>
          <h3 style={{ margin: '6px 0' }}>Learned habits (vs KataGo)</h3>
          <div className="stack">
            {habits.slice(0, 8).map((h) => (
              <div key={h.label} className="grid" style={{ gridTemplateColumns: '220px 1fr 60px', alignItems: 'center', gap: 10 }}>
                <span className="small">
                  {h.weight > 0 ? 'Prefers' : 'Avoids'} {h.label}
                </span>
                <div className="bar">
                  <span style={{ width: `${Math.min(100, Math.abs(h.weight) * 40)}%`, background: h.weight > 0 ? 'var(--doppel)' : 'var(--muted)' }} />
                </div>
                <span className="small mono">{h.weight > 0 ? '+' : ''}{h.weight.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {examples.length > 0 && (
        <div>
          <h3 style={{ margin: '10px 0 8px' }}>KataGo's move vs your likely move</h3>
          <div className="card-list">
            {examples.map(({ r, dop, p }) => {
              const g = games.find((x) => x.id === r.gameId)!;
              return (
                <div key={r.id} className="poscard" onClick={() => go(`review/${r.gameId}?move=${r.index + 1}`)}>
                  <MoveThumb game={g} record={r} extra={[{ loc: dop, kind: 'doppel', label: 'D' }]} />
                  <div className="small">
                    <span className="kata">KataGo {locToGtp(r.bestLoc, r.size)}</span> · <span className="doppel">you, likely {locToGtp(dop, r.size)} ({fmtPct(p)})</span>
                  </div>
                  <div className="tiny muted">
                    Move {r.index + 1} · you played {locToGtp(r.loc, r.size)} (−{r.scoreLoss.toFixed(1)})
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerLevelPanel() {
  const targets = usePlayerTargets();
  return <LevelPanel targets={targets} who={usesDemoData() ? "the demo player's" : 'your'} auto />;
}

/** How this weakness compares with players of the same level. */
function PeerChip({ peer }: { peer: NonNullable<Weakness['peer']> }) {
  const r = peer.ratio;
  const text =
    r >= 1.4
      ? `${r.toFixed(1)}× as often as ${rankLabel(peer.rank)} players`
      : r <= 0.75
        ? `less often than most ${rankLabel(peer.rank)} players`
        : `about as often as ${rankLabel(peer.rank)} players`;
  return (
    <span className={`chip ${r >= 1.4 ? 'bad' : r <= 0.75 ? 'good' : ''}`} title={`You: ${fmtPct(peer.playerRate)} of ${peer.opportunities} such decisions. Players around ${rankLabel(peer.rank)}: ${fmtPct(peer.peerRate)} (network-pass counts, so these differ a little from the numbers above).`}>
      {text}
    </span>
  );
}

function WeaknessDetail({ w }: { w: Weakness }) {
  const games = useStore((s) => s.games);
  const [open, setOpen] = useState(false);
  const c = corpus();
  const ev = w.evidence.slice(0, open ? 12 : 4).map((e) => c.byId.get(e.moveId)).filter((r): r is MoveRecord => !!r);
  return (
    <div className="panel stack">
      <div className="spread">
        <div>
          <h2>{w.llm?.title ?? w.title}</h2>
          <div className="tiny muted">
            {AXIS_LABEL[w.category] ?? w.category} · discovered {new Date(w.discoveredAt).toLocaleDateString()}
            {w.llm && ` · wording by ${w.llm.model}`}
          </div>
        </div>
        <div className="row">
          <span className={`chip ${w.status === 'improving' ? 'good' : w.status === 'resolved' ? 'kata' : 'bad'}`}>{w.status}</span>
          <a className="btn small primary" href={href(`forge/${w.id}`)}>
            Train
          </a>
        </div>
      </div>
      <p className="dim small">{w.llm?.description ?? w.description}</p>
      {w.llm && <p className="tiny muted">Statistics: {w.description}</p>}
      {w.llm?.trainingFocus && <div className="callout small">{w.llm.trainingFocus}</div>}
      <div className="row wrap small">
        <span className="chip">
          {w.occurrences} errors / {w.opportunities} chances ({fmtPct(w.errorRate)})
        </span>
        <span className="chip">{w.games} games</span>
        <span className="chip">confidence {fmtPct(w.confidence)}</span>
        {w.peer && <PeerChip peer={w.peer} />}
        <span className="chip">−{w.totalScoreLoss.toFixed(0)} pts total</span>
        {w.trend.older + w.trend.newer > 0 && (
          <span className={`chip ${w.trend.newer < w.trend.older ? 'good' : 'bad'}`}>
            older games {fmtPct(w.trend.older)} → recent {fmtPct(w.trend.newer)}
          </span>
        )}
      </div>
      <div className="card-list">
        {ev.map((r) => {
          const g = games.find((x) => x.id === r.gameId);
          if (!g) return null;
          return (
            <div key={r.id} className="poscard" onClick={() => go(`review/${r.gameId}?move=${r.index + 1}`)}>
              <MoveThumb game={g} record={r} />
              <div className="tiny muted">
                {g.black} vs {g.white} · move {r.index + 1} · −{r.scoreLoss.toFixed(1)} pts
              </div>
            </div>
          );
        })}
      </div>
      {w.evidence.length > 4 && (
        <button className="btn small ghost" style={{ justifySelf: 'start' }} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : `Show more evidence (${w.evidence.length})`}
        </button>
      )}
    </div>
  );
}

export function PlayerDNA() {
  const profile = useStore((s) => s.profile);
  const weaknesses = useStore((s) => s.weaknesses);
  const busy = useStore((s) => s.busy);
  const llm = useStore((s) => s.llm);
  const settings = useStore((s) => s.settings);
  if (!profile)
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <div className="eyebrow">Your fingerprint</div>
            <h1>Player DNA</h1>
          </div>
        </div>
        <div className="empty">Your Player DNA appears after your first analysed game. Make sure the library knows which side you played.</div>
      </div>
    );
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Your fingerprint</div>
          <h1>Player DNA</h1>
          <p className="sub">
            {profile.name} · {profile.games} games · {profile.playerMoves} of your moves · model v{profile.version}
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => void rebuildProfile()} disabled={busy.profile}>
            {busy.profile ? 'Rebuilding…' : 'Rebuild'}
          </button>
          <button
            className="btn primary"
            disabled={!llm?.configured || busy.llm || !settings.useLlm}
            title={!llm?.configured ? 'Set LLM_API_KEY on the server to enable' : 'Send compressed evidence (not your games) to the LLM'}
            onClick={() => void runLlmDiscovery()}
          >
            {busy.llm ? 'Discovering…' : 'Discover patterns with LLM'}
          </button>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <h3 style={{ marginBottom: 8 }}>Level</h3>
        <PlayerLevelPanel />
      </div>

      <div className="grid cols-2">
        <div className="panel">
          <h3>Accuracy by area</h3>
          <Radar axes={profile.axes} />
          <p className="tiny muted">Share of moves losing less than 1 point, per area. Overall: {fmtPct(profile.overallAccuracy)}.</p>
        </div>
        <div className="panel">
          <h3 style={{ marginBottom: 8 }}>Tendencies vs KataGo in the same positions</h3>
          <div className="stack" style={{ maxHeight: 360, overflowY: 'auto' }}>
            {profile.axes
              .filter((a) => a.n >= 8)
              .map((a) => (
                <div key={a.axis} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
                  <div className="spread">
                    <strong className="small">{a.label}</strong>
                    <span className="tiny muted">
                      {a.n} moves · −{a.avgScoreLoss.toFixed(2)} pts avg
                    </span>
                  </div>
                  <p className="tiny dim" style={{ margin: '3px 0 5px' }}>
                    {a.summary}
                  </p>
                  {a.tendencies.map((t) => (
                    <div key={t.label} className="grid" style={{ gridTemplateColumns: '150px 1fr 1fr', gap: 8, alignItems: 'center', marginTop: 3 }}>
                      <span className="tiny dim">{t.label}</span>
                      <div className="row">
                        <Bar value={t.player} />
                        <span className="tiny mono you">{fmtPct(t.player)}</span>
                      </div>
                      <div className="row">
                        <Bar value={t.engine} tone="kata" />
                        <span className="tiny mono kata">{fmtPct(t.engine)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
          </div>
          <p className="tiny muted" style={{ marginTop: 6 }}>
            <span className="you">amber</span>: how often you do it · <span className="kata">teal</span>: how often KataGo's move does
          </p>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <h3 style={{ marginBottom: 8 }}>Doppelgänger</h3>
        <DoppelSection />
      </div>

      <div style={{ marginTop: 18 }}>
        <div className="spread" style={{ marginBottom: 10 }}>
          <h3>Recurring weaknesses</h3>
          <span className="small muted">each one needs 3+ errors across 2+ games and a clearly raised error rate</span>
        </div>
        {weaknesses.length ? weaknesses.map((w) => <WeaknessDetail key={w.id} w={w} />) : <div className="empty">No recurring weakness confirmed yet.</div>}
      </div>
    </div>
  );
}
