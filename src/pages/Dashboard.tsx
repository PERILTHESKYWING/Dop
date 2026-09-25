import { useMemo } from 'react';
import { useStore } from '../state/store';
import { corpus, importFiles, loadDemo, runQueue, startEngine } from '../state/actions';
import { Bar, DropZone, fmtPct, Stat } from '../components/common';
import { go, href } from '../router';
import { AXES, AXIS_LABEL } from '../lib/profile/fingerprint';
import { describeWeights } from '../lib/profile/doppel';
import type { Phase, Weakness } from '../lib/types';
import { modelOrderFor } from '../lib/engine/models';

function Check({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  return (
    <div className="spread" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
      <div>
        <span className={`dot ${ok === null ? 'busy' : ok ? 'ok' : 'err'}`} />
        {label}
      </div>
      <span className="small muted">{detail}</span>
    </div>
  );
}

function FirstRun() {
  const caps = useStore((s) => s.caps);
  const engine = useStore((s) => s.engine);
  const llm = useStore((s) => s.llm);
  const settings = useStore((s) => s.settings);
  const order = caps ? modelOrderFor(settings.modelId, caps.webgpu && !settings.forceCpu) : [];
  const prog = engine.progress;
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div>
          <h1>Set up your training lab</h1>
          <p className="sub">Everything runs in this browser. Your games and analyses stay on this device.</p>
        </div>
      </div>
      <div className="grid cols-2">
        <div className="panel">
          <h3 style={{ marginBottom: 8 }}>This device</h3>
          <Check ok={caps ? caps.webgpu : null} label="WebGPU" detail={caps ? (caps.webgpu ? caps.webgpuAdapter ?? 'available' : 'not available: CPU fallback will be used') : 'checking…'} />
          <Check ok={caps ? caps.wasm : null} label="WebAssembly (CPU fallback)" detail={caps ? (caps.wasm ? 'available' : 'missing') : 'checking…'} />
          <Check
            ok={engine.status === 'ready' ? true : engine.status === 'error' || engine.status === 'unsupported' ? false : engine.status === 'off' ? false : null}
            label="KataGo network"
            detail={
              engine.status === 'ready'
                ? `${engine.info?.modelName} · ${engine.info?.backend === 'webgpu' ? 'WebGPU' : 'CPU'}`
                : engine.status === 'loading'
                  ? prog?.stage === 'download'
                    ? `downloading ${Math.round(prog.loaded / 1e6)}${prog.total ? ` / ${Math.round(prog.total / 1e6)}` : ''} MB`
                    : 'loading…'
                  : engine.status === 'error'
                    ? 'failed to load (see Engine & Settings)'
                    : `not loaded yet${order[0] ? ` · will use ${order[0].name}` : ''}`
            }
          />
          <Check ok={llm ? llm.configured : null} label="LLM pattern discovery" detail={llm ? (llm.configured ? `${llm.model}` : 'not configured: optional') : 'checking…'} />
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => void startEngine()} disabled={engine.status === 'loading' || engine.status === 'ready'}>
              {engine.status === 'ready' ? 'KataGo ready' : 'Load KataGo now'}
            </button>
            <span className="small muted">Downloads once, then cached.</span>
          </div>
          {engine.status === 'error' && <p className="small bad" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{engine.error}</p>}
        </div>
        <div className="panel stack">
          <h3>How it works</h3>
          <ol className="dim small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 5 }}>
            <li>Import your SGF games.</li>
            <li>KataGo analyses every position quickly, then studies the important ones deeply.</li>
            <li>Your Player DNA and recurring weaknesses are built from repeated evidence.</li>
            <li>Forge trains each weakness with positions from your own games, plus look-alikes that need the opposite decision.</li>
            <li>Blind tests check whether you really learned it. The model updates as you play and train.</li>
          </ol>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 12 }}>
        <h3 style={{ marginBottom: 10 }}>Start</h3>
        <DropZone onFiles={(f) => void importFiles(f)} />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => void loadDemo().catch((e) => alert(e.message))}>
            Load demo data
          </button>
          <span className="small muted">A demo player with real KataGo analyses, so every page works before you import anything.</span>
        </div>
      </div>
    </div>
  );
}

const PHASES: Phase[] = ['opening', 'middlegame', 'endgame'];

function WeaknessMap() {
  const version = useStore((s) => s.corpusVersion);
  const weaknesses = useStore((s) => s.weaknesses);
  const cells = useMemo(() => {
    const recs = corpus().playerRecords();
    return AXES.map((a) =>
      PHASES.map((ph) => {
        const rs = recs.filter((r) => r.features.phase === ph && a.select(r.features));
        const mistakes = rs.filter((r) => r.scoreLoss >= 2.5).length;
        return { n: rs.length, rate: rs.length ? mistakes / rs.length : 0 };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  const flagged = new Set(weaknesses.map((w) => w.category));
  return (
    <div>
      <table className="data" style={{ tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ width: '38%' }}>Area</th>
            {PHASES.map((p) => (
              <th key={p}>{p}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {AXES.map((a, i) => (
            <tr key={a.axis}>
              <td>
                {a.label} {flagged.has(a.axis) && <span className="chip bad" style={{ marginLeft: 4 }}>weakness</span>}
              </td>
              {cells[i].map((c, j) => (
                <td key={j} title={`${c.n} moves, ${fmtPct(c.rate)} costly`}>
                  {c.n >= 5 ? (
                    <div
                      style={{
                        height: 18,
                        borderRadius: 3,
                        background: `rgba(212,105,92,${Math.min(0.9, 0.08 + c.rate * 2.2)})`,
                        fontSize: 10.5,
                        paddingLeft: 5,
                        lineHeight: '18px',
                      }}
                    >
                      {fmtPct(c.rate)}
                    </div>
                  ) : (
                    <span className="tiny muted">–</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tiny muted" style={{ marginTop: 6 }}>Share of your moves in each area that cost 2.5 points or more.</p>
    </div>
  );
}

function WeaknessCard({ w, label }: { w: Weakness; label: string }) {
  const m = useStore((s) => s.mastery[w.id]);
  return (
    <div className="panel stack">
      <div className="spread">
        <h3>{label}</h3>
        <span className={`chip ${w.status === 'improving' ? 'good' : 'bad'}`}>{w.status}</span>
      </div>
      <h2>{w.llm?.title ?? w.title}</h2>
      <p className="dim small">{w.llm?.description ?? w.description}</p>
      <div className="row wrap small">
        <span className="chip">{w.occurrences} times in {w.games} games</span>
        <span className="chip">confidence {fmtPct(w.confidence)}</span>
        <span className="chip">−{w.avgScoreLoss.toFixed(1)} pts avg</span>
        {m && <span className="chip you">mastery {fmtPct(m.mastery)}</span>}
      </div>
      <div className="row">
        <button className="btn primary" onClick={() => go(`forge/${w.id}`)}>
          Train in Forge
        </button>
        <button className="btn ghost" onClick={() => go(`blind/${w.id}`)}>
          Do I really know this?
        </button>
      </div>
    </div>
  );
}

function TrainingHistory() {
  const attempts = useStore((s) => s.attempts);
  const days = useMemo(() => {
    const byDay = new Map<string, { n: number; ok: number }>();
    for (const a of attempts) {
      const d = new Date(a.at).toISOString().slice(0, 10);
      const x = byDay.get(d) ?? { n: 0, ok: 0 };
      x.n++;
      if (a.conceptCorrect) x.ok++;
      byDay.set(d, x);
    }
    return [...byDay.entries()].sort().slice(-14);
  }, [attempts]);
  if (!attempts.length) return <p className="small muted">No training yet. Forge sessions and blind tests will show up here.</p>;
  const max = Math.max(...days.map(([, d]) => d.n));
  return (
    <div className="stack">
      <div className="row" style={{ alignItems: 'flex-end', height: 70, gap: 4 }}>
        {days.map(([d, x]) => (
          <div key={d} title={`${d}: ${x.n} positions, ${fmtPct(x.ok / x.n)} right decision`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
            <div style={{ height: `${(x.n / max) * 100}%`, background: 'var(--line-2)', borderRadius: 2, position: 'relative', minHeight: 3 }}>
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${(x.ok / x.n) * 100}%`, background: 'var(--you)', borderRadius: 2 }} />
            </div>
          </div>
        ))}
      </div>
      <p className="tiny muted">
        {attempts.length} positions trained · {fmtPct(attempts.filter((a) => a.conceptCorrect).length / attempts.length)} right decision overall · bars show the last {days.length} training days
      </p>
    </div>
  );
}

export function Dashboard() {
  const games = useStore((s) => s.games);
  const profile = useStore((s) => s.profile);
  const weaknesses = useStore((s) => s.weaknesses);
  const doppel = useStore((s) => s.doppel);
  const queue = useStore((s) => s.queue);
  const busy = useStore((s) => s.busy);
  const settings = useStore((s) => s.settings);
  const analyses = useStore((s) => s.analyses);
  if (!games.length) return <FirstRun />;

  const mine = games.filter((g) => g.source === 'user' || g.source === 'demo');
  const analysed = mine.filter((g) => g.status === 'done').length;
  const positions = Object.values(analyses).reduce((a, x) => a + x.evals.filter(Boolean).length, 0);
  const pending = games.filter((g) => g.status !== 'done' && g.status !== 'error' && g.status !== 'skipped').length;
  const active = weaknesses.filter((w) => w.status !== 'resolved');
  const biggest = active.find((w) => w.status === 'active') ?? active[0];
  const improving = weaknesses.find((w) => w.status === 'improving');
  const name = settings.playerNames[0];
  const habits = doppel ? describeWeights(doppel).slice(0, 3) : [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{name ? `${name}` : 'Your lab'}</h1>
          <p className="sub">
            {profile ? `Model v${profile.version} · updated ${new Date(profile.updatedAt).toLocaleString()}` : 'Waiting for analysed games'}
            {busy.profile && ' · rebuilding…'}
          </p>
        </div>
        <div className="row">
          {!name && (
            <a className="btn" href={href('settings')}>
              Tell me which player is you
            </a>
          )}
          {pending > 0 && !queue.running && (
            <button className="btn" onClick={() => void runQueue()}>
              Analyse {pending} waiting game{pending > 1 ? 's' : ''}
            </button>
          )}
          <a className="btn primary" href={href('forge')}>
            Open Forge
          </a>
        </div>
      </div>

      <div className="panel grid cols-4" style={{ marginBottom: 12 }}>
        <Stat value={`${analysed}/${mine.length}`} label="Analysed games" />
        <Stat value={positions.toLocaleString()} label="Analysed positions" />
        <Stat value={profile ? fmtPct(profile.overallAccuracy) : '–'} label="Accurate moves" hint={profile ? `loss < 1 point · avg ${profile.avgScoreLoss.toFixed(2)} pts/move` : undefined} />
        <Stat value={active.length} label="Recurring weaknesses" hint={active.length ? `${active.filter((w) => w.status === 'improving').length} improving` : 'needs repeated evidence'} />
      </div>

      <div className="grid cols-2">
        {biggest ? (
          <WeaknessCard w={biggest} label="Biggest recurring weakness" />
        ) : (
          <div className="panel">
            <h3>Recurring weaknesses</h3>
            <p className="dim small" style={{ marginTop: 8 }}>
              None confirmed yet. A weakness needs the same kind of error at least 3 times in 2 or more games. {pending ? 'Analysis is still running.' : 'Import more games to sharpen the picture.'}
            </p>
          </div>
        )}
        {improving ? (
          <WeaknessCard w={improving} label="Improving" />
        ) : (
          <div className="panel stack">
            <h3>Your Doppelgänger</h3>
            {doppel ? (
              <>
                <p className="dim small">
                  A behavioural model of your move choice, learned from {doppel.trainedOn} of your moves. On games it has not seen it predicts your exact move{' '}
                  <strong className="doppel">{fmtPct(doppel.metrics.top1)}</strong> of the time (KataGo's policy alone: {fmtPct(doppel.metrics.baselineTop1)}).
                </p>
                {habits.length > 0 && (
                  <div className="row wrap">
                    {habits.map((h) => (
                      <span key={h.label} className="chip doppel">
                        {h.weight > 0 ? 'prefers' : 'avoids'} {h.label}
                      </span>
                    ))}
                  </div>
                )}
                <a className="btn small" href={href('dna')} style={{ justifySelf: 'start' }}>
                  See Player DNA
                </a>
              </>
            ) : (
              <p className="dim small">Trained once enough of your moves are analysed.</p>
            )}
          </div>
        )}
      </div>

      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <div className="panel">
          <div className="spread" style={{ marginBottom: 10 }}>
            <h3>Player DNA</h3>
            <a className="small muted" href={href('dna')}>
              details →
            </a>
          </div>
          {profile ? (
            <div className="stack">
              {profile.axes
                .filter((a) => a.n >= 8)
                .map((a) => (
                  <div key={a.axis} className="grid" style={{ gridTemplateColumns: '150px 1fr 44px', alignItems: 'center', gap: 10 }}>
                    <span className="small dim">{AXIS_LABEL[a.axis]}</span>
                    <Bar value={a.accuracy} />
                    <span className="small mono">{fmtPct(a.accuracy)}</span>
                  </div>
                ))}
            </div>
          ) : (
            <p className="small muted">Appears after the first analysed game.</p>
          )}
        </div>
        <div className="panel">
          <h3 style={{ marginBottom: 10 }}>Weakness map</h3>
          {profile ? <WeaknessMap /> : <p className="small muted">Appears after the first analysed game.</p>}
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <div className="panel">
          <h3 style={{ marginBottom: 10 }}>Training history</h3>
          <TrainingHistory />
        </div>
        <div className="panel">
          <div className="spread" style={{ marginBottom: 10 }}>
            <h3>All weaknesses</h3>
            <span className="small muted">{active.length}</span>
          </div>
          {active.length ? (
            active.slice(0, 6).map((w) => (
              <div key={w.id} className="weak-row">
                <div>
                  <a href={href(`forge/${w.id}`)} style={{ textDecoration: 'none' }}>
                    {w.llm?.title ?? w.title}
                  </a>
                  <div className="tiny muted">
                    {AXIS_LABEL[w.category] ?? w.category} · {w.occurrences}× · {fmtPct(w.errorRate)} of {w.opportunities} chances · conf. {fmtPct(w.confidence)}
                  </div>
                </div>
                <span className={`chip ${w.status === 'improving' ? 'good' : ''}`}>{w.status}</span>
              </div>
            ))
          ) : (
            <p className="small muted">Nothing repeated often enough yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
