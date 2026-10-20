import type { Register } from 'claude-code'
import { ioFrom } from '../src/io'
import { realDeps, runCommand } from '../src/commands'
import { recordMeasure, recordTurn } from '../src/session'

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'tagteam', description: 'Manage and switch Claude accounts' })
    } catch (err) {
      $.ui.log(`tagteam: command registration failed: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
    }
    return next(e)
  })

  on('command.run', { command: 'tagteam' }, async ($, e) => {
    const confirm = (q: string) => $.ui.ask(q, ['Remove', 'Cancel']).then((a) => a === 'Remove', () => false)
    try {
      return { text: await runCommand(ioFrom($), e.args, realDeps(confirm)) }
    } catch (err) {
      return { text: `tagteam: ${err instanceof Error ? err.message : String(err)}` }
    }
  })

  on('session.measure', async ($, e, next) => {
    try {
      const ui = { toast: (t: string) => $.ui.toast(t), status: (t: string) => $.ui.status(t) }
      await recordMeasure(ioFrom($), ui, e.rateLimits)
    } catch (err) {
      $.ui.log(`tagteam: usage tracking failed: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      if (e.usage) await recordTurn(ioFrom($), e.usage)
    } catch (err) {
      $.ui.log(`tagteam: token tracking failed: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
    }
    return next(e)
  })
}
