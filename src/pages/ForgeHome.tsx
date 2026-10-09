import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icons';
import { BrandSpinner } from '../components/Brand';
import { usePlayerTargets, useLevelOf } from '../components/Level';
import { countBy, dailySet, dayKey, matches } from '../lib/problems/bank';
import { levelLabel, PROBLEM_MAX_LEVEL, PROBLEM_MIN_LEVEL, ratingToRank } from '../lib/problems/level';
import { CATEGORY_TEXT, type ProblemCategory } from '../lib/problems/types';
import { categoryStats, currentCombo, loadForge, playerRank, savePrefs, setStartingLevel, useForge, type ForgePrefs } from '../state/problems';
import { useStore } from '../state/store';
import { practiceItems } from '../lib/forge/worth';
import { go, href } from '../router';
import '../components/forge.css';

/**
 * Forge's front page: practice settings in the spirit of 101weiqi (type, level range,
 * number of problems, time limit), the daily set, the player's problem level, streak and
 * results. Problems come from the KataGo-verified bank; "My mistakes" drills the player's
 * own weaknesses (the original Forge).
 */

const LEVELS: number[] = [];
for (let r = PROBLEM_MIN_LEVEL; r <= PROBLEM_MAX_LEVEL; r++) LEVELS.push(r);

const CATS: ProblemCategory[] = ['life', 'tesuji', 'endgame', 'middle'];

export function ForgeHome() {
  const loaded = useForge((s) => s.loaded);
  const bank = useForge((s) => s.bank);
  const bankError = useForge((s) => s.bankError);
  const prefs = useForge((s) => s.prefs);
  const progress = useForge((s) => s.progress);
  const weaknesses = useStore((s) => s.weaknesses);
  const itemsByW = useStore((s) => s.items);
  const minWin = useStore((s) => s.settings.minLosingWinrate);
  const games = useStore((s) => s.games);
  const own = games.some((g) => g.source === 'user');
  const { level } = useLevelOf(usePlayerTargets());
  useEffect(() => void loadForge(), []);

  const rank = playerRank(progress, own && level ? level.overall.rank : -5);
  const hidden = useMemo(() => new Set(progress.hidden), [progress.hidden]);
  const usable = useMemo(() => (bank ?? []).filter((p) => !hidden.has(p.id)), [bank, hidden]);
  const filter = { categories: prefs.categories, minLevel: prefs.minLevel, maxLevel: prefs.maxLevel, minLosingWinrate: prefs.minLosingWinrate, maxMoves: prefs.maxMoves };
  const counts = useMemo(() => countBy(usable, filter), [usable, prefs]); // eslint-disable-line react-hooks/exhaustive-deps
  const available = useMemo(() => usable.filter((p) => matches(p, filter)).length, [usable, prefs]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = dayKey();
  const daily = useMemo(() => (usable.length ? dailySet(usable, rank, today) : []), [usable, Math.round(rank), today]); // eslint-disable-line react-hooks/exhaustive-deps
  const dailyDone = progress.daily.day === today ? progress.daily.done.filter((id) => daily.some((p) => p.id === id)).length : 0;
  const mistakes = useMemo(() => weaknesses.filter((w) => practiceItems(itemsByW[w.id] ?? [], minWin).length > 0).length, [weaknesses, itemsByW, minWin]);
  const stats = categoryStats(progress);
  const todayCount = progress.results.filter((r) => dayKey(r.at) === today).length;
  const streakAlive = progress.streak.lastDay === today || progress.streak.lastDay === dayKey(Date.now() - 86_400_000);

  const set = (patch: Partial<ForgePrefs>) => void savePrefs(patch);
  const toggleCat = (c: ProblemCategory) => {
    const has = prefs.categories.includes(c);
    const next = has ? prefs.categories.filter((x) => x !== c) : [...prefs.categories, c];
    if (next.length) set({ categories: next });
  };
  const aroundMe = () => set({ minLevel: clampL(Math.round(rank) - 3), maxLevel: clampL(Math.round(rank) + 2) });

  if (!loaded || (!bank && !bankError))
    return (
      <div className="page">
        <div className="empty">
          <BrandSpinner />
        </div>
      </div>
    );

  return (
    <div className="page forge-home">
      <div className="page-head">
        <div>
          <div className="eyebrow">Training</div>
          <h1>Forge</h1>
          <p className="dim small">Real-game problems, verified by KataGo, at your level.</p>
        </div>
        <div className="fh-rating">
          {progress.rating !== null ? (
            <>
              <div className="fh-rank">{levelLabel(ratingToRank(progress.rating))}</div>
              <div className="tiny muted">rating {Math.round(progress.rating)}</div>
              <Sparkline points={progress.ratingHistory.map((h) => h.rating)} />
            </>
          ) : (
            <StartLevel suggested={own && level ? Math.round(level.overall.rank) : null} />
          )}
        </div>
      </div>

      <div className="fh-strip">
        <div className={`fh-streak ${streakAlive && progress.streak.days ? 'on' : ''}`}>
          <Icon name="flame" />
          <strong>{streakAlive ? progress.streak.days : 0}</strong>
          <span className="tiny muted">streak{progress.streak.best > 1 ? ` · best ${progress.streak.best}` : ''}</span>
        </div>
        <div className="fh-mini">
          <strong>{todayCount}</strong>
          <span className="tiny muted">today</span>
        </div>
        <div className="fh-mini">
          <strong>{currentCombo(progress)}</strong>
          <span className="tiny muted">combo · best {progress.bestCombo}</span>
        </div>
        <div className="fh-mini">
          <strong>{progress.results.length}</strong>
          <span className="tiny muted">total</span>
        </div>
      </div>

      {bankError && <div className="callout bad small">Problem bank failed to load ({bankError}). Reload to retry.</div>}

      <div className="fh-grid">
        <section className="panel stack fh-daily">
          <div className="spread">
            <h3>Daily 8</h3>
            <span className="chip">{dailyDone}/{daily.length}</span>
          </div>
          <p className="small dim">Eight problems at your level, reset daily.</p>
          <div className="fh-daily-dots">
            {daily.map((p) => (
              <span key={p.id} className={`fh-dot ${progress.daily.day === today && progress.daily.done.includes(p.id) ? 'done' : ''}`} title={`${CATEGORY_TEXT[p.cat].label}, ${levelLabel(p.level)}`} />
            ))}
          </div>
          <button className="btn primary big" disabled={!daily.length} onClick={() => go('forge/set?daily=1')}>
            <Icon name="play" /> {dailyDone >= daily.length && daily.length ? 'Replay' : dailyDone ? 'Continue' : 'Start'}
          </button>
        </section>

        <section className="panel stack fh-settings">
          <h3>Practice</h3>

          <Field label="Type" zh="题型">
            <div className="fh-cats">
              {CATS.map((c) => (
                <button key={c} className={`fh-cat ${prefs.categories.includes(c) ? 'on' : ''}`} onClick={() => toggleCat(c)} title={CATEGORY_TEXT[c].blurb}>
                  <strong>
                    {CATEGORY_TEXT[c].label} <span className="fh-zh">{CATEGORY_TEXT[c].zh}</span>
                  </strong>
                  <span>{counts[c]} problems</span>
                </button>
              ))}
              <a className="fh-cat mine" href={href('forge/mine')} title={CATEGORY_TEXT.mine.blurb}>
                <strong>
                  {CATEGORY_TEXT.mine.label} <span className="fh-zh">{CATEGORY_TEXT.mine.zh}</span>
                </strong>
                <span>{mistakes ? `${mistakes} weaknesses` : 'from your games'}</span>
              </a>
            </div>
          </Field>

          <Field label="Level" zh="级别">
            <div className="row wrap">
              <select value={prefs.minLevel} onChange={(e) => set({ minLevel: Number(e.target.value), maxLevel: Math.max(prefs.maxLevel, Number(e.target.value)) })}>
                {LEVELS.map((r) => (
                  <option key={r} value={r}>
                    {levelLabel(r)}
                  </option>
                ))}
              </select>
              <span className="muted">to</span>
              <select value={prefs.maxLevel} onChange={(e) => set({ maxLevel: Number(e.target.value), minLevel: Math.min(prefs.minLevel, Number(e.target.value)) })}>
                {LEVELS.map((r) => (
                  <option key={r} value={r}>
                    {levelLabel(r)}
                  </option>
                ))}
              </select>
              <button className="btn small ghost" onClick={aroundMe}>
                My level ({levelLabel(rank)})
              </button>
            </div>
          </Field>

          <Field label="Problems" zh="题数">
            <Seg value={prefs.count} options={[5, 10, 20, 30].map((n) => [n, String(n)])} onChange={(count) => set({ count })} />
          </Field>

          <Field label="Time limit" zh="限时">
            <Seg value={prefs.timeLimit} options={[[0, 'None'], [30, '30 s'], [60, '1 min'], [180, '3 min']]} onChange={(timeLimit) => set({ timeLimit })} />
          </Field>

          <Field label="Answer length" zh="手数">
            <Seg value={prefs.maxMoves} options={[[0, 'Any'], [1, '1'], [3, '≤3'], [5, '≤5']]} onChange={(maxMoves) => set({ maxMoves })} />
          </Field>

          <Field label="Min. trailing winrate" zh="胜率">
            <div className="row">
              <input
                type="range"
                min={0}
                max={0.45}
                step={0.05}
                value={prefs.minLosingWinrate}
                onChange={(e) => set({ minLosingWinrate: Number(e.target.value) })}
                style={{ flex: 1 }}
              />
              <strong className="mono">{Math.round(prefs.minLosingWinrate * 100)}%</strong>
            </div>
            <p className="tiny muted">
              Filters whole-board problems. Life-and-death always qualifies.
            </p>
          </Field>

          <details className="fh-options">
            <summary className="small">Options</summary>
            <div className="stack tight small">
              <Toggle on={prefs.confirmMove} onChange={(confirmMove) => set({ confirmMove })} label="Confirm moves (tap twice)" />
              <Toggle on={prefs.autoNext} onChange={(autoNext) => set({ autoNext })} label="Auto-next after a right answer" />
              <Toggle on={prefs.onWrong === 'retry'} onChange={(v) => set({ onWrong: v ? 'retry' : 'answer' })} label="Retry after a wrong move" />
              <Toggle on={prefs.coords} onChange={(coords) => set({ coords })} label="Coordinates" />
              <Toggle on={prefs.sound} onChange={(sound) => set({ sound })} label="Sounds" />
              <Toggle on={prefs.llmText} onChange={(llmText) => set({ llmText })} label="Coach hints" />
            </div>
          </details>

          <div className="spread fh-go">
            <span className="small muted">{available} match</span>
            <button className="btn primary big" disabled={!available} onClick={() => go('forge/set')}>
              <Icon name="play" /> Start {Math.min(prefs.count, available)}
            </button>
          </div>
        </section>
      </div>

      {progress.results.length > 0 && (
        <section className="panel stack">
          <h3>Results</h3>
          <div className="fh-catstats">
            {CATS.filter((c) => stats[c]).map((c) => {
              const s = stats[c]!;
              return (
                <div key={c} className="fh-catstat">
                  <strong>{CATEGORY_TEXT[c].label}</strong>
                  <span className="small">
                    {s.ok}/{s.tried} first try
                  </span>
                  {s.ok > 0 && <span className="tiny muted">~{levelLabel(s.level)}</span>}
                </div>
              );
            })}
          </div>
          <div className="fh-recent">
            {progress.results.slice(-40).map((r, i) => (
              <span key={i} className={`fh-res ${r.ok ? 'ok' : r.solved ? 'half' : 'bad'}`} title={`${CATEGORY_TEXT[r.cat].label}, ${levelLabel(r.level)}: ${r.ok ? 'solved' : r.solved ? 'solved with help' : 'missed'}`} />
            ))}
          </div>
        </section>
      )}
      <p className="tiny muted fs-source">
        Problems come from Fox (15k to 7d) and pro games. KataGo proves every answer and refutation. Levels reflect how often each rank finds the move. New problems nightly.
      </p>
    </div>
  );
}

const clampL = (r: number) => Math.max(PROBLEM_MIN_LEVEL, Math.min(PROBLEM_MAX_LEVEL, r));

function Field({ label, zh, children }: { label: string; zh: string; children: ReactNode }) {
  return (
    <div className="fh-field">
      <div className="field-label">
        {label} <span className="fh-zh">{zh}</span>
      </div>
      {children}
    </div>
  );
}

function Seg<T extends number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="fh-seg" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} role="radio" aria-checked={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="fh-toggle">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function StartLevel({ suggested }: { suggested: number | null }) {
  const [r, setR] = useState(suggested ?? -5);
  return (
    <div className="stack tight fh-start">
      <span className="small">Your level</span>
      <div className="row">
        <select value={r} onChange={(e) => setR(Number(e.target.value))}>
          {LEVELS.map((x) => (
            <option key={x} value={x}>
              {levelLabel(x)}
            </option>
          ))}
        </select>
        <button
          className="btn small primary"
          onClick={() => {
            void setStartingLevel(r);
            void savePrefs({ minLevel: clampL(r - 3), maxLevel: clampL(r + 2) });
          }}
        >
          Set
        </button>
      </div>
      <span className="tiny muted">{suggested !== null ? 'From your games. ' : ''}Adjusts as you solve.</span>
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const pts = points.slice(-60);
  if (pts.length < 2) return null;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const span = Math.max(50, hi - lo);
  const d = pts.map((v, i) => `${(i / (pts.length - 1)) * 100},${28 - ((v - lo) / span) * 26}`).join(' ');
  return (
    <svg className="fh-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
      <polyline points={d} />
    </svg>
  );
}
