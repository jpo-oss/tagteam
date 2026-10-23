import type { Register, Timer } from 'claude-code'
import { ioFrom, type Io } from '../src/io'
import { adoptFolders, parseArgs, realDeps, refreshAccounts, refreshLauncher, runCommand } from '../src/commands'
import { drawError, drawPane, paneRows, settingsLine } from '../src/pane'
import { recordMeasure, recordTurn, refreshStatus } from '../src/session'
import { listAccounts, readPins, stateStamp } from '../src/store'
import type { Account } from '../src/types'
import { checkForUpdate, updateDepsFrom } from '../src/update'
import { evaluate, manualSwitch, newState, settingsFrom, turnEnded, uiFrom } from '../src/switch'

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

function redraw($: { ui: { invalidate(event: 'ui.render'): void } }): void {
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // display only
  }
}

export const register: Register = (on, options) => {
  const settings = settingsFrom(options)
  const state = newState()
  let evaluating = false
  let poll: Timer | undefined
  let stamp = ''

  // Not awaited: each run can take up to a minute. A refresh run's own session skips this, so it never starts another.
  const refreshLater = (io: Io, log: (t: string) => void, accounts: Account[]) => {
    if (!accounts.length) return
    void (async () => {
      if (await io.env('TAGTEAM_REFRESH')) return
      log(`tagteam: ${await refreshAccounts(io, accounts)}`)
    })().catch((err) => log(`tagteam: refresh failed: ${message(err)}`))
  }

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'tagteam',
        description: 'Manage and switch Claude accounts',
        argumentHint: '[status | add | remove | edit | switch | pin | unpin | refresh | install] [label]',
      })
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
      const io = ioFrom($)
      const before = new Set((await listAccounts(io)).map((a) => a.label))
      for (const note of await adoptFolders(io, log)) $.ui.toast(note)
      refreshLater(io, log, (await listAccounts(io)).filter((a) => !before.has(a.label)))
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
      const later = (accounts: Account[]) => refreshLater(io, (t) => $.ui.log(t, { to: 'debug' }), accounts)
      text = await runCommand(io, e.args, realDeps(confirm, switchTo, $.plugin.root, openPane, later, () => $.session.cwd()))
    } catch (err) {
      text = `tagteam: ${message(err)}`
    }
    if (['add', 'edit', 'remove', 'delete', 'refresh', 'pin', 'unpin'].includes(parseArgs(e.args).sub)) {
      await refreshStatus(io, { status: (t) => $.ui.status(t) }, settings).catch(() => undefined)
      redraw($)
    }
    return { text }
  })

  on('ui.render', { component: 'Pane', requestId: 'tagteam' }, async ($, e) => {
    const io = ioFrom($)
    // While the pane is open, redraw when another session on this machine writes state.
    poll ??= $.clock.every(5000, () => {
      void stateStamp(io).then((now) => {
        if (now !== stamp) redraw($)
      }, () => undefined)
    })
    try {
      stamp = await stateStamp(io)
      return drawPane($.ui.resolve(e), await paneRows(io, await io.now(), settings.threshold, Object.keys(await readPins(io)).length ? await $.session.cwd() : undefined), e.props.bodyColumns, settingsLine(settings))
    } catch (err) {
      $.ui.log(`tagteam: dashboard failed: ${message(err)}`, { to: 'debug' })
      return drawError($.ui.resolve(e), message(err), e.props.bodyColumns)
    }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === 'tagteam') {
      poll?.cancel()
      poll = undefined
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const check = !evaluating
    evaluating = true
    const io = ioFrom($)
    try {
      await recordMeasure(io, { toast: (t) => $.ui.toast(t), status: (t) => $.ui.status(t) }, settings, e.rateLimits)
      redraw($)
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
      if (e.usage) {
        await recordTurn(ioFrom($), e.usage)
        redraw($)
      }
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
