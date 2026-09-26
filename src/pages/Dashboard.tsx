import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { corpus, importFiles, loadDemo, runQueue, startEngine, usesDemoData } from '../state/actions';
import { Bar, DropZone, MoveThumb, fmtPct } from '../components/common';
import { Icon, type IconName } from '../components/Icons';
import { DemoNotice, EngineNotice, SideChooser } from '../components/Notices';
import { useCopy } from '../components/Doppel';
import { go, href } from '../router';
import { AXES, AXIS_LABEL } from '../lib/profile/fingerprint';
import { describeWeights } from '../lib/profile/doppel';
import { practiceItems } from '../lib/forge/worth';
import type { Phase, Weakness } from '../lib/types';
import { modelOrderFor } from '../lib/engine/models';
import './dashboard.css';

const DAY = 24 * 3600 * 1000;
const PHASES: Phase[] = ['opening', 'middlegame', 'endgame'];
const PHASE_SHORT: Record<Phase, string> = { opening: 'Opening', middlegame: 'Middle', endgame: 'Endgame' };
const PHASE_TINY: Record<Phase, string> = { opening: 'Open', middlegame: 'Mid', endgame: 'End' };

function Arrow() {
  return (
    <svg className="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/** A quiet text link with an arrow, for "see more" navigation. */
function More({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a className="dash-more" href={href(to)}>
      {children} <Arrow />
    </a>
  );
}

function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : new Date(t).toLocaleDateString();
}

// ------------------------------------------------------------------ first run

/** A device check: ok, a problem, a fallback in use (warn), optional and off, or still checking. */
function Check({ state, label, detail }: { state: 'ok' | 'err' | 'warn' | 'off' | 'busy'; label: string; detail: string }) {
  return (
    <div className="fr-check">
      <span className={`dot ${state === 'off' ? '' : state}`} />
      <strong>{label}</strong>
      <span>{detail}</span>
    </div>
  );
}

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'upload', title: 'Import', text: 'Drop your SGF games. Many at once is fine.' },
  { icon: 'board', title: 'Analyse', text: 'KataGo takes a first look at every position, then searches each one.' },
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
  const ready = engine.status === 'ready';
  return (
    <div className="page dash first-run">
      <header className="dash-hero">
        <div className="dash-hero-main">
          <div className="eyebrow">Welcome</div>
          <h1>Let’s set up your lab</h1>
          <p className="sub">KataGo studies your own games, finds the mistakes you repeat, and trains them away. Everything stays in this browser.</p>
          <More to="welcome">What is DOPPELGÄNGER?</More>
        </div>
        <ol className="fr-track" aria-label="Getting started">
          <li className="on">
            <span>1</span> Import your games
          </li>
          <li className={ready ? 'done' : ''}>
            <span>2</span> KataGo analyses them
          </li>
          <li>
            <span>3</span> Train what it finds
          </li>
        </ol>
      </header>

      <EngineNotice />

      <div className="fr-grid">
        <section className="panel accent fr-start">
          <div className="fr-tag">Start here</div>
          <h2>Bring your games</h2>
          <p className="small dim">SGF files from any server or program, in any common encoding. The lab works out which player is you.</p>
          <DropZone onFiles={(f) => void importFiles(f)} />
          <div className="fr-or">
            <span>or</span>
          </div>
          <div className="fr-demo">
            <span className="fr-demo-ico">
              <Icon name="stones" />
            </span>
            <div className="fr-demo-text">
              <strong>Not ready yet?</strong>
              <span>A demo player with real KataGo analyses, so every page works right away.</span>
            </div>
            <button className="btn" onClick={() => void loadDemo().catch((e) => alert(e.message))}>
              <Icon name="stones" /> Explore the demo first
            </button>
          </div>
        </section>

        <section className="panel fr-device">
          <div className="dash-card-head">
            <h3>This device</h3>
            <span className={`chip ${ready ? 'good' : ''}`}>{ready ? 'KataGo ready' : caps ? (caps.webgpu && !settings.forceCpu ? 'will use WebGPU' : 'will use the CPU') : 'checking…'}</span>
          </div>
          <div className="fr-checks">
            <Check state={caps ? (caps.webgpu ? 'ok' : 'warn') : 'busy'} label="Graphics card (WebGPU)" detail={caps ? (caps.webgpu ? caps.webgpuAdapter ?? 'available' : 'not available: the CPU is used') : 'checking…'} />
            <Check state={caps ? (caps.wasm ? 'ok' : 'err') : 'busy'} label="CPU engine" detail={caps ? (caps.wasm ? 'available' : 'missing') : 'checking…'} />
            <Check
              state={engine.status === 'ready' ? 'ok' : engine.status === 'error' || engine.status === 'unsupported' ? 'err' : engine.status === 'off' ? 'off' : 'busy'}
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
            <Check state={llm ? (llm.available ? 'ok' : llm.configured ? 'err' : 'off') : 'busy'} label="Pattern discovery (LLM)" detail={llm ? (llm.available ? llm.model ?? 'connected' : llm.configured ? 'not answering' : 'optional, off') : 'checking…'} />
          </div>
          {engine.status === 'loading' && (
            <div className={`progress ${prog?.stage === 'download' && prog.total ? '' : 'indeterminate'}`}>
              <span style={{ width: prog?.stage === 'download' && prog.total ? `${(prog.loaded / prog.total) * 100}%` : undefined }} />
            </div>
          )}
          <div className="fr-device-foot">
            <button className="btn" onClick={() => void startEngine()} disabled={engine.status === 'loading' || ready}>
              <Icon name={ready ? 'check' : 'cpu'} /> {ready ? 'KataGo is ready' : engine.status === 'loading' ? 'Loading KataGo…' : 'Load KataGo now'}
            </button>
            <span className="tiny muted">It also starts by itself when the first game needs it.</span>
          </div>
          <div className="fr-private">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="5" y="10.5" width="14" height="10" rx="2.4" />
              <path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7" />
            </svg>
            <span>
              <strong>Everything runs on this device.</strong> KataGo analyses in this browser, and your games, profile and training are stored here. No account, nothing uploaded.
            </span>
          </div>
        </section>
      </div>

      <section className="panel fr-steps">
        <h3>How it works</h3>
        <ol>
          {STEPS.map((st, i) => (
            <li key={st.title}>
              <span className="fr-step-ico">
                <Icon name={st.icon} />
              </span>
              <span className="fr-step-n">Step {i + 1}</span>
              <strong>{st.title}</strong>
              <p>{st.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ next step

interface Step {
  icon: IconName;
  title: string;
  text: string;
  action: string;
  actionIcon: IconName;
  to?: string;
  run?: () => void;
  note?: string;
}

/** The single most useful thing to do now, from what is in the lab. */
function useNextStep(practice: Record<string, number>): Step {
  const games = useStore((s) => s.games);
  const analyses = useStore((s) => s.analyses);
  const queue = useStore((s) => s.queue);
  const weaknesses = useStore((s) => s.weaknesses);
  const mastery = useStore((s) => s.mastery);
  const attempts = useStore((s) => s.attempts);
  const blindTests = useStore((s) => s.blindTests);
  const demo = usesDemoData();
  const own = games.filter((g) => g.source === 'user');
  const pending = games.filter((g) => g.status !== 'done' && g.status !== 'error' && g.status !== 'skipped');

  if (pending.length && !queue.running)
    return {
      icon: 'board',
      title: `Analyse ${pending.length} new game${pending.length > 1 ? 's' : ''}`,
      text: 'KataGo takes a first look at every position, then searches each one. The lab stays usable meanwhile.',
      action: 'Start the analysis',
      actionIcon: 'play',
      run: () => void runQueue(),
    };

  // A game analysed in the last few days, with no training since: look at it while it is fresh.
  const lastTrained = attempts.length ? attempts[attempts.length - 1].at : 0;
  const recent = own
    .filter((g) => g.status === 'done' && g.playerColor && analyses[g.id])
    .sort((a, b) => analyses[b.id].updatedAt - analyses[a.id].updatedAt)[0];
  const recentAt = recent ? analyses[recent.id].updatedAt : 0;
  if (recent && Date.now() - recentAt < 3 * DAY && recentAt > lastTrained)
    return {
      icon: 'board',
      title: 'Review your latest game',
      text: `${recent.black} vs ${recent.white}${recent.result ? ` (${recent.result})` : ''}: see where it turned, with KataGo’s candidate moves.`,
      action: 'Review the game',
      actionIcon: 'board',
      to: `review/${recent.id}`,
    };

  const active = weaknesses.filter((w) => w.status !== 'resolved' && practice[w.id] > 0);
  const who = demo ? 'Mira’s' : 'your';
  for (const w of active.slice(0, 3)) {
    const m = mastery[w.id];
    const lastTest = blindTests.filter((t) => t.weaknessId === w.id && t.finishedAt).sort((a, b) => b.finishedAt! - a.finishedAt!)[0];
    const tested = lastTest && (!m || lastTest.finishedAt! >= m.lastPracticed);
    if (m && m.mastery >= 0.6 && !tested)
      return {
        icon: 'eyeOff',
        title: `Test yourself: ${w.llm?.title ?? w.title}`,
        text: `Mastery is at ${fmtPct(m.mastery)}. A blind test on fresh positions shows whether the habit has really changed.`,
        action: 'Take a blind test',
        actionIcon: 'eyeOff',
        to: `blind/${w.id}`,
      };
    if (!m || m.mastery < 0.6)
      return {
        icon: 'flame',
        title: `Train ${who} top weakness`,
        text: `${w.llm?.title ?? w.title}: ${w.occurrences}× in ${w.games} games, −${w.avgScoreLoss.toFixed(1)} points each time.${m ? ` Mastery ${fmtPct(m.mastery)}.` : ''}`,
        action: 'Train in Forge',
        actionIcon: 'flame',
        to: `forge/${w.id}`,
      };
  }

  if (queue.running)
    return {
      icon: 'board',
      title: 'KataGo is reading your games',
      text: 'Your profile, weaknesses and copy update as each game is finished.',
      action: 'Watch the progress',
      actionIcon: 'library',
      to: 'library',
    };
  if (!weaknesses.some((w) => w.status !== 'resolved'))
    return {
      icon: 'upload',
      title: 'Add more of your games',
      text: 'A weakness needs the same kind of error at least 3 times in 2 or more games. More games sharpen the picture.',
      action: 'Import games',
      actionIcon: 'upload',
      to: 'library',
    };
  return {
    icon: 'twin',
    title: 'Play your Doppelgänger',
    text: 'A game against a copy of how you choose moves: see your habits from the other side of the board.',
    action: 'Play the copy',
    actionIcon: 'play',
    to: 'doppel/play',
  };
}

function NextStep({ step }: { step: Step }) {
  return (
    <div className="next-step">
      <div className="next-label">
        <Icon name="spark" /> Next step
      </div>
      <div className="next-body">
        <span className="next-ico">
          <Icon name={step.icon} />
        </span>
        <div>
          <strong>{step.title}</strong>
          <p>{step.text}</p>
        </div>
      </div>
      <button className="btn primary next-go" onClick={() => (step.run ? step.run() : step.to && go(step.to))}>
        <Icon name={step.actionIcon} /> {step.action}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ cards

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
    <div className="panel dash-queue">
      <div className="spread">
        <h3 className="with-icon">
          <span className="live-dot" data-on={queue.running ? '1' : '0'} /> Game analysis
        </h3>
        {!queue.running && pending.length > 0 && (
          <button className="btn small" onClick={() => void runQueue()}>
            <Icon name="play" /> Analyse {pending.length} game{pending.length > 1 ? 's' : ''}
          </button>
        )}
      </div>
      {queue.running && cur ? (
        <>
          <div className="spread small">
            <span>
              <strong>
                {cur.black} vs {cur.white}
              </strong>{' '}
              <span className="muted">{cur.status === 'deep' ? `searching positions ${cur.progress.deep}/${cur.progress.deepTotal}` : `first look ${cur.progress.fast}/${cur.progress.total}`}</span>
            </span>
            <span className="muted">{pending.length - 1 > 0 ? `${pending.length - 1} more waiting` : 'last one'}</span>
          </div>
          <div className="progress">
            <span style={{ width: `${Math.round(p * 100)}%` }} />
          </div>
        </>
      ) : queue.running ? (
        <div className="small dim">{engine.status === 'loading' ? (engine.progress?.stage === 'download' ? 'Downloading the KataGo network…' : 'Starting KataGo…') : 'Preparing…'}</div>
      ) : (
        <div className="small dim">{pending.length ? `${pending.length} game${pending.length > 1 ? 's' : ''} waiting.` : ''}</div>
      )}
      {failed.length > 0 && (
        <div className="small bad">
          {failed.length} game{failed.length > 1 ? 's' : ''} failed: {failed[0].error} <a href={href('library')}>open the Game Library to retry</a>
        </div>
      )}
    </div>
  );
}

function StatTile({ icon, tone, value, label, hint }: { icon: IconName; tone?: string; value: ReactNode; label: string; hint?: string }) {
  return (
    <div className="panel dash-stat">
      <span className={`dash-stat-ico ${tone ?? ''}`}>
        <Icon name={icon} />
      </span>
      <div className="dash-stat-text">
        <div className="dash-stat-v">{value}</div>
        <div className="dash-stat-l">{label}</div>
        {hint && <div className="dash-stat-h">{hint}</div>}
      </div>
    </div>
  );
}

/** A typical example of the weakness (its loss closest to the average), as a board thumbnail. */
function WeaknessExample({ w }: { w: Weakness }) {
  const games = useStore((s) => s.games);
  useStore((s) => s.corpusVersion);
  const ex = [...w.evidence].sort((a, b) => Math.abs(a.scoreLoss - w.avgScoreLoss) - Math.abs(b.scoreLoss - w.avgScoreLoss))[0];
  const game = ex && games.find((g) => g.id === ex.gameId);
  const rec = ex && corpus().byId.get(ex.moveId);
  if (!ex || !game || !rec) return null;
  return (
    <a className="wk-example" href={href(`review/${game.id}?move=${ex.index}`)} title="Open this position in Game Review">
      <MoveThumb game={game} record={rec} />
      <span className="wk-example-cap">
        <span>
          <i className="dot-you" /> played
        </span>
        <span>
          <i className="dot-kata" /> KataGo
        </span>
        <span className="wk-example-move">
          move {ex.index + 1} · −{ex.scoreLoss.toFixed(1)}
        </span>
      </span>
    </a>
  );
}

function WeaknessCard({ w, practice }: { w: Weakness; practice: number }) {
  const m = useStore((s) => s.mastery[w.id]);
  return (
    <section className="panel dash-card dash-weak">
      <div className="dash-weak-text">
        <div className="dash-card-head">
          <h3>Your biggest recurring weakness</h3>
          <span className={`chip ${w.status === 'improving' ? 'good' : 'bad'}`}>{w.status}</span>
        </div>
        <h2>{w.llm?.title ?? w.title}</h2>
        <p className="dim small dash-desc">{w.llm?.description ?? w.description}</p>
        <div className="dash-minis">
          <div>
            <strong>{w.occurrences}×</strong>
            <span>in {w.games} games</span>
          </div>
          <div>
            <strong>−{w.avgScoreLoss.toFixed(1)}</strong>
            <span>points each time</span>
          </div>
          <div>
            <strong>{m ? fmtPct(m.mastery) : '0%'}</strong>
            <span>mastery</span>
          </div>
        </div>
        <div className="dash-card-actions">
          <button className="btn" onClick={() => go(`forge/${w.id}`)} disabled={!practice} title={practice ? undefined : 'No practice positions within the winrate limit yet'}>
            <Icon name="flame" /> Train in Forge
          </button>
          <button className="btn" onClick={() => go(`blind/${w.id}`)} disabled={!practice} title="Do I really know this? A blind test on fresh positions">
            <Icon name="eyeOff" /> Blind test
          </button>
        </div>
      </div>
      <WeaknessExample w={w} />
    </section>
  );
}

function NoWeaknessCard() {
  return (
    <section className="panel dash-card dash-weak empty">
      <div className="dash-weak-text">
        <div className="dash-card-head">
          <h3>Recurring weaknesses</h3>
        </div>
        <h2>Nothing confirmed yet</h2>
        <p className="dim small">A weakness needs the same kind of error at least 3 times in 2 or more games. Analyse more of your games to sharpen the picture.</p>
        <div className="dash-card-actions">
          <a className="btn" href={href('library')}>
            <Icon name="upload" /> Import games
          </a>
        </div>
      </div>
    </section>
  );
}

function CopyCard() {
  const copy = useCopy();
  const doppel = copy.model;
  const habits = doppel ? describeWeights(doppel).slice(0, 3) : [];
  const demo = copy.owner === 'demo';
  return (
    <section className="panel dash-card dash-copy">
      <div className="dash-card-head">
        <h3>{demo && copy.demoName ? `${copy.demoName}'s Doppelgänger` : 'Your Doppelgänger'}</h3>
        <More to="doppel">Details</More>
      </div>
      {doppel ? (
        <>
          <h2>
            Predicts {copy.whose} move <span className="doppel">{fmtPct(doppel.metrics.top1)}</span> of the time
          </h2>
          <div className="copy-bars">
            <div>
              <span>The copy</span>
              <div className="copy-bar doppel">
                <i style={{ '--v': doppel.metrics.top1 } as CSSProperties} />
              </div>
              <b>{fmtPct(doppel.metrics.top1)}</b>
            </div>
            <div>
              <span>KataGo policy</span>
              <div className="copy-bar kata">
                <i style={{ '--v': doppel.metrics.baselineTop1 } as CSSProperties} />
              </div>
              <b>{fmtPct(doppel.metrics.baselineTop1)}</b>
            </div>
          </div>
          <p className="dim small">
            A model of how {demo ? 'the player chooses' : 'you choose'} moves, learned from {doppel.moves ?? doppel.trainedOn} of {copy.whose} moves.
          </p>
          {habits.length > 0 && (
            <div className="row wrap copy-habits">
              {habits.map((h) => (
                <span key={h.label} className="chip doppel">
                  {h.weight > 0 ? 'prefers' : 'avoids'} {h.label}
                </span>
              ))}
            </div>
          )}
          <div className="dash-card-actions">
            <a className="btn" href={href('doppel')}>
              <Icon name="twin" /> Meet {demo ? 'the copy' : 'your copy'}
            </a>
            <a className="btn" href={href('doppel/play')}>
              <Icon name="play" /> Play it
            </a>
          </div>
        </>
      ) : (
        <>
          <h2>Not trained yet</h2>
          <p className="dim small">A copy of how you choose moves, trained once about 30 of your moves are analysed.</p>
          <div className="dash-card-actions">
            <a className="btn" href={href('doppel')}>
              <Icon name="twin" /> What it needs
            </a>
          </div>
        </>
      )}
    </section>
  );
}

/** Player DNA (accuracy per area) and where the points go (costly moves per area and phase), in one table. */
function DnaCard() {
  const version = useStore((s) => s.corpusVersion);
  const weaknesses = useStore((s) => s.weaknesses);
  const profile = useStore((s) => s.profile);
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
  const flagged = new Set(weaknesses.filter((w) => w.status !== 'resolved').map((w) => w.category));
  const heat = (c: { n: number; rate: number }, key: string) =>
    c.n >= 5 ? (
      <span key={key} className="heat" style={{ '--a': Math.min(0.9, 0.08 + c.rate * 2.2) } as CSSProperties} data-strong={c.rate > 0.2 ? '1' : undefined} title={`${c.n} moves, ${fmtPct(c.rate)} costly`}>
        {fmtPct(c.rate)}
      </span>
    ) : (
      <span key={key} className="heat none" title={`${c.n} moves`}>
        –
      </span>
    );
  return (
    <section className="panel dash-card dash-dna">
      <div className="dash-card-head">
        <h3>Player DNA</h3>
        <More to="dna">Details</More>
      </div>
      {profile ? (
        <>
          <p className="tiny muted dna-legend">
            Accuracy in each area, and where the points go: the share of your moves in each phase that cost 2.5 points or more.
          </p>
          <div className="dna-grid" role="table" aria-label="Player DNA and where the points go">
            <div className="dna-row dna-headrow" role="row">
              <span role="columnheader">Area</span>
              <span role="columnheader" data-short="Acc.">
                Accuracy
              </span>
              {PHASES.map((p) => (
                <span key={p} role="columnheader" data-short={PHASE_TINY[p]}>
                  {PHASE_SHORT[p]}
                </span>
              ))}
            </div>
            {AXES.map((a, i) => {
              const ax = profile.axes.find((x) => x.axis === a.axis);
              const known = ax && ax.n >= 8;
              return (
                <div key={a.axis} className={`dna-row ${flagged.has(a.axis) ? 'flagged' : ''}`} role="row">
                  <span className="dna-area" role="rowheader">
                    {a.label}
                    {flagged.has(a.axis) && <i className="dna-flag" title="A recurring weakness is in this area" />}
                  </span>
                  <span className="dna-acc" role="cell">
                    {known ? (
                      <>
                        <Bar value={ax.accuracy} />
                        <b>{fmtPct(ax.accuracy)}</b>
                      </>
                    ) : (
                      <span className="tiny muted">too few moves</span>
                    )}
                  </span>
                  {cells[i].map((c, j) => (
                    <span key={j} role="cell">
                      {heat(c, String(j))}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="small muted">Appears after the first analysed game.</p>
      )}
    </section>
  );
}

function WeaknessList({ practice }: { practice: Record<string, number> }) {
  const weaknesses = useStore((s) => s.weaknesses);
  const mastery = useStore((s) => s.mastery);
  const active = weaknesses.filter((w) => w.status !== 'resolved');
  return (
    <section className="panel dash-card dash-list">
      <div className="dash-card-head">
        <h3>All weaknesses</h3>
        <span className="chip">{active.length}</span>
      </div>
      {active.length ? (
        <div className="wk-grid">
          {active.slice(0, 6).map((w, i) => {
            const m = mastery[w.id];
            return (
              <a key={w.id} className="wk-tile" href={href(`forge/${w.id}`)} title={practice[w.id] ? 'Train in Forge' : 'Open in Forge'}>
                <span className="wk-n">{i + 1}</span>
                <span className="wk-body">
                  <strong>{w.llm?.title ?? w.title}</strong>
                  <small>
                    {AXIS_LABEL[w.category] ?? w.category} · {w.occurrences}× · {fmtPct(w.errorRate)} of {w.opportunities} chances
                  </small>
                  {m && (
                    <span className="wk-mastery">
                      <Bar value={m.mastery} />
                      <em>{fmtPct(m.mastery)} mastery</em>
                    </span>
                  )}
                </span>
                {w.status === 'improving' ? <span className="chip good">improving</span> : <span />}
              </a>
            );
          })}
        </div>
      ) : (
        <p className="small muted">Nothing repeated often enough yet.</p>
      )}
    </section>
  );
}

function TrainingCard() {
  const attempts = useStore((s) => s.attempts);
  const blindTests = useStore((s) => s.blindTests);
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
  const finished = blindTests.filter((t) => t.result);
  const learned = finished.filter((t) => t.result!.verdict === 'learned').length;
  const max = Math.max(1, ...days.map(([, d]) => d.n));
  return (
    <section className="panel dash-card dash-train">
      <div className="dash-card-head">
        <h3>Training history</h3>
        {attempts.length > 0 && <More to="forge">Forge</More>}
      </div>
      {attempts.length ? (
        <>
          <div className="train-body">
          <div className="train-figs">
            <div>
              <strong>{attempts.length}</strong>
              <span>positions trained</span>
            </div>
            <div>
              <strong>{fmtPct(attempts.filter((a) => a.conceptCorrect).length / attempts.length)}</strong>
              <span>right decisions</span>
            </div>
            <div>
              <strong>
                {learned}/{finished.length}
              </strong>
              <span>blind tests passed</span>
            </div>
          </div>
          <div className="history train-chart">
            {days.map(([d, x]) => (
              <div key={d} className="history-day" title={`${d}: ${x.n} positions, ${fmtPct(x.ok / x.n)} right decision`}>
                <div className="history-bar" style={{ height: `${(x.n / max) * 100}%` }}>
                  <span style={{ height: `${(x.ok / x.n) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          </div>
          <p className="tiny muted">
            {attempts.length} positions trained · {fmtPct(attempts.filter((a) => a.conceptCorrect).length / attempts.length)} right decisions · last {days.length} training day{days.length > 1 ? 's' : ''}
          </p>
        </>
      ) : (
        <div className="train-empty">
          <span className="train-empty-ico">
            <Icon name="flame" />
          </span>
          <p className="small muted">No training yet. Forge sessions and blind tests will show up here.</p>
          <a className="btn" href={href('forge')}>
            <Icon name="flame" /> Start in Forge
          </a>
        </div>
      )}
    </section>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function Dashboard() {
  const games = useStore((s) => s.games);
  if (!games.length) return <FirstRun />;
  return <Home />;
}

function Home() {
  const games = useStore((s) => s.games);
  const profile = useStore((s) => s.profile);
  const weaknesses = useStore((s) => s.weaknesses);
  const busy = useStore((s) => s.busy);
  const analyses = useStore((s) => s.analyses);
  const items = useStore((s) => s.items);
  const minWin = useStore((s) => s.settings.minLosingWinrate);
  useStore((s) => s.corpusVersion);
  // Only positions Forge will actually ask (worth drilling, not lopsided).
  const practice = useMemo(() => Object.fromEntries(Object.entries(items).map(([id, list]) => [id, practiceItems(list ?? [], minWin).length])), [items, minWin]);
  const step = useNextStep(practice);

  const demo = usesDemoData();
  const mine = games.filter((g) => (demo ? g.source === 'user' || g.source === 'demo' : g.source === 'user'));
  const analysed = mine.filter((g) => g.status === 'done').length;
  const positions = mine.reduce((a, g) => a + (analyses[g.id]?.evals.filter(Boolean).length ?? 0), 0);
  const active = weaknesses.filter((w) => w.status !== 'resolved');
  const biggest = active.find((w) => w.status === 'active') ?? active[0];
  const improving = active.filter((w) => w.status === 'improving').length;

  return (
    <div className="page dash">
      <header className="dash-hero">
        <div className="dash-hero-main">
          <div className="eyebrow">{greeting()}</div>
          <h1>{profile?.name && profile.name !== 'You' ? profile.name : 'Your lab'}</h1>
          <p className="sub" title={profile ? new Date(profile.updatedAt).toLocaleString() : undefined}>
            {profile ? `Player model v${profile.version} · updated ${ago(profile.updatedAt)}` : 'Your profile appears once your games are analysed.'}
            {busy.profile && ' · updating…'}
          </p>
          <div className="dash-actions" role="group" aria-label="Quick actions">
            <a className="btn" href={href('library')}>
              <Icon name="upload" /> Import games
            </a>
            <a className="btn" href={href('review')}>
              <Icon name="board" /> Review a game
            </a>
            <a className="btn" href={href('doppel/play')}>
              <Icon name="twin" /> Play the copy
            </a>
          </div>
        </div>
        <NextStep step={step} />
      </header>

      <EngineNotice />
      <SideChooser />
      <DemoNotice />
      <QueueCard />

      <div className="dash-stats">
        <StatTile icon="library" value={`${analysed}/${mine.length}`} label="Games analysed" hint={analysed < mine.length ? `${mine.length - analysed} to go` : 'all analysed'} />
        <StatTile icon="board" tone="sky" value={positions.toLocaleString()} label="Positions read" hint="by KataGo" />
        <StatTile icon="target" tone="meadow" value={profile ? fmtPct(profile.overallAccuracy) : '–'} label="Accurate moves" hint={profile ? `avg loss ${profile.avgScoreLoss.toFixed(2)} pts/move` : undefined} />
        <StatTile icon="flame" tone="dusk" value={active.length} label="Recurring weaknesses" hint={active.length ? `${improving} improving` : 'needs repeated evidence'} />
      </div>

      <div className="dash-grid">
        {biggest ? <WeaknessCard w={biggest} practice={practice[biggest.id] ?? 0} /> : <NoWeaknessCard />}
        <CopyCard />
        <DnaCard />
        <WeaknessList practice={practice} />
        <TrainingCard />
      </div>
    </div>
  );
}
