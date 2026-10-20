import type { Register } from 'claude-code'
import { ioFrom } from '../src/io'
import { recordMeasure, recordTurn } from '../src/session'

export const register: Register = (on) => {
  on('session.measure', async ($, e, next) => {
    const ui = { toast: (t: string) => void $.ui.toast(t), status: (t: string) => void $.ui.status(t) }
    await recordMeasure(ioFrom($), ui, e.rateLimits)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.usage) await recordTurn(ioFrom($), e.usage)
    return next(e)
  })
}
