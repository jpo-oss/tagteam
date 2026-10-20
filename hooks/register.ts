import type { Register } from 'claude-code'
import { ioFrom } from '../src/io'
import { recordMeasure, recordTurn } from '../src/session'

export const register: Register = (on) => {
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
