import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast, useStore } from '../state/store';
import { corpus, evolveCopy, getEngine, isPlayerGame, loadDemo, markInteractive, pcSmallIfSame, rebuildProfile, runQueue, saveDoppelGame, startEngine } from '../state/actions';
import { Board, type Mark } from '../components/Board';
import { fmtPct, gameTitle, Legend, MoveThumb } from '../components/common';
import { BoardScreen, HeadButton, Notice, PlayersBar, REPORT_TABS, type ScreenTool } from '../components/BoardScreen';
import { BlunderPanel, PerformancePanel, TrendPanel } from '../components/Report';
import { SkillPanel } from '../components/Skill';
import type { PosValue } from '../lib/analysis/lineStats';
import { KomiPicker } from '../components/Komi';
import { DoppelLine, useCopy, type CopyInfo } from '../components/Doppel';
import { BrandMark, Icon } from '../components/Icons';
import { evaluateFast, evaluateFastMany, toPlayAt } from '../lib/analysis/analyzer';
import type { EngineBackend } from '../lib/engine/types';
import { PcGone } from '../state/pc';
import { replay } from '../lib/go/board';
import { engineKomi } from '../lib/go/rules';
import { locToGtp } from '../lib/go/coords';
import { other, PASS, type Color, type Loc, type Move } from '../lib/go/types';
import {
  copyVsKataGo,
  describeContextHabits,
  describeHabits,
  DOPPEL_ALGO,
  habitCost,
  MIN_COPY_MOVES,
  PHASES,
  positionExample,
  predict,
  rankDisagreements,
  sampleMove,
  type Disagreement,
  type DoppelModel,
  type DoppelPrediction,
  type MoveValue,
} from '../lib/profile/doppel';
import type { GameRecord, OpponentProfile, PolicyEntry } from '../lib/types';
import { FULL_STRENGTH, lossBudget } from '../lib/profile/strength';
import { bookMoves } from '../lib/profile/book';
import { choiceDistribution, describeCandidates, drawFrom, TILT_LOSS, type CandInfo, type ChoiceState } from '../lib/profile/human';
import { DEFAULT_DIALS, PRESETS, presetDials, type CopyDials, type Mood } from '../lib/profile/dials';
import { GENES } from '../lib/profile/genome';
import { SIGNATURES } from '../lib/profile/signatures';
import { moverView } from '../lib/engine/parse';
import { addCopyFeedback, loadCopyLab, pendingFeedback, setCopyDials, useCopyLab } from '../state/copy';
import { rankLabelWhole, rankTier } from '../lib/level/ranks';

const rankLabel = (r: number) => rankTier(r) ?? rankLabelWhole(r);
import { loadLevel, useLevel } from '../state/level';
import { go, href } from '../router';
import { ActionTile, ControlSheet, FieldTile, GearButton, SheetSection, ToggleTile } from '../components/ControlSheet';
import './doppel.css';

type View = 'overview' | 'differences' | 'play';

/** Strength dial settings (ranks on the level scale, see level/ranks.ts). */
const STRENGTHS = [-14, -9, -6, -4, -2, 0, 1, 3, 5, 7, 9, 10, 11, FULL_STRENGTH];

/** The losing side must keep this winrate for a disagreement to count (looser than practice: this is a report). */
const REPORT_MIN_LOSING_WINRATE = 0.1;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const pts = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;

function ago(t: number) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

// ------------------------------------------------------------------ page

/** Opens and closes the page's settings sheet (the gear at the top right). */
interface SheetCtl {
  open: boolean;
  set: (v: boolean) => void;
}

export function Doppelganger({ tab, query }: { tab?: string; query?: URLSearchParams }) {
  const copy = useCopy();
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheet: SheetCtl = { open: sheetOpen, set: setSheetOpen };
  const opponents = useStore((s) => s.opponents);
  // "Play" is the default: the sidebar's own three entries (Doppelgänger, The Copy, Where
  // it differs) are the only way to reach the other two views now.
  const view: View = tab === 'differences' ? 'differences' : tab === 'copy' ? 'overview' : 'play';
  const ready = copy.state === 'ready' && copy.model;
  // Playing an imported player's copy (from their profile page).
  const opp = view === 'play' ? opponents.find((o) => o.id === query?.get('opp') && o.copy) : undefined;
  if (opp?.copy) return <PlayCopy key={opp.id} copy={{ ...copy, owner: 'user', who: `${opp.name}'s copy`, whose: `${opp.name}'s`, demoName: opp.name }} model={opp.copy} opponent={opp} />;
  // Playing is a full-screen board (see BoardScreen): no page around it.
  if (view === 'play' && ready) return <PlayCopy copy={copy} model={copy.model!} />;
  return (
    <div className={`page dop-page ${view !== 'overview' && ready ? 'dop-wide' : ''} ${view === 'play' ? 'dop-play-page' : ''}`}>
      {view !== 'play' && <Head copy={copy} onSettings={ready ? () => sheet.set(true) : undefined} />}
      {!ready ? (
        <NotReady copy={copy} />
      ) : (
        <>
          {copy.owner === 'demo' && view === 'overview' && <DemoBanner copy={copy} />}
          {view === 'overview' && <Overview copy={copy} model={copy.model!} />}
          {view === 'differences' && <Differences copy={copy} model={copy.model!} at={query?.get('at') ?? undefined} />}
          {view !== 'play' && <DopSheet sheet={sheet} copy={copy} />}
        </>
      )}
    </div>
  );
}

/** The overview and differences pages still get a full title (now reached only from the
 * sidebar); the play page keeps to a board, a Start button and whose copy it is. */
function Head({ copy, onSettings }: { copy: CopyInfo; onSettings?: () => void }) {
  const busy = useStore((s) => s.busy.profile);
  const m = copy.model;
  const demo = copy.owner === 'demo' && copy.state === 'ready';
  return (
    <div className="page-head dop-head">
      <div className="dop-title">
        <BrandMark className="dop-emblem" />
        <div>
          <div className="eyebrow">{demo ? 'Demo player' : 'Your copy'}</div>
          <h1>{demo && copy.demoName ? `${copy.demoName}'s Doppelgänger` : 'Your Doppelgänger'}</h1>
          <p className="sub">
            {m
              ? `Trained on ${plural(m.moves ?? m.trainedOn + m.metrics.testSize, 'move')}. Predicts ${demo ? `${copy.demoName ?? 'the player'}'s` : 'your'} moves, not the best ones.`
              : 'Predicts your moves, not the best ones.'}
            {busy && ' Updating…'}
          </p>
        </div>
      </div>
      {m && onSettings && (
        <div className="dop-head-tools">
          <GearButton onClick={onSettings} label="Settings" />
        </div>
      )}
    </div>
  );
}

/**
 * The Control Center: everything you can set or do on the Doppelgänger pages, grouped.
 * `children` puts the current view's own settings (a game's setup, say) first.
 */
function DopSheet({ sheet, copy }: { sheet: SheetCtl; copy: CopyInfo }) {
  const close = useCallback(() => sheet.set(false), [sheet]);
  return (
    <ControlSheet open={sheet.open} onClose={close} title="Doppelgänger">
      <DopSettings copy={copy} onNav={close} />
    </ControlSheet>
  );
}

/** Retrain the copy, import games, or play an opponent's copy: the sheet's sections, also
 * shown under the board on the play screen. */
function DopSettings({ copy, onNav }: { copy: CopyInfo; onNav?: () => void }) {
  const busy = useStore((s) => s.busy.profile);
  const doppel = useStore((s) => s.doppel);
  const evolving = useCopyLab((s) => s.evolving);
  useCopyLab((s) => s.feedback);
  useEffect(() => void loadCopyLab(), []);
  const pending = pendingFeedback('me', doppel);
  const opponents = useStore((s) => s.opponents).filter((o) => o.copy);
  const nav = (path: string) => {
    onNav?.();
    go(path);
  };
  return (
    <>
      <SheetSection title="Copy">
        <ActionTile
          onClick={() => void rebuildProfile()}
          disabled={busy}
          icon="↻"
          label={busy ? 'Retraining…' : 'Retrain'}
          sub={pending ? `Learns ${plural(pending, '"not me"', '"not me"s')}` : 'All analysed games'}
        />
        {copy.owner !== 'demo' && <ActionTile onClick={() => void evolveCopy(4)} disabled={busy || !!evolving || !doppel} icon="🧬" label={evolving ? `Evolving ${evolving.done}/${evolving.total}` : 'Evolve'} sub="Tune it to you" />}
        <ActionTile onClick={() => nav('library')} icon={<Icon name="upload" />} label="Import games" sub={copy.owner === 'demo' ? 'Make it yours' : 'Add games'} />
      </SheetSection>
      <SheetSection title="Opponents">
        {opponents.length ? (
          <FieldTile label="Play an opponent">
            <select defaultValue="" onChange={(e) => e.target.value && nav(`doppel/play?opp=${e.target.value}`)} aria-label="Opponent">
              <option value="" disabled>
                Choose…
              </option>
              {opponents.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </FieldTile>
        ) : (
          <ActionTile onClick={() => nav('opponents')} icon={<Icon name="swords" />} label="Opponents" sub="Copy anyone" />
        )}
      </SheetSection>
      <SheetSection title="More">
        <ActionTile onClick={() => nav('doppel/copy')} icon={<Icon name="stones" />} label="Copy" sub="What it learned" />
        <ActionTile onClick={() => nav('doppel/differences')} icon={<Icon name="target" />} label="Differences" sub="vs KataGo" />
      </SheetSection>
    </>
  );
}

function DemoBanner({ copy }: { copy: CopyInfo }) {
  return (
    <div className="banner info">
      <div className="grow stack tight">
        <strong>{copy.demoName ?? 'Demo player'}'s copy, not yours</strong>
        <span className="small dim">Yours trains after {MIN_COPY_MOVES} analysed moves (about one game).</span>
      </div>
      <a className="btn" href={href('library')}>
        <Icon name="upload" /> Import games
      </a>
    </div>
  );
}

// ------------------------------------------------------------------ not trained yet

function Step({ done, title, detail, action }: { done: boolean | 'busy'; title: string; detail: ReactNode; action?: ReactNode }) {
  return (
    <div className={`dop-step ${done === true ? 'done' : done === 'busy' ? 'busy' : ''}`}>
      <span className="dop-step-mark" aria-hidden>
        {done === true ? <Icon name="check" /> : null}
      </span>
      <div className="grow">
        <strong>{title}</strong>
        <div className="small dim">{detail}</div>
      </div>
      {action}
    </div>
  );
}

function NotReady({ copy }: { copy: CopyInfo }) {
  const games = useStore((s) => s.games);
  const analyses = useStore((s) => s.analyses);
  const queue = useStore((s) => s.queue);
  const busy = useStore((s) => s.busy.profile);
  const version = useStore((s) => s.corpusVersion);
  const own = games.filter((g) => g.source === 'user');
  const sided = own.filter((g) => g.playerColor !== null);
  const analysed = sided.filter((g) => analyses[g.id]);
  const waiting = sided.filter((g) => !analyses[g.id] && g.status !== 'error' && g.status !== 'skipped');
  const failed = sided.filter((g) => g.status === 'error');
  // The user's own analysed moves (the demo player's do not count toward the user's copy).
  const moves = useMemo(() => (copy.demoMode ? 0 : corpus().playerRecords().length), [copy.demoMode, version]);
  const enough = moves >= MIN_COPY_MOVES;
  const cur = games.find((g) => g.id === queue.currentGameId);
  return (
    <div className="grid cols-hero">
      <div className="panel accent stack">
        <h2>Copy not trained</h2>
        <p className="dim small">
          Needs about {MIN_COPY_MOVES} of your analysed moves.
          {copy.state === 'foreign' && ' The stored copy learned from other games, so it stays hidden.'}
        </p>
        <div className="dop-steps">
          <Step
            done={own.length > 0}
            title="Import games"
            detail={own.length ? `${plural(own.length, 'game')} in library.` : 'Add SGF files.'}
            action={
              !own.length && (
                <a className="btn small primary" href={href('library')}>
                  Library
                </a>
              )
            }
          />
          <Step
            done={sided.length > 0}
            title="Set your side"
            detail={
              own.length === 0
                ? 'Asked on import if missing.'
                : sided.length === own.length
                  ? 'All set.'
                  : `Set in ${sided.length}/${own.length} games.`
            }
            action={
              own.length > sided.length && (
                <a className="btn small" href={href('library')}>
                  Set sides
                </a>
              )
            }
          />
          <Step
            done={analysed.length > 0 ? true : queue.running && waiting.length ? 'busy' : false}
            title="Analyse"
            detail={
              <>
                {analysed.length ? `${plural(analysed.length, 'game')} analysed. ` : ''}
                {waiting.length ? `${plural(waiting.length, 'game')} waiting. ` : ''}
                {failed.length ? `${plural(failed.length, 'game')} failed. ` : ''}
                {queue.running && cur ? `Now: ${gameTitle(cur)}, ${cur.status === 'deep' ? `deep ${cur.progress.deep}/${cur.progress.deepTotal}` : `fast ${cur.progress.fast}/${cur.progress.total}`}.` : ''}
                {!analysed.length && !waiting.length && !failed.length ? 'Nothing yet.' : ''}
              </>
            }
            action={
              waiting.length > 0 &&
              !queue.running && (
                <button className="btn small primary" onClick={() => void runQueue()}>
                  Analyse now
                </button>
              )
            }
          />
          <Step
            done={enough}
            title={`${MIN_COPY_MOVES} moves`}
            detail={
              <div className="stack tight">
                <span>{enough ? `${moves.toLocaleString()} analysed.` : `${moves}/${MIN_COPY_MOVES}`}</span>
                {!enough && (
                  <div className="progress">
                    <span style={{ width: `${Math.min(100, (moves / MIN_COPY_MOVES) * 100)}%` }} />
                  </div>
                )}
              </div>
            }
          />
          {enough && (
            <Step
              done={busy ? 'busy' : false}
              title="Train"
              detail={busy ? 'Training…' : 'Ready.'}
              action={
                !busy && (
                  <button className="btn small primary" onClick={() => void rebuildProfile()}>
                    Train
                  </button>
                )
              }
            />
          )}
        </div>
      </div>
      <div className="panel stack">
        <h3>You get</h3>
        <ul className="notes small">
          <li>Move prediction accuracy</li>
          <li>Your habits vs KataGo</li>
          <li>Where habits cost points</li>
          <li>A game against yourself</li>
        </ul>
        {!games.some((g) => g.source === 'demo') && !own.length && (
          <button className="btn" style={{ justifySelf: 'start' }} onClick={() => void loadDemo().catch((e) => alert((e as Error).message))}>
            <Icon name="stones" /> Try the demo
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ comparing the copy with KataGo on the player's games

interface Report {
  /** Positions where the copy could predict. */
  positions: number;
  /** ...where its most likely move is not KataGo's. */
  disagreements: number;
  list: Disagreement[];
}

let reportCache: { key: string; report: Report } | null = null;

/** The copy against KataGo on every analysed position of the player, computed in slices. */
function useReport(model: DoppelModel) {
  const version = useStore((s) => s.corpusVersion);
  const key = `${model.version}|${model.trainedAt}|${version}`;
  const [state, setState] = useState<{ key: string; report: Report | null; progress: number }>(() => ({
    key,
    report: reportCache?.key === key ? reportCache.report : null,
    progress: 0,
  }));
  useEffect(() => {
    if (reportCache?.key === key) {
      setState({ key, report: reportCache.report, progress: 1 });
      return;
    }
    let cancelled = false;
    setState({ key, report: null, progress: 0 });
    (async () => {
      const c = corpus();
      const recs = c.playerRecords();
      const report: Report = { positions: 0, disagreements: 0, list: [] };
      let t = performance.now();
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i];
        const a = c.analyses.get(r.gameId);
        const ev = a?.evals[r.index];
        if (ev) {
          const prev = r.index > 0 ? c.games.get(r.gameId)!.moves[r.index - 1] : null;
          const res = copyVsKataGo(model, { record: r, eval: ev, next: a!.evals[r.index + 1], board: c.boards(r.gameId)[r.index], lastOpp: prev && prev.color !== r.color ? prev.loc : null });
          if (res) {
            report.positions++;
            if (res.disagreement) {
              report.disagreements++;
              report.list.push(res.disagreement);
            }
          }
        }
        if (performance.now() - t > 24) {
          await new Promise((res) => setTimeout(res, 0));
          if (cancelled) return;
          setState((s) => ({ ...s, progress: i / recs.length }));
          t = performance.now();
        }
      }
      reportCache = { key, report };
      if (!cancelled) setState({ key, report, progress: 1 });
    })();
    return () => {
      cancelled = true;
    };
  }, [key, model]);
  return state.key === key ? state : { key, report: null, progress: 0 };
}

function useRanked(model: DoppelModel) {
  const r = useReport(model);
  const ranked = useMemo(() => (r.report ? rankDisagreements(r.report.list, { minLosingWinrate: REPORT_MIN_LOSING_WINRATE }) : []), [r.report]);
  return { ...r, ranked };
}

function Computing({ progress, positions }: { progress: number; positions?: number }) {
  return (
    <div className="stack tight">
      <span className="small dim">Comparing with KataGo{positions ? ` (${plural(positions, 'position')})` : ''}…</span>
      <div className="progress">
        <span style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ overview

function Overview({ copy, model }: { copy: CopyInfo; model: DoppelModel }) {
  return (
    <>
      <div className="grid cols-hero">
        <StatusCard copy={copy} model={model} />
        <HabitsCard copy={copy} model={model} />
      </div>
      <div className="grid cols-hero" style={{ marginTop: 14 }}>
        <PlayStyleCard copy={copy} model={model} />
        <EvolutionCard copy={copy} model={model} />
      </div>
      <div className="grid cols-hero" style={{ marginTop: 14 }}>
        <DifferencesPreview copy={copy} model={model} />
        <div className="panel dop-cta stack">
          <BrandMark className="dop-cta-mark" />
          <h2>Play {copy.owner === 'demo' ? copy.who : 'your copy'}</h2>
          <p className="small dim">It plays like {copy.owner === 'demo' ? copy.demoName ?? 'the player' : 'you'}. KataGo's choice is shown beside each reply.</p>
          <a className="btn primary" href={href('doppel/play')} style={{ justifySelf: 'start' }}>
            <Icon name="play" /> Play
          </a>
          <OpponentCopyPicker />
        </div>
      </div>
    </>
  );
}

/** The Doppelgänger isn't only for you: any opponent with enough of their games analysed
 * gets a copy too, with its own strength dial. This is the way into it from the main page. */
function OpponentCopyPicker() {
  const opponents = useStore((s) => s.opponents).filter((o) => o.copy);
  if (!opponents.length)
    return (
      <p className="tiny muted">
        Copy any rival from their <a href={href('opponents')}>opponent page</a>.
      </p>
    );
  return (
    <label className="stack tight">
      <span className="field-label">Or play an opponent</span>
      <select defaultValue="" onChange={(e) => e.target.value && go(`doppel/play?opp=${e.target.value}`)}>
        <option value="" disabled>
          Choose…
        </option>
        {opponents.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function CompareRow({ label, copy, kata }: { label: string; copy: number; kata: number }) {
  return (
    <div className="dop-compare-row">
      <span className="small">{label}</span>
      <div className="dop-bars">
        <div className="dop-barline">
          <div className="bar dop-bar-copy">
            <span style={{ width: `${copy * 100}%` }} />
          </div>
          <span className="mono doppel">{fmtPct(copy)}</span>
        </div>
        <div className="dop-barline">
          <div className="bar kata">
            <span style={{ width: `${kata * 100}%` }} />
          </div>
          <span className="mono kata">{fmtPct(kata)}</span>
        </div>
      </div>
    </div>
  );
}

function StatusCard({ copy, model }: { copy: CopyInfo; model: DoppelModel }) {
  const busy = useStore((s) => s.busy.profile);
  const m = model.metrics;
  const moves = model.moves ?? model.trainedOn + m.testSize;
  const gamesN = model.gameIds?.length;
  const gain = m.top1 - m.baselineTop1;
  const old = (model.algo ?? 1) < DOPPEL_ALGO;
  const you = copy.owner === 'demo' ? copy.demoName ?? 'the player' : 'you';
  return (
    <div className="panel accent stack">
      <h3>Accuracy</h3>
      <h2>
        Exact move <span className="doppel">{fmtPct(m.top1)}</span>
      </h2>
      <div className="dop-compare">
        <div className="dop-compare-legend tiny">
          <span className="doppel">● Copy</span>
          <span className="kata">● KataGo policy</span>
        </div>
        <CompareRow label="Exact move" copy={m.top1} kata={m.baselineTop1} />
        <CompareRow label="Top 3" copy={m.top3} kata={m.baselineTop3} />
      </div>
      <p className="small dim">
        {m.testSize < 20
          ? `Only ${plural(m.testSize, 'test move')}. Rough numbers.`
          : gain >= 0.02
            ? `${Math.round(gain * 100)} pts better than KataGo at predicting ${you}.`
            : gain > -0.02
              ? `Level with KataGo. Add games.`
              : `Behind KataGo. Add more of ${copy.whose} games.`}
      </p>
      <dl className="kv">
        <dt>Trained on</dt>
        <dd>
          {plural(moves, 'move')}
          {gamesN ? ` in ${plural(gamesN, 'game')}` : ''}
          {copy.newGames > 0 && <span className="muted"> · {plural(copy.newGames, 'new game')} pending</span>}
        </dd>
        <dt>Tested on</dt>
        <dd>
          {plural(m.testSize, 'unseen move')}
        </dd>
        {model.outsideRate !== undefined && (
          <>
            <dt>Off KataGo's list</dt>
            <dd>
              {fmtPct(model.outsideRate)} <span className="muted">(outside top 10)</span>
            </dd>
          </>
        )}
        <dt>Updated</dt>
        <dd>
          {ago(model.trainedAt)} · v{model.version}
        </dd>
      </dl>
      {old && (
        <div className="callout small">
          {(model.algo ?? 1) < 2 ? 'Trained with an old method. Numbers are inflated.' : 'Trained before the copy learned openings, phases and human mistakes.'}{' '}
          <button className="btn small" disabled={busy} onClick={() => void rebuildProfile()}>
            {busy ? 'Retraining…' : 'Retrain'}
          </button>
        </div>
      )}
    </div>
  );
}

function HabitsCard({ copy, model }: { copy: CopyInfo; model: DoppelModel }) {
  const habits = describeHabits(model, 8);
  const changes = describeContextHabits(model, 5);
  const max = Math.max(0.5, ...habits.map((h) => Math.abs(h.weight)));
  return (
    <div className="panel stack">
      <h3>{copy.owner === 'demo' ? 'Habits' : 'Your habits'}</h3>
      {habits.length ? (
        <>
          <p className="small dim">vs KataGo, {copy.owner === 'demo' ? copy.demoName ?? 'the player' : 'you'}:</p>
          <div className="dop-habits">
            {habits.map((h) => (
              <div key={h.feature} className="dop-habit" title={`${h.odds >= 1 ? h.odds.toFixed(1) + '× more' : (1 / h.odds).toFixed(1) + '× less'} likely than KataGo policy`}>
                <span className="small">{h.text}</span>
                <div className={`bar ${h.weight > 0 ? 'dop-bar-copy' : 'dop-bar-less'}`}>
                  <span style={{ width: `${Math.min(100, (Math.abs(h.weight) / max) * 100)}%` }} />
                </div>
                <span className={`chip ${h.strength === 'strong' ? 'doppel' : ''}`}>{h.strength}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="small dim">No clear habit yet.</p>
      )}
      {changes.length > 0 && (
        <>
          <h4>As the game changes</h4>
          <ul className="small dop-changes">
            {changes.map((c, i) => (
              <li key={i}>
                <strong>{c.when}:</strong> {c.text.charAt(0).toLowerCase() + c.text.slice(1)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const pct0 = (v: number) => `${Math.round(v * 100)}%`;

/** How the copy plays, mistakes included, next to the player: measured on games it did not learn from. */
function PlayStyleCard({ copy, model }: { copy: CopyInfo; model: DoppelModel }) {
  const play = model.metrics.play;
  const mk = model.mistakes;
  const you = copy.owner === 'demo' ? copy.demoName ?? 'The player' : 'You';
  const your = copy.owner === 'demo' ? 'their' : 'your';
  if (!play || !mk)
    return (
      <div className="panel stack">
        <h3>How it plays</h3>
        <p className="small dim">Retrain the copy to measure its mistakes against {your}s.</p>
      </div>
    );
  const kinds = mk.types
    .map((t, i) => ({ ...t, title: SIGNATURES[i]?.title ?? t.id }))
    .filter((t) => t.you >= 3 && t.mult >= 1.3)
    .sort((a, b) => b.mult - a.mult)
    .slice(0, 3);
  return (
    <div className="panel stack">
      <h3>How it plays</h3>
      <h2>
        Plays {your} move <span className="doppel">{pct0(play.match)}</span>
      </h2>
      <p className="small dim">
        Chance it picks {your} exact move in games it never saw{play.habitsMatch < play.match - 0.005 ? ` (was ${pct0(play.habitsMatch)} before it learned ${your} mistakes)` : ''}.
      </p>
      {!play.byPhase.some((p) => p.you.moves) && <p className="small muted">Its mistakes are compared with {your}s once games have KataGo's full analysis (the quick first look has no move values).</p>}
      <table className="data dop-mistakes">
        <thead>
          <tr>
            <th />
            <th>{you}</th>
            <th className="doppel">Copy</th>
          </tr>
        </thead>
        <tbody>
          {play.byPhase.map((p, i) =>
            p.you.moves ? (
              <tr key={i}>
                <td>{PHASES[i].charAt(0).toUpperCase() + PHASES[i].slice(1)}</td>
                <td className="mono">
                  {p.you.meanLoss.toFixed(1)} pts · {pct0(p.you.mistakes)}
                </td>
                <td className="mono doppel">
                  {p.copy.meanLoss.toFixed(1)} pts · {pct0(p.copy.mistakes)}
                </td>
              </tr>
            ) : null,
          )}
          <tr>
            <td>Obvious blunders</td>
            <td className="mono">{fmtPct(play.obvious.you)}</td>
            <td className="mono doppel">{fmtPct(play.obvious.copy)}</td>
          </tr>
        </tbody>
      </table>
      <p className="tiny muted">
        Points lost per move · share of moves losing 2+ points. Obvious blunders: self-atari, filling an own eye, leaving a big group in atari. {pct0(play.outside.share)} of {your} moves were outside KataGo's top 10 ({play.outside.meanLoss.toFixed(1)} pts each); the copy never plays those, so the rows compare the rest.
      </p>
      <dl className="kv">
        <dt>After a mistake</dt>
        <dd>
          {mk.tilt >= 1.15
            ? `${you} ${your === 'your' ? 'lose' : 'loses'} ${mk.tilt.toFixed(1)}× as much on the next move; the copy tilts too.`
            : mk.tilt <= 0.87
              ? `${you} ${your === 'your' ? 'steady yourself' : 'steadies'} after one; so does the copy.`
              : 'No tilt measured.'}
        </dd>
        {kinds.length > 0 && (
          <>
            <dt>{your === 'your' ? 'Your' : 'Their'} mistakes</dt>
            <dd>{kinds.map((k) => `${k.title.toLowerCase()} (${k.mult.toFixed(1)}×)`).join('; ')}</dd>
          </>
        )}
        {model.book && model.book.positions > 0 && (
          <>
            <dt>Opening book</dt>
            <dd>{plural(model.book.positions, 'position')} from {your} games</dd>
          </>
        )}
      </dl>
    </div>
  );
}

/** Evolution: the copy tunes its own settings to the player, and keeps going as games come in. */
function EvolutionCard({ copy, model }: { copy: CopyInfo; model: DoppelModel }) {
  const evolving = useCopyLab((s) => s.evolving);
  const busy = useStore((s) => s.busy.profile);
  const evo = model.evo;
  const hist = evo?.history ?? [];
  const mine = copy.owner !== 'demo' || !copy.demoName;
  const g = model.genome;
  const W = 220;
  const H = 46;
  let path = '';
  if (hist.length >= 2) {
    const lo = Math.min(...hist.map((h) => h.best));
    const hi = Math.max(...hist.map((h) => h.best));
    path = hist.map((h, i) => `${i ? 'L' : 'M'}${((i / (hist.length - 1)) * W).toFixed(1)},${(H - 3 - ((h.best - lo) / Math.max(hi - lo, 1e-6)) * (H - 6)).toFixed(1)}`).join(' ');
  }
  const words = g
    ? [
        g.halfLife > 0 ? `recent games count more (half after ${Math.round(g.halfLife)} games)` : 'all games count the same',
        `variety ${g.temperature.toFixed(2)}`,
        g.gamma >= 0.25 ? 'mistakes must look natural' : 'any plausible mistake',
        `trusts the book after ${g.bookAlpha < 1.5 ? 'one game' : `${Math.round(g.bookAlpha)} games`}`,
      ]
    : [];
  return (
    <div className="panel stack">
      <div className="spread">
        <h3>Evolution</h3>
        {evo && <span className="chip doppel">generation {evo.generation}</span>}
      </div>
      <p className="small dim">
        The copy breeds its own settings: {GENES.length} of them, scored on how well a copy built with them plays like {copy.owner === 'demo' ? copy.demoName ?? 'the player' : 'you'} in games it didn't learn from. It evolves a little after every update.
      </p>
      {path && (
        <svg className="dop-evo" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" aria-label="Best score per generation">
          <path d={path} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {words.length > 0 && <p className="small">Best so far: {words.join(' · ')}.</p>}
      {evolving ? (
        <div className="stack tight">
          <div className="bar dop-bar-copy">
            <span style={{ width: `${(evolving.done / Math.max(evolving.total, 1)) * 100}%` }} />
          </div>
          <span className="tiny muted">
            Evolving… {evolving.done}/{evolving.total}
          </span>
        </div>
      ) : (
        mine && (
          <button className="btn" style={{ justifySelf: 'start' }} disabled={busy} onClick={() => void evolveCopy(4)}>
            Evolve 4 more generations
          </button>
        )
      )}
    </div>
  );
}

function DifferencesPreview({ copy, model }: { copy: CopyInfo; model: DoppelModel }) {
  const games = useStore((s) => s.games);
  const { report, ranked, progress } = useRanked(model);
  const byId = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  return (
    <div className="panel stack">
      <div className="spread">
        <h3>Costliest habits</h3>
        {ranked.length > 3 && (
          <a className="small muted" href={href('doppel/differences')}>
            All {ranked.length}
          </a>
        )}
      </div>
      {!report ? (
        <Computing progress={progress} />
      ) : (
        <>
          <p className="small dim">
            Differs from KataGo in {fmtPct(report.positions ? report.disagreements / report.positions : 0)} of {copy.whose} positions.
            {ranked.length ? '' : ' None cost a point.'}
          </p>
          {ranked.length > 0 && (
            <div className="card-list dop-cards">
              {ranked.slice(0, 3).map((d) => {
                const g = byId.get(d.gameId);
                const rec = corpus().byId.get(d.id);
                if (!g || !rec) return null;
                return (
                  <a key={d.id} className="poscard" href={href(`doppel/differences?at=${encodeURIComponent(d.id)}`)}>
                    <MoveThumb game={g} record={{ ...rec, loc: d.played === d.copy.loc ? PASS : rec.loc }} extra={[{ loc: d.copy.loc, kind: 'doppel', label: 'D' }]} />
                    <div className="small">
                      <span className="kata">KataGo {locToGtp(d.kata.loc, d.size)}</span> · <span className="doppel">copy {locToGtp(d.copy.loc, d.size)} ({fmtPct(d.copy.p)})</span>
                    </div>
                    <div className="tiny muted">
                      Move {d.index + 1} · −{d.cost!.scoreLoss.toFixed(1)} pts · {g.date ?? gameTitle(g)}
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ where the copy and KataGo differ

function valueText(v: MoveValue | undefined) {
  return v ? `${fmtPct(v.win)} · ${pts(v.lead)}` : '—';
}

function Differences({ copy, model, at }: { copy: CopyInfo; model: DoppelModel; at?: string }) {
  const games = useStore((s) => s.games);
  const { report, ranked, progress } = useRanked(model);
  const [shown, setShown] = useState(25);
  const idx = Math.max(0, ranked.findIndex((d) => d.id === at));
  const sel = ranked[idx] ?? null;
  const game = sel ? games.find((g) => g.id === sel.gameId) : undefined;
  const board = useMemo(() => (sel && game ? replay(game.size, game.setup, game.moves, sel.index) : null), [sel, game]);
  const select = useCallback((d: Disagreement) => go(`doppel/differences?at=${encodeURIComponent(d.id)}`), []);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const next = ranked[idx + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) {
        e.preventDefault();
        select(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ranked, idx, select]);

  useEffect(() => {
    if (idx >= shown) setShown(idx + 10);
    // Keep the selected row visible inside the list (without scrolling the page).
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('.dop-row.on');
    if (!list || !row) return;
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
  }, [idx, shown]);

  if (!report)
    return (
      <div className="panel">
        <Computing progress={progress} />
      </div>
    );
  if (!ranked.length)
    return (
      <div className="empty">
        Differs from KataGo in {fmtPct(report.positions ? report.disagreements / report.positions : 0)} of {copy.whose} {plural(report.positions, 'position')}, but none cost a point. Analyse more games.
      </div>
    );

  const marks: Mark[] = [];
  if (sel) {
    marks.push({ loc: sel.kata.loc, kind: 'best' });
    marks.push({ loc: sel.copy.loc, kind: 'doppel', label: 'D' });
    if (sel.played !== sel.copy.loc && sel.played !== sel.kata.loc && sel.played !== PASS) marks.push({ loc: sel.played, kind: 'played' });
  }
  const you = copy.owner === 'demo' ? copy.demoName ?? 'the player' : 'you';
  return (
    <div className="dop-stage">
      <div className="dop-board">
        {sel && game && board && (
          <>
            <Board size={game.size} stones={board.stones} lastMove={sel.index > 0 ? game.moves[sel.index - 1].loc : null} marks={marks} coords ariaLabel="Game position" />
            <div className="dop-board-legend dop-caption">
              <Legend />
            </div>
          </>
        )}
      </div>
      <div className="dop-side">
        {sel && game && (
          <div className="panel stack">
            <div className="spread">
              <div className="stack tight">
                <h3>
                  #{idx + 1} · Move {sel.index + 1} · {sel.color === 1 ? 'Black' : 'White'}
                </h3>
                <span className="tiny muted">
                  {gameTitle(game)}
                  {game.date ? ` · ${game.date}` : ''}
                </span>
              </div>
              <span className="chip bad">−{sel.cost!.scoreLoss.toFixed(1)} pts</span>
            </div>
            <p className="small">
              Copy <strong className="doppel">{locToGtp(sel.copy.loc, sel.size)}</strong> ({fmtPct(sel.copy.p)} for {you}) · KataGo{' '}
              <strong className="kata">{locToGtp(sel.kata.loc, sel.size)}</strong> ({fmtPct(sel.kata.p)})
            </p>
            <table className="data dop-table">
              <thead>
                <tr>
                  <th />
                  <th>Move</th>
                  <th title="Copy's probability">Likely</th>
                  <th title="KataGo policy">Policy</th>
                  <th title="Winrate and score after">After</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="kata">KataGo</td>
                  <td className="kata strong">{locToGtp(sel.kata.loc, sel.size)}</td>
                  <td className="mono">{fmtPct(sel.kata.p)}</td>
                  <td className="mono">{fmtPct(sel.kata.prior)}</td>
                  <td className="mono nowrap">{valueText(sel.kata.value)}</td>
                </tr>
                <tr>
                  <td className="doppel">Copy</td>
                  <td className="doppel strong">{locToGtp(sel.copy.loc, sel.size)}</td>
                  <td className="mono">{fmtPct(sel.copy.p)}</td>
                  <td className="mono">{fmtPct(sel.copy.prior)}</td>
                  <td className="mono nowrap">{valueText(sel.copy.value)}</td>
                </tr>
              </tbody>
            </table>
            <div className="small dim">
              Costs <strong className="bad">{sel.cost!.scoreLoss.toFixed(1)} pts</strong>
              {sel.cost!.winrateLoss >= 0.005 ? `, ${fmtPct(sel.cost!.winrateLoss, 1)} winrate` : ''}
              {sel.cost!.from === 'candidates' ? '' : ' (move played)'}
            </div>
            <DoppelLine predictions={sel.top} size={sel.size} who="Copy top 3" played={sel.played} />
            <div className="row wrap">
              <a className="btn small primary" href={href(`review/${sel.gameId}?move=${sel.index + 1}`)}>
                <Icon name="board" /> Review
              </a>
              <button
                className="btn small"
                onClick={() => {
                  startFromPosition(game, sel.index, other(sel.color), true);
                  go('doppel/play');
                }}
                title="Copy takes this side"
              >
                <Icon name="play" /> Play from here
              </button>
              <span className="grow" />
              <button className="btn small ghost" disabled={idx === 0} onClick={() => select(ranked[idx - 1])} title="Previous (↑)">
                ◀
              </button>
              <button className="btn small ghost" disabled={idx >= ranked.length - 1} onClick={() => select(ranked[idx + 1])} title="Next (↓)">
                ▶
              </button>
            </div>
          </div>
        )}
        <div className="panel stack">
          <div className="spread">
            <h3>Costliest habits</h3>
            <span className="chip">{ranked.length}</span>
          </div>
          <p className="tiny muted">Ranked by probability × points lost.</p>
          <div className="dop-list" ref={listRef} role="listbox" aria-label="Disagreements">
            {ranked.slice(0, shown).map((d, i) => (
              <button key={d.id} role="option" aria-selected={i === idx} className={`dop-row ${i === idx ? 'on' : ''}`} onClick={() => select(d)}>
                <span className="dop-row-n mono">{i + 1}</span>
                <span className="dop-row-main">
                  <span className="small">
                    <span className="kata">{locToGtp(d.kata.loc, d.size)}</span> vs <span className="doppel">{locToGtp(d.copy.loc, d.size)}</span>
                    <span className="muted"> · {fmtPct(d.copy.p)} likely</span>
                  </span>
                  <span className="tiny muted">
                    Move {d.index + 1} · {games.find((g) => g.id === d.gameId)?.date ?? ''}
                  </span>
                </span>
                <span className="dop-row-cost mono" title={`Expected cost ${habitCost(d).toFixed(2)} pts`}>
                  −{d.cost!.scoreLoss.toFixed(1)}
                </span>
              </button>
            ))}
          </div>
          {ranked.length > shown && (
            <button className="btn small ghost" style={{ justifySelf: 'start' }} onClick={() => setShown((n) => n + 25)}>
              More ({ranked.length - shown})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ play against the copy

interface PlaySetup {
  user: Color;
  from: 'empty' | 'game';
  size: number;
  gameId?: string;
  /** Moves of the game played before the starting position. */
  move: number;
  /** Komi for a game from an empty board (area scoring). */
  komi?: number;
}

interface PlayGame {
  id: number;
  size: number;
  komi: number;
  setup: Move[];
  /** Moves of the source game before the starting position. */
  prefix: Move[];
  /** Moves played in this game. */
  moves: Move[];
  start: Color;
  user: Color;
  /** How the copy plays this game (profile/dials.ts). */
  dials: CopyDials;
  /** Points each of the copy's moves lost (by ply), so it can tilt after a mistake like the player. */
  copyLoss: Record<number, number>;
  from?: { gameId: string; move: number };
  /** Whose copy plays: "me" or an imported player's id. */
  copyOf?: string;
  /** Set when a side resigns instead of the game ending by double pass. */
  resigned?: Color;
  /** The library id this game was saved as, once Save or "Review this game" has saved it. */
  savedId?: string;
  /** How many moves the saved copy has (later moves are unsaved). */
  savedAt?: number;
}

/** KataGo's quick read of one position, and what the copy makes of it. */
interface PositionRead {
  toPlay: Color;
  bWin: number;
  bLead: number;
  policy: PolicyEntry[];
  /** The copy's habits' probabilities for the side to move, likeliest first. */
  preds: DoppelPrediction[];
  /** KataGo's ownership (stored), kept for "not me" corrections. */
  ownership?: string;
  /** On the copy's turn: the moves it chooses among (with what each loses), and the state of its game. */
  cands?: CandInfo[];
  state?: ChoiceState;
}

/** Kept while the app is open, so a game survives switching tabs. */
const play: {
  setup: PlaySetup;
  game: PlayGame | null;
  reads: Map<string, PositionRead>;
  hints: boolean;
  autostart: boolean;
} = {
  setup: { user: 1, from: 'empty', size: 19, move: 0 },
  game: null,
  reads: new Map(),
  hints: false,
  autostart: false,
};

/** Whether a game against the copy shows the evaluation bar and the report tabs: off by
 * default, so the game is just the board. Persisted like a setting, not tied to one game. */
function readShowAnalysis() {
  try {
    return localStorage.getItem('dop.doppelAnalysis') === '1';
  } catch {
    return false;
  }
}
function writeShowAnalysis(v: boolean) {
  try {
    localStorage.setItem('dop.doppelAnalysis', v ? '1' : '0');
  } catch {
    /* private mode */
  }
}
let gameIds = 1;

const lineKey = (moves: Move[]) => moves.map((m) => `${m.color}${m.loc}`).join(',');
const readKey = (g: PlayGame, ply: number) => `${g.id}|${lineKey(g.moves.slice(0, ply))}`;
const colorAt = (g: PlayGame, ply: number): Color => (ply % 2 === 0 ? g.start : other(g.start));
const isOver = (g: PlayGame) => !!g.resigned || (g.moves.length >= 2 && g.moves[g.moves.length - 1].loc === PASS && g.moves[g.moves.length - 2].loc === PASS);

function newGame(s: PlaySetup, dials: CopyDials, source?: GameRecord): PlayGame {
  if (s.from === 'game' && source) {
    const n = Math.max(0, Math.min(source.moves.length, s.move));
    return {
      id: gameIds++,
      size: source.size,
      // As KataGo is given it (territory rules add half a point, see go/rules.ts).
      komi: engineKomi(source.komi, source.rules),
      setup: source.setup,
      prefix: source.moves.slice(0, n),
      moves: [],
      start: toPlayAt(source.setup, source.moves, n, source.handicap),
      user: s.user,
      dials,
      copyLoss: {},
      from: { gameId: source.id, move: n },
    };
  }
  return { id: gameIds++, size: s.size, komi: s.komi ?? 7.5, setup: [], prefix: [], moves: [], start: 1, user: s.user, dials, copyLoss: {} };
}

/** Set up a game from a position of the player's games (used by "Play from here"). */
function startFromPosition(g: GameRecord, move: number, user: Color, autostart: boolean) {
  play.setup = { ...play.setup, from: 'game', gameId: g.id, move, user };
  play.game = null;
  play.autostart = autostart;
}

async function readPosition(g: PlayGame, ply: number, model: DoppelModel, copyTurn = false): Promise<PositionRead> {
  // The PC's copy of the same network when it runs (nothing to compute here); this device's otherwise.
  const pc = pcSmallIfSame();
  if (pc) {
    try {
      return await readWith(pc, g, ply, model, copyTurn);
    } catch (e) {
      if (!(e instanceof PcGone)) throw e;
    }
  }
  markInteractive();
  const eng = getEngine() ?? (await startEngine());
  if (!eng) throw new Error('KataGo is not available');
  return readWith(eng, g, ply, model, copyTurn);
}

/** Moves the copy's habits must reach (times its favourite's probability) to be looked at. */
const CONSIDER = 0.03;
/** At most this many of the copy's own candidates are looked at. */
const CONSIDER_MAX = 8;

async function readWith(eng: EngineBackend, g: PlayGame, ply: number, model: DoppelModel, copyTurn: boolean): Promise<PositionRead> {
  markInteractive();
  const history = [...g.prefix, ...g.moves.slice(0, ply)];
  const board = replay(g.size, g.setup, history);
  const toPlay = colorAt(g, ply);
  const ev = await evaluateFast(eng, { size: g.size, komi: g.komi, setup: g.setup, history, toPlay, board });
  // The mood dial can make the copy play as it does when behind or ahead, whatever the score.
  const mood = copyTurn ? g.dials.mood : 'auto';
  const win = mood === 'behind' ? 0.15 : mood === 'ahead' ? 0.85 : moverView(ev.bWin, ev.bLead, toPlay).win;
  const pos = positionExample({ size: g.size, setup: g.setup, history, toPlay, policy: ev.policy, ownership: ev.ownership, board, win });
  const preds = pos ? predict(model, pos.example) : [];
  const read: PositionRead = { toPlay, bWin: ev.bWin, bLead: ev.bLead, policy: ev.policy, preds, ownership: ev.ownership };
  if (!copyTurn || !pos || !preds.length) return read;
  // The copy's turn: what each move it might play costs, by KataGo's look at the position after
  // it (its likelier candidates, KataGo's own first choices and the player's book moves).
  const top = preds[0].p;
  const book = g.dials.book > 0 ? bookMoves(model.book, board, toPlay, history.length, g.dials.book) : [];
  const locs = [
    ...new Set([
      ...preds.filter((p) => p.p >= top * CONSIDER).slice(0, CONSIDER_MAX).map((p) => p.loc),
      ...ev.policy.filter((e) => e.loc !== PASS).slice(0, 3).map((e) => e.loc),
      ...book.map((b) => b.loc),
    ]),
  ].filter((loc) => loc !== PASS && board.isLegal(loc, toPlay));
  const children = locs.map((loc) => {
    const after = board.clone();
    after.play(loc, toPlay);
    return { size: g.size, komi: g.komi, setup: g.setup, history: [...history, { color: toPlay, loc }], toPlay: other(toPlay), board: after };
  });
  markInteractive();
  const evs = await evaluateFastMany(eng, children);
  const leads = new Map(locs.map((loc, i) => [loc, toPlay === 1 ? evs[i].bLead : -evs[i].bLead]));
  const bestLead = Math.max(...leads.values());
  let best = locs[0];
  for (const [loc, lead] of leads) if (lead === bestLead) best = loc;
  const all = [...new Set([...preds.map((p) => p.loc), ...book.map((b) => b.loc)])].filter((loc) => loc !== PASS);
  const info = describeCandidates(pos.ctx, all, toPlay, pos.lastOpp, history.length, moverView(ev.bWin, ev.bLead, toPlay).lead, best);
  read.cands = all.map((loc, i) => {
    const lead = leads.get(loc);
    const b = book.find((x) => x.loc === loc);
    return {
      loc,
      p: preds.find((x) => x.loc === loc)?.p ?? 0,
      prior: ev.policy.find((e) => e.loc === loc)?.p ?? 0,
      ...(lead !== undefined ? { loss: Math.max(0, bestLead - lead) } : {}),
      flags: info[i].flags,
      sigs: info[i].sigs,
      ...(b ? { book: b.n } : {}),
    };
  });
  const lastCopyPly = ply - 2;
  read.state = { phase: pos.example.phase ?? 1, sit: pos.example.sit ?? 1, afterMistake: (g.copyLoss[lastCopyPly] ?? 0) >= TILT_LOSS };
  return read;
}

/**
 * The copy's move: drawn from its choice (habits, what each move costs, the player's mistake
 * profile, book and dials); a pass when KataGo thinks the game is over or offers nothing.
 */
function chooseReply(read: PositionRead, g: PlayGame, model: DoppelModel): { loc: Loc; loss?: number } {
  const passP = read.policy.find((e) => e.loc === PASS)?.p ?? 0;
  if (passP >= 0.5) return { loc: PASS };
  const d = g.dials;
  if (read.cands?.length && read.state) {
    const budget = d.strength !== null ? lossBudget(d.strength, useLevel.getState().calibration) : undefined;
    const dist = choiceDistribution(read.cands, read.state, model, d, budget !== undefined ? { budget } : {});
    const c = read.cands[drawFrom(dist)];
    if (c) return { loc: c.loc, loss: c.loss };
  }
  const pick = d.variety > 0 ? sampleMove(read.preds) : read.preds[0] ?? null;
  if (pick) return { loc: pick.loc };
  return { loc: read.policy.find((e) => e.loc !== PASS)?.loc ?? PASS };
}

function PlayCopy({ copy, model, opponent }: { copy: CopyInfo; model: DoppelModel; opponent?: OpponentProfile }) {
  const games = useStore((s) => s.games);
  useLevel((s) => s.calibration);
  useEffect(() => void loadLevel(), []);
  const engine = useStore((s) => s.engine);
  const dials = useCopyLab((s) => s.dials);
  useEffect(() => void loadCopyLab(), []);
  const [setup, setSetupState] = useState<PlaySetup>(play.setup);
  const copyOf = opponent?.id ?? 'me';
  const [game, setGameState] = useState<PlayGame | null>((play.game?.copyOf ?? 'me') === copyOf ? play.game : null);
  const [hints, setHintsState] = useState(play.hints);
  // Winrates, the report tabs and the copy-vs-KataGo comparisons stay out of sight while
  // you play, until you switch them on (remembered in this browser).
  const [showAnalysis, setShowAnalysisState] = useState(readShowAnalysis);
  const [tab, setTab] = useState<string | null>('data');
  const [notice, setNotice] = useState<null | 'leave' | 'resign' | 'save'>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // A move to look back at (null: the game as it stands).
  const [viewPly, setViewPly] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const reads = play.reads;
  const gameRef = useRef(game);
  gameRef.current = game;
  const [saving, setSaving] = useState(false);
  // The copy's dials during a game, and "not me": the ply of the copy's move being corrected.
  const [dialsOpen, setDialsOpen] = useState(false);
  const [fixing, setFixing] = useState<number | null>(null);

  const setSetup = (s: PlaySetup) => {
    play.setup = s;
    setSetupState(s);
  };
  const setGame = useCallback((f: (g: PlayGame | null) => PlayGame | null) => {
    setGameState((g) => {
      const next = f(g);
      play.game = next;
      return next;
    });
  }, []);
  const setHints = (v: boolean) => {
    play.hints = v;
    setHintsState(v);
  };
  const setShowAnalysis = (v: boolean) => {
    setShowAnalysisState(v);
    writeShowAnalysis(v);
  };

  // Someone else's copy (the demo player's or an imported player's) is named rather than "your copy".
  const demoMode = copy.owner === 'demo' || !!opponent;
  const whoLabel = demoMode ? copy.who : 'Your copy';
  /** The person copied, in sentences ("you", or their name). */
  const playerName = opponent?.name ?? (demoMode ? copy.demoName ?? 'the player' : 'you');
  const sources = useMemo(
    () => (opponent ? games.filter((g) => opponent.gameIds.includes(g.id)) : games.filter((g) => isPlayerGame(g) && (copy.owner === 'demo' ? g.source === 'demo' : g.source === 'user'))),
    [games, copy.owner, opponent],
  );
  const source = sources.find((g) => g.id === setup.gameId) ?? sources[0];

  const start = useCallback(() => {
    const s = play.setup;
    const src = sources.find((g) => g.id === s.gameId) ?? sources[0];
    if (play.reads.size > 400) play.reads.clear();
    setError(null);
    setGame(() => ({ ...newGame(s, useCopyLab.getState().dials, src), copyOf }));
  }, [sources, setGame, copyOf]);

  // "Play from here" asks for a game to start right away.
  useEffect(() => {
    if (play.autostart) {
      play.autostart = false;
      start();
    }
  }, [start]);

  // Read every position once; on the copy's turn, answer.
  useEffect(() => {
    if (!game) return;
    const ply = game.moves.length;
    const key = readKey(game, ply);
    const over = isOver(game);
    const copyTurn = !over && colorAt(game, ply) !== game.user;
    if (reads.has(key) && !copyTurn) return;
    let cancelled = false;
    (async () => {
      const t0 = performance.now();
      try {
        setError(null);
        let read = reads.get(key);
        if (!read) {
          read = await readPosition(game, ply, model, copyTurn);
          reads.set(key, read);
          setTick((t) => t + 1);
        }
        if (cancelled || !copyTurn) return;
        // A moment to "think", so the reply does not land on the same frame as your move.
        const wait = 550 - (performance.now() - t0);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (cancelled) return;
        const { loc, loss } = chooseReply(read, game, model);
        setGame((g) =>
          g && g.id === game.id && readKey(g, g.moves.length) === key
            ? { ...g, moves: [...g.moves, { color: colorAt(g, ply), loc }], copyLoss: loss !== undefined ? { ...g.copyLoss, [ply]: loss } : g.copyLoss }
            : g,
        );
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [game, model, retry, reads, setGame]);

  // ---------------------------------------------------------------- setup screen
  if (!game) {
    const preview = setup.from === 'game' && source ? replay(source.size, source.setup, source.moves, Math.min(setup.move, source.moves.length)) : null;
    const size = preview ? source!.size : setup.size;
    const unavailable = engine.status === 'error' || engine.status === 'unsupported';
    return (
      <BoardScreen
        className="dop-screen"
        title={`Play ${demoMode ? copy.who : 'your copy'}`}
        sub={opponent ? 'Opponent' : 'Doppelgänger'}
        homeHref={opponent ? href(`opponents/${opponent.id}`) : undefined}
        homeLabel={opponent ? 'Back' : undefined}
        players={<PlayersBar black={setup.user === 1 ? 'You' : whoLabel} white={setup.user === 1 ? whoLabel : 'You'} />}
        board={<Board size={size} stones={preview ? preview.stones : new Int8Array(size * size)} lastMove={preview && setup.move > 0 ? source!.moves[setup.move - 1]?.loc : null} coords ariaLabel="Starting position" />}
        tools={[
          { id: 'settings', label: 'Copy', icon: 'twin', on: settingsOpen, onClick: () => setSettingsOpen(!settingsOpen) },
          { id: 'analysis', label: 'Analysis', icon: 'trend', on: showAnalysis, onClick: () => setShowAnalysis(!showAnalysis), title: 'Winrates and reports' },
          { id: 'hints', label: 'Hints', icon: 'eye', on: hints, onClick: () => setHints(!hints), title: 'Your predicted move' },
        ]}
        panel={
          settingsOpen ? (
            <DopSettings copy={copy} />
          ) : (
            <>
              <div className="stack tight">
                <span className="field-label">You play</span>
                <div className="segmented dop-seg">
                  {([1, 2] as Color[]).map((c) => (
                    <button key={c} className={setup.user === c ? 'on' : ''} onClick={() => setSetup({ ...setup, user: c })}>
                      <strong>
                        <i className={`stone-dot ${c === 1 ? 'b' : 'w'}`} /> {c === 1 ? 'Black' : 'White'}
                      </strong>
                      <span>vs {c === 1 ? 'White' : 'Black'}</span>
                    </button>
                  ))}
                </div>
              </div>
              {unavailable ? (
                <div className="callout bad small">
                  KataGo failed to start, so the copy cannot play. See <a href={href('settings')}>Settings</a>.
                </div>
              ) : (
                <button className="btn primary dop-start" onClick={start}>
                  <Icon name="play" /> Start
                </button>
              )}
              {!unavailable && engine.status !== 'ready' && <p className="tiny muted">KataGo loads on start.</p>}
              <SheetSection title="Setup">
                <ToggleTile on={setup.from === 'empty'} onChange={() => setSetup({ ...setup, from: 'empty' })} icon="◻" label="Empty board" sub="Black moves first" />
                <ToggleTile
                  on={setup.from === 'game'}
                  onChange={() => sources.length && setSetup({ ...setup, from: 'game', gameId: source?.id, move: setup.move || Math.min(60, source?.moves.length ?? 0) })}
                  icon="◧"
                  label={demoMode ? 'From a game' : 'From your game'}
                  sub={sources.length ? 'Any position' : 'No games yet'}
                />
                {setup.from === 'empty' ? (
                  <>
                    <FieldTile label="Board">
                      <select aria-label="Board size" value={setup.size} onChange={(e) => setSetup({ ...setup, size: Number(e.target.value) })}>
                        <option value={19}>19×19</option>
                        <option value={13}>13×13</option>
                        <option value={9}>9×9</option>
                      </select>
                    </FieldTile>
                    <FieldTile label="Scoring">
                      <KomiPicker komi={setup.komi ?? 7.5} onKomi={(komi) => setSetup({ ...setup, komi })} />
                    </FieldTile>
                  </>
                ) : (
                  source && (
                    <>
                      <FieldTile label="Game">
                        <select value={source.id} onChange={(e) => setSetup({ ...setup, gameId: e.target.value, move: Math.min(setup.move, games.find((g) => g.id === e.target.value)?.moves.length ?? 0) })} aria-label="Game">
                          {sources.map((g) => (
                            <option key={g.id} value={g.id}>
                              {gameTitle(g)} {g.date ?? ''}
                            </option>
                          ))}
                        </select>
                      </FieldTile>
                      <FieldTile label={`After move ${setup.move} of ${source.moves.length} · ${toPlayAt(source.setup, source.moves, setup.move, source.handicap) === 1 ? 'Black' : 'White'} to play`}>
                        <input type="range" min={0} max={source.moves.length} value={Math.min(setup.move, source.moves.length)} onChange={(e) => setSetup({ ...setup, move: Number(e.target.value) })} aria-label="Starting move" />
                      </FieldTile>
                    </>
                  )
                )}
              </SheetSection>
              <CopyDialsPanel dials={dials} onChange={(d) => void setCopyDials(d)} who={playerName} />
            </>
          )
        }
      />
    );
  }

  // ---------------------------------------------------------------- the game
  const history = [...game.prefix, ...game.moves];
  const board = replay(game.size, game.setup, history);
  const ply = game.moves.length;
  const toPlay = colorAt(game, ply);
  const over = isOver(game);
  const yourTurn = !over && toPlay === game.user;
  const current = reads.get(readKey(game, ply));
  const last = history.length ? history[history.length - 1].loc : null;
  const lastCopy = [...game.moves.keys()].reverse().find((i) => game.moves[i].color !== game.user);
  const lastUser = [...game.moves.keys()].reverse().find((i) => game.moves[i].color === game.user);
  const copyRead = lastCopy !== undefined ? reads.get(readKey(game, lastCopy)) : undefined;
  const userRead = lastUser !== undefined ? reads.get(readKey(game, lastUser)) : undefined;
  const size = game.size;
  const loadingEngine = engine.status === 'loading' || engine.status === 'detecting';
  const whoName = demoMode ? copy.who : 'Your copy';
  const thinking = !error && !over && (!yourTurn || !current);

  // Looking back at an earlier move: the board shows it, and no move can be played.
  const viewing = viewPly !== null && viewPly < ply ? viewPly : null;
  const fixPly = fixing !== null && fixing < ply && game.moves[fixing]?.color !== game.user ? fixing : null;
  const lookAt = fixPly ?? viewing;
  const shownBoard = lookAt === null ? board : replay(game.size, game.setup, [...game.prefix, ...game.moves.slice(0, lookAt)]);
  const shownLast = lookAt === null ? last : lookAt > 0 ? game.moves[lookAt - 1].loc : game.prefix.length ? game.prefix[game.prefix.length - 1].loc : null;
  const shownRead = viewing === null ? current : reads.get(readKey(game, viewing));
  const shownPly = viewing ?? ply;
  const prevRead = shownPly > 0 ? reads.get(readKey(game, shownPly - 1)) : undefined;

  const marks: Mark[] = [];
  let caption = '';
  if (fixPly !== null) {
    const mv = game.moves[fixPly].loc;
    if (mv !== PASS) marks.push({ loc: mv, kind: 'doppel', label: '✕' });
  } else if (viewing !== null) {
    // An earlier position: just the stones.
  } else if (yourTurn && hints && current) {
    const kata = current.policy.find((e) => e.loc !== PASS);
    const guess = current.preds.find((e) => e.loc !== PASS);
    if (guess) marks.push({ loc: guess.loc, kind: 'doppel', label: String(Math.round(guess.p * 100)) });
    if (kata && kata.loc !== guess?.loc) marks.push({ loc: kata.loc, kind: 'best', label: String(Math.round(kata.p * 100)) });
    caption =
      guess && kata && guess.loc === kata.loc
        ? `Copy and KataGo agree: ${locToGtp(guess.loc, size)} (${fmtPct(guess.p)})`
        : `Purple: your predicted move. Teal: KataGo.`;
  } else if (showAnalysis && lastCopy !== undefined && lastCopy === ply - 1 && copyRead) {
    const mv = game.moves[lastCopy].loc;
    const kata = copyRead.policy.find((e) => e.loc !== PASS);
    if (mv !== PASS) marks.push({ loc: mv, kind: 'doppel' });
    if (kata && kata.loc !== mv) marks.push({ loc: kata.loc, kind: 'best', label: 'K' });
    if (kata && mv !== PASS) caption = kata.loc === mv ? 'Same as KataGo.' : 'Purple: copy. K: KataGo.';
  }

  /** "Not me": the copy's move at `fixPly` is not what the player would play (`mine`: what they would). */
  const recordFix = async (mine: Loc | null) => {
    if (fixPly === null) return;
    const r = reads.get(readKey(game, fixPly));
    const at = colorAt(game, fixPly);
    if (!r) return;
    if (mine !== null && (mine === game.moves[fixPly].loc || !shownBoard.isLegal(mine, at))) return;
    setFixing(null);
    await addCopyFeedback({
      copyOf,
      size: game.size,
      setup: game.setup,
      history: [...game.prefix, ...game.moves.slice(0, fixPly)],
      toPlay: at,
      policy: r.policy.slice(0, 24),
      ownership: r.ownership,
      win: moverView(r.bWin, r.bLead, at).win,
      copyLoc: game.moves[fixPly].loc,
      mine,
    });
    const n = pendingFeedback(copyOf, opponent ? opponent.copy : model);
    toast(`Noted. ${demoMode ? 'The copy' : 'Your copy'} learns from ${n === 1 ? 'it' : `these ${n}`} when it next retrains.`, 'ok');
  };
  const onPlay = (loc: Loc) => {
    if (fixPly !== null) return void recordFix(loc);
    if (!yourTurn || viewing !== null) return;
    if (loc !== PASS && !board.isLegal(loc, game.user)) return;
    setGame((g) => (g && g.id === game.id && g.moves.length === ply ? { ...g, moves: [...g.moves, { color: game.user, loc }] } : g));
  };
  const undo = () => {
    if (lastUser === undefined) return;
    setViewPly(null);
    setGame((g) => (g && g.id === game.id ? { ...g, moves: g.moves.slice(0, lastUser) } : g));
  };
  const resign = () => {
    if (over) return;
    setGame((g) => (g && g.id === game.id ? { ...g, resigned: g.user } : g));
  };
  /** Keeps the game in the library (once a game, at the moves played so far); returns its id. */
  const saveGame = async () => {
    if (game.savedId && game.savedAt === game.moves.length) return game.savedId;
    const you = 'You';
    const black = game.user === 1 ? you : whoName;
    const white = game.user === 1 ? whoName : you;
    const result = game.resigned ? `${game.resigned === 1 ? 'W' : 'B'}+R` : over && current ? `${current.bLead >= 0 ? 'B' : 'W'}+${Math.abs(current.bLead).toFixed(1)}` : undefined;
    const id = await saveDoppelGame({ replaces: game.savedId, size: game.size, komi: game.komi, setup: game.setup, moves: history, user: game.user, black, white, result });
    const at = game.moves.length;
    setGame((g) => (g && g.id === game.id ? { ...g, savedId: id, savedAt: at } : g));
    return id;
  };
  const reviewGame = async () => {
    if (saving) return;
    setSaving(true);
    try {
      go(`review/${await saveGame()}`);
    } finally {
      setSaving(false);
    }
  };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveGame();
      toast('Saved to library', 'ok');
    } finally {
      setSaving(false);
    }
  };
  const home = opponent ? `opponents/${opponent.id}` : 'dashboard';
  const saved = !!game.savedId && game.savedAt === game.moves.length;
  const unsaved = game.moves.length > 0 && !saved;

  // How the game has gone: the copy's replies against KataGo, and the player's moves against the copy.
  let replies = 0,
    kataReplies = 0,
    guessed = 0,
    userMoves = 0;
  game.moves.forEach((m, i) => {
    const r = reads.get(readKey(game, i));
    if (!r || m.loc === PASS) return;
    if (m.color === game.user) {
      userMoves++;
      if (r.preds[0]?.loc === m.loc) guessed++;
    } else {
      replies++;
      if (r.policy.find((e) => e.loc !== PASS)?.loc === m.loc) kataReplies++;
    }
  });
  const black = game.user === 1 ? 'You' : whoName;
  const white = game.user === 1 ? whoName : 'You';
  const values: (PosValue | null)[] = Array.from({ length: ply + 1 }, (_, i) => {
    const r = reads.get(readKey(game, i));
    return r ? { bWin: r.bWin, bLead: r.bLead, best: r.policy.find((e) => e.loc !== PASS)?.loc ?? null } : null;
  });
  const goPly = (p: number) => setViewPly(p >= ply ? null : Math.max(0, p));
  const report = { values, moves: game.moves, size, black, white, cursor: viewing ?? ply, onPick: goPly };

  const status = error ? (
    <span className="bad">
      {/not available/.test(error) ? 'KataGo unavailable. ' : `KataGo stopped: ${error}. `}
      <button className="btn small" onClick={() => setRetry((r) => r + 1)}>
        Retry
      </button>{' '}
      <a href={href('settings')}>Settings</a>
    </span>
  ) : loadingEngine ? (
    engine.progress?.stage === 'download' ? (
      `Loading KataGo… ${engine.progress.total ? Math.round((engine.progress.loaded / engine.progress.total) * 100) + '%' : Math.round(engine.progress.loaded / 1e6) + ' MB'}`
    ) : (
      'Starting KataGo…'
    )
  ) : over ? (
    game.resigned ? (
      <>{game.resigned === game.user ? 'You resigned.' : `${whoName} resigned.`}</>
    ) : (
      <>
        Game over.{' '}
        {current && (
          <>
            Est. <strong>{current.bLead >= 0 ? 'B' : 'W'}+{Math.abs(current.bLead).toFixed(1)}</strong>.
          </>
        )}
      </>
    )
  ) : viewing !== null ? (
    <>Move {game.prefix.length + viewing}. Go to end to play.</>
  ) : yourTurn ? (
    <>Your move ({game.user === 1 ? 'Black' : 'White'})</>
  ) : (
    <>{whoName} thinking…</>
  );

  const playing = (
    <>
      <div className="small dim dop-status">
        <span className="live-dot" data-on={thinking || loadingEngine ? '1' : '0'} /> {status}
      </div>
      {caption && fixPly === null && <div className="small dop-caption">{caption}</div>}
      {fixPly !== null ? (
        <div className="callout small stack tight dop-notme">
          <span>
            Where would {playerName} have played instead of <strong className="doppel">{locToGtp(game.moves[fixPly].loc, size)}</strong>? Tap the board.
          </span>
          <div className="row">
            <button className="btn small" onClick={() => void recordFix(null)}>
              Just not that
            </button>
            <button className="btn small ghost" onClick={() => setFixing(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        !over &&
        viewing === null &&
        lastCopy !== undefined &&
        lastCopy >= ply - 2 &&
        game.moves[lastCopy].loc !== PASS && (
          <div className="small dim dop-notme row">
            <span>
              {whoName} played <strong className="doppel">{locToGtp(game.moves[lastCopy].loc, size)}</strong>
              {showAnalysis && game.copyLoss[lastCopy] !== undefined && <span className="muted"> · −{game.copyLoss[lastCopy].toFixed(1)} pts</span>}
            </span>
            <button className="btn small ghost" onClick={() => setFixing(lastCopy)} title={`Not what ${playerName} would play: the copy learns from it`}>
              Not me
            </button>
          </div>
        )
      )}
      {over && (
        <button className="btn primary" onClick={() => void reviewGame()} disabled={saving}>
          <Icon name="board" /> {saving ? 'Saving…' : 'Review'}
        </button>
      )}
    </>
  );
  let panel: ReactNode = playing;
  if (dialsOpen)
    panel = (
      <>
        {playing}
        <CopyDialsPanel
          dials={game.dials}
          onChange={(d) => {
            setGame((g) => (g && g.id === game.id ? { ...g, dials: d } : g));
            void setCopyDials(d);
          }}
          who={playerName}
        />
      </>
    );
  else if (showAnalysis && tab === 'data')
    panel = (
      <>
        {playing}
        {lastCopy !== undefined && (
          <div className="stack">
            <h3>Last reply</h3>
            {copyRead ? <ReplyCompare read={copyRead} played={game.moves[lastCopy].loc} size={size} who={whoName} /> : <p className="small muted">…</p>}
          </div>
        )}
        {lastUser !== undefined && game.moves[lastUser].loc !== PASS && (
          <div className="stack">
            <h3>Your move</h3>
            {userRead ? (
              <>
                <DoppelLine predictions={userRead.preds.slice(0, 3)} size={size} who="Expected" played={game.moves[lastUser].loc} />
                <div className="small dim">
                  KataGo: <span className="kata">{locToGtp(userRead.policy.find((e) => e.loc !== PASS)?.loc ?? PASS, size)}</span>
                </div>
              </>
            ) : (
              <p className="small muted">Reading…</p>
            )}
          </div>
        )}
      </>
    );
  else if (showAnalysis && tab === 'trend') panel = <TrendPanel {...report} />;
  else if (showAnalysis && tab === 'blunder') panel = <BlunderPanel {...report} />;
  else if (showAnalysis && tab === 'skill') panel = <SkillPanel size={size} komi={game.komi} setup={game.setup} moves={history} black={black} white={white} />;
  else if (showAnalysis && tab === 'performance')
    panel = (
      <>
        <PerformancePanel {...report} />
        {(replies > 0 || userMoves > 0) && (
          <dl className="kv">
            {replies > 0 && (
              <>
                <dt>Copy</dt>
                <dd>
                  matched KataGo {kataReplies}/{replies}
                </dd>
              </>
            )}
            {userMoves > 0 && (
              <>
                <dt>You</dt>
                <dd>
                  matched the copy {guessed}/{userMoves}
                </dd>
              </>
            )}
          </dl>
        )}
      </>
    );

  const tools: ScreenTool[] = [
    { id: 'undo', label: 'Undo', icon: 'back', onClick: undo, disabled: lastUser === undefined, title: 'Undo your last move' },
    { id: 'pass', label: 'Pass', icon: 'pass', onClick: () => onPlay(PASS), disabled: !yourTurn || viewing !== null },
    over ? { id: 'new', label: 'New game', icon: 'plus', onClick: () => setGame(() => null) } : { id: 'resign', label: 'Resign', icon: 'close', onClick: () => setNotice('resign') },
    { id: 'hints', label: 'Hints', icon: 'eye', on: hints, onClick: () => setHints(!hints), title: 'Your predicted move' },
    { id: 'dials', label: 'Copy', icon: 'twin', on: dialsOpen, onClick: () => setDialsOpen(!dialsOpen), title: 'How the copy plays' },
    { id: 'analysis', label: 'Analysis', icon: 'trend', on: showAnalysis, onClick: () => setShowAnalysis(!showAnalysis), title: 'Eval bar and report tabs' },
  ];

  return (
    <BoardScreen
      className="dop-screen"
      title={demoMode ? copy.who : 'Your copy'}
      sub={`${game.size}×${game.size} · komi ${game.komi} · ${dialsLabel(game.dials)}`}
      homeHref={href(home)}
      homeLabel={opponent ? 'Back' : 'Home'}
      onHome={unsaved && !over ? () => setNotice('leave') : undefined}
      head={<HeadButton icon="save" label={saved ? 'Saved' : 'Save'} onClick={() => (saved ? toast('Already saved', 'info') : setNotice('save'))} disabled={saving || !game.moves.length} title="Save to library" />}
      players={
        <PlayersBar
          black={black}
          white={white}
          black2={!over && toPlay === 1 ? (yourTurn ? 'your move' : 'thinking…') : undefined}
          white2={!over && toPlay === 2 ? (yourTurn ? 'your move' : 'thinking…') : undefined}
          captures={shownBoard.captures}
          showEval={showAnalysis}
          bWin={shownRead?.bWin ?? null}
          bLead={shownRead?.bLead ?? null}
          pending={!shownRead}
          before={shownPly > 0 && prevRead ? { mover: game.moves[shownPly - 1].color, bWin: prevRead.bWin, bLead: prevRead.bLead } : null}
        />
      }
      board={
        <Board
          size={size}
          stones={shownBoard.stones}
          lastMove={shownLast}
          toPlay={fixPly !== null ? colorAt(game, fixPly) : yourTurn && viewing === null ? game.user : undefined}
          onPlay={fixPly !== null || (yourTurn && viewing === null) ? onPlay : undefined}
          marks={marks}
          coords
          ariaLabel="Game board"
        />
      }
      steps={{ pos: viewing ?? ply, total: ply, onGo: goPly }}
      tabs={showAnalysis ? REPORT_TABS : null}
      tab={tab}
      onTab={setTab}
      panel={panel}
      tools={tools}
      notice={
        notice === 'resign' ? (
          <Notice
            title="Resign?"
            onClose={() => setNotice(null)}
            actions={
              <>
                <button className="btn ghost" onClick={() => setNotice(null)}>
                  Keep playing
                </button>
                <button className="btn primary" onClick={() => (setNotice(null), resign())}>
                  Resign
                </button>
              </>
            }
          />
        ) : notice === 'save' ? (
          <Notice
            title="Save game?"
            onClose={() => setNotice(null)}
            actions={
              <>
                <button className="btn ghost" onClick={() => setNotice(null)}>
                  Cancel
                </button>
                <button className="btn primary" onClick={() => (setNotice(null), void save())}>
                  Save
                </button>
              </>
            }
          >
            <span>
              Saves {history.length} moves to your library. Saving again updates it.
            </span>
          </Notice>
        ) : notice === 'leave' ? (
          <Notice
            title="Leave unsaved?"
            onClose={() => setNotice(null)}
            actions={
              <>
                <button className="btn ghost" onClick={() => setNotice(null)}>
                  Stay
                </button>
                <button className="btn" onClick={() => (setGame(() => null), go(home))}>
                  Leave
                </button>
                <button className="btn primary" onClick={() => void saveGame().then(() => go(home))}>
                  Save &amp; leave
                </button>
              </>
            }
          >
            <span>{game.savedId ? 'Recent moves are unsaved.' : 'This game is unsaved.'}</span>
          </Notice>
        ) : null
      }
    />
  );
}

const MOODS: { id: Mood; label: string }[] = [
  { id: 'auto', label: 'As the game goes' },
  { id: 'calm', label: 'Calm (never tilts)' },
  { id: 'tilted', label: 'Tilted' },
  { id: 'behind', label: 'As when behind' },
  { id: 'ahead', label: 'As when ahead' },
];

function dialsLabel(d: CopyDials) {
  const preset = d.preset === 'custom' ? 'custom' : PRESETS.find((p) => p.id === d.preset)?.label ?? 'Me';
  const level = d.strength !== null ? ` · ${d.strength === FULL_STRENGTH ? 'full strength' : `~${rankLabel(d.strength)}`}` : '';
  return preset + level;
}

const times = (v: number) => (v === 0 ? 'none' : `${v.toFixed(2).replace(/\.?0+$/, '')}×`);
const lean = (v: number, lo: string, hi: string) => (Math.abs(v) < 0.05 ? 'as you' : `${v < 0 ? lo : hi} ${Math.round(Math.abs(v) * 100)}%`);

/** How the copy plays: presets for the usual moods, and every dial behind them. */
function CopyDialsPanel({ dials, onChange, who }: { dials: CopyDials; onChange: (d: CopyDials) => void; who: string }) {
  const [more, setMore] = useState(dials.preset === 'custom');
  const set = (patch: Partial<CopyDials>) => onChange({ ...dials, ...patch, preset: 'custom' });
  const range = (key: 'mistakes' | 'variety' | 'faithfulness' | 'fighting' | 'territory' | 'tenuki', min: number, max: number, label: string) => (
    <FieldTile label={label}>
      <input type="range" min={min} max={max} step={0.05} value={dials[key]} onChange={(e) => set({ [key]: Number(e.target.value) })} aria-label={label} />
    </FieldTile>
  );
  return (
    <>
      <SheetSection title="Copy">
        {PRESETS.map((p) => (
          <ToggleTile key={p.id} on={dials.preset === p.id} onChange={() => onChange(presetDials(p.id, dials))} label={p.label} sub={p.sub} />
        ))}
        <FieldTile label="Strength">
          <select value={dials.strength === null ? 'natural' : String(dials.strength)} onChange={(e) => onChange({ ...dials, strength: e.target.value === 'natural' ? null : Number(e.target.value) })} aria-label="Strength">
            <option value="natural">Natural ({who})</option>
            {STRENGTHS.map((r) => (
              <option key={r} value={r}>
                {r === FULL_STRENGTH ? 'Full strength' : `~${rankLabel(r)}`}
              </option>
            ))}
          </select>
          {dials.strength !== null && (
            <span className="tiny muted">
              Same style, ~{lossBudget(dials.strength, useLevel.getState().calibration).toFixed(1)} pts lost per move ({dials.strength === FULL_STRENGTH ? 'top player' : rankLabel(dials.strength)}).
            </span>
          )}
        </FieldTile>
        <ToggleTile on={more} onChange={setMore} icon="⚙" label="All dials" sub={dials.preset === 'custom' ? 'Custom' : 'Fine-tune'} />
      </SheetSection>
      {more && (
        <SheetSection title="Dials">
          {range('mistakes', 0, 2, `Mistakes: ${times(dials.mistakes)} ${who === 'you' ? 'yours' : 'theirs'}`)}
          <FieldTile label="Biggest mistake">
            <select value={dials.maxMistake} onChange={(e) => set({ maxMistake: Number(e.target.value) })} aria-label="Biggest mistake">
              <option value={0}>No limit</option>
              {[2, 3, 5, 8, 12].map((v) => (
                <option key={v} value={v}>
                  {v} points
                </option>
              ))}
            </select>
          </FieldTile>
          {range('variety', 0, 2, `Variety: ${dials.variety === 0 ? 'always its first choice' : times(dials.variety)}`)}
          {range('faithfulness', 0, 1, `Style: ${Math.round(dials.faithfulness * 100)}% ${who === 'you' ? 'you' : 'them'}, ${Math.round((1 - dials.faithfulness) * 100)}% KataGo`)}
          {range('fighting', -1, 1, `Fighting: ${lean(dials.fighting, 'calmer', 'fiercer')}`)}
          {range('territory', -1, 1, `Territory: ${lean(dials.territory, 'more influence', 'more territory')}`)}
          {range('tenuki', -1, 1, `Tenuki: ${lean(dials.tenuki, 'stays local', 'plays away')}`)}
          <FieldTile label="Mood">
            <select value={dials.mood} onChange={(e) => set({ mood: e.target.value as Mood })} aria-label="Mood">
              {MOODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </FieldTile>
          <FieldTile label="Own opening book">
            <select value={dials.book} onChange={(e) => set({ book: Number(e.target.value) })} aria-label="Opening book">
              <option value={0}>Off</option>
              {[20, 40, 60, 80, 120].map((v) => (
                <option key={v} value={v}>
                  First {v} moves
                </option>
              ))}
            </select>
          </FieldTile>
          <ToggleTile on={dials.guard} onChange={(v) => set({ guard: v })} icon="🛡" label="Blunder guard" sub="No self-atari, no ignoring a big atari" />
          <ToggleTile on={dials.types} onChange={(v) => set({ types: v })} icon="≈" label={`${who === 'you' ? 'Your' : 'Their'} kinds of mistakes`} sub="Not random ones" />
          <ActionTile onClick={() => onChange({ ...DEFAULT_DIALS, strength: dials.strength })} icon="↺" label="Reset" sub="As measured" />
        </SheetSection>
      )}
    </>
  );
}

/** The copy's reply next to KataGo's choice: the candidates with both sets of probabilities. */
function ReplyCompare({ read, played, size, who }: { read: PositionRead; played: Loc; size: number; who: string }) {
  if (played === PASS) return <p className="small">{who} passed{read.policy[0]?.loc === PASS ? ' (same as KataGo)' : ''}</p>;
  const kata = read.policy.find((e) => e.loc !== PASS);
  const chosen = read.cands?.find((c) => c.loc === played);
  const rank = read.preds.findIndex((p) => p.loc === played);
  const p = read.preds[rank]?.p;
  const rows = read.preds.slice(0, 5);
  if (kata && !rows.some((r) => r.loc === kata.loc)) rows.push({ loc: kata.loc, p: read.preds.find((x) => x.loc === kata.loc)?.p ?? 0 });
  const max = Math.max(...rows.map((r) => Math.max(r.p, read.policy.find((e) => e.loc === r.loc)?.p ?? 0)), 0.01);
  return (
    <>
      <div className="dop-reply">
        <div>
          <span className="tiny muted">{who} played</span>
          <strong className="doppel dop-big">{locToGtp(played, size)}</strong>
          <span className="tiny dim">
            {chosen?.book ? 'from the opening book' : p !== undefined ? `#${rank + 1} · ${fmtPct(p)}` : 'KataGo move'}
            {chosen?.loss !== undefined && ` · −${chosen.loss.toFixed(1)} pts`}
          </span>
        </div>
        <div>
          <span className="tiny muted">KataGo</span>
          <strong className="kata dop-big">{kata ? locToGtp(kata.loc, size) : 'pass'}</strong>
          <span className="tiny dim">{kata ? (kata.loc === played ? 'same' : `policy ${fmtPct(kata.p)}`) : ''}</span>
        </div>
      </div>
      <table className="data dop-cands">
        <thead>
          <tr>
            <th>Move</th>
            <th className="doppel">Copy</th>
            <th className="kata">KataGo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = read.policy.find((e) => e.loc === r.loc)?.p ?? 0;
            return (
              <tr key={r.loc} className={r.loc === played ? 'selected' : ''}>
                <td className={`mono ${r.loc === played ? 'doppel strong' : r.loc === kata?.loc ? 'kata strong' : ''}`}>{locToGtp(r.loc, size)}</td>
                <td>
                  <div className="dop-cell">
                    <div className="bar dop-bar-copy">
                      <span style={{ width: `${(r.p / max) * 100}%` }} />
                    </div>
                    <span className="mono">{fmtPct(r.p)}</span>
                  </div>
                </td>
                <td>
                  <div className="dop-cell">
                    <div className="bar kata">
                      <span style={{ width: `${(k / max) * 100}%` }} />
                    </div>
                    <span className="mono">{fmtPct(k)}</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
