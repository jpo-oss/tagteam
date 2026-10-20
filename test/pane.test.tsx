import { expect, test } from 'claude-code/testing'
import { memoryIo } from './support/memory'
import { routeTo } from './support/route'
import { localDay } from '../src/session'
import { saveAccount, saveUsage, writeActive } from '../src/store'
import type { Account, Usage } from '../src/types'

const PANE = {
  plugin: 'tagteam',
  component: 'Pane',
  requestId: 'tagteam',
  props: {
    title: 'Accounts',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const acct = (label: string, uuid: string, over: Partial<Account> = {}): Account =>
  ({ label, dir: `/t/${label}`, accountUuid: uuid, email: `${label}@x.io`, order: 0, excluded: false, needsSignIn: false, ...over })

const seed = async () => {
  const io = memoryIo({ HOME: '/h', TAGTEAM_HOME: '/t' })
  const now = Date.now()
  const a = acct('a', 'ua')
  await saveAccount(io, a)
  await saveAccount(io, acct('b', 'ub', { excluded: true }))
  await saveAccount(io, acct('c', 'uc', { needsSignIn: true }))
  await saveAccount(io, acct('d', 'ud'))
  await writeActive(io, a)
  const resetsAt = new Date(now + 3600_000).toISOString()
  const usage = (uuid: string, p5: number, p7: number, tokens: Record<string, number>): Usage => ({
    accountUuid: uuid,
    windows: {
      five_hour: { kind: 'five_hour', percentUsed: p5, resetsAt, readAt: now },
      seven_day: { kind: 'seven_day', percentUsed: p7, resetsAt, readAt: now },
    },
    tokensByDay: Object.fromEntries(
      Object.entries(tokens).map(([ago, n]) => {
        const d = new Date(now)
        d.setDate(d.getDate() - Number(ago))
        return [localDay(d.getTime()), { input: n, output: 0, cacheRead: 0, cacheWrite: 0 }]
      }),
    ),
    earlyResets: [],
  })
  await saveUsage(io, usage('ua', 42, 61, { 0: 1200, 3: 300, 9: 5000 }))
  await saveUsage(io, usage('ud', 100, 30, {}))
  return io
}

test('the pane lists every account, on every surface', async ($, on) => {
  routeTo(on, await seed())
  on('command.register', () => ({ value: { command: 'tagteam' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /a.*42%/ }))?.text).toContain('active')
    expect((await ui.find({ type: 'Text', text: /b.*excluded/ }))?.text).toContain('b@x.io')
    expect(await ui.find({ type: 'Text', text: /c.*needs sign-in/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /d.*limited until/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /today 1\.2k/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /week 1\.5k/ })).toBeTruthy()
    await ui.unmount()
  }
})
