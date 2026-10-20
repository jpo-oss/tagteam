import type { Register } from 'claude-code'
import { ioFrom } from '../src/io'
import { realDeps, refreshLauncher, runCommand } from '../src/commands'
import { drawPane, paneRows } from '../src/pane'
import { recordMeasure, recordTurn } from '../src/session'
import { evaluate, manualSwitch, newState, settingsFrom, turnEnded, uiFrom } from '../src/switch'

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export const register: Register = (on, options) => {
  const settings = settingsFrom(options)
  const state = newState()
  let evaluating = false

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'tagteam', description: 'Manage and switch Claude accounts' })
    } catch (err) {
      $.ui.log(`tagteam: command registration failed: ${message(err)}`, { to: 'debug' })
    }
    try {
      await refreshLauncher(ioFrom($), $.plugin.root)
    } catch (err) {
      $.ui.log(`tagteam: launcher update failed: ${message(err)}`, { to: 'debug' })
    }
    return next(e)
  })

  on('command.run', { command: 'tagteam' }, async ($, e) => {
    const confirm = (q: string) => $.ui.ask(q, ['Remove', 'Cancel']).then((a) => a === 'Remove', () => false)
    const io = ioFrom($)
    const switchTo = (label: string) => manualSwitch({ io, ui: uiFrom($), state, settings }, label)
    const openPane = async () =>
      (await $.ui.open({ id: 'tagteam', title: 'Accounts' })).isPlaced ? 'Accounts pane opened.' : 'No room for the pane here.'
    try {
      return { text: await runCommand(io, e.args, realDeps(confirm, switchTo, $.plugin.root, openPane)) }
    } catch (err) {
      return { text: `tagteam: ${message(err)}` }
    }
  })

  on('ui.render', { component: 'Pane', requestId: 'tagteam' }, async ($, e) => {
    const io = ioFrom($)
    return drawPane($.ui.resolve(e), await paneRows(io, await io.now(), settings.threshold), e.props.bodyColumns)
  })

  on('session.measure', async ($, e, next) => {
    const check = !evaluating
    evaluating = true
    const io = ioFrom($)
    try {
      await recordMeasure(io, { toast: (t) => $.ui.toast(t), status: (t) => $.ui.status(t) }, e.rateLimits)
    } catch (err) {
      $.ui.log(`tagteam: usage tracking failed: ${message(err)}`, { to: 'debug' })
    }
    // Not awaited: a question or another session's decision can take minutes, and the session keeps working meanwhile.
    if (check) {
      void (async () => evaluate({ io, ui: uiFrom($), state, settings }, await io.now()))()
        .catch((err) => $.ui.log(`tagteam: switch check failed: ${message(err)}`, { to: 'debug' }))
        .finally(() => (evaluating = false))
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) state.inTurn = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      if (e.usage) await recordTurn(ioFrom($), e.usage)
    } catch (err) {
      $.ui.log(`tagteam: token tracking failed: ${message(err)}`, { to: 'debug' })
    }
    if (e.agentId === undefined) {
      try {
        await turnEnded({ io: ioFrom($), ui: uiFrom($), state, settings })
      } catch (err) {
        $.ui.log(`tagteam: switch failed: ${message(err)}`, { to: 'debug' })
      }
    }
    return next(e)
  })
}
