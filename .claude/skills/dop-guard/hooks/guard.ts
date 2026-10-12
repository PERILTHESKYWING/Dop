const SECRET = [
  /VITE_[A-Z_]*(KEY|SECRET|TOKEN)/,
  /AIza[0-9A-Za-z_-]{30,}/,
  /(LLM_API_KEY|GEMINI_API_KEY)\s*[=:]\s*['"][A-Za-z0-9_-]{16,}['"]/,
  /\bsk-[A-Za-z0-9]{20,}/,
]

export function secretReason(path: string, text: string): string | undefined {
  if (/\.md$/.test(path)) return undefined
  return SECRET.some(r => r.test(text))
    ? 'looks like an API key or a VITE_ secret. Keys stay server-side in api/ and in Vercel settings, never in source.'
    : undefined
}

const BUNDLED = /public\/models\/g170e-b10c128-[^\s]*\.bin\.gz/

export function bashReason(command: string): string | undefined {
  if (/gh\s+pr\s+create\b/.test(command) && /--draft\b|\s-d\b/.test(command)) return 'PRs must be ready for review, not draft.'
  if (/gh\s+api\b/.test(command) && /draft\s*=\s*true/.test(command)) return 'PRs must be ready for review, not draft.'
  if (/git\s+push\b/.test(command) && /(--force\b|\s-f\b|--force-with-lease)/.test(command) && /\b(main|master)\b/.test(command))
    return 'no force-push to main.'
  if (/git\s+add\b/.test(command)) {
    if (/(^|[\s/])\.env(\s|$|\.(?!example))/.test(command)) return 'never commit .env files (only .env.example).'
    const weights = command.match(/\S+\.(bin\.gz|bin|onnx|pb)\b/g) ?? []
    if (weights.some(w => !BUNDLED.test(w))) return 'never commit network weights except the bundled public/models/g170e-b10c128-*.bin.gz.'
  }
  return undefined
}

export const ENGINE_REMINDER =
  'public/engine changed: bump ENGINE_FILES in src/lib/engine/browserEngine.ts (Vercel caches /engine for a week) and measure speed with Settings > Benchmark before claiming a gain.'

export function touchesEngine(path: string): boolean {
  return /(^|\/)public\/engine\//.test(path)
}
