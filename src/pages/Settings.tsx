import { EngineSpeed } from '../components/EngineSpeed';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import {
  getEngine,
  gpuMarkedBroken,
  inSafeMode,
  loadNetworkFile,
  queueDeepPositions,
  rebuildProfile,
  refreshLlmStatus,
  removeDemo,
  resetEverything,
  restartEngine,
  retryGpu,
  saveSettings,
  searchVisitsFor,
  setPlayerNames,
  startEngine,
  trainLabModel,
} from '../state/actions';
import { fmtPct } from '../components/common';
import { Icon } from '../components/Icons';
import { customModel, modelById, MODELS } from '../lib/engine/models';
import { storageEstimate } from '../lib/db/db';
import { DEFAULT_THEME, THEMES, type ThemeId } from '../lib/themes';
import { switchTheme } from '../components/Scenery';

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
  const fileInput = useRef<HTMLInputElement>(null);
  const p = engine.progress;
  const gpuBroken = gpuMarkedBroken();
  const safe = inSafeMode();
  const custom = customModel(settings.modelId);
  const liveEngine = getEngine();
  return (
    <div className="panel stack">
      <div className="spread">
        <h3 className="with-icon">
          <Icon name="cpu" style={{ width: 16, height: 16 }} /> KataGo engine
        </h3>
        <span className={`chip ${engine.status === 'ready' ? 'good' : engine.status === 'error' || engine.status === 'unsupported' ? 'bad' : ''}`}>
          {engine.status === 'ready' ? 'ready' : engine.status === 'off' ? 'starts when needed' : engine.status}
        </span>
      </div>
      {engine.info && engine.status === 'ready' && (
        <div className="engine-now">
          <strong>{engine.info.modelName}</strong>
          <span className="small dim">
            {engine.info.backend === 'webgpu' ? 'on the graphics card (WebGPU)' : 'on the CPU'}
            {engine.evalMs ? ` · about ${engine.evalMs} ms per position` : ''}
          </span>
        </div>
      )}
      <EngineSpeed />
      {engine.status === 'loading' && (
        <div className="stack tight">
          <div className="tiny muted">
            {p?.stage === 'download'
              ? `Downloading ${p.modelId}${p.source ? ` from ${p.source}` : ''}${p.total > 0 ? ` · ${mb(p.loaded)} / ${mb(p.total)}` : ` · ${mb(p.loaded)}`}`
              : p?.stage === 'cache'
                ? 'Reading the network saved in this browser'
                : p?.stage === 'check'
                  ? 'Testing the network on this device'
                  : 'Loading the network'}
          </div>
          <div className={`progress ${p?.stage === 'download' && p.total ? '' : 'indeterminate'}`}>
            <span style={{ width: p?.stage === 'download' && p.total ? `${(p.loaded / p.total) * 100}%` : undefined }} />
          </div>
        </div>
      )}
      {engine.status === 'error' && <div className="callout bad small" style={{ whiteSpace: 'pre-wrap' }}>{engine.error}</div>}
      {engine.note && <div className="callout small">{engine.note}</div>}
      {engine.status === 'ready' && engine.failures && engine.failures.length > 0 && (
        <details className="small">
          <summary>Tried first, but could not use ({engine.failures.length})</summary>
          <pre className="tiny muted" style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{engine.failures.join('\n')}</pre>
        </details>
      )}
      {gpuBroken && caps?.webgpu && (
        <div className="callout small">
          The graphics card failed to run KataGo last time, so the CPU is used.{' '}
          <button className="btn small" onClick={() => void retryGpu()}>
            Try the graphics card again
          </button>
        </div>
      )}
      {safe && (
        <div className="callout small">
          Safe mode: the built-in network on the CPU.{' '}
          <button className="btn small" onClick={() => void restartEngine()}>
            Leave safe mode
          </button>
        </div>
      )}

      <div className="divider" />
      <label className="stack tight small">
        <span className="field-label">Network</span>
        <select value={settings.modelId} onChange={(e) => void saveSettings({ modelId: e.target.value })}>
          <option value="auto">Automatic: the strong network with WebGPU, the built-in one on the CPU</option>
          {custom && <option value={custom.id}>{custom.name}</option>}
          {MODELS.map((m) => (
            <option key={m.id} value={m.id} disabled={!!m.incompatible}>
              {m.name} · {m.approxMB} MB{m.incompatible ? ' (not supported)' : m.gpuOnly ? ' (needs WebGPU)' : ''}
            </option>
          ))}
        </select>
      </label>
      <p className="tiny muted">{(modelById(settings.modelId) ?? null)?.note ?? 'Picks kata1 b18c384nbt when WebGPU works and the built-in g170e b10c128 otherwise. The built-in network ships with the site, so analysis works even when downloads are blocked.'}</p>
      <div className="row wrap">
        <button className="btn small" onClick={() => fileInput.current?.click()}>
          <Icon name="upload" /> Load a network file…
        </button>
        <span className="tiny muted">A .bin.gz from katagotraining.org, for when downloads are blocked here.</span>
        <input
          ref={fileInput}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void loadNetworkFile(f);
          }}
        />
      </div>
      <label className="row small">
        <input type="checkbox" checked={settings.forceCpu} onChange={(e) => void saveSettings({ forceCpu: e.target.checked })} /> Always use the CPU
      </label>
      <div className="row wrap">
        <label className="stack tight small">
          <span className="field-label">Search per position (game analysis)</span>
          <select value={settings.searchVisits} onChange={(e) => void saveSettings({ searchVisits: Number(e.target.value) })}>
            <option value={0}>Automatic{engine.status === 'ready' && liveEngine ? ` (${searchVisitsFor(liveEngine, 0)} visits here)` : ''}</option>
            {[16, 32, 64, 128, 256, 512, 1024].map((v) => (
              <option key={v} value={v}>
                {v} visits
              </option>
            ))}
          </select>
        </label>
        <label className="stack tight small">
          <span className="field-label">Live analysis stops at</span>
          <select value={settings.ponderLimit} onChange={(e) => void saveSettings({ ponderLimit: Number(e.target.value) })}>
            <option value={0}>Never (keeps reading)</option>
            {[500, 2000, 10000, 50000].map((v) => (
              <option key={v} value={v}>
                {v.toLocaleString()} visits
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="tiny muted">
        Every position of every game gets a quick look from the network first, then a tree search. Live analysis (Space in Game Review and on the
        analysis boards) keeps searching the position on screen, so its numbers get more reliable the longer it runs; games wait while it does.
      </p>
      <label className="row small">
        <input type="checkbox" checked={settings.autoAnalyze} onChange={(e) => void saveSettings({ autoAnalyze: e.target.checked })} /> Analyse imported games automatically
      </label>
      <div className="row wrap">
        <button className="btn primary" onClick={() => void (engine.status === 'off' || engine.status === 'unsupported' ? startEngine() : restartEngine())}>
          {engine.status === 'off' ? 'Start KataGo' : 'Apply and restart KataGo'}
        </button>
        <button className="btn" onClick={() => void restartEngine({ safe: true })} title="Built-in network on the CPU">
          Safe mode
        </button>
      </div>
      <details className="small">
        <summary>This device</summary>
        <div className="stack tight" style={{ marginTop: 8 }}>
          <Check ok={caps ? caps.webgpu : null} label="WebGPU" detail={caps?.webgpu ? caps.webgpuAdapter || 'available' : caps ? 'not available, the CPU is used' : undefined} />
          <Check ok={caps ? caps.wasm : null} label="WebAssembly" />
          <Check ok={caps ? caps.workers : null} label="Web Workers" />
          <Check ok={caps ? caps.indexedDB : null} label="Storage (IndexedDB)" />
          <Check ok={caps ? caps.cacheApi : null} label="Network cache" detail={caps && !caps.cacheApi ? 'networks download again each visit' : undefined} />
          {engine.info && <Check ok={true} label="Engine build" detail={engine.info.engine} />}
        </div>
      </details>
      <details className="small">
        <summary>Available networks</summary>
        <div className="table-scroll">
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
        </div>
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
      <label className="stack tight small">
        <span className="field-label">Your names in SGF files (comma-separated)</span>
        <input value={names} onChange={(e) => setNames(e.target.value)} placeholder="e.g. 1kuyoo, 一子道长青" />
      </label>
      <p className="tiny muted">Games where one of these names played are matched to you automatically. You can also pick your side game by game in the Game Library.</p>
      <div className="row">
        <button
          className="btn"
          onClick={() =>
            void setPlayerNames(
              names
                .split(/[,，、]/)
                .map((x) => x.trim())
                .filter(Boolean),
            )
          }
        >
          Save and match my games
        </button>
      </div>
    </div>
  );
}

function PracticeSection() {
  const settings = useStore((s) => s.settings);
  const [v, setV] = useState(settings.minLosingWinrate);
  useEffect(() => setV(settings.minLosingWinrate), [settings.minLosingWinrate]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <div className="panel stack">
      <h3>Practice positions</h3>
      <label className="stack tight small">
        <span className="spread">
          <span className="field-label">The side that is behind keeps at least</span>
          <strong className="mono">{Math.round(v * 100)}%</strong>
        </span>
        <input
          type="range"
          min={0.1}
          max={0.45}
          step={0.05}
          value={v}
          onChange={(e) => {
            const x = Number(e.target.value);
            setV(x);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => void saveSettings({ minLosingWinrate: x }).then(() => rebuildProfile()), 500);
          }}
        />
      </label>
      <p className="tiny muted">Forge, blind tests and engine variations only use positions that are still a game. Lopsided positions, where almost any move wins or loses, are left out.</p>
    </div>
  );
}

function AppearanceSection() {
  const settings = useStore((s) => s.settings);
  const theme = settings.theme ?? DEFAULT_THEME;
  const [pending, setPending] = useState<ThemeId | null>(null);
  const opts: { v: typeof settings.effects; label: string; hint: string }[] = [
    { v: 'auto', label: 'Automatic', hint: 'full effects on capable devices' },
    { v: 'full', label: 'Full', hint: 'moving light, clouds and glass' },
    { v: 'light', label: 'Light', hint: 'still background, fastest' },
  ];
  const pick = async (id: ThemeId) => {
    if (id === theme || pending) return;
    setPending(id);
    try {
      await switchTheme(id);
    } finally {
      setPending(null);
    }
  };
  return (
    <div className="panel stack">
      <h3>Appearance</h3>
      <div className="theme-cards" role="radiogroup" aria-label="Background theme">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={theme === t.id}
            className={`theme-card${theme === t.id ? ' on' : ''}${pending === t.id ? ' busy' : ''}`}
            onClick={() => void pick(t.id)}
          >
            <span className="theme-thumb">
              <img src={`/art/${t.id}/thumb.webp`} alt="" width={480} height={270} loading="lazy" decoding="async" />
              {theme === t.id && (
                <span className="theme-check">
                  <Icon name="check" />
                </span>
              )}
            </span>
            <span className="theme-name">
              {t.name}
              {t.dark && <span className="theme-tag">dark</span>}
            </span>
            <span className="theme-desc">{t.description}</span>
          </button>
        ))}
      </div>
      <div className="field-label">Motion and effects</div>
      <div className="segmented">
        {opts.map((o) => (
          <button key={o.v} className={settings.effects === o.v ? 'on' : ''} onClick={() => void saveSettings({ effects: o.v })}>
            <strong>{o.label}</strong>
            <span>{o.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LlmSection() {
  const settings = useStore((s) => s.settings);
  const llm = useStore((s) => s.llm);
  const checking = useStore((s) => s.busy.llmCheck);
  const test = llm?.test;
  return (
    <div className="panel stack">
      <div className="spread">
        <h3>Pattern discovery (LLM)</h3>
        <span className={`chip ${llm?.available ? 'good' : llm?.configured ? 'bad' : ''}`}>{llm ? (llm.available ? 'connected' : llm.configured ? 'not answering' : 'off') : 'checking'}</span>
      </div>
      {llm && !llm.configured && (
        <div className="callout small">
          {llm.error?.includes('LLM_API_KEY') ? (
            <>
              Not set up. In Vercel, open your project, then <strong>Settings → Environment Variables</strong>, add <span className="mono">LLM_API_KEY</span> (your Google AI Studio key) and redeploy.
              Everything else works without it.
            </>
          ) : (
            llm.error
          )}
        </div>
      )}
      {test && (
        <div className={`callout small ${test.ok ? 'good' : 'bad'}`}>
          {test.ok ? (
            <>
              Working: <strong>{test.model}</strong> answered in {((test.ms ?? 0) / 1000).toFixed(1)} s.
            </>
          ) : (
            <>
              The test call failed.
              <ul className="notes">
                {test.errors.slice(-4).map((e, i) => (
                  <li key={i} className="tiny">
                    {e}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {llm?.models && llm.models.length > 0 && <p className="tiny muted">Models tried in order: {llm.models.join(' → ')}. Busy or retired models are skipped automatically.</p>}
      <div className="row wrap">
        <button className="btn" disabled={checking} onClick={() => void refreshLlmStatus(true)}>
          {checking ? 'Testing…' : 'Test connection'}
        </button>
        <label className="row small">
          <input type="checkbox" checked={settings.useLlm} onChange={(e) => void saveSettings({ useLlm: e.target.checked })} /> Use it to describe patterns
        </label>
      </div>
      <p className="tiny muted">
        The model only names and groups patterns in evidence KataGo already measured; it never produces numbers. The API key stays on the server and is never sent to this page.
      </p>
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
        <div className="table-scroll">
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
        </div>
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
  const hasDemo = useStore((s) => s.games.some((g) => g.source === 'demo'));
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
        {hasDemo && (
          <button className="btn small" onClick={() => void removeDemo()}>
            Remove demo data
          </button>
        )}
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
          <div className="eyebrow">Setup</div>
          <h1>Engine & Settings</h1>
          <p className="sub">KataGo, your player names, practice limits and the optional language model.</p>
        </div>
      </div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <EngineSection />
          <PlayerSection />
          <PracticeSection />
        </div>
        <div className="stack">
          <LlmSection />
          <AppearanceSection />
          <LabSection />
          <StorageSection />
        </div>
      </div>
    </div>
  );
}
