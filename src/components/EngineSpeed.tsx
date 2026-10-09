import { useState } from 'react';
import { getEngine, pauseQueue, resumeQueue, retuneEngine } from '../state/actions';
import { useStore } from '../state/store';
import { usePower } from '../lib/engine/governor';
import { nnCacheFor } from '../lib/engine/mcts';
import { QUICK_BENCH, runBenchmark, type BenchReport, type SetupResult } from '../lib/engine/benchmark';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const POWER: Record<string, string> = {
  full: 'Full speed',
  battery: 'Saving battery',
  'low-battery': 'Battery low: background paused',
  hot: 'Device hot: slowed down',
};

/** Engine speed on this device: the measured setup, power state, and the benchmark. */
export function EngineSpeed() {
  const engine = useStore((s) => s.engine);
  const forceCpu = useStore((s) => s.settings.forceCpu);
  const power = usePower();
  const [bench, setBench] = useState<{ running: boolean; text?: string; done?: number; total?: number; report?: BenchReport; error?: string }>({ running: false });
  const [stopFlag] = useState({ stop: false });
  const eng = getEngine();
  if (engine.status !== 'ready' || !eng) return null;
  const t = eng.tuning;
  const cache = nnCacheFor(eng).stats();
  const hitRate = cache.hits + cache.misses ? cache.hits / (cache.hits + cache.misses) : 0;

  const start = async () => {
    stopFlag.stop = false;
    pauseQueue();
    setBench({ running: true, text: 'Starting' });
    try {
      const report = await runBenchmark({
        ...QUICK_BENCH,
        forceCpu: forceCpu || eng.info.backend !== 'webgpu',
        shouldStop: () => stopFlag.stop,
        onProgress: (text, done, total) => setBench((b) => ({ ...b, text, done, total })),
      });
      setBench({ running: false, report });
    } catch (e) {
      setBench({ running: false, error: (e as Error).message });
    } finally {
      resumeQueue();
    }
  };

  return (
    <div className="stack tight small">
      <div className="engine-now">
        <strong>
          {t ? `${Math.round(t.evalsPerSec)} positions/s` : `${Math.round(1000 / Math.max(1, eng.evalMs))} positions/s`}
          {t && t.baselineEvalsPerSec ? ` (${(t.evalsPerSec / t.baselineEvalsPerSec).toFixed(1)}x the plain setup)` : ''}
        </strong>
        <span className="tiny muted">
          {eng.build === 'kataeval' ? 'SIMD build' : 'compatibility build'} · {eng.laneCount} {eng.laneCount === 1 ? 'worker' : 'workers'} · {eng.laneBatch} per call
          {t?.fp16 ? ' · half precision' : ''} · {POWER[power.mode]}
          {power.maxLanes > 1 && power.lanes < power.maxLanes ? ` (${power.lanes} of ${power.maxLanes} workers)` : ''}
          {cache.hits + cache.misses > 0 ? ` · cache ${pct(hitRate)} hits` : ''}
        </span>
      </div>
      <div className="row wrap">
        <button className="btn small" onClick={() => void retuneEngine()} disabled={bench.running}>
          Measure again
        </button>
        {!bench.running ? (
          <button className="btn small" onClick={() => void start()}>
            Benchmark (about 3 min)
          </button>
        ) : (
          <button className="btn small" onClick={() => (stopFlag.stop = true)}>
            Stop
          </button>
        )}
      </div>
      {bench.running && (
        <div className="stack tight">
          <div className="tiny muted">{bench.text}</div>
          <div className="progress">
            <span style={{ width: bench.total ? `${((bench.done ?? 0) / bench.total) * 100}%` : '0%' }} />
          </div>
        </div>
      )}
      {bench.error && <div className="callout bad tiny">{bench.error}</div>}
      {bench.report && <BenchTable r={bench.report} />}
      {t && t.log.length > 0 && (
        <details className="tiny">
          <summary>Measurements</summary>
          <pre className="tiny muted" style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{t.log.join('\n')}</pre>
        </details>
      )}
    </div>
  );
}

function BenchTable({ r }: { r: BenchReport }) {
  const rows: [string, (s: SetupResult) => string][] = [
    ['Speed', (s) => `${Math.round(s.evalsPerSec)}/s`],
    [`Best move right, ${r.baseline.visits} visits`, (s) => pct(s.agreeAtVisits)],
    ['Best move right, 1 s', (s) => pct(s.agreeInTime)],
    ['Visits in 1 s', (s) => String(Math.round(s.avgVisitsInTime))],
    [`Score error, ${r.baseline.visits} visits`, (s) => `${s.scoreErrAtVisits.toFixed(1)} pts`],
    [`Time for ${r.baseline.visits} visits`, (s) => `${(s.msPerPositionAtVisits / 1000).toFixed(1)} s`],
    ['Compute per position', (s) => `${s.computeMsPerEval.toFixed(0)} ms`],
    ['Memory', (s) => `${s.heapMB} MB`],
  ];
  const sus = r.tuned.sustained;
  return (
    <div className="stack tight">
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th />
              <th>Before</th>
              <th>Now</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, f]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{f(r.baseline)}</td>
                <td>{f(r.tuned)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tiny muted">
        Scored against native KataGo ({r.reference.deepVisits} visits). KataGo's own search at {r.reference.lightVisits} visits picks the same move{' '}
        {pct(r.tuned.katagoAgreeAtVisits)} of the time.
        {sus ? ` Sustained: ${Math.round(sus.firstEvalsPerSec)}/s at the start, ${Math.round(sus.lastEvalsPerSec)}/s after ${sus.seconds} s.` : ''}
        {r.battery ? ` Battery: ${pct(r.battery.start)} to ${pct(r.battery.end)}.` : ''}
      </p>
    </div>
  );
}
