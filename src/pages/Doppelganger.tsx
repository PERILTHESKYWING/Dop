import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast, useStore } from '../state/store';
import { corpus, getEngine, isPlayerGame, loadDemo, markInteractive, rebuildProfile, runQueue, saveDoppelGame, startEngine } from '../state/actions';
import { Board, type Mark } from '../components/Board';
import { fmtPct, gameTitle, Legend, MoveThumb } from '../components/common';
import { BoardScreen, HeadButton, Notice, PlayersBar, REPORT_TABS, type ScreenTool } from '../components/BoardScreen';
import { BlunderPanel, PerformancePanel, TrendPanel } from '../components/Report';
import type { PosValue } from '../lib/analysis/lineStats';
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
import { ActionTile, ControlSheet, FieldTile, GearButton, SheetSection, ToggleTile } from '../components/ControlSheet';
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
  const opponents = useStore((s) => s.opponents).filter((o) => o.copy);
  const nav = (path: string) => {
    onNav?.();
    go(path);
  };
  return (
    <>
      <SheetSection title="Copy">
        <ActionTile onClick={() => void rebuildProfile()} disabled={busy} icon="↻" label={busy ? 'Retraining…' : 'Retrain'} sub="All analysed games" />
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
          Trained with an old method. Numbers are inflated.{' '}
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

function PlayCopy({ copy, model, opponent }: { copy: CopyInfo; model: DoppelModel; opponent?: OpponentProfile }) {
  const games = useStore((s) => s.games);
  useLevel((s) => s.calibration);
  useEffect(() => void loadLevel(), []);
  const engine = useStore((s) => s.engine);
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
              <SheetSection title="Copy">
                <FieldTile label="Strength">
                  <select value={setup.strength === null ? 'natural' : String(setup.strength)} onChange={(e) => setSetup({ ...setup, strength: e.target.value === 'natural' ? null : Number(e.target.value) })} aria-label="Strength">
                    <option value="natural">Natural ({demoMode ? 'player' : 'you'})</option>
                    {STRENGTHS.map((r) => (
                      <option key={r} value={r}>
                        {r === FULL_STRENGTH ? 'Full strength' : `~${rankLabel(r)}`}
                      </option>
                    ))}
                  </select>
                  {setup.strength !== null && (
                    <span className="tiny muted">
                      Same style, capped at ~{lossBudget(setup.strength, useLevel.getState().calibration).toFixed(1)} pts lost per move ({setup.strength === FULL_STRENGTH ? 'top player' : rankLabel(setup.strength)}).
                    </span>
                  )}
                </FieldTile>
                <ToggleTile on={setup.sample} onChange={(v) => setSetup({ ...setup, sample: v })} icon="⚄" label="Vary moves" sub="Like a person" />
              </SheetSection>
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
  const shownBoard = viewing === null ? board : replay(game.size, game.setup, [...game.prefix, ...game.moves.slice(0, viewing)]);
  const shownLast = viewing === null ? last : viewing > 0 ? game.moves[viewing - 1].loc : game.prefix.length ? game.prefix[game.prefix.length - 1].loc : null;
  const shownRead = viewing === null ? current : reads.get(readKey(game, viewing));

  const marks: Mark[] = [];
  let caption = '';
  if (viewing !== null) {
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

  const onPlay = (loc: Loc) => {
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
      {caption && <div className="small dop-caption">{caption}</div>}
      {over && (
        <button className="btn primary" onClick={() => void reviewGame()} disabled={saving}>
          <Icon name="board" /> {saving ? 'Saving…' : 'Review'}
        </button>
      )}
    </>
  );
  let panel: ReactNode = playing;
  if (showAnalysis && tab === 'data')
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
    { id: 'analysis', label: 'Analysis', icon: 'trend', on: showAnalysis, onClick: () => setShowAnalysis(!showAnalysis), title: 'Eval bar and report tabs' },
  ];

  return (
    <BoardScreen
      className="dop-screen"
      title={demoMode ? copy.who : 'Your copy'}
      sub={`${game.size}×${game.size} · komi ${game.komi}${game.strength !== null ? ` · ${game.strength === FULL_STRENGTH ? 'full strength' : `~${rankLabel(game.strength)}`}` : ''}`}
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
        />
      }
      board={<Board size={size} stones={shownBoard.stones} lastMove={shownLast} toPlay={yourTurn && viewing === null ? game.user : undefined} onPlay={yourTurn && viewing === null ? onPlay : undefined} marks={marks} coords ariaLabel="Game board" />}
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

/** The copy's reply next to KataGo's choice: the candidates with both sets of probabilities. */
function ReplyCompare({ read, played, size, who }: { read: PositionRead; played: Loc; size: number; who: string }) {
  if (played === PASS) return <p className="small">{who} passed{read.policy[0]?.loc === PASS ? ' (same as KataGo)' : ''}</p>;
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
          <span className="tiny dim">{p !== undefined ? `#${rank + 1} · ${fmtPct(p)}` : 'KataGo move'}</span>
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
