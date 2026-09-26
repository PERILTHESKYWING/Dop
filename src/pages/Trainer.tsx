import { useEffect, useMemo, useRef, useState } from 'react';
import { Board } from '../components/Board';
import { WinBar } from '../components/Analysis';
import { fmtPct } from '../components/common';
import { replay } from '../lib/go/board';
import { gtpToLoc, locToGtp } from '../lib/go/coords';
import { PASS, type Color, type Loc, type Move } from '../lib/go/types';
import {
  DEFAULT_TRAINER_URL,
  fmtAgo,
  fmtDuration,
  fmtElo,
  milestones,
  setTrainerUrl,
  trainer,
  trainerUrl,
  TrainerError,
  type GenerationView,
  type PlayResponse,
  type TrainerHistory,
  type TrainerStatus,
} from '../lib/trainer/client';
import { toast } from '../state/store';
import './trainer.css';

type Conn = 'checking' | 'online' | 'offline';

/** Polls the trainer on this PC: status every 2 s, rating history when a generation is added or rated. */
function useTrainer() {
  const [conn, setConn] = useState<Conn>('checking');
  const [status, setStatus] = useState<TrainerStatus | null>(null);
  const [history, setHistory] = useState<TrainerHistory | null>(null);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const seen = useRef<{ gens: number; rated: number } | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.hidden) {
        timer = setTimeout(tick, 2000);
        return;
      }
      try {
        const s = await trainer.status();
        if (!alive) return;
        setStatus(s);
        setConn('online');
        setError('');
        const rated = s.latest?.rated ? s.generations : s.generations - 1;
        const prev = seen.current;
        if (!prev || prev.gens !== s.generations || prev.rated !== rated) {
          const h = await trainer.history();
          if (!alive) return;
          setHistory(h);
          const latest = h.generations[h.generations.length - 1];
          if (prev && latest && rated > prev.rated && latest.rated) {
            const before = h.generations[h.generations.length - 2];
            const gain = before?.elo != null && latest.elo != null ? latest.elo - before.elo : null;
            toast(`${latest.label} is rated: ${fmtElo(latest.elo)} Elo${gain !== null ? ` (${fmtElo(gain)} on ${before.label})` : ''}.`, gain !== null && gain > 0 ? 'ok' : 'info');
          } else if (prev && s.generations > prev.gens && latest) {
            toast(`${latest.label} is ready. You can play it now.`, 'ok');
          }
          seen.current = { gens: s.generations, rated };
        }
      } catch (e) {
        if (!alive) return;
        setConn('offline');
        setError((e as Error).message);
      }
      timer = setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [nonce]);

  return { conn, status, history, error, retry: () => setNonce((n) => n + 1) };
}

export function Trainer() {
  const { conn, status, history, error, retry } = useTrainer();
  return (
    <div className="trn-page">
      <div className="page-head">
        <div>
          <h1>Home Trainer</h1>
          <p className="sub">A Go AI that teaches itself on your own graphics card, starting from nothing. Watch it climb, and play it whenever you like.</p>
        </div>
        <ConnBadge conn={conn} status={status} />
      </div>
      {conn === 'online' && status ? (
        <Dashboard status={status} history={history} />
      ) : (
        <Setup checking={conn === 'checking'} error={error} onRetry={retry} />
      )}
    </div>
  );
}

function ConnBadge({ conn, status }: { conn: Conn; status: TrainerStatus | null }) {
  const text = conn === 'online' ? (status?.paused ? 'Connected · paused' : 'Connected to your PC') : conn === 'checking' ? 'Looking for the trainer…' : 'Trainer not running';
  return (
    <span className="trn-conn">
      <span className={`dot ${conn === 'online' ? (status?.phase === 'error' ? 'err' : 'ok') : conn === 'checking' ? 'busy' : ''}`} /> {text}
    </span>
  );
}

// ------------------------------------------------------------------ setup

function Setup({ checking, error, onRetry }: { checking: boolean; error: string; onRetry: () => void }) {
  const [url, setUrl] = useState(trainerUrl());
  return (
    <div className="trn-setup">
      <div className="panel stack">
        <h2>Start the trainer on your PC</h2>
        <p className="small dim">
          The training runs on your own GPU with KataGo's self-play pipeline: it plays itself, learns from those games, and every new network is rated against the older ones. This page connects to it
          by itself once it is running.
        </p>
        <ol className="trn-steps">
          <li>
            <a className="btn primary" href="downloads/dop-trainer.zip" download>
              Download Dop Trainer
            </a>
            <span className="small muted"> Windows 10/11 with an NVIDIA or AMD graphics card. About 11 MB.</span>
          </li>
          <li>
            Unzip it anywhere and double-click <strong>Start-Trainer.bat</strong>. The first start installs Python packages, KataGo and PyTorch (a 3 GB download, once). If Python is missing it tells you how to
            get it.
          </li>
          <li>Leave the black window open. Training continues while it is open and picks up where it stopped next time.</li>
          <li>Come back to this page. When your browser asks whether this site may connect to devices on your local network, allow it: that is how the page reaches the trainer.</li>
        </ol>
        <div className="row wrap">
          <button className="btn small" onClick={onRetry} disabled={checking}>
            {checking ? 'Looking…' : 'Check again'}
          </button>
          {error && !checking && <span className="small muted">{error}</span>}
        </div>
      </div>
      <div className="panel stack">
        <h3>What to expect</h3>
        <ul className="small trn-bullets">
          <li>It starts from random play, so the first networks are hopeless. The rating chart shows it improving generation by generation, usually several generations an hour.</li>
          <li>A rough guide for one RTX 5070 running nonstop: purposeful moves within hours, club level after a few days, strong amateur play after weeks. The best KataGo networks took years on many GPUs, so it will not catch them.</li>
          <li>It uses the GPU fully while it runs. Pause it from this page when you want to game, or just close the window.</li>
        </ul>
        <details className="small">
          <summary>Trainer address</summary>
          <div className="row wrap" style={{ marginTop: 8 }}>
            <input className="trn-input" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Trainer address" />
            <button
              className="btn small"
              onClick={() => {
                setTrainerUrl(url);
                onRetry();
              }}
            >
              Save
            </button>
            {url !== DEFAULT_TRAINER_URL && (
              <button
                className="btn small ghost"
                onClick={() => {
                  setUrl(DEFAULT_TRAINER_URL);
                  setTrainerUrl(DEFAULT_TRAINER_URL);
                  onRetry();
                }}
              >
                Reset
              </button>
            )}
          </div>
          <p className="muted">Only change this if you started the trainer with another port. If you use your own domain for this site, start the trainer with --allow-origin followed by the address.</p>
        </details>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ dashboard

const PHASES: Record<string, string> = {
  starting: 'Starting',
  selfplay: 'Playing itself',
  shuffle: 'Preparing training data',
  train: 'Learning',
  export: 'Saving a new network',
  rating: 'Rating match',
  waiting: 'Collecting games',
  paused: 'Paused',
  stopped: 'Stopped',
  error: 'Stopped by an error',
};

function Dashboard({ status, history }: { status: TrainerStatus; history: TrainerHistory | null }) {
  const gens = history?.generations ?? [];
  const rated = gens.filter((g) => g.elo !== null);
  return (
    <div className="stack">
      <div className="trn-top">
        <Strength status={status} history={history} />
        <Activity status={status} />
      </div>
      <div className="panel stack">
        <div className="spread">
          <h3>Strength over time</h3>
          <span className="small muted">
            Elo above the untrained network, from {history ? `${history.ratingBoardSize}×${history.ratingBoardSize} games at ${history.ratingVisits} visits` : 'rating games'}
          </span>
        </div>
        {rated.length ? <EloChart history={history!} /> : <div className="empty small">The chart starts when the first network has played its rating games.</div>}
      </div>
      <div className="trn-bottom">
        <Play status={status} gens={gens} />
        {history && <Milestones history={history} />}
      </div>
    </div>
  );
}

/** Counts up to the new value when it changes, so a rise is felt. */
function useCountUp(target: number | null, ms = 900) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (target === null) return setV(null);
    const start = from.current ?? 0;
    from.current = target;
    if (start === target || matchMedia('(prefers-reduced-motion: reduce)').matches) return setV(target);
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const f = Math.min(1, (now - t0) / ms);
      setV(start + (target - start) * (1 - Math.pow(1 - f, 3)));
      if (f < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function Strength({ status, history }: { status: TrainerStatus; history: TrainerHistory | null }) {
  const gens = (history?.generations ?? []).filter((g) => g.elo !== null);
  const best = gens.length ? gens[gens.length - 1] : null;
  const prev = gens.length > 1 ? gens[gens.length - 2] : null;
  const dayAgo = Date.now() / 1000 - 86400;
  const base = [...gens].reverse().find((g) => g.created <= dayAgo) ?? gens[0] ?? null;
  const shown = useCountUp(best?.elo ?? null);
  const gain = best && prev && best.elo !== null && prev.elo !== null ? best.elo - prev.elo : null;
  const day = best && base && base !== best && best.elo !== null && base.elo !== null ? best.elo - base.elo : null;
  const next = history ? milestones(history).find((m) => !m.reachedAt) : null;
  const [pop, setPop] = useState(false);
  const last = useRef(best?.label);
  useEffect(() => {
    if (best?.label && last.current && best.label !== last.current) {
      setPop(true);
      const t = setTimeout(() => setPop(false), 1600);
      last.current = best.label;
      return () => clearTimeout(t);
    }
    last.current = best?.label;
  }, [best?.label]);
  return (
    <div className={`panel trn-hero ${pop ? 'pop' : ''}`}>
      <div className="trn-hero-label">Current strength</div>
      <div className="trn-elo">
        <span className="trn-elo-num">{shown === null ? '–' : fmtElo(shown)}</span>
        <span className="trn-elo-unit">Elo</span>
      </div>
      <div className="trn-hero-sub">
        {best ? (
          <>
            <strong>{best.label}</strong>
            {best.se !== null && <span className="muted"> ±{Math.round(best.se)}</span>}
            {gain !== null && <span className={`trn-delta ${gain >= 0 ? 'up' : 'down'}`}>{fmtElo(gain)} on {prev!.label}</span>}
            {day !== null && <span className={`trn-delta ${day >= 0 ? 'up' : 'down'}`}>{fmtElo(day)} in 24 h</span>}
          </>
        ) : status.generations ? (
          <span className="muted">Rating the first network…</span>
        ) : (
          <span className="muted">No network yet: it is still playing its first random games.</span>
        )}
      </div>
      <div className="trn-facts">
        <Fact v={status.generations} l="generations" />
        <Fact v={status.selfplayGames.toLocaleString()} l="self-play games" />
        <Fact v={status.latest?.trainSamples ? shortNum(status.latest.trainSamples) : '0'} l="positions learned" />
        <Fact v={fmtDuration(Math.max(0, Date.now() / 1000 - (status.runStarted || Date.now() / 1000)))} l="since the start" />
      </div>
      {next && <div className="small trn-next">Next milestone: {next.title}</div>}
    </div>
  );
}

const Fact = ({ v, l }: { v: string | number; l: string }) => (
  <div className="trn-fact">
    <strong>{v}</strong>
    <span>{l}</span>
  </div>
);

function shortNum(n: number) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}

function Activity({ status }: { status: TrainerStatus }) {
  const [busy, setBusy] = useState(false);
  const pct = status.total ? Math.min(1, status.done / status.total) : null;
  const toggle = async () => {
    setBusy(true);
    try {
      await trainer.control(status.paused ? 'resume' : 'pause');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const phase = status.paused && status.phase !== 'paused' ? `${PHASES[status.phase] ?? status.phase} (pausing after this step)` : (PHASES[status.phase] ?? status.phase);
  const working = !status.paused && !['stopped', 'error', 'paused'].includes(status.phase);
  return (
    <div className="panel stack trn-activity">
      <div className="spread">
        <h3 className="with-icon">
          <span className="live-dot" data-on={working ? '1' : '0'} /> {phase}
        </h3>
        {status.phase !== 'stopped' && status.phase !== 'error' && (
          <button className="btn small" onClick={() => void toggle()} disabled={busy}>
            {status.paused ? 'Resume' : 'Pause'}
          </button>
        )}
      </div>
      <p className="small dim">{status.phase === 'error' ? status.error : status.detail}</p>
      {pct !== null ? (
        <div className="progress" aria-label={`${status.done} of ${status.total}`}>
          <span style={{ width: `${pct * 100}%` }} />
        </div>
      ) : (
        working && <div className="progress trn-indeterminate"><span /></div>
      )}
      <div className="small muted">
        {status.total ? `${status.done} of ${status.total} · ` : ''}
        {fmtDuration(status.phaseSeconds)} in this step · cycle {status.cycle || status.cycles + 1}
      </div>
      <div className="small muted">
        {status.modelKind} network · KataGo {status.katago} ({status.backend}) · {status.trainingHours.toFixed(1)} h of training so far
      </div>
      {status.log.length > 0 && (
        <details className="small">
          <summary>Recent output</summary>
          <pre className="trn-log">{status.log.join('\n')}</pre>
        </details>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ chart

function EloChart({ history }: { history: TrainerHistory }) {
  const pts = history.generations.filter((g): g is GenerationView & { elo: number } => g.elo !== null);
  const refs = history.references.filter((r) => r.label !== 'gen0');
  const [hover, setHover] = useState<number | null>(null);
  // Draw in CSS pixels (the SVG is as wide as its box) so text and strokes keep their size.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 500 ? 200 : 260,
    L = 44,
    R = 12,
    T = 14,
    B = 26;
  const vals = [0, ...pts.map((p) => p.elo), ...refs.map((r) => r.elo)];
  let lo = Math.min(...vals),
    hi = Math.max(...vals);
  const pad = Math.max(50, (hi - lo) * 0.08);
  lo -= pad;
  hi += pad;
  const n = pts.length;
  const x = (i: number) => L + (n <= 1 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = niceTicks(lo, hi, H < 240 ? 4 : 5);
  // Reference labels sit above their line; nudge them apart when two lines are close.
  const refLabels: (typeof refs[number] & { ty: number })[] = [];
  for (const r of [...refs].sort((a, b) => b.elo - a.elo)) {
    const prev = refLabels[refLabels.length - 1];
    const ty = prev && y(r.elo) - 5 < prev.ty + 14 ? prev.ty + 14 : y(r.elo) - 5;
    refLabels.push({ ...r, ty });
  }
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.elo).toFixed(1)}`).join('');
  const band =
    pts.length > 1
      ? pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.elo + (p.se ?? 0)).toFixed(1)}`).join('') +
        [...pts]
          .reverse()
          .map((p, j) => `L${x(n - 1 - j).toFixed(1)},${y(p.elo - (p.se ?? 0)).toFixed(1)}`)
          .join('') +
        'Z'
      : '';
  const area = pts.length > 1 ? `${line}L${x(n - 1)},${H - B}L${x(0)},${H - B}Z` : '';
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = n <= 1 ? 0 : Math.round(((px - L) / (W - L - R)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const h = hover !== null ? pts[hover] : null;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(4, Math.floor(W / 70))));
  return (
    <div className="trn-chart" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`Elo by generation, from ${fmtElo(pts[0]?.elo)} to ${fmtElo(pts[n - 1]?.elo)}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
            <text className="axis" x={L - 6} y={y(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {refLabels.map((r) => (
          <g key={r.label}>
            <line className="ref" x1={L} x2={W - R} y1={y(r.elo)} y2={y(r.elo)} />
            <text className="ref-label" x={W - R - 4} y={r.ty} textAnchor="end">
              {r.label === 'ref' ? `Reference b10, ${history.ratingVisits} visits` : 'Reference b10, instinct only'} ({fmtElo(r.elo)})
            </text>
          </g>
        ))}
        {band && <path className="band" d={band} />}
        {area && <path className="area" d={area} />}
        <path className="line" d={line} />
        {pts.map((p, i) => (i % labelEvery === 0 || i === n - 1 ? (
          <text key={p.label} className="axis" x={x(i)} y={H - 8} textAnchor="middle">
            {p.gen}
          </text>
        ) : null))}
        {pts.map((p, i) =>
          // With many generations only the newest and the hovered one get a dot.
          n <= 40 || i === n - 1 || i === hover ? (
            <circle key={p.label} className={`pt ${i === n - 1 ? 'last' : ''}`} cx={x(i)} cy={y(p.elo)} r={i === n - 1 ? 5 : hover === i ? 4.5 : 3} />
          ) : null,
        )}
        {h && hover !== null && <line className="cross" x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} />}
      </svg>
      {h && hover !== null && (
        <div className="trn-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <strong>
            {h.label}: {fmtElo(h.elo)} Elo
          </strong>
          {h.se !== null && <span> ±{Math.round(h.se)}</span>}
          <div className="muted">
            {h.trainSamples ? `${shortNum(h.trainSamples)} positions learned · ` : ''}
            {(h.selfplayGames ?? 0).toLocaleString()} self-play games · {fmtAgo(h.created)}
          </div>
        </div>
      )}
      <div className="small muted trn-axis-note">Generation</div>
    </div>
  );
}

function niceTicks(lo: number, hi: number, count: number): number[] {
  const span = hi - lo;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Math.round(v));
  return out;
}

function Milestones({ history }: { history: TrainerHistory }) {
  const ms = milestones(history);
  return (
    <div className="panel stack trn-milestones">
      <h3>Milestones</h3>
      <ul>
        {ms.map((m) => (
          <li key={m.id} className={m.reachedAt ? 'done' : ''}>
            <span className="trn-check" aria-hidden>
              {m.reachedAt ? '✓' : ''}
            </span>
            <div>
              <strong>{m.title}</strong>
              <div className="small muted">{m.reachedAt ? `${m.gen}, ${fmtAgo(m.reachedAt)}` : m.detail}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ play

interface Game {
  id: number;
  size: number;
  komi: number;
  user: Color;
  moves: Move[];
  /** "latest" follows the newest generation move by move. */
  model: string;
  visits: number;
}

const colorAt = (i: number): Color => (i % 2 === 0 ? 1 : 2);

function Play({ status, gens }: { status: TrainerStatus; gens: GenerationView[] }) {
  const [setup, setSetup] = useState({ size: 19, komi: 7.5, user: 1 as Color, model: 'latest', visits: 400 });
  const [game, setGame] = useState<Game | null>(null);
  const [reply, setReply] = useState<PlayResponse | null>(null);
  const [err, setErr] = useState('');
  const [retry, setRetry] = useState(0);
  const inFlight = useRef<string>('');

  const board = useMemo(() => (game ? replay(game.size, [], game.moves) : null), [game]);
  const ply = game?.moves.length ?? 0;
  const over = !!game && ply >= 2 && game.moves[ply - 1].loc === PASS && game.moves[ply - 2].loc === PASS;
  const engineTurn = !!game && !over && colorAt(ply) !== game.user;

  useEffect(() => {
    if (!game || !engineTurn) return;
    const key = `${game.id}:${ply}:${retry}`;
    if (inFlight.current === key) return;
    inFlight.current = key;
    setErr('');
    trainer
      .play({
        moves: game.moves.map((m) => [m.color === 1 ? 'B' : 'W', m.loc === PASS ? 'pass' : locToGtp(m.loc, game.size)]),
        size: game.size,
        komi: game.komi,
        rules: 'chinese',
        visits: game.visits,
        model: game.model,
      })
      .then((r) => {
        setReply(r);
        const loc = r.move.toLowerCase() === 'pass' ? PASS : gtpToLoc(r.move, game.size);
        setGame((g) => (g && g.id === game.id && g.moves.length === ply ? { ...g, moves: [...g.moves, { color: colorAt(ply), loc }] } : g));
      })
      .catch((e) => {
        inFlight.current = '';
        setErr(e instanceof TrainerError ? e.message : String(e));
      });
  }, [game, engineTurn, ply, retry]);

  if (!game || !board) {
    const opts = [{ v: 'latest', l: `Newest (${status.latest?.label ?? 'none yet'})` }, ...[...gens].reverse().filter((g) => g.playable).map((g) => ({ v: g.label, l: `${g.label}${g.elo !== null ? ` · ${fmtElo(g.elo)} Elo` : ''}` }))];
    return (
      <div className="panel stack trn-play-setup">
        <h3>Play it</h3>
        <p className="small dim">
          It plays with KataGo's search on your GPU. "Newest" switches to each new generation as soon as it is ready, even in the middle of a game, so you feel it getting stronger. Pick an older generation to
          see how far it has come.
        </p>
        <div className="trn-form">
          <label>
            <span className="field-label">Opponent</span>
            <select value={setup.model} onChange={(e) => setSetup({ ...setup, model: e.target.value })}>
              {opts.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.l}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">You play</span>
            <select value={setup.user} onChange={(e) => setSetup({ ...setup, user: Number(e.target.value) as Color })}>
              <option value={1}>Black (first)</option>
              <option value={2}>White</option>
            </select>
          </label>
          <label>
            <span className="field-label">Board</span>
            <select value={setup.size} onChange={(e) => setSetup({ ...setup, size: Number(e.target.value), komi: Number(e.target.value) === 19 ? 7.5 : 7 })}>
              <option value={19}>19×19</option>
              <option value={13}>13×13</option>
              <option value={9}>9×9</option>
            </select>
          </label>
          <label>
            <span className="field-label">Komi</span>
            <select value={setup.komi} onChange={(e) => setSetup({ ...setup, komi: Number(e.target.value) })}>
              {[7.5, 7, 6.5, 5.5, 0.5, 0, -0.5].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">Thinking</span>
            <select value={setup.visits} onChange={(e) => setSetup({ ...setup, visits: Number(e.target.value) })}>
              <option value={1}>Instinct only (1 visit)</option>
              <option value={100}>Quick (100 visits)</option>
              <option value={400}>Normal (400 visits)</option>
              <option value={1600}>Deep (1600 visits)</option>
            </select>
          </label>
        </div>
        <button className="btn primary" style={{ justifySelf: 'start' }} disabled={!status.generations} onClick={() => setGame({ id: Date.now(), moves: [], ...setup })}>
          {status.generations ? 'Start a game' : 'Waiting for the first network'}
        </button>
      </div>
    );
  }

  const onPlay = (loc: Loc) => {
    if (engineTurn || over) return;
    if (loc !== PASS && !board.isLegal(loc, game.user)) return;
    setGame((g) => (g && g.moves.length === ply ? { ...g, moves: [...g.moves, { color: game.user, loc }] } : g));
  };
  const undo = () => {
    const lastUser = [...game.moves.keys()].reverse().find((i) => game.moves[i].color === game.user);
    if (lastUser === undefined) return;
    inFlight.current = '';
    setReply(null);
    setGame({ ...game, id: game.id, moves: game.moves.slice(0, lastUser) });
  };
  const last = game.moves.length ? game.moves[game.moves.length - 1].loc : null;
  const lastEngine = [...game.moves].reverse().find((m) => m.color !== game.user);
  return (
    <div className="panel trn-game">
      <div className="trn-game-board">
        <Board size={game.size} stones={board.stones} lastMove={last} toPlay={engineTurn ? undefined : game.user} onPlay={engineTurn || over ? undefined : onPlay} coords ariaLabel="Game against the home-trained network" />
      </div>
      <div className="stack trn-game-side">
        <div className="spread">
          <h3 className="with-icon">
            <span className="live-dot" data-on={engineTurn && !err ? '1' : '0'} /> Playing {reply?.model ?? (game.model === 'latest' ? status.latest?.label : game.model)}
          </h3>
          <span className="small muted">
            you: <i className={`stone-dot ${game.user === 1 ? 'b' : 'w'}`} /> {game.user === 1 ? 'Black' : 'White'} · komi {game.komi}
          </span>
        </div>
        <WinBar bWin={reply?.winrate ?? null} bLead={reply?.scoreLead ?? null} pending={engineTurn} />
        <div className="small dim">
          {err ? (
            <span className="bad">
              {err}{' '}
              <button className="btn small" onClick={() => setRetry((r) => r + 1)}>
                Try again
              </button>
            </span>
          ) : over ? (
            <>Game over: both passed.{reply?.scoreLead != null && <> Its estimate: {reply.scoreLead >= 0 ? 'B' : 'W'}+{Math.abs(reply.scoreLead).toFixed(1)}.</>}</>
          ) : engineTurn ? (
            'Thinking…'
          ) : (
            <>
              Your move.
              {lastEngine && lastEngine.loc === PASS ? ' It passed.' : ''}
              {reply && reply.seconds ? ` It read ${reply.visits ?? 0} positions in ${reply.seconds.toFixed(1)} s.` : ''}
            </>
          )}
        </div>
        {reply && reply.candidates.length > 1 && !engineTurn && (
          <div className="small muted">
            It considered{' '}
            {reply.candidates
              .slice(0, 4)
              .map((c) => `${c.move} (${fmtPct(c.winrate)} for Black, ${c.visits} visits)`)
              .join(', ')}
            .
          </div>
        )}
        <div className="row wrap">
          <button className="btn small" onClick={undo}>
            ◀ Take back
          </button>
          <button className="btn small ghost" onClick={() => onPlay(PASS)} disabled={engineTurn || over}>
            Pass
          </button>
          <span className="grow" />
          <button
            className="btn small ghost"
            onClick={() => {
              setGame(null);
              setReply(null);
              setErr('');
            }}
          >
            New game
          </button>
        </div>
      </div>
    </div>
  );
}
