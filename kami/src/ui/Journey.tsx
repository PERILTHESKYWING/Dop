import { COPY, fill, PATH, PER_DAY, POINTS, type DayMark, type JourneySummary } from '../../../shared/kiaiJourney';
import { FEATURES, useJourney } from '../lib/journey';
import { useSetting } from '../lib/settings';
import { dayLabel, SealMark } from './Seal';
import './journey.css';

const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MARK_LABEL: Record<DayMark, string> = { study: 'studied', rest: 'rest day used', none: 'no study', today: 'today, not yet' };

/** A clock-hand wedge from 12 o'clock over a 14-unit dot: `f` of the turn, at least an eighth. */
function wedge(f: number): string {
  const a = 2 * Math.PI * Math.max(0.125, Math.min(0.99, f));
  const x = (7 + 7 * Math.sin(a)).toFixed(2);
  const y = (7 - 7 * Math.cos(a)).toFixed(2);
  return `M7 7V0A7 7 0 ${a > Math.PI ? 1 : 0} 1 ${x} ${y}Z`;
}

/**
 * Ten stones toward the next station, filled in proportion: each tenth done is a black stone, the
 * tenth under way fills like a clock hand from 12 o'clock, never less than an eighth of the dot
 * (a thin edge-on sliver read as a broken "C"), and the rest are empty rings.
 */
function PathStones({ s }: { s: JourneySummary }) {
  const tenths = s.next ? Math.max(0, Math.min(10, (10 * s.into) / s.span)) : 10;
  return (
    <div className="path-stones" aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => {
        const f = Math.max(0, Math.min(1, tenths - i));
        return (
          <span key={i} className={f >= 1 ? 'b' : ''}>
            {f > 0 && f < 1 && (
              <svg viewBox="0 0 14 14">
                <path d={wedge(f)} />
              </svg>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** The last seven days as seven points on one board line. */
function WeekLine({ s }: { s: JourneySummary }) {
  return (
    <ol className="week-line" aria-label="The last seven days">
      {s.streak.week.map(({ day, mark }) => {
        const [y, m, d] = day.split('-').map(Number);
        const wd = new Date(y, m - 1, d, 12).getDay();
        return (
          <li key={day} className={`m-${mark}`} aria-label={`${dayLabel(day, true)}: ${MARK_LABEL[mark]}`}>
            <span className="week-pt" aria-hidden="true" />
            <span className="week-wd" aria-hidden="true">
              {WEEKDAY[wd]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function HowItGrows() {
  const rows: [string, string][] = [[COPY.howReview, fill('howEach', { points: POINTS.review, max: PER_DAY.review * POINTS.review })]];
  rows.push([COPY.howAsk, fill('howEach', { points: POINTS.ask, max: PER_DAY.ask * POINTS.ask })]);
  if (FEATURES.guided) rows.push([COPY.howGuided, fill('howEach', { points: POINTS.guided, max: PER_DAY.guided * POINTS.guided })]);
  if (FEATURES.solve) rows.push([COPY.howSolve, fill('howEach', { points: POINTS.solve, max: PER_DAY.solve * POINTS.solve })]);
  rows.push([COPY.howFirst, fill('howOnce', { points: POINTS.firstOfDay })]);
  return (
    <details className="journey-how">
      <summary>{COPY.howTitle}</summary>
      <dl className="stats">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="set-help">{COPY.dailyLimit}</p>
      <p className="set-help">{COPY.classical}</p>
    </details>
  );
}

/** Settings › Journey, above the toggles: station, progress, days in a row, seals. */
export function JourneyPanel() {
  const on = useSetting<boolean>('journey.on');
  const s = useJourney();
  if (!on) return <p className="set-blurb">{COPY.off}</p>;
  const c = s.station.classical;
  const rests = s.streak.rests;
  return (
    <div className="journey">
      <p className="set-blurb">{COPY.blurb}</p>
      <section className="journey-station" aria-label="Station">
        <h4 className="journey-head">{fill('head', { n: s.station.i + 1, of: PATH.length })}</h4>
        <div className="journey-stage">{fill('noteStation', { label: s.station.label })}</div>
        {c && (
          <div className="journey-classical" title={`Japanese ${c.ja} · Chinese ${c.zh}`}>
            <span lang="ja">{c.kanji}</span> · {c.gloss}
          </div>
        )}
        {!s.started && <p className="journey-note">{COPY.notStarted}</p>}
        <PathStones s={s} />
        <div className="journey-next">{s.next ? fill('toNext', { into: s.into, span: s.span, next: s.next.label }) : COPY.last}</div>
        <p className="journey-note">{COPY.honesty}</p>
      </section>

      <section className="journey-days" aria-label={COPY.daysTitle}>
        <p className="journey-dayline">
          {s.streak.current === 1 ? COPY.dayLine : fill('daysLine', { n: s.streak.current })} · {fill('best', { best: s.streak.best })} ·{' '}
          {rests === 0 ? COPY.noRests : fill(rests === 1 ? 'restsSaved' : 'restsSavedMany', { n: rests })}
        </p>
        <WeekLine s={s} />
        <p className="set-help">{COPY.restHelp}</p>
      </section>

      <section className="journey-seals" aria-label={COPY.sealsTitle}>
        <h4>{COPY.sealsTitle}</h4>
        <ul className="seal-grid">
          {s.seals.map((x) => (
            <li key={x.id}>
              <SealMark seal={x} />
              <div className="seal-text">
                <div className="set-label">{x.title}</div>
                <div className="set-help">{x.how}</div>
                <div className="seal-when">{x.earned ? dayLabel(x.earned) : fill('progress', { n: x.progress[0], of: x.progress[1] })}</div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <HowItGrows />
    </div>
  );
}
