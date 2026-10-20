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

const setup = async ($: any, on: any, io: ReturnType<typeof memoryIo>) => {
  routeTo(on, io)
  on('command.register', () => ({ value: { command: 'tagteam' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

test('tokens count input and output only', async ($, on) => {
  const io = await seed()
  const u = JSON.parse((await io.read('/t/state/usage/ua.json'))!) as Usage
  const day = localDay(Date.now())
  u.tokensByDay[day] = { input: 100, output: 20, cacheRead: 9000, cacheWrite: 7000 }
  await saveUsage(io, u)
  await setup($, on, io)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /today 120 /ui })).toBeTruthy()
  await ui.unmount()
})

test('no line is wider than the pane', async ($, on) => {
  await setup($, on, await seed())
  const props = { ...PANE.props, bodyColumns: 40 }
  const ui = await $.ui.mount({ ...PANE, props, surface: 'terminal' })
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts.length).toBeGreaterThan(4)
  for (const t of texts) expect((t.text ?? '').length).toBeLessThanOrEqual(40)
  await ui.unmount()
})

test('the error line fits a narrow pane', async ($, on) => {
  const io = await seed()
  await io.write('/t/state/usage/ua.json', '{nope')
  await setup($, on, io)
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 20 }, surface: 'terminal' })
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts.map((t) => t.text).join(' ')).toContain('cannot read')
  for (const t of texts) expect((t.text ?? '').length).toBeLessThanOrEqual(20)
  await ui.unmount()
})

test('the empty state fits a narrow pane', async ($, on) => {
  await setup($, on, memoryIo({ HOME: '/h', TAGTEAM_HOME: '/t' }))
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 20 }, surface: 'terminal' })
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts.length).toBeGreaterThan(1)
  for (const t of texts) expect((t.text ?? '').length).toBeLessThanOrEqual(20)
  await ui.unmount()
})

test('the active account is marked and the empty state is told', async ($, on) => {
  await setup($, on, await seed())
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /a.*42%/ }))?.text).toMatch(/^● a/)
  expect((await ui.find({ type: 'Text', text: /b.*excluded/ }))?.text).toMatch(/^ {2}b/)
  await ui.unmount()
})

test('with no accounts the pane says so', async ($, on) => {
  await setup($, on, memoryIo({ HOME: '/h', TAGTEAM_HOME: '/t' }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /No accounts yet/ })).toBeTruthy()
  await ui.unmount()
})

test('corrupt account or usage files draw an error line', async ($, on) => {
  const io = await seed()
  await io.write('/t/state/usage/ua.json', '{nope')
  await setup($, on, io)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /tagteam: cannot read accounts: / })).toBeTruthy()
  await io.write('/t/state/usage/ua.json', '{}')
  await io.write('/t/state/accounts/a.json', '{nope')
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await again.find({ type: 'Text', text: /tagteam: cannot read accounts: / })).toBeTruthy()
  await ui.unmount()
  await again.unmount()
})
