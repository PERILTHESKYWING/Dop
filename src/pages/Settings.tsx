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
import { COOL_PONDER, isPhoneLike } from '../lib/engine/governor';
import { storageEstimate } from '../lib/db/db';
import { DEFAULT_THEME, THEMES, type ThemeId } from '../lib/themes';
import { switchTheme } from '../components/Scenery';
import { LOCAL_PC, probePc, usePc } from '../state/pc';

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
  const bigHelper = useStore((s) => s.bigHelper);
  const student = useStore((s) => s.student);
  return (
    <div className="panel stack">
      <div className="spread">
        <h3 className="with-icon">
          <Icon name="cpu" style={{ width: 16, height: 16 }} /> Engine
        </h3>
        <span className={`chip ${engine.status === 'ready' ? 'good' : engine.status === 'error' || engine.status === 'unsupported' ? 'bad' : ''}`}>
          {engine.status === 'ready' ? 'ready' : engine.status === 'off' ? 'idle' : engine.status}
        </span>
      </div>
      {engine.info && engine.status === 'ready' && (
        <div className="engine-now">
          <strong>{engine.info.modelName}</strong>
          <span className="small dim">
            {engine.info.backend === 'webgpu' ? 'GPU (WebGPU)' : 'CPU'}
            {engine.evalMs ? ` · ${engine.evalMs} ms/position` : ''}
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
                ? 'Reading cached network'
                : p?.stage === 'check'
                  ? 'Testing network'
                  : 'Loading network'}
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
          <summary>Failed attempts ({engine.failures.length})</summary>
          <pre className="tiny muted" style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{engine.failures.join('\n')}</pre>
        </details>
      )}
      {gpuBroken && caps?.webgpu && (
        <div className="callout small">
          GPU failed last time. Using CPU.{' '}
          <button className="btn small" onClick={() => void retryGpu()}>
            Retry GPU
          </button>
        </div>
      )}
      {safe && (
        <div className="callout small">
          Safe mode: built-in network, CPU.{' '}
          <button className="btn small" onClick={() => void restartEngine()}>
            Exit safe mode
          </button>
        </div>
      )}

      <div className="divider" />
      <label className="stack tight small">
        <span className="field-label">Network</span>
        <select value={settings.modelId} onChange={(e) => void saveSettings({ modelId: e.target.value })}>
          <option value="auto">Auto</option>
          {custom && <option value={custom.id}>{custom.name}</option>}
          {MODELS.map((m) => (
            <option key={m.id} value={m.id} disabled={!!m.incompatible}>
              {m.name} · {m.approxMB} MB{m.incompatible ? ' (not supported)' : m.gpuOnly ? ' (needs WebGPU)' : ''}
            </option>
          ))}
        </select>
      </label>
      <p className="tiny muted">{(modelById(settings.modelId) ?? null)?.note ?? 'b18c384nbt on WebGPU, built-in b10c128 on CPU. The built-in network works offline.'}</p>
      <div className="row wrap">
        <button className="btn small" onClick={() => fileInput.current?.click()}>
          <Icon name="upload" /> Load file
        </button>
        <span className="tiny muted">A .bin.gz from katagotraining.org.</span>
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
        <input type="checkbox" checked={settings.forceCpu} onChange={(e) => void saveSettings({ forceCpu: e.target.checked })} /> Force CPU
      </label>
      <div className="row wrap">
        <label className="stack tight small">
          <span className="field-label">Visits per move</span>
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
          <span className="field-label">Live analysis limit</span>
          <select value={settings.ponderLimit} onChange={(e) => void saveSettings({ ponderLimit: Number(e.target.value) })}>
            <option value={0}>None</option>
            {[500, 2000, 10000, 50000].map((v) => (
              <option key={v} value={v}>
                {v.toLocaleString()} visits
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="tiny muted">
        Live analysis (Space) keeps searching the current position. Game analysis pauses meanwhile.
      </p>
      <label className="row small">
        <input type="checkbox" checked={settings.autoAnalyze} onChange={(e) => void saveSettings({ autoAnalyze: e.target.checked })} /> Auto-analyse imports
      </label>
      <label className="row small">
        <input type="checkbox" checked={settings.bigHelper !== 'off'} onChange={(e) => void saveSettings({ bigHelper: e.target.checked ? 'auto' : 'off' })} /> Big network helper
        <span className="tiny muted">
          {bigHelper.status === 'ready'
            ? `${bigHelper.model} on ${bigHelper.backend === 'webgpu' ? 'GPU' : 'CPU'}`
            : bigHelper.status === 'loading'
              ? 'loading…'
              : bigHelper.status === 'error'
                ? `failed: ${bigHelper.note}`
                : 'starts when needed, where a GPU or a strong computer can run it'}
        </span>
      </label>
      <p className="tiny muted">
        The small network searches; the big one judges the top of each search and corrects everything below it.
      </p>
      <label className="stack tight small">
        <span className="field-label">Student network</span>
        <select value={settings.student} onChange={(e) => void saveSettings({ student: e.target.value as typeof settings.student })}>
          <option value="auto">Auto (only once it beats the built-in network)</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </label>
      <p className="tiny muted">
        {student.status === 'ready'
          ? `${student.name} searches; ${engine.info?.modelName ?? 'KataGo'} judges the top of each search.`
          : student.status === 'loading'
            ? 'Loading the student network…'
            : student.status === 'error'
              ? `The student network failed: ${student.note}`
              : 'A small network taught every night by KataGo\'s big ones, several times faster per position. Auto turns it on by itself once it measures better than the built-in network.'}
        {student.gate
          ? ` Last measured: ${Math.round(student.gate.student.top1 * 100)}% best moves found vs ${Math.round(student.gate.baseline.top1 * 100)}% for ${student.gate.baseline.name}, ${student.gate.speedup.toFixed(1)}x the speed.`
          : ''}
      </p>
      <label className="stack tight small">
        <span className="field-label">Cool mode</span>
        <select value={settings.coolMode} onChange={(e) => void saveSettings({ coolMode: e.target.value as typeof settings.coolMode })}>
          <option value="auto">Auto ({isPhoneLike() ? 'on, this is a phone' : 'off, this is a computer'})</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </label>
      <p className="tiny muted">
        Cool mode keeps a phone cool: two workers at most, the small network, game analysis only part of the time and never in the
        background, and live analysis rests after {COOL_PONDER} visits or a minute untouched. Changes apply after Restart.
      </p>
      <div className="row wrap">
        <button className="btn primary" onClick={() => void (engine.status === 'off' || engine.status === 'unsupported' ? startEngine() : restartEngine())}>
          {engine.status === 'off' ? 'Start KataGo' : 'Restart'}
        </button>
        <button className="btn" onClick={() => void restartEngine({ safe: true })} title="Built-in network, CPU">
          Safe mode
        </button>
      </div>
      <details className="small">
        <summary>Device</summary>
        <div className="stack tight" style={{ marginTop: 8 }}>
          <Check ok={caps ? caps.webgpu : null} label="WebGPU" detail={caps?.webgpu ? caps.webgpuAdapter || 'available' : caps ? 'unavailable' : undefined} />
          <Check ok={caps ? caps.wasm : null} label="WebAssembly" />
          <Check ok={caps ? caps.workers : null} label="Web Workers" />
          <Check ok={caps ? caps.indexedDB : null} label="IndexedDB" />
          <Check ok={caps ? caps.cacheApi : null} label="Network cache" detail={caps && !caps.cacheApi ? 're-downloads each visit' : undefined} />
          {engine.info && <Check ok={true} label="Engine build" detail={engine.info.engine} />}
        </div>
      </details>
      <details className="small">
        <summary>Networks</summary>
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

function PcSection() {
  const settings = useStore((s) => s.settings);
  const pc = usePc();
  const phone = isPhoneLike();
  const [address, setAddress] = useState(settings.pcAddress);
  const [code, setCode] = useState(settings.pcCode);
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    await saveSettings({ pcAddress: address.trim(), pcCode: code.trim() });
    await probePc();
    setChecking(false);
  };
  return (
    <div className="panel stack">
      <div className="spread">
        <h3 className="with-icon">
          <Icon name="cpu" style={{ width: 16, height: 16 }} /> PC helper
        </h3>
        <span className={`chip ${pc.status === 'connected' ? 'good' : pc.status === 'error' ? 'bad' : ''}`}>
          {pc.status === 'connected' ? 'connected' : pc.status === 'error' ? 'lost' : 'not running'}
        </span>
      </div>
      {pc.status === 'connected' ? (
        <p className="small">
          {pc.network ?? 'KataGo'} on {pc.backend ?? 'the PC'}. Live and game analysis run there
          {pc.analysed ? ` (${pc.analysed} positions so far)` : ''}.
        </p>
      ) : (
        <p className="small muted">
          Everything runs on this {phone ? 'phone' : 'computer'} until the helper answers. With it, your graphics card searches with
          a big network, many times faster.
        </p>
      )}
      {pc.note && <div className="callout small">{pc.note}</div>}
      <ol className="small stack tight" style={{ margin: 0, paddingLeft: 18 }}>
        <li>
          <a href="/downloads/dop-pc-helper.zip" download>
            Download the helper
          </a>{' '}
          on your Windows PC and unzip it.
        </li>
        <li>Double-click start-windows.bat. It installs what it needs the first time.</li>
        <li>
          {phone
            ? 'For this phone, use start-phone-too.bat instead and type the address and code it prints below.'
            : 'Keep its window open. This page finds it by itself.'}
        </li>
      </ol>
      <label className="row small">
        <input type="checkbox" checked={settings.pcUse !== 'off'} onChange={(e) => void saveSettings({ pcUse: e.target.checked ? 'auto' : 'off' })} /> Use
        the PC when it is on
      </label>
      <label className="stack tight small">
        <span className="field-label">Address {phone ? '' : '(only for another device)'}</span>
        <input value={address} placeholder={LOCAL_PC} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label className="stack tight small">
        <span className="field-label">Pairing code</span>
        <input value={code} placeholder={phone ? 'printed by the helper' : 'found automatically'} onChange={(e) => setCode(e.target.value)} />
      </label>
      <div className="row wrap">
        <button className="btn small" disabled={checking} onClick={() => void check()}>
          {checking ? 'Checking…' : 'Save and check'}
        </button>
        <label className="row small">
          Visits per position
          <select value={settings.pcVisits} onChange={(e) => void saveSettings({ pcVisits: Number(e.target.value) })}>
            {[200, 400, 800, 1600, 3200].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
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
        <span className="field-label">Your SGF names (comma-separated)</span>
        <input value={names} onChange={(e) => setNames(e.target.value)} placeholder="e.g. 1kuyoo, 一子道长青" />
      </label>
      <p className="tiny muted">Games with these names are matched to you.</p>
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
          Save
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
      <h3>Practice</h3>
      <label className="stack tight small">
        <span className="spread">
          <span className="field-label">Min. winrate for losing side</span>
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
      <p className="tiny muted">Skips lopsided positions.</p>
    </div>
  );
}

function AppearanceSection() {
  const settings = useStore((s) => s.settings);
  const theme = settings.theme ?? DEFAULT_THEME;
  const [pending, setPending] = useState<ThemeId | null>(null);
  const opts: { v: typeof settings.effects; label: string; hint: string }[] = [
    { v: 'auto', label: 'Automatic', hint: 'by device' },
    { v: 'full', label: 'Full', hint: 'all effects' },
    { v: 'light', label: 'Light', hint: 'fastest' },
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
      <div className="field-label">Effects</div>
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
        <h3>LLM</h3>
        <span className={`chip ${llm?.available ? 'good' : llm?.configured ? 'bad' : ''}`}>{llm ? (llm.available ? 'connected' : llm.configured ? 'no response' : 'off') : 'checking'}</span>
      </div>
      {llm && !llm.configured && (
        <div className="callout small">
          {llm.error?.includes('LLM_API_KEY') ? (
            <>
              Not set up. In Vercel <strong>Settings → Environment Variables</strong>, add <span className="mono">LLM_API_KEY</span> (Google AI Studio key) and redeploy. Optional.
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
              OK: <strong>{test.model}</strong>, {((test.ms ?? 0) / 1000).toFixed(1)} s.
            </>
          ) : (
            <>
              Test failed.
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
      {llm?.models && llm.models.length > 0 && <p className="tiny muted">Model order: {llm.models.join(', ')}.</p>}
      <div className="row wrap">
        <button className="btn" disabled={checking} onClick={() => void refreshLlmStatus(true)}>
          {checking ? 'Testing…' : 'Test'}
        </button>
        <label className="row small">
          <input type="checkbox" checked={settings.useLlm} onChange={(e) => void saveSettings({ useLlm: e.target.checked })} /> Name patterns
        </label>
      </div>
      <p className="tiny muted">
        It only labels KataGo findings. The key stays on the server.
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
          {busy.lab ? `${busy.labStage ?? 'Training'}…` : latest ? `Train v${latest.version + 1}` : 'Train'}
        </button>
      </div>
      <p className="small dim">
        A small model trained on your KataGo analyses. Its worst misses are queued for deeper analysis. Far weaker than KataGo.
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
                <th>Top 1</th>
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
                  <td className="mono small muted" title="Near last move / random">
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
          <span>{hard.length} hardest positions</span>
          <button className="btn small" onClick={() => void queueDeepPositions(hard)}>
            Analyse deeper
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
      <p className="small dim">Stored in this browser only.</p>
      {est && (
        <div className="small">
          {mb(est.usage)} / {mb(est.quota)}
        </div>
      )}
      <div className="row wrap">
        <button className="btn small" onClick={() => void rebuildProfile()}>
          Rebuild profile
        </button>
        {hasDemo && (
          <button className="btn small" onClick={() => void removeDemo()}>
            Remove demo
          </button>
        )}
        <button
          className="btn small ghost bad"
          onClick={() => {
            if (confirm('Delete all data in this browser?')) void resetEverything();
          }}
        >
          Delete everything
        </button>
      </div>
      <p className="tiny muted">
        KataGo (MIT) via saigo-online/katago-webgpu. Licences: THIRD_PARTY_NOTICES.md.
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
          <h1>Settings</h1>
        </div>
      </div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <EngineSection />
          <PcSection />
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
