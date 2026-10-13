import type { Register } from 'claude-code'
import { ENGINE_REMINDER, bashReason, secretReason, touchesEngine } from './guard'

export const register: Register = on => {
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const why = secretReason(e.file_path, e.content)
    if (why) return { deny: `${$.plugin.name}: ${e.file_path} ${why}` }
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || !touchesEngine(e.file_path)) return ran
    return { ...ran, context: [...(ran.context ?? []), ENGINE_REMINDER] }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const why = secretReason(e.file_path, e.new_string)
    if (why) return { deny: `${$.plugin.name}: ${e.file_path} ${why}` }
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || !touchesEngine(e.file_path)) return ran
    return { ...ran, context: [...(ran.context ?? []), ENGINE_REMINDER] }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const why = bashReason(e.command)
    return why ? { deny: `${$.plugin.name}: ${why}` } : next(e)
  }).catch(($, e, next) => next(e))
}
