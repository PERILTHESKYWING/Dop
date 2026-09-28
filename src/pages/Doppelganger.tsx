import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { corpus, getEngine, isPlayerGame, loadDemo, markInteractive, rebuildProfile, runQueue, saveDoppelGame, startEngine } from '../state/actions';
import { Board, type Mark } from '../components/Board';
import { WinBar } from '../components/Analysis';
import { EvalToggle, fmtPct, FocusEval, gameTitle, Legend, MoveThumb, useEvalPref, useFocusMode, FocusToggle, WinrateGraph } from '../components/common';
import { KomiPicker } from '../components/Komi';
import { DoppelLine, useCopy, type CopyInfo } from '../components/Doppel';
import { BrandMark, Icon } from '../components/Icons';
import { evaluateFast, toPlayAt } from '../lib/analysis/analyzer';
import { replay } from '../lib/go/board';
import { engineKomi } from '../lib/go/rules';
import { locToGtp } from '../lib/go/coords';
import { other, PASS, type Color, type Loc, type Move } from '../lib/go/types';
import {
  copyVsKataGo,
  describeHabits,
  DOPPEL_ALGO,
  habitCost,
  MIN_COPY_MOVES,
  predictForPosition,
  rankDisagreements,
  sampleMove,
  type Disagreement,
  type DoppelModel,
  type DoppelPrediction,
  type MoveValue,
} from '../lib/profile/doppel';
import type { GameRecord, OpponentProfile, PolicyEntry } from '../lib/types';
import { chooseStyled, FULL_STRENGTH, lossBudget } from '../lib/profile/strength';
import { rankLabel } from '../lib/level/ranks';
import { loadLevel, useLevel } from '../state/level';
import { go, href } from '../router';
import { ActionTile, BackLink, ControlSheet, FieldTile, GearButton, SheetSection, ToggleTile } from '../components/ControlSheet';
import './doppel.css';

type View = 'overview' | 'differences' | 'play';

/** Strength dial settings (ranks on the level scale, see level/ranks.ts). */
const STRENGTHS = [-14, -9, -6, -4, -2, 0, 1, 3, 5, 7, 9, FULL_STRENGTH];

/** The losing side must keep this winrate for a disagreement to count (looser than practice: this is a report). */
const REPORT_MIN_LOSING_WINRATE = 0.1;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const pts = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;

function ago(t: number) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} hour${Math.round(s / 3600) === 1 ? '' : 's'} ago`;
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
  if (opp?.copy)
    return (
      <div className="page dop-page dop-wide">
        <div className="page-head dop-head">
          <div className="dop-title">
            <BackLink href={href(`opponents/${opp.id}`)} label={opp.name} />
            <div>
              <div className="eyebrow">Doppelgänger</div>
              <h1>{opp.name}'s copy</h1>
              <p className="sub">
                Learned from {opp.copy.moves ?? opp.copy.trainedOn} of {opp.name}'s moves · predicts {fmtPct(opp.copy.metrics.top1)} of held-out moves (KataGo alone {fmtPct(opp.copy.metrics.baselineTop1)})
              </p>
            </div>
          </div>
          <GearButton onClick={() => sheet.set(true)} label="Game settings" />
        </div>
        <PlayCopy key={opp.id} copy={{ ...copy, owner: 'user', who: `${opp.name}'s copy`, whose: `${opp.name}'s`, demoName: opp.name }} model={opp.copy} opponent={opp} sheet={sheet} />
      </div>
    );
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
          {view === 'play' && <PlayCopy copy={copy} model={copy.model!} sheet={sheet} />}
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
          <div className="eyebrow">{demo ? 'The demo player, copied' : 'The copy of you'}</div>
          <h1>{demo && copy.demoName ? `${copy.demoName}'s Doppelgänger` : 'Your Doppelgänger'}</h1>
          <p className="sub">
            {m
              ? `It has studied ${plural(m.moves ?? m.trainedOn + m.metrics.testSize, 'move')} of ${demo ? `${copy.demoName ?? 'the demo player'}'s` : 'yours'} and predicts what ${demo ? copy.demoName ?? 'the player' : 'you'} would play, not what is best.`
              : 'A model that studies your games and predicts what you would play, not what is best.'}
            {busy && ' Updating…'}
          </p>
        </div>
      </div>
      {m && onSettings && (
        <div className="dop-head-tools">
          <GearButton onClick={onSettings} label="Doppelgänger settings" />
        </div>
      )}
    </div>
  );
}

/**
 * The Control Center: everything you can set or do on the Doppelgänger pages, grouped.
 * `children` puts the current view's own settings (a game's setup, say) first.
 */
function DopSheet({ sheet, copy, children }: { sheet: SheetCtl; copy: CopyInfo; children?: ReactNode }) {
  const busy = useStore((s) => s.busy.profile);
  const opponents = useStore((s) => s.opponents).filter((o) => o.copy);
  const close = useCallback(() => sheet.set(false), [sheet]);
  const nav = (path: string) => {
    sheet.set(false);
    go(path);
  };
  return (
    <ControlSheet open={sheet.open} onClose={close} title="Doppelgänger">
      {children}
      <SheetSection title="The copy">
        <ActionTile onClick={() => void rebuildProfile()} disabled={busy} icon="↻" label={busy ? 'Retraining…' : 'Retrain now'} sub="From every analysed game" />
        <ActionTile onClick={() => nav('library')} icon={<Icon name="upload" />} label="Import games" sub={copy.owner === 'demo' ? 'Make it yours' : 'Teach it more'} />
      </SheetSection>
      <SheetSection title="Opponents' copies">
        {opponents.length ? (
          <FieldTile label="Play a copy of an opponent">
            <select defaultValue="" onChange={(e) => e.target.value && nav(`doppel/play?opp=${e.target.value}`)} aria-label="Opponent">
              <option value="" disabled>
                Choose an opponent…
              </option>
              {opponents.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </FieldTile>
        ) : (
          <ActionTile onClick={() => nav('opponents')} icon={<Icon name="swords" />} label="Opponents" sub="Train a copy of anyone" />
        )}
      </SheetSection>
    </ControlSheet>
  );
}

function DemoBanner({ copy }: { copy: CopyInfo }) {
  return (
    <div className="banner info">
      <div className="grow stack tight">
        <strong>This is {copy.demoName ?? 'the demo player'}'s copy, not yours</strong>
        <span className="small dim">
          It learned from the demo games. Yours is built from your own games once about {MIN_COPY_MOVES} of your moves are analysed: one full game is enough to start, more games make it sharper.
        </span>
      </div>
      <a className="btn" href={href('library')}>
        <Icon name="upload" /> Import your games
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
        <h2>{copy.state === 'foreign' ? 'Your copy is not trained yet' : 'Your copy has not been trained yet'}</h2>
        <p className="dim small">
          It learns how you choose among KataGo's candidate moves, from your own analysed games: whether you answer locally or play elsewhere, save weak stones or give them up, and so on. It needs about {MIN_COPY_MOVES} of your moves.
          {copy.state === 'foreign' && ' The copy on file learned from other games than yours (the demo player’s, or games since removed), so it stays hidden until yours is trained.'}
        </p>
        <div className="dop-steps">
          <Step
            done={own.length > 0}
            title="Import your games"
            detail={own.length ? `${plural(own.length, 'game')} in the library.` : 'Add your SGF files in the Game Library.'}
            action={
              !own.length && (
                <a className="btn small primary" href={href('library')}>
                  Open the Game Library
                </a>
              )
            }
          />
          <Step
            done={sided.length > 0}
            title="Say which side you played"
            detail={
              own.length === 0
                ? 'The library asks when a game does not say.'
                : sided.length === own.length
                  ? 'Known in every game.'
                  : `Known in ${sided.length} of ${own.length} games. Only those count.`
            }
            action={
              own.length > sided.length && (
                <a className="btn small" href={href('library')}>
                  Choose sides
                </a>
              )
            }
          />
          <Step
            done={analysed.length > 0 ? true : queue.running && waiting.length ? 'busy' : false}
            title="Let KataGo analyse them"
            detail={
              <>
                {analysed.length ? `${plural(analysed.length, 'game')} analysed. ` : ''}
                {waiting.length ? `${plural(waiting.length, 'game')} waiting. ` : ''}
                {failed.length ? `${plural(failed.length, 'game')} failed (retry in the library). ` : ''}
                {queue.running && cur ? `Now: ${gameTitle(cur)}, ${cur.status === 'deep' ? `searching ${cur.progress.deep}/${cur.progress.deepTotal}` : `first look ${cur.progress.fast}/${cur.progress.total}`}.` : ''}
                {!analysed.length && !waiting.length && !failed.length ? 'Nothing to analyse yet.' : ''}
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
            title={`About ${MIN_COPY_MOVES} of your moves`}
            detail={
              <div className="stack tight">
                <span>{enough ? `${moves.toLocaleString()} of your moves are analysed.` : `${moves} of ${MIN_COPY_MOVES} so far.`}</span>
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
              title="Train the copy"
              detail={busy ? 'Training…' : 'Enough moves: it trains with your profile.'}
              action={
                !busy && (
                  <button className="btn small primary" onClick={() => void rebuildProfile()}>
                    Train now
                  </button>
                )
              }
            />
          )}
        </div>
      </div>
      <div className="panel stack">
        <h3>What it will show</h3>
        <ul className="notes small">
          <li>How often it names your exact move, compared with KataGo's own guess.</li>
          <li>Your habits in plain words, measured against KataGo in the same positions.</li>
          <li>The positions where your habit and KataGo part ways, and what that costs.</li>
          <li>A game against it: it answers with the moves it expects you to play.</li>
        </ul>
        {!games.some((g) => g.source === 'demo') && !own.length && (
          <button className="btn" style={{ justifySelf: 'start' }} onClick={() => void loadDemo().catch((e) => alert((e as Error).message))}>
            <Icon name="stones" /> Meet the demo player's copy first
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
      <span className="small dim">Comparing the copy with KataGo{positions ? ` on ${plural(positions, 'position')}` : ''}…</span>
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
        <DifferencesPreview copy={copy} model={model} />
        <div className="panel dop-cta stack">
          <BrandMark className="dop-cta-mark" />
          <h2>Play against {copy.owner === 'demo' ? copy.who : 'your copy'}</h2>
          <p className="small dim">
            It answers with the moves it expects {copy.owner === 'demo' ? `${copy.demoName ?? 'the player'} to play` : 'you to play'}, picked at random in proportion to its probabilities so it varies the way a person does. Next to every reply you see what KataGo would have played.
          </p>
          <a className="btn primary" href={href('doppel/play')} style={{ justifySelf: 'start' }}>
            <Icon name="play" /> Play {copy.owner === 'demo' ? 'the copy' : 'your copy'}
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
        It can mimic any opponent too, not just you: analyse enough of someone's games on their{' '}
        <a href={href('opponents')}>opponent page</a> to train a copy of them, style and strength dial included.
      </p>
    );
  return (
    <label className="stack tight">
      <span className="field-label">Or play a copy of an opponent</span>
      <select defaultValue="" onChange={(e) => e.target.value && go(`doppel/play?opp=${e.target.value}`)}>
        <option value="" disabled>
          Choose an opponent…
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
      <h3>How well it knows {copy.whose} moves</h3>
      <h2>
        Names {copy.whose} exact move <span className="doppel">{fmtPct(m.top1)}</span> of the time
      </h2>
      <div className="dop-compare">
        <div className="dop-compare-legend tiny">
          <span className="doppel">● the copy</span>
          <span className="kata">● KataGo's policy alone</span>
        </div>
        <CompareRow label="Exact move" copy={m.top1} kata={m.baselineTop1} />
        <CompareRow label="In its top 3" copy={m.top3} kata={m.baselineTop3} />
      </div>
      <p className="small dim">
        {m.testSize < 20
          ? `Checked on only ${plural(m.testSize, 'move')} so far, so these numbers are rough.`
          : gain >= 0.02
            ? `${Math.round(gain * 100)} points better than KataGo's own guess at naming what ${you} play${copy.owner === 'demo' ? 's' : ''}: that gap is the habits it learned.`
            : gain > -0.02
              ? `About as good as KataGo's own guess so far. More games give it more of ${copy.whose} habits to learn.`
              : `Not yet better than KataGo's own guess: it needs more of ${copy.whose} games.`}
      </p>
      <dl className="kv">
        <dt>Learned from</dt>
        <dd>
          {plural(moves, 'move')}
          {gamesN ? ` in ${plural(gamesN, 'game')}` : ''}
          {copy.newGames > 0 && <span className="muted"> · {plural(copy.newGames, 'newer game')} not learned yet</span>}
        </dd>
        <dt>Checked on</dt>
        <dd>
          {plural(m.testSize, 'move')} {(gamesN ?? 0) >= 5 ? 'from games it had not seen' : 'it had not learned from'}
        </dd>
        {model.outsideRate !== undefined && (
          <>
            <dt>Off KataGo's list</dt>
            <dd>
              {fmtPct(model.outsideRate)} of {copy.whose} moves <span className="muted">(not among KataGo's top 10, so a copy cannot name them)</span>
            </dd>
          </>
        )}
        <dt>Updated</dt>
        <dd>
          {ago(model.trainedAt)} · version {model.version}
        </dd>
      </dl>
      {old && (
        <div className="callout small">
          This copy was trained with an earlier method whose numbers were too kind (it counted moves outside KataGo's list as findable).{' '}
          <button className="btn small" disabled={busy} onClick={() => void rebuildProfile()}>
            {busy ? 'Retraining…' : 'Retrain now'}
          </button>
        </div>
      )}
    </div>
  );
}

function HabitsCard({ copy, model }: { copy: CopyInfo; model: DoppelModel }) {
  const habits = describeHabits(model, 8);
  const max = Math.max(0.5, ...habits.map((h) => Math.abs(h.weight)));
  return (
    <div className="panel stack">
      <h3>{copy.owner === 'demo' ? 'Its habits' : 'Your habits, as it sees them'}</h3>
      {habits.length ? (
        <>
          <p className="small dim">Compared with KataGo in the same positions, {copy.owner === 'demo' ? copy.demoName ?? 'the player' : 'you'}:</p>
          <div className="dop-habits">
            {habits.map((h) => (
              <div key={h.feature} className="dop-habit" title={`${h.odds >= 1 ? h.odds.toFixed(1) + '× as likely' : (1 / h.odds).toFixed(1) + '× less likely'} as KataGo's policy suggests, all else equal`}>
                <span className="small">{h.text}</span>
                <div className={`bar ${h.weight > 0 ? 'dop-bar-copy' : 'dop-bar-less'}`}>
                  <span style={{ width: `${Math.min(100, (Math.abs(h.weight) / max) * 100)}%` }} />
                </div>
                <span className={`chip ${h.strength === 'strong' ? 'doppel' : ''}`}>{h.strength}</span>
              </div>
            ))}
          </div>
          <p className="tiny muted">Each habit is a learned weight: how much more or less likely such a move is for {copy.owner === 'demo' ? 'the player' : 'you'} than KataGo's policy suggests, with everything else equal.</p>
        </>
      ) : (
        <p className="small dim">No clear habit yet: so far {copy.owner === 'demo' ? 'the player chooses' : 'you choose'} among KataGo's candidates much as KataGo's policy would. More games may show some.</p>
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
        <h3>Where {copy.owner === 'demo' ? 'its habits' : 'your habits'} cost the most</h3>
        {ranked.length > 3 && (
          <a className="small muted" href={href('doppel/differences')}>
            all {ranked.length} →
          </a>
        )}
      </div>
      {!report ? (
        <Computing progress={progress} />
      ) : (
        <>
          <p className="small dim">
            In {fmtPct(report.positions ? report.disagreements / report.positions : 0)} of {copy.whose} positions its first choice is not KataGo's.{' '}
            {ranked.length ? `These cost the most (likelihood × points lost):` : 'None of those cost a point or more in a game that was still open.'}
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
        In {fmtPct(report.positions ? report.disagreements / report.positions : 0)} of {copy.whose} {plural(report.positions, 'position')} the copy's first choice is not KataGo's, but none of those, where KataGo measured it, cost a point or more in a game that was still open. More analysed games (and deeper searches of them) will show more.
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
            <Board size={game.size} stones={board.stones} lastMove={sel.index > 0 ? game.moves[sel.index - 1].loc : null} marks={marks} coords ariaLabel="Position from your game" />
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
              Here the copy expects <strong className="doppel">{locToGtp(sel.copy.loc, sel.size)}</strong> ({fmtPct(sel.copy.p)} likely for {you}). KataGo plays{' '}
              <strong className="kata">{locToGtp(sel.kata.loc, sel.size)}</strong>, which the copy gives {fmtPct(sel.kata.p)}.
            </p>
            <table className="data dop-table">
              <thead>
                <tr>
                  <th />
                  <th>Move</th>
                  <th title="The copy's probability that the player picks this move">Likely</th>
                  <th title="KataGo's network policy for this move">Policy</th>
                  <th title="Winrate and score for the player after the move">After</th>
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
              Following the habit here costs <strong className="bad">{sel.cost!.scoreLoss.toFixed(1)} points</strong>
              {sel.cost!.winrateLoss >= 0.005 ? ` and ${fmtPct(sel.cost!.winrateLoss, 1)} of the winning chances` : ''}
              {sel.cost!.from === 'candidates' ? ', by KataGo’s evaluation of both moves.' : ', measured on the move actually played.'}
            </div>
            <DoppelLine predictions={sel.top} size={sel.size} who="The copy's top 3" played={sel.played} />
            <div className="row wrap">
              <a className="btn small primary" href={href(`review/${sel.gameId}?move=${sel.index + 1}`)}>
                <Icon name="board" /> Open in Game Review
              </a>
              <button
                className="btn small"
                onClick={() => {
                  startFromPosition(game, sel.index, other(sel.color), true);
                  go('doppel/play');
                }}
                title="The copy takes this side from here; you play the other"
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
            <h3>Most expensive habits</h3>
            <span className="chip">{ranked.length}</span>
          </div>
          <p className="tiny muted">
            Positions from {copy.whose} analysed games where the copy's first choice is not KataGo's, ranked by what the habit costs: its probability × the points its move loses. Only games that were still open, and in the early opening only losses of 3 points or more.
          </p>
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
                <span className="dop-row-cost mono" title={`Expected cost ${habitCost(d).toFixed(2)} points`}>
                  −{d.cost!.scoreLoss.toFixed(1)}
                </span>
              </button>
            ))}
          </div>
          {ranked.length > shown && (
            <button className="btn small ghost" style={{ justifySelf: 'start' }} onClick={() => setShown((n) => n + 25)}>
              Show more ({ranked.length - shown})
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
  /** Vary like a person (sample) or always play the copy's likeliest move. */
  sample: boolean;
  /** Target level for the copy (see profile/strength.ts); null plays as the player does. */
  strength: number | null;
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
  sample: boolean;
  strength: number | null;
  from?: { gameId: string; move: number };
  /** Whose copy plays: "me" or an imported player's id. */
  copyOf?: string;
  /** Set when a side resigns instead of the game ending by double pass. */
  resigned?: Color;
  /** The library id this game was saved as, once "Review game" or the sheet has saved it. */
  savedId?: string;
}

/** KataGo's quick read of one position, and what the copy makes of it. */
interface PositionRead {
  toPlay: Color;
  bWin: number;
  bLead: number;
  policy: PolicyEntry[];
  /** The copy's probabilities for the side to move, likeliest first. */
  preds: DoppelPrediction[];
  /** Points each considered move loses (with the strength dial on). */
  losses?: Map<Loc, number>;
}

/** Kept while the app is open, so a game survives switching tabs. */
const play: {
  setup: PlaySetup;
  game: PlayGame | null;
  reads: Map<string, PositionRead>;
  hints: boolean;
  autostart: boolean;
} = {
  setup: { user: 1, from: 'empty', size: 19, move: 0, sample: true, strength: null },
  game: null,
  reads: new Map(),
  hints: false,
  autostart: false,
};

/** Immersive play: no winrates, no candidate/policy hints, no move-by-move comparisons —
 * just the board, until the game ends. Persisted like a setting, not tied to one game. */
function readImmersive() {
  try {
    return localStorage.getItem('dop.doppelImmersive') === '1';
  } catch {
    return false;
  }
}
function writeImmersive(v: boolean) {
  try {
    localStorage.setItem('dop.doppelImmersive', v ? '1' : '0');
  } catch {
    /* private mode */
  }
}
let gameIds = 1;

const lineKey = (moves: Move[]) => moves.map((m) => `${m.color}${m.loc}`).join(',');
const readKey = (g: PlayGame, ply: number) => `${g.id}|${lineKey(g.moves.slice(0, ply))}`;
const colorAt = (g: PlayGame, ply: number): Color => (ply % 2 === 0 ? g.start : other(g.start));
const isOver = (g: PlayGame) => !!g.resigned || (g.moves.length >= 2 && g.moves[g.moves.length - 1].loc === PASS && g.moves[g.moves.length - 2].loc === PASS);

function newGame(s: PlaySetup, source?: GameRecord): PlayGame {
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
      sample: s.sample,
      strength: s.strength,
      from: { gameId: source.id, move: n },
    };
  }
  return { id: gameIds++, size: s.size, komi: s.komi ?? 7.5, setup: [], prefix: [], moves: [], start: 1, user: s.user, sample: s.sample, strength: s.strength };
}

/** Set up a game from a position of the player's games (used by "Play from here"). */
function startFromPosition(g: GameRecord, move: number, user: Color, autostart: boolean) {
  play.setup = { ...play.setup, from: 'game', gameId: g.id, move, user };
  play.game = null;
  play.autostart = autostart;
}

async function readPosition(g: PlayGame, ply: number, model: DoppelModel, withLosses = false): Promise<PositionRead> {
  markInteractive();
  const eng = getEngine() ?? (await startEngine());
  if (!eng) throw new Error('KataGo is not available');
  markInteractive();
  const history = [...g.prefix, ...g.moves.slice(0, ply)];
  const board = replay(g.size, g.setup, history);
  const toPlay = colorAt(g, ply);
  const ev = await evaluateFast(eng, { size: g.size, komi: g.komi, setup: g.setup, history, toPlay, board });
  const preds = predictForPosition(model, { size: g.size, setup: g.setup, history, toPlay, policy: ev.policy, ownership: ev.ownership, board }, 10);
  const read: PositionRead = { toPlay, bWin: ev.bWin, bLead: ev.bLead, policy: ev.policy, preds };
  if (withLosses && preds.length) {
    // What each move the copy considers costs: KataGo's look at the position after it,
    // compared with the best of them (KataGo's own first choices are always included).
    const top = preds[0].p;
    const locs = [...new Set([...preds.filter((p) => p.p >= top * 0.05).slice(0, 6).map((p) => p.loc), ...ev.policy.filter((e) => e.loc !== PASS).slice(0, 3).map((e) => e.loc)])];
    const leads = new Map<Loc, number>();
    for (const loc of locs) {
      if (loc === PASS || !board.isLegal(loc, toPlay)) continue;
      const after = board.clone();
      after.play(loc, toPlay);
      markInteractive();
      const child = await evaluateFast(eng, { size: g.size, komi: g.komi, setup: g.setup, history: [...history, { color: toPlay, loc }], toPlay: other(toPlay), board: after });
      leads.set(loc, toPlay === 1 ? child.bLead : -child.bLead);
    }
    const best = Math.max(...leads.values());
    read.losses = new Map([...leads].map(([loc, lead]) => [loc, best - lead]));
  }
  return read;
}

/** The copy's move: from its own distribution; a pass when KataGo thinks the game is over or offers nothing. */
function chooseReply(read: PositionRead, sample: boolean, strength: number | null): Loc {
  const passP = read.policy.find((e) => e.loc === PASS)?.p ?? 0;
  if (passP >= 0.5) return PASS;
  if (strength !== null && read.losses?.size) {
    const styled = chooseStyled(read.preds, read.losses, lossBudget(strength, useLevel.getState().calibration), { sample });
    if (styled) return styled.loc;
  }
  const pick = sample ? sampleMove(read.preds) : read.preds[0] ?? null;
  if (pick) return pick.loc;
  return read.policy.find((e) => e.loc !== PASS)?.loc ?? PASS;
}

function PlayCopy({ copy, model, opponent, sheet }: { copy: CopyInfo; model: DoppelModel; opponent?: OpponentProfile; sheet: SheetCtl }) {
  const games = useStore((s) => s.games);
  useLevel((s) => s.calibration);
  useEffect(() => void loadLevel(), []);
  const engine = useStore((s) => s.engine);
  const [setup, setSetupState] = useState<PlaySetup>(play.setup);
  const copyOf = opponent?.id ?? 'me';
  const [game, setGameState] = useState<PlayGame | null>((play.game?.copyOf ?? 'me') === copyOf ? play.game : null);
  const [hints, setHintsState] = useState(play.hints);
  const [immersive, setImmersive] = useState(readImmersive);
  const [, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [focused, setFocused] = useFocusMode();
  const [evalOn, setEvalOn] = useEvalPref();
  const reads = play.reads;
  const gameRef = useRef(game);
  gameRef.current = game;
  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFocused(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focused, setFocused]);
  const [saving, setSaving] = useState(false);

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
  const setImmersiveBoth = (v: boolean) => {
    setImmersive(v);
    writeImmersive(v);
  };

  // Someone else's copy (the demo player's or an imported player's) is named rather than "your copy".
  const demoMode = copy.owner === 'demo' || !!opponent;
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
    setGame(() => ({ ...newGame(s, src), copyOf }));
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
          read = await readPosition(game, ply, model, copyTurn && game.strength !== null);
          reads.set(key, read);
          setTick((t) => t + 1);
        }
        if (cancelled || !copyTurn) return;
        // A moment to "think", so the reply does not land on the same frame as your move.
        const wait = 550 - (performance.now() - t0);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (cancelled) return;
        const loc = chooseReply(read, game.sample, game.strength);
        setGame((g) => (g && g.id === game.id && readKey(g, g.moves.length) === key ? { ...g, moves: [...g.moves, { color: colorAt(g, ply), loc }] } : g));
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
      <div className="dop-stage">
        <div className="dop-board">
          <Board
            size={size}
            stones={preview ? preview.stones : new Int8Array(size * size)}
            lastMove={preview && setup.move > 0 ? source!.moves[setup.move - 1]?.loc : null}
            coords
            ariaLabel="Starting position"
          />
        </div>
        <div className="dop-side">
          <div className="panel accent stack dop-play-setup">
            <div className="spread">
              <h2>Play against {demoMode ? copy.who : 'your copy'}</h2>
              <GearButton onClick={() => sheet.set(true)} label="Game settings" />
            </div>
            <div className="stack tight">
              <span className="field-label">You play</span>
              <div className="segmented dop-seg">
                {([1, 2] as Color[]).map((c) => (
                  <button key={c} className={setup.user === c ? 'on' : ''} onClick={() => setSetup({ ...setup, user: c })}>
                    <strong>
                      <i className={`stone-dot ${c === 1 ? 'b' : 'w'}`} /> {c === 1 ? 'Black' : 'White'}
                    </strong>
                    <span>the copy plays {c === 1 ? 'White' : 'Black'}</span>
                  </button>
                ))}
              </div>
            </div>
            {unavailable ? (
              <div className="callout bad small">
                KataGo could not start on this device, and the copy chooses among KataGo's candidate moves, so it cannot play here. <a href={href('settings')}>Engine &amp; Settings</a> has the details and fixes.
              </div>
            ) : (
              <button className="btn primary dop-start" onClick={start}>
                <Icon name="play" /> Start the game
              </button>
            )}
            {!unavailable && engine.status !== 'ready' && <p className="tiny muted">KataGo loads when the game starts (it supplies the candidate moves the copy chooses from).</p>}
          </div>
        </div>
        <DopSheet sheet={sheet} copy={copy}>
          <SheetSection title="Game setup">
            <ToggleTile on={setup.from === 'empty'} onChange={() => setSetup({ ...setup, from: 'empty' })} icon="◻" label="Empty board" sub="Black moves first" />
            <ToggleTile
              on={setup.from === 'game'}
              onChange={() => sources.length && setSetup({ ...setup, from: 'game', gameId: source?.id, move: setup.move || Math.min(60, source?.moves.length ?? 0) })}
              icon="◧"
              label={demoMode ? 'One of the games' : 'One of your games'}
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
          <SheetSection title="The copy's play">
            <FieldTile label="Strength">
              <select value={setup.strength === null ? 'natural' : String(setup.strength)} onChange={(e) => setSetup({ ...setup, strength: e.target.value === 'natural' ? null : Number(e.target.value) })} aria-label="Strength">
                <option value="natural">As {demoMode ? 'the player' : 'you'} play (no limit)</option>
                {STRENGTHS.map((r) => (
                  <option key={r} value={r}>
                    {r === FULL_STRENGTH ? 'Full strength, same style' : `About ${rankLabel(r)}, same style`}
                  </option>
                ))}
              </select>
              {setup.strength !== null && (
                <span className="tiny muted">
                  Picks the moves its player would, but each move's cost is held to what a {setup.strength === FULL_STRENGTH ? 'top player' : rankLabel(setup.strength)} typically loses (about{' '}
                  {lossBudget(setup.strength, useLevel.getState().calibration).toFixed(1)} points a move).
                </span>
              )}
            </FieldTile>
            <ToggleTile on={setup.sample} onChange={(v) => setSetup({ ...setup, sample: v })} icon="⚄" label="Vary its moves" sub="Like a person would" />
          </SheetSection>
          <PlayingToggles immersive={immersive} setImmersive={setImmersiveBoth} hints={hints} setHints={setHints} />
        </DopSheet>
      </div>
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

  const marks: Mark[] = [];
  let caption = '';
  if (immersive) {
    // No hints, no comparisons: just the board, until the game is over.
  } else if (yourTurn && hints && current) {
    const kata = current.policy.find((e) => e.loc !== PASS);
    const guess = current.preds.find((e) => e.loc !== PASS);
    if (guess) marks.push({ loc: guess.loc, kind: 'doppel', label: String(Math.round(guess.p * 100)) });
    if (kata && kata.loc !== guess?.loc) marks.push({ loc: kata.loc, kind: 'best', label: String(Math.round(kata.p * 100)) });
    caption =
      guess && kata && guess.loc === kata.loc
        ? `The copy expects ${locToGtp(guess.loc, size)} from you (${fmtPct(guess.p)}), which is also KataGo's first choice.`
        : `Purple: the move the copy expects from you (%). Teal: KataGo's first choice (policy %).`;
  } else if (lastCopy !== undefined && lastCopy === ply - 1 && copyRead) {
    const mv = game.moves[lastCopy].loc;
    const kata = copyRead.policy.find((e) => e.loc !== PASS);
    if (mv !== PASS) marks.push({ loc: mv, kind: 'doppel' });
    if (kata && kata.loc !== mv) marks.push({ loc: kata.loc, kind: 'best', label: 'K' });
    if (kata && mv !== PASS) caption = kata.loc === mv ? "The copy's reply is KataGo's first choice too." : "Dashed purple: the copy's reply. K: where KataGo would have played.";
  }

  const onPlay = (loc: Loc) => {
    if (!yourTurn) return;
    if (loc !== PASS && !board.isLegal(loc, game.user)) return;
    setGame((g) => (g && g.id === game.id && g.moves.length === ply ? { ...g, moves: [...g.moves, { color: game.user, loc }] } : g));
  };
  const undo = () => {
    if (lastUser === undefined) return;
    setGame((g) => (g && g.id === game.id ? { ...g, moves: g.moves.slice(0, lastUser) } : g));
  };
  const resign = () => {
    if (over) return;
    if (!confirm('Resign this game?')) return;
    setGame((g) => (g && g.id === game.id ? { ...g, resigned: g.user } : g));
  };
  const reviewGame = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const you = 'You';
      const black = game.user === 1 ? you : whoName;
      const white = game.user === 1 ? whoName : you;
      const result = game.resigned ? `${game.resigned === 1 ? 'W' : 'B'}+R` : current ? `${current.bLead >= 0 ? 'B' : 'W'}+${Math.abs(current.bLead).toFixed(1)}` : undefined;
      const id =
        game.savedId ??
        (await saveDoppelGame({
          size: game.size,
          komi: game.komi,
          setup: game.setup,
          moves: history,
          user: game.user,
          black,
          white,
          result,
        }));
      setGame((g) => (g && g.id === game.id ? { ...g, savedId: id } : g));
      go(`review/${id}`);
    } finally {
      setSaving(false);
    }
  };

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

  return (
    <div className={`dop-stage ${focused ? 'focused' : ''}`}>
      <FocusToggle focused={focused} onChange={setFocused} />
      {focused && <EvalToggle on={evalOn} onChange={setEvalOn} />}
      {focused && evalOn && (
        <FocusEval>
          <WinBar bWin={current?.bWin ?? null} bLead={current?.bLead ?? null} pending={!current} />
          {ply > 0 && (
            <WinrateGraph
              values={Array.from({ length: ply + 1 }, (_, i) => reads.get(readKey(game, i))?.bWin ?? null)}
              scores={Array.from({ length: ply + 1 }, (_, i) => reads.get(readKey(game, i))?.bLead ?? null)}
              cursor={ply}
            />
          )}
        </FocusEval>
      )}
      <div className="dop-board">
        <Board size={size} stones={board.stones} lastMove={last} toPlay={yourTurn ? game.user : undefined} onPlay={yourTurn ? onPlay : undefined} marks={marks} coords ariaLabel="Game against your copy" />
        {caption && <div className="small dop-caption">{caption}</div>}
      </div>
      <div className="dop-side">
        <div className="panel stack dop-play-panel">
          <div className="spread">
            <h3 className="with-icon">
              <span className="live-dot" data-on={thinking || loadingEngine ? '1' : '0'} /> {demoMode ? `Playing ${copy.who}` : 'Playing your copy'}
            </h3>
            <span className="small muted">
              you: <i className={`stone-dot ${game.user === 1 ? 'b' : 'w'}`} /> {game.user === 1 ? 'Black' : 'White'}
            </span>
          </div>
          {(!immersive || over) && <WinBar bWin={current?.bWin ?? null} bLead={current?.bLead ?? null} pending={!current} />}
          {(!immersive || over) && ply > 0 && (
            <WinrateGraph
              values={Array.from({ length: ply + 1 }, (_, i) => reads.get(readKey(game, i))?.bWin ?? null)}
              scores={Array.from({ length: ply + 1 }, (_, i) => reads.get(readKey(game, i))?.bLead ?? null)}
              cursor={ply}
            />
          )}
          <div className="small dim">
            {error ? (
              <span className="bad">
                {/not available/.test(error) ? 'KataGo is not available, so the copy cannot answer. ' : `KataGo stopped: ${error}. `}
                <button className="btn small" onClick={() => setRetry((r) => r + 1)}>
                  Try again
                </button>{' '}
                <a href={href('settings')}>Engine &amp; Settings</a>
              </span>
            ) : loadingEngine ? (
              engine.progress?.stage === 'download' ? (
                `Loading KataGo's network… ${engine.progress.total ? Math.round((engine.progress.loaded / engine.progress.total) * 100) + '%' : Math.round(engine.progress.loaded / 1e6) + ' MB'}`
              ) : (
                'Starting KataGo…'
              )
            ) : over ? (
              <>
                {game.resigned ? (
                  <>{game.resigned === game.user ? 'You resigned.' : `${whoName} resigned.`}</>
                ) : (
                  <>
                    Game over: both passed.{' '}
                    {current && (
                      <>
                        KataGo's estimate: <strong>{current.bLead >= 0 ? 'B' : 'W'}+{Math.abs(current.bLead).toFixed(1)}</strong>.
                      </>
                    )}
                  </>
                )}
              </>
            ) : yourTurn ? (
              <>Your move ({game.user === 1 ? 'Black' : 'White'}). Tap the board.</>
            ) : (
              <>{whoName} is choosing a move…</>
            )}
          </div>
          <div className="dop-toolbar" role="toolbar" aria-label="Game controls">
            <button onClick={undo} disabled={lastUser === undefined} title="Take back your last move">
              <span aria-hidden>↶</span>
              Take back
            </button>
            <button onClick={() => onPlay(PASS)} disabled={!yourTurn} title="Pass">
              <span aria-hidden>⏸</span>
              Pass
            </button>
            {!over && (
              <button onClick={resign} title="Resign the game">
                <span aria-hidden>⚑</span>
                Resign
              </button>
            )}
            <button onClick={() => setGame(() => null)} title="Back to the game setup">
              <span aria-hidden>＋</span>
              New game
            </button>
            <button className={immersive ? 'on' : ''} onClick={() => setImmersiveBoth(!immersive)} aria-pressed={immersive} title="Hide winrates and hints until the game ends">
              <span aria-hidden>◐</span>
              Immersive
            </button>
          </div>
          {over && (
            <button className="btn primary" onClick={() => void reviewGame()} disabled={saving}>
              <Icon name="board" /> {saving ? 'Saving…' : 'Review this game'}
            </button>
          )}
        </div>

        {!immersive && lastCopy !== undefined && (
          <div className="panel stack">
            <h3>Its last reply</h3>
            {copyRead ? <ReplyCompare read={copyRead} played={game.moves[lastCopy].loc} size={size} who={whoName} /> : <p className="small muted">…</p>}
          </div>
        )}

        {!immersive && lastUser !== undefined && game.moves[lastUser].loc !== PASS && (
          <div className="panel stack">
            <h3>Your last move</h3>
            {userRead ? (
              <>
                <DoppelLine predictions={userRead.preds.slice(0, 3)} size={size} who={demoMode ? `${copy.who} expected` : 'Your copy expected'} played={game.moves[lastUser].loc} />
                <div className="small dim">
                  KataGo's first choice: <span className="kata">{locToGtp(userRead.policy.find((e) => e.loc !== PASS)?.loc ?? PASS, size)}</span>
                </div>
              </>
            ) : (
              <p className="small muted">KataGo is reading that position…</p>
            )}
          </div>
        )}

        <DopSheet sheet={sheet} copy={copy}>
          <PlayingToggles immersive={immersive} setImmersive={setImmersiveBoth} hints={hints} setHints={setHints} />
        </DopSheet>

        {(!immersive || over) && (replies > 0 || userMoves > 0) && (
          <div className="panel stack">
            <h3>This game</h3>
            <dl className="kv">
              {replies > 0 && (
                <>
                  <dt>The copy</dt>
                  <dd>
                    played KataGo's first choice in {kataReplies} of {plural(replies, 'reply', 'replies')}
                  </dd>
                </>
              )}
              {userMoves > 0 && (
                <>
                  <dt>You</dt>
                  <dd>
                    played the move {demoMode ? 'it' : 'your copy'} expected {guessed} of {plural(userMoves, 'time')}
                  </dd>
                </>
              )}
            </dl>
            <div className="line-moves">
              {game.moves.map((m, i) => (
                <span key={i} className={`chip ${m.color === game.user ? 'you' : 'doppel'}`} title={m.color === game.user ? 'you' : 'the copy'}>
                  {game.prefix.length + i + 1}. {m.loc === PASS ? 'pass' : locToGtp(m.loc, size)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Settings that apply while a game is on: immersive mode and the copy's hint. */
function PlayingToggles({ immersive, setImmersive, hints, setHints }: { immersive: boolean; setImmersive: (v: boolean) => void; hints: boolean; setHints: (v: boolean) => void }) {
  return (
    <SheetSection title="While playing">
      <ToggleTile on={immersive} onChange={setImmersive} icon="◐" label="Immersive" sub="No winrates or hints until it ends" />
      <ToggleTile on={hints && !immersive} onChange={(v) => (setHints(v), v && setImmersive(false))} icon="◎" label="Hints" sub="What the copy expects from you" />
    </SheetSection>
  );
}

/** The copy's reply next to KataGo's choice: the candidates with both sets of probabilities. */
function ReplyCompare({ read, played, size, who }: { read: PositionRead; played: Loc; size: number; who: string }) {
  if (played === PASS) return <p className="small">{who} passed{read.policy[0]?.loc === PASS ? ', as KataGo would.' : '.'}</p>;
  const kata = read.policy.find((e) => e.loc !== PASS);
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
          <span className="tiny dim">{p !== undefined ? `${rank === 0 ? 'its first choice' : `its choice #${rank + 1}`} · ${fmtPct(p)}` : 'KataGo’s move (no prediction)'}</span>
        </div>
        <div>
          <span className="tiny muted">KataGo would play</span>
          <strong className="kata dop-big">{kata ? locToGtp(kata.loc, size) : 'pass'}</strong>
          <span className="tiny dim">{kata ? (kata.loc === played ? 'the same move' : `policy ${fmtPct(kata.p)}`) : ''}</span>
        </div>
      </div>
      <table className="data dop-cands">
        <thead>
          <tr>
            <th>Move</th>
            <th className="doppel">The copy</th>
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
      <p className="tiny muted">The copy's probabilities are for the player it copies; KataGo's are its network's first impressions (policy).</p>
    </>
  );
}
