import type { Register } from 'claude-code'
import { ioFrom } from '../src/io'
import { adoptFolders, parseArgs, realDeps, refreshLauncher, runCommand } from '../src/commands'
import { drawError, drawPane, paneRows, settingsLine } from '../src/pane'
import { recordMeasure, recordTurn, refreshStatus } from '../src/session'
import { checkForUpdate, updateDepsFrom } from '../src/update'
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
    try {
      const log = (t: string) => $.ui.log(t, { to: 'debug' })
      for (const note of await adoptFolders(ioFrom($), log)) $.ui.toast(note)
    } catch (err) {
      $.ui.log(`tagteam: adding terminal sign-ins failed: ${message(err)}`, { to: 'debug' })
    }
    // Not awaited: the lookup must never slow session start.
    void checkForUpdate(updateDepsFrom($, ioFrom($), $.plugin.root)).catch((err) =>
      $.ui.log(`tagteam: update check failed: ${message(err)}`, { to: 'debug' }),
    )
    return next(e)
  })

  on('command.run', { command: 'tagteam' }, async ($, e) => {
    const confirm = (q: string) => $.ui.ask(q, ['Remove', 'Cancel']).then((a) => a === 'Remove', () => false)
    const io = ioFrom($)
    const switchTo = (label: string) => manualSwitch({ io, ui: uiFrom($), state, settings }, label)
    const openPane = async () =>
      (await $.ui.open({ id: 'tagteam', title: 'Accounts' })).isPlaced ? 'Accounts pane opened.' : 'No room for the pane here.'
    let text: string
    try {
      text = await runCommand(io, e.args, realDeps(confirm, switchTo, $.plugin.root, openPane))
    } catch (err) {
      text = `tagteam: ${message(err)}`
    }
    if (['add', 'edit', 'remove'].includes(parseArgs(e.args).sub)) {
      await refreshStatus(io, { status: (t) => $.ui.status(t) }).catch(() => undefined)
    }
    return { text }
  })

  on('ui.render', { component: 'Pane', requestId: 'tagteam' }, async ($, e) => {
    const io = ioFrom($)
    try {
      return drawPane($.ui.resolve(e), await paneRows(io, await io.now(), settings.threshold), e.props.bodyColumns, settingsLine(settings))
    } catch (err) {
      $.ui.log(`tagteam: dashboard failed: ${message(err)}`, { to: 'debug' })
      return drawError($.ui.resolve(e), message(err), e.props.bodyColumns)
    }
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
