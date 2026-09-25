/**
 * KataGo networks the app can download at runtime. Nothing here is bundled: files are
 * fetched on first use and cached in the browser (Cache API).
 *
 * kata1 networks come from katagotraining.org. Browsers need CORS for a direct
 * download, so the app first tries a same-origin path that the host rewrites to
 * media.katagotraining.org (see vercel.json and vite.config.ts), then the direct URL.
 * The small g170 nets are MIT-licensed files in the katago-webgpu repository, served
 * by jsDelivr / raw.githubusercontent.com (both send CORS headers).
 */
export interface ModelSpec {
  id: string;
  name: string;
  file: string;
  urls: string[];
  approxMB: number;
  modelVersion: number;
  strength: number; // relative ordering only
  note: string;
  /** Networks this build cannot load (kept in the list so the reason is visible). */
  incompatible?: string;
  /** Recommended only with WebGPU; on CPU it is very slow. */
  gpuOnly?: boolean;
  human?: boolean;
}

const KATA1 = 'https://media.katagotraining.org/uploaded/networks/models/kata1/';
const WEBGPU_REPO_PIN = 'd5ad1c0423dba989c60a2f06b1848e7eec2b5941';
const jsd = (path: string) => `https://cdn.jsdelivr.net/gh/saigo-online/katago-webgpu@${WEBGPU_REPO_PIN}/${path}`;
const raw = (path: string) => `https://raw.githubusercontent.com/saigo-online/katago-webgpu/${WEBGPU_REPO_PIN}/${path}`;

export const MODELS: ModelSpec[] = [
  {
    id: 'kata1-b28c512nbt',
    name: 'kata1 b28c512nbt (strongest)',
    file: 'kata1-b28c512nbt-s8326494464-d4628051565.bin.gz',
    urls: ['/katago-models/kata1-b28c512nbt-s8326494464-d4628051565.bin.gz', KATA1 + 'kata1-b28c512nbt-s8326494464-d4628051565.bin.gz'],
    approxMB: 260,
    modelVersion: 15,
    strength: 100,
    note: 'Strongest kata1 architecture. Large download; best with WebGPU.',
    gpuOnly: true,
  },
  {
    id: 'kata1-b18c384nbt',
    name: 'kata1 b18c384nbt',
    file: 'kata1-b18c384nbt-s9996604416-d4316597426.bin.gz',
    urls: ['/katago-models/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz', KATA1 + 'kata1-b18c384nbt-s9996604416-d4316597426.bin.gz'],
    approxMB: 97,
    modelVersion: 14,
    strength: 90,
    note: 'Strong and much faster than b28. Fallback when b28 cannot be used.',
  },
  {
    id: 'g170e-b10c128',
    name: 'g170e b10c128 (light)',
    file: 'g170e-b10c128-s1141046784-d204142634.bin.gz',
    urls: [
      jsd('cpp/tests/models/g170e-b10c128-s1141046784-d204142634.bin.gz'),
      raw('cpp/tests/models/g170e-b10c128-s1141046784-d204142634.bin.gz'),
    ],
    approxMB: 11,
    modelVersion: 8,
    strength: 40,
    note: 'Small and quick to download. Default for the CPU fallback; still far stronger than most humans.',
  },
  {
    id: 'g170-b6c96',
    name: 'g170 b6c96 (tiny)',
    file: 'g170-b6c96-s175395328-d26788732.bin.gz',
    urls: [jsd('cpp/tests/models/g170-b6c96-s175395328-d26788732.bin.gz'), raw('cpp/tests/models/g170-b6c96-s175395328-d26788732.bin.gz')],
    approxMB: 4,
    modelVersion: 8,
    strength: 20,
    note: 'Tiny network for slow machines.',
  },
  {
    id: 'b18c384nbt-humanv0',
    name: 'Human SL b18c384nbt-humanv0',
    file: 'b18c384nbt-humanv0.bin.gz',
    urls: ['https://github.com/lightvector/KataGo/releases/download/v1.15.0/b18c384nbt-humanv0.bin.gz'],
    approxMB: 90,
    modelVersion: 15,
    strength: 0,
    human: true,
    note: 'Predicts human moves by rank (humanPolicy).',
    incompatible:
      'Uses the SGF-metadata encoder, which the browser WebGPU backend rejects. humanPolicy stays empty until a compatible build exists.',
  },
];

export const modelById = (id: string) => MODELS.find((m) => m.id === id);

/**
 * The order in which to try networks for the "auto" setting: strongest first, then the
 * b18c384nbt fallback, then the light networks so analysis can always start.
 */
export function autoModelOrder(hasWebGpu: boolean): ModelSpec[] {
  const usable = MODELS.filter((m) => !m.incompatible && !m.human);
  if (hasWebGpu) return usable.sort((a, b) => b.strength - a.strength);
  // Without WebGPU, big nets are too slow to be useful for whole-game analysis.
  return usable.filter((m) => !m.gpuOnly && m.strength <= 40).sort((a, b) => b.strength - a.strength);
}

export function modelOrderFor(modelId: string, hasWebGpu: boolean): ModelSpec[] {
  if (modelId === 'auto') return autoModelOrder(hasWebGpu);
  const chosen = modelById(modelId);
  const rest = autoModelOrder(hasWebGpu).filter((m) => m.id !== modelId);
  return chosen && !chosen.incompatible ? [chosen, ...rest] : rest;
}
