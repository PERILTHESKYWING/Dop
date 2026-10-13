import type { Register } from 'claude-code'
import { NOISY, bigReadReason, capGitLog, quietNpm, trimLines } from './guard'

export const register: Register = on => {
  on('tool.call', { tool: 'Read' }, ($, e, next) => {
    const hasRange = e.offset !== undefined || e.limit !== undefined || e.allow_large === true
    const why = bigReadReason(e.file_path, hasRange)
    return why ? { deny: `${$.plugin.name}: ${why}` } : next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = capGitLog(quietNpm(e.command))
    const ran = await next({ ...e, command })
    if (ran.deny !== undefined || ran.isError === true || !NOISY.test(command)) return ran
    const out = ran.result
    if (!out || typeof out.stdout !== 'string') return ran
    return { result: { ...out, stdout: trimLines(out.stdout), stderr: trimLines(out.stderr ?? '') } }
  }).catch(($, e, next) => next(e))
}
