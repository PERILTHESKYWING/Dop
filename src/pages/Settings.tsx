import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { queueDeepPositions, rebuildProfile, refreshLlmStatus, resetEverything, restartEngine, saveSettings, setPlayerNames, startEngine, trainLabModel } from '../state/actions';
import { fmtPct } from '../components/common';
import { MODELS } from '../lib/engine/models';
import { storageEstimate } from '../lib/db/db';

const mb = (n: number) => `${(n / 1_048_576).toFixed(n > 1e8 ? 0 : 1)} MB`;

function Check({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string }) {
  return (
    <div className="spread small">
      <span>
        <span className={`dot ${ok === null ? '' : ok ? 'good' : 'bad'}`} /> {label}
      </span>
      <span className="muted">{detail ?? (ok === null ? 'checking' : ok ? 'yes' : 'no')}</span>
    </div>
  );
}

function EngineSection() {
  const settings = useStore((s) => s.settings);
  const caps = useStore((s) => s.caps);
  const engine = useStore((s) => s.engine);
  const p = engine.progress;
  return (
    <div className="panel stack">
      <h3>KataGo engine</h3>
      <Check ok={caps ? caps.webgpu : null} label="WebGPU" detail={caps?.webgpu ? caps.webgpuAdapter || 'available' : caps ? 'not available, using CPU (WASM)' : undefined} />
      <Check ok={caps ? caps.wasm : null} label="WebAssembly" />
      <Check ok={caps ? caps.workers : null} label="Web Workers" />
      <Check ok={caps ? caps.indexedDB : null} label="IndexedDB storage" />
      <Check ok={caps ? caps.cacheApi : null} label="Network cache" detail={caps && !caps.cacheApi ? 'networks re-download each visit' : undefined} />
      <div className="divider" />
      <div className="kv small">
        <dt>Status</dt>
        <dd className={engine.status === 'error' || engine.status === 'unsupported' ? 'bad' : engine.status === 'ready' ? 'good' : ''}>{engine.status}</dd>
        {engine.info && (
          <>
            <dt>Network</dt>
            <dd>{engine.info.modelName}</dd>
            <dt>Backend</dt>
            <dd>{engine.info.backend === 'webgpu' ? 'WebGPU' : 'CPU (WASM)'}</dd>
            <dt>Build</dt>
            <dd className="mono">{engine.info.engine}</dd>
          </>
        )}
        {engine.error && (
          <>
            <dt>Error</dt>
            <dd className="bad">{engine.error}</dd>
          </>
        )}
      </div>
      {engine.status === 'loading' && p && (
        <div>
          <div className="tiny muted">
            {p.stage === 'download' ? `Downloading ${p.modelId}` : p.stage === 'cache' ? 'Reading cached network' : 'Loading network'}
            {p.total > 0 && ` · ${mb(p.loaded)} / ${mb(p.total)}`}
          </div>
          <div className="progress">
            <span style={{ width: `${p.total ? (p.loaded / p.total) * 100 : 30}%` }} />
          </div>
        </div>
      )}
      <label className="stack small">
        Network
        <select value={settings.modelId} onChange={(e) => void saveSettings({ modelId: e.target.value })}>
          <option value="auto">Automatic: strongest that runs well here</option>
          {MODELS.map((m) => (
            <option key={m.id} value={m.id} disabled={!!m.incompatible}>
              {m.name} · ~{m.approxMB} MB{m.incompatible ? ' (not supported)' : m.gpuOnly ? ' (WebGPU recommended)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="row small">
        <input type="checkbox" checked={settings.forceCpu} onChange={(e) => void saveSettings({ forceCpu: e.target.checked })} /> Force CPU backend
      </label>
      <div className="row wrap">
        <label className="stack small">
          Deep analysis visits
          <select value={settings.deepVisits} onChange={(e) => void saveSettings({ deepVisits: Number(e.target.value) })}>
            {[16, 32, 64, 128, 256, 512].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="stack small">
          Deep positions per game
          <select value={settings.deepPerGame} onChange={(e) => void saveSettings({ deepPerGame: Number(e.target.value) })}>
            {[8, 16, 24, 40, 60].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="row small">
        <input type="checkbox" checked={settings.autoAnalyze} onChange={(e) => void saveSettings({ autoAnalyze: e.target.checked })} /> Analyse imported games automatically
      </label>
      <div className="row">
        <button className="btn primary" onClick={() => void (engine.status === 'ready' || engine.status === 'error' ? restartEngine() : startEngine())}>
          {engine.status === 'ready' || engine.status === 'error' ? 'Apply and restart engine' : 'Start engine'}
        </button>
      </div>
      <p className="tiny muted">Networks are downloaded from katagotraining.org on first use and cached in this browser. Every analysis stores the engine, network, version and visits used.</p>
      <details className="small">
        <summary>Available networks</summary>
        <table className="data">
          <tbody>
            {MODELS.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td className="small muted">{m.incompatible ?? m.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function PlayerSection() {
  const settings = useStore((s) => s.settings);
  const [names, setNames] = useState(settings.playerNames.join(', '));
  useEffect(() => setNames(settings.playerNames.join(', ')), [settings.playerNames]);
  return (
    <div className="panel stack">
      <h3>You</h3>
      <label className="stack small">
        Your names in SGF files (comma-separated)
        <input value={names} onChange={(e) => setNames(e.target.value)} placeholder="e.g. mira, Mira K." />
      </label>
      <div className="row">
        <button
          className="btn"
          onClick={() =>
            void setPlayerNames(
              names
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean),
            )
          }
        >
          Save and re-detect sides
        </button>
      </div>
    </div>
  );
}

function LlmSection() {
  const settings = useStore((s) => s.settings);
  const llm = useStore((s) => s.llm);
  return (
    <div className="panel stack">
      <h3>Pattern discovery (LLM)</h3>
      <Check ok={llm ? llm.available : null} label="Language model" detail={llm ? (llm.available ? llm.model : llm.configured ? llm.error ?? 'unavailable' : 'not configured') : undefined} />
      <label className="row small">
        <input type="checkbox" checked={settings.useLlm} onChange={(e) => void saveSettings({ useLlm: e.target.checked })} /> Use it to describe patterns
      </label>
      <p className="tiny muted">
        The model only names and groups patterns in compressed evidence that KataGo already measured. It never produces numbers, and everything works without it. The API key stays on the server
        (LLM_API_KEY); it is never sent to this page.
      </p>
      <div className="row">
        <button className="btn small" onClick={() => void refreshLlmStatus()}>
          Check again
        </button>
      </div>
    </div>
  );
}

function LabSection() {
  const models = useStore((s) => s.labModels);
  const datasets = useStore((s) => s.datasets);
  const hard = useStore((s) => s.hardExamples);
  const busy = useStore((s) => s.busy);
  const latest = models[0];
  return (
    <div className="panel stack">
      <div className="spread">
        <h3>Model lab</h3>
        <button className="btn small primary" disabled={busy.lab} onClick={() => void trainLabModel()}>
          {busy.lab ? `${busy.labStage ?? 'Training'}…` : latest ? `Train version ${latest.version + 1}` : 'Train first version'}
        </button>
      </div>
      <p className="small dim">
        A small pattern model learns from your KataGo analyses in the background, is benchmarked against KataGo's choices, and sends the positions it gets most wrong back for deeper analysis. Each
        version is kept with the dataset it was trained on. It is a study aid and far weaker than KataGo.
      </p>
      {busy.lab && (
        <div className="progress">
          <span style={{ width: `${(busy.labProgress ?? 0) * 100}%` }} />
        </div>
      )}
      {models.length > 0 && (
        <table className="data">
          <thead>
            <tr>
              <th>Version</th>
              <th>Positions</th>
              <th>Agrees with KataGo</th>
              <th>Top 5</th>
              <th>Baseline</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id}>
                <td className="mono">v{m.version}</td>
                <td className="mono small">{m.trainPositions}</td>
                <td className="mono">{fmtPct(m.benchmark.top1, 1)}</td>
                <td className="mono small">{fmtPct(m.benchmark.top5, 1)}</td>
                <td className="mono small muted" title="Nearest-to-last-move heuristic / uniform guess">
                  {fmtPct(m.benchmark.baselines.nearLastTop1, 1)} / {fmtPct(m.benchmark.baselines.uniformTop1, 1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {datasets.length > 0 && (
        <div className="tiny muted">
          Dataset v{datasets[0].version}: {datasets[0].positions} positions ({datasets[0].deepPositions} deep) from {datasets[0].games} games · {datasets[0].engineModels.join(', ')}
        </div>
      )}
      {hard.length > 0 && (
        <div className="row spread small">
          <span>{hard.length} positions the model found hardest</span>
          <button className="btn small" onClick={() => void queueDeepPositions(hard)}>
            Queue deep analysis
          </button>
        </div>
      )}
    </div>
  );
}

function StorageSection() {
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const counts = { g: useStore((s) => s.games.length), a: useStore((s) => s.attempts.length) };
  useEffect(() => {
    void storageEstimate().then(setEst);
  }, [counts.g, counts.a]);
  return (
    <div className="panel stack">
      <h3>Data</h3>
      <p className="small dim">Everything is stored in this browser only: games, analyses, your profile and training history.</p>
      {est && (
        <div className="small">
          Using {mb(est.usage)} of {mb(est.quota)}
        </div>
      )}
      <div className="row wrap">
        <button className="btn small" onClick={() => void rebuildProfile()}>
          Rebuild profile
        </button>
        <button
          className="btn small ghost bad"
          onClick={() => {
            if (confirm('Delete all games, analyses, profile and training history from this browser?')) void resetEverything();
          }}
        >
          Delete everything
        </button>
      </div>
      <p className="tiny muted">
        DOPPELGÄNGER runs KataGo (MIT) compiled to WebAssembly from saigo-online/katago-webgpu. See THIRD_PARTY_NOTICES.md in the repository for all licences.
      </p>
    </div>
  );
}

export function Settings() {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Engine & Settings</h1>
        </div>
      </div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <EngineSection />
          <PlayerSection />
        </div>
        <div className="stack">
          <LabSection />
          <LlmSection />
          <StorageSection />
        </div>
      </div>
    </div>
  );
}
