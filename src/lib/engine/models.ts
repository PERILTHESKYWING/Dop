/**
 * KataGo networks the app can use. One small network ships with the site
 * (public/models/, MIT-licensed as part of the katago-webgpu repository) so analysis
 * always works; the kata1 networks are downloaded on first use and cached in the
 * browser (Cache API).
 *
 * kata1 networks come from katagotraining.org. Browsers need CORS for a direct
 * download, so the app first tries a same-origin path that the host rewrites to
 * media.katagotraining.org (see vercel.json and vite.config.ts), then the direct URL.
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
  /** Only used when chosen explicitly (too large to download without asking). */
  optIn?: boolean;
  /** Served from this site, so it loads even when third-party hosts are blocked. */
  bundled?: boolean;
  human?: boolean;
  /** Where to download it by hand for "Load a network file". */
  homepage?: string;
}

const KATA1 = 'https://media.katagotraining.org/uploaded/networks/models/kata1/';
const WEBGPU_REPO_PIN = 'd5ad1c0423dba989c60a2f06b1848e7eec2b5941';
const jsd = (path: string) => `https://cdn.jsdelivr.net/gh/saigo-online/katago-webgpu@${WEBGPU_REPO_PIN}/${path}`;
const raw = (path: string) => `https://raw.githubusercontent.com/saigo-online/katago-webgpu/${WEBGPU_REPO_PIN}/${path}`;

export const BUNDLED_ID = 'g170e-b10c128';

export const MODELS: ModelSpec[] = [
  {
    id: 'kata1-b28c512nbt',
    name: 'kata1 b28c512nbt (strongest, very large)',
    file: 'kata1-b28c512nbt-s8326494464-d4628051565.bin.gz',
    urls: ['/katago-models/kata1-b28c512nbt-s8326494464-d4628051565.bin.gz', KATA1 + 'kata1-b28c512nbt-s8326494464-d4628051565.bin.gz'],
    approxMB: 260,
    modelVersion: 15,
    strength: 100,
    note: 'Strongest kata1 network. 260 MB download and needs a powerful GPU with plenty of memory; weaker machines can crash loading it.',
    gpuOnly: true,
    optIn: true,
    homepage: 'https://katagotraining.org/networks/',
  },
  {
    id: 'kata1-b18c384nbt',
    name: 'kata1 b18c384nbt (strong)',
    file: 'kata1-b18c384nbt-s9996604416-d4316597426.bin.gz',
    urls: ['/katago-models/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz', KATA1 + 'kata1-b18c384nbt-s9996604416-d4316597426.bin.gz'],
    approxMB: 97,
    modelVersion: 14,
    strength: 90,
    note: 'Professional-level strength, validated on the WebGPU backend. The default when WebGPU is available.',
    gpuOnly: true,
    homepage: 'https://katagotraining.org/networks/',
  },
  {
    id: BUNDLED_ID,
    name: 'g170e b10c128 (built in)',
    file: 'g170e-b10c128-s1141046784-d204142634.bin.gz',
    urls: [
      '/models/g170e-b10c128-s1141046784-d204142634.bin.gz',
      jsd('cpp/tests/models/g170e-b10c128-s1141046784-d204142634.bin.gz'),
      raw('cpp/tests/models/g170e-b10c128-s1141046784-d204142634.bin.gz'),
    ],
    approxMB: 11,
    modelVersion: 8,
    strength: 40,
    bundled: true,
    note: 'Ships with the site, so it always loads. Fast enough on the CPU; still far stronger than most human players.',
  },
  {
    id: 'g170-b6c96',
    name: 'g170 b6c96 (tiny)',
    file: 'g170-b6c96-s175395328-d26788732.bin.gz',
    urls: [jsd('cpp/tests/models/g170-b6c96-s175395328-d26788732.bin.gz'), raw('cpp/tests/models/g170-b6c96-s175395328-d26788732.bin.gz')],
    approxMB: 4,
    modelVersion: 8,
    strength: 20,
    optIn: true,
    note: 'Tiny network for very slow machines.',
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

/** A network file the user loaded from disk (kept in the browser's network cache). */
export function customModel(id: string): ModelSpec | undefined {
  if (!id.startsWith('file:')) return undefined;
  const file = id.slice(5);
  return {
    id,
    name: `Your file: ${file}`,
    file,
    urls: [],
    approxMB: 0,
    modelVersion: 0,
    strength: 60,
    note: 'Loaded from your computer and kept in this browser.',
  };
}

export const modelById = (id: string) => MODELS.find((m) => m.id === id) ?? customModel(id);

/**
 * The order in which to try networks for the "auto" setting. With WebGPU: the strong
 * b18c384nbt, then the built-in network so analysis can always start. Without WebGPU
 * only the built-in network, since big networks on the CPU take many seconds per move.
 */
export function autoModelOrder(hasWebGpu: boolean): ModelSpec[] {
  const bundled = MODELS.filter((m) => m.bundled);
  if (!hasWebGpu) return bundled;
  const strong = MODELS.filter((m) => !m.incompatible && !m.human && !m.optIn && !m.bundled).sort((a, b) => b.strength - a.strength);
  return [...strong, ...bundled];
}

/** An explicit choice first, always followed by the automatic order as fallback. */
export function modelOrderFor(modelId: string, hasWebGpu: boolean): ModelSpec[] {
  if (modelId === 'auto') return autoModelOrder(hasWebGpu);
  const chosen = modelById(modelId);
  const rest = autoModelOrder(hasWebGpu).filter((m) => m.id !== modelId);
  return chosen && !chosen.incompatible ? [chosen, ...rest] : rest;
}

/** The last resort: the built-in network on the CPU. */
export const bundledModel = () => MODELS.find((m) => m.bundled)!;
