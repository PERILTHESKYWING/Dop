import { useMemo, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { corpus, importFiles, loadDemo, runQueue, startEngine, usesDemoData } from '../state/actions';
import { Bar, DropZone, fmtPct } from '../components/common';
import { Icon, type IconName } from '../components/Icons';
import { DemoNotice, EngineNotice, SideChooser } from '../components/Notices';
import { go, href } from '../router';
import { AXES, AXIS_LABEL } from '../lib/profile/fingerprint';
import { describeWeights } from '../lib/profile/doppel';
import type { Phase, Weakness } from '../lib/types';
import { modelOrderFor } from '../lib/engine/models';

function Check({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  return (
    <div className="spread" style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
      <div className="small" style={{ fontWeight: 600 }}>
        <span className={`dot ${ok === null ? 'busy' : ok ? 'ok' : 'err'}`} />
        {label}
      </div>
      <span className="small muted" style={{ textAlign: 'right' }}>
        {detail}
      </span>
    </div>
  );
}

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'upload', title: 'Import', text: 'Drop your SGF games. Many at once is fine.' },
  { icon: 'board', title: 'Analyse', text: 'KataGo reads every position, then studies the key moments.' },
  { icon: 'dna', title: 'Profile', text: 'Your Player DNA and recurring weaknesses, from repeated evidence.' },
  { icon: 'flame', title: 'Forge', text: 'Train each weakness on positions from your own games.' },
  { icon: 'eyeOff', title: 'Test', text: 'Blind tests check that the lesson really stuck.' },
];

function FirstRun() {
  const caps = useStore((s) => s.caps);
  const engine = useStore((s) => s.engine);
  const llm = useStore((s) => s.llm);
  const settings = useStore((s) => s.settings);
  const order = caps ? modelOrderFor(settings.modelId, caps.webgpu && !settings.forceCpu) : [];
  const prog = engine.progress;
  return (
    <div className="page" style={{ maxWidth: 1080 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Welcome</div>
          <h1>Your personal Go training lab</h1>
          <p className="sub">KataGo studies your own games, finds the mistakes you repeat, and trains them away. Everything stays in this browser.</p>
        </div>
      </div>
      <EngineNotice />
      <div className="grid cols-hero">
        <div className="panel accent stack">
          <h2>Start with your games</h2>
          <DropZone onFiles={(f) => void importFiles(f)} />
          <div className="row wrap">
            <button className="btn" onClick={() => void loadDemo().catch((e) => alert(e.message))}>
              <Icon name="stones" /> Explore the demo first
            </button>
            <span className="small muted">A demo player with real KataGo analyses, so every page works right away.</span>
          </div>
        </div>
        <div className="panel stack">
          <h3>This device</h3>
          <div>
            <Check ok={caps ? caps.webgpu : null} label="Graphics card (WebGPU)" detail={caps ? (caps.webgpu ? caps.webgpuAdapter ?? 'available' : 'not available: the CPU is used') : 'checking…'} />
            <Check ok={caps ? caps.wasm : null} label="CPU engine" detail={caps ? (caps.wasm ? 'available' : 'missing') : 'checking…'} />
            <Check
              ok={engine.status === 'ready' ? true : engine.status === 'error' || engine.status === 'unsupported' ? false : engine.status === 'off' ? null : null}
              label="KataGo"
              detail={
                engine.status === 'ready'
                  ? `${engine.info?.modelName} · ${engine.info?.backend === 'webgpu' ? 'WebGPU' : 'CPU'}`
                  : engine.status === 'loading'
                    ? prog?.stage === 'download'
                      ? `downloading ${Math.round(prog.loaded / 1e6)}${prog.total ? ` / ${Math.round(prog.total / 1e6)}` : ''} MB`
                      : prog?.stage === 'check'
                        ? 'testing…'
                        : 'loading…'
                    : engine.status === 'error'
                      ? 'could not start'
                      : `ready to load${order[0] ? `: ${order[0].name}` : ''}`
              }
            />
            <Check ok={llm ? llm.available : null} label="Pattern discovery (LLM)" detail={llm ? (llm.available ? llm.model ?? 'connected' : llm.configured ? 'not answering' : 'optional, off') : 'checking…'} />
          </div>
          <button className="btn" onClick={() => void startEngine()} disabled={engine.status === 'loading' || engine.status === 'ready'} style={{ justifySelf: 'start' }}>
            <Icon name="cpu" /> {engine.status === 'ready' ? 'KataGo is ready' : engine.status === 'loading' ? 'Loading KataGo…' : 'Load KataGo now'}
          </button>
          {engine.status === 'loading' && (
            <div className={`progress ${prog?.stage === 'download' && prog.total ? '' : 'indeterminate'}`}>
              <span style={{ width: prog?.stage === 'download' && prog.total ? `${(prog.loaded / prog.total) * 100}%` : undefined }} />
            </div>
          )}
        </div>
      </div>
      <div className="steps" style={{ marginTop: 16 }}>
        {STEPS.map((st, i) => (
          <div key={st.title} className="panel step">
            <div className="step-ico">
              <Icon name={st.icon} />
            </div>
            <div className="tiny muted">Step {i + 1}</div>
            <strong>{st.title}</strong>
            <p className="small dim">{st.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Live analysis progress, so it is always clear that work is happening. */
function QueueCard() {
  const games = useStore((s) => s.games);
  const queue = useStore((s) => s.queue);
  const engine = useStore((s) => s.engine);
  const pending = games.filter((g) => g.status !== 'done' && g.status !== 'error' && g.status !== 'skipped');
  const failed = games.filter((g) => g.status === 'error');
  const cur = games.find((g) => g.id === queue.currentGameId);
  if (!pending.length && !failed.length) return null;
  const p = cur ? (cur.status === 'deep' ? cur.progress.deep / Math.max(1, cur.progress.deepTotal) : cur.progress.fast / Math.max(1, cur.progress.total)) : 0;
  return (
    <div className="panel stack" style={{ marginBottom: 14 }}>
      <div className="spread">
        <h3 className="with-icon">
          <span className="live-dot" data-on={queue.running ? '1' : '0'} /> Game analysis
        </h3>
        {!queue.running && pending.length > 0 && (
          <button className="btn small primary" onClick={() => void runQueue()}>
            Analyse {pending.length} game{pending.length > 1 ? 's' : ''}
          </button>
        )}
      </div>
      {queue.running && cur ? (
        <>
          <div className="spread small">
            <span>
              <strong>{cur.black} vs {cur.white}</strong>{' '}
              <span className="muted">{cur.status === 'deep' ? `studying key moments ${cur.progress.deep}/${cur.progress.deepTotal}` : `reading positions ${cur.progress.fast}/${cur.progress.total}`}</span>
            </span>
            <span className="muted">{pending.length - 1 > 0 ? `${pending.length - 1} more waiting` : 'last one'}</span>
          </div>
          <div className="progress">
            <span style={{ width: `${Math.round(p * 100)}%` }} />
          </div>
        </>
      ) : queue.running ? (
        <div className="small dim">
          {engine.status === 'loading' ? (engine.progress?.stage === 'download' ? 'Downloading the KataGo network…' : 'Starting KataGo…') : 'Preparing…'}
        </div>
      ) : (
        <div className="small dim">{pending.length ? `${pending.length} game${pending.length > 1 ? 's' : ''} waiting.` : ''}</div>
      )}
      {failed.length > 0 && (
        <div className="small bad">
          {failed.length} game{failed.length > 1 ? 's' : ''} failed: {failed[0].error}{' '}
          <a href={href('library')}>open the Game Library to retry</a>
        </div>
      )}
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
  const items = useStore((s) => s.items[w.id]?.length ?? 0);
  return (
    <div className="panel accent stack">
      <div className="spread">
        <h3>{label}</h3>
        <span className={`chip ${w.status === 'improving' ? 'good' : 'bad'}`}>{w.status}</span>
      </div>
      <h2>{w.llm?.title ?? w.title}</h2>
      <p className="dim small">{w.llm?.description ?? w.description}</p>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
        <div className="mini-stat">
          <strong>{w.occurrences}×</strong>
          <span>in {w.games} games</span>
        </div>
        <div className="mini-stat">
          <strong>−{w.avgScoreLoss.toFixed(1)}</strong>
          <span>points each time</span>
        </div>
        <div className="mini-stat">
          <strong>{m ? fmtPct(m.mastery) : '0%'}</strong>
          <span>mastery</span>
        </div>
      </div>
      <div className="row wrap">
        <button className="btn primary" onClick={() => go(`forge/${w.id}`)} disabled={!items} title={items ? undefined : 'No practice positions within the winrate limit yet'}>
          <Icon name="flame" /> Train in Forge
        </button>
        <button className="btn ghost" onClick={() => go(`blind/${w.id}`)} disabled={!items}>
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
      <div className="history">
        {days.map(([d, x]) => (
          <div key={d} className="history-day" title={`${d}: ${x.n} positions, ${fmtPct(x.ok / x.n)} right decision`}>
            <div className="history-bar" style={{ height: `${(x.n / max) * 100}%` }}>
              <span style={{ height: `${(x.ok / x.n) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="tiny muted">
        {attempts.length} positions trained · {fmtPct(attempts.filter((a) => a.conceptCorrect).length / attempts.length)} right decisions · last {days.length} training days
      </p>
    </div>
  );
}

function Tile({ icon, tone, value, label, hint }: { icon: IconName; tone?: string; value: ReactNode; label: string; hint?: string }) {
  return (
    <div className="panel stat-tile">
      <div className={`ico ${tone ?? ''}`}>
        <Icon name={icon} />
      </div>
      <div className="stat">
        <div className="v">{value}</div>
        <div className="l">{label}</div>
        {hint && <div className="tiny muted">{hint}</div>}
      </div>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function Dashboard() {
  const games = useStore((s) => s.games);
  const profile = useStore((s) => s.profile);
  const weaknesses = useStore((s) => s.weaknesses);
  const doppel = useStore((s) => s.doppel);
  const busy = useStore((s) => s.busy);
  const analyses = useStore((s) => s.analyses);
  useStore((s) => s.corpusVersion);
  if (!games.length) return <FirstRun />;

  const demo = usesDemoData();
  const mine = games.filter((g) => (demo ? g.source === 'user' || g.source === 'demo' : g.source === 'user'));
  const analysed = mine.filter((g) => g.status === 'done').length;
  const positions = mine.reduce((a, g) => a + (analyses[g.id]?.evals.filter(Boolean).length ?? 0), 0);
  const active = weaknesses.filter((w) => w.status !== 'resolved');
  const biggest = active.find((w) => w.status === 'active') ?? active[0];
  const improving = weaknesses.find((w) => w.status === 'improving');
  const habits = doppel ? describeWeights(doppel).slice(0, 3) : [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{greeting()}</div>
          <h1>{profile?.name && profile.name !== 'You' ? profile.name : 'Your lab'}</h1>
          <p className="sub">
            {profile ? `Player model v${profile.version} · updated ${new Date(profile.updatedAt).toLocaleString()}` : 'Your profile appears once your games are analysed.'}
            {busy.profile && ' · updating…'}
          </p>
        </div>
        <div className="row wrap">
          <a className={biggest ? 'btn' : 'btn primary big'} href={href('library')}>
            <Icon name="upload" /> Import games
          </a>
          {biggest && (
            <a className="btn primary big glow" href={href('forge')}>
              <Icon name="flame" /> Continue training
            </a>
          )}
        </div>
      </div>

      <EngineNotice />
      <SideChooser />
      <DemoNotice />
      <QueueCard />

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Tile icon="library" value={`${analysed}/${mine.length}`} label="Games analysed" />
        <Tile icon="board" tone="sky" value={positions.toLocaleString()} label="Positions read" />
        <Tile icon="target" tone="meadow" value={profile ? fmtPct(profile.overallAccuracy) : '–'} label="Accurate moves" hint={profile ? `avg loss ${profile.avgScoreLoss.toFixed(2)} pts/move` : undefined} />
        <Tile icon="flame" tone="dusk" value={active.length} label="Recurring weaknesses" hint={active.length ? `${active.filter((w) => w.status === 'improving').length} improving` : 'needs repeated evidence'} />
      </div>

      <div className="grid cols-2">
        {biggest ? (
          <WeaknessCard w={biggest} label="Your biggest recurring weakness" />
        ) : (
          <div className="panel stack">
            <h3>Recurring weaknesses</h3>
            <h2>Nothing confirmed yet</h2>
            <p className="dim small">A weakness needs the same kind of error at least 3 times in 2 or more games. Analyse more of your games to sharpen the picture.</p>
          </div>
        )}
        {improving ? (
          <WeaknessCard w={improving} label="Improving" />
        ) : (
          <div className="panel stack">
            <h3>Your Doppelgänger</h3>
            {doppel ? (
              <>
                <h2>
                  Predicts your move <span className="doppel">{fmtPct(doppel.metrics.top1)}</span> of the time
                </h2>
                <p className="dim small">
                  A model of how you choose moves, learned from {doppel.trainedOn} of your moves. KataGo's policy alone guesses {fmtPct(doppel.metrics.baselineTop1)}.
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
                  <Icon name="dna" /> See Player DNA
                </a>
              </>
            ) : (
              <p className="dim small">Trained once enough of your moves are analysed.</p>
            )}
          </div>
        )}
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <div className="panel">
          <div className="spread" style={{ marginBottom: 12 }}>
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
          <h3 style={{ marginBottom: 12 }}>Where the points go</h3>
          {profile ? <WeaknessMap /> : <p className="small muted">Appears after the first analysed game.</p>}
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <div className="panel">
          <h3 style={{ marginBottom: 12 }}>Training history</h3>
          <TrainingHistory />
        </div>
        <div className="panel">
          <div className="spread" style={{ marginBottom: 6 }}>
            <h3>All weaknesses</h3>
            <span className="chip">{active.length}</span>
          </div>
          {active.length ? (
            active.slice(0, 6).map((w) => (
              <div key={w.id} className="weak-row">
                <div>
                  <a href={href(`forge/${w.id}`)}>{w.llm?.title ?? w.title}</a>
                  <div className="tiny muted">
                    {AXIS_LABEL[w.category] ?? w.category} · {w.occurrences}× · {fmtPct(w.errorRate)} of {w.opportunities} chances
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
