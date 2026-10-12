// Pure helpers, kept apart so they are easy to test.
const BIG =
  /(^|\/)(package-lock\.json|README\.md)$|\.(bin|gz|wasm|onnx|pb|map)$|(^|\/)(node_modules|dist|\.git)\/|(^|\/)public\/(models|engine)\/|(^|\/)data\//

export function bigReadReason(path: string, hasRange: boolean): string | undefined {
  if (hasRange || !BIG.test(path)) return undefined
  return `${path} is large. Open docs/handoff/<topic>.md instead, or Read with offset and limit, or Grep for what you need.`
}

export function quietNpm(command: string): string {
  if (!/^\s*npm\s+(ci|install|i)\b/.test(command)) return command
  if (/--loglevel|--silent/.test(command)) return command
  return `${command} --no-audit --no-fund --loglevel=error`
}

export function capGitLog(command: string): string {
  if (!/^\s*git\s+log\b/.test(command)) return command
  if (/[|;&]/.test(command)) return command
  if (/(\s-n\b|\s-\d+\b|--max-count|\s-[A-Za-z]*n\d)/.test(command)) return command
  return `${command} -n 30`
}

// Only commands whose long output is rarely worth reading in full.
export const NOISY = /^\s*(npm|npx|pnpm|yarn|vitest|tsc|vite)\b/

export function trimLines(text: string, max = 120, head = 30): string {
  const lines = text.split('\n')
  if (lines.length <= max) return text
  const tail = max - head
  const cut = lines.length - max
  return [...lines.slice(0, head), `... [lean-tokens trimmed ${cut} lines] ...`, ...lines.slice(-tail)].join('\n')
}
