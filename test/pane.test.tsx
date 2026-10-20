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
  ({ label, dir: `/t/${label}`, accountUuid: uuid, email: `${label}@example.com`, order: 0, excluded: false, needsSignIn: false, ...over })

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
  await saveUsage(io, usage('ua', 42, 80, { 0: 1200, 3: 300, 9: 5000 }))
  await saveUsage(io, usage('ud', 100, 30, {}))
  return io
}

const setup = async ($: any, on: any, io: ReturnType<typeof memoryIo>) => {
  routeTo(on, io)
  on('command.register', () => ({ value: { command: 'tagteam' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

type Found = { text: string; props: Record<string, unknown> }
type Mounted = { find: (q: object) => Promise<Found | undefined>; findAll: (q: object) => Promise<Found[]>; unmount: () => Promise<void> }
const mount = ($: any, surface: 'terminal' | 'desktop', columns = 60): Promise<Mounted> =>
  $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns }, surface })

// Card lines are one Text each, with the border, bar and words nested inside.
const lines = async (ui: Mounted) => (await ui.findAll({ type: 'Text' })).filter((t) => t.props.wrap === 'truncate-end').map((t) => t.text)
const card = (all: string[], title: string) => {
  const i = all.findIndex((l) => l.startsWith(`╭─ ${title} `))
  return all.slice(i, all.findIndex((l, j) => j > i && l.startsWith('╰')) + 1)
}
const bars = async (ui: Mounted) =>
  (await ui.findAll({ type: 'Text', text: /^[█░]+$/ })).map((t) => [t.text.replace(/░/g, '').length, t.text.length, t.props.color])

test('each account is a card with state, bars, reset times and tokens, on every surface', async ($, on) => {
  await setup($, on, await seed())
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface)
    const all = await lines(ui)
    const a = card(all, '● a')
    expect(a[0]).toMatch(/^╭─ ● a ─+ a@example\.com ─╮$/)
    expect(a[1]).toMatch(/^│ State {5}Active +│$/)
    expect(a[2]).toMatch(/^│ 5-hour {4}████░░░░░░ {2}42% {2}resets in 1h +│$/)
    expect(a[3]).toMatch(/^│ Weekly {4}████████░░ {2}80% {2}resets in 1h +│$/)
    expect(a[4]).toMatch(/^│ Tokens {4}today 1\.2k {3}this week 1\.5k +│$/)
    expect(a[5]).toMatch(/^╰─+╯$/)
    expect(card(all, 'b')[1]).toContain('State     Excluded')
    expect(card(all, 'c')[1]).toContain('State     Needs sign-in')
    expect(card(all, 'c')[2]).toContain('Usage     no reading yet')
    expect(card(all, 'd')[1]).toContain('State     Limited, in 1h')
    expect(card(all, 'd')[2]).toContain('██████████ 100%')
    await ui.unmount()
  }
})

test('the active card has a marked, bold title and a colored border', async ($, on) => {
  await setup($, on, await seed())
  const ui = await mount($, 'terminal')
  expect((await ui.find({ type: 'Text', text: /^● a$/ }))?.props.bold).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^b$/ }))?.props.bold).toBeFalsy()
  expect((await ui.findAll({ type: 'Text', text: /^╭─ $/ })).map((t) => t.props.color ?? 'dim')).toEqual(['claude', 'dim', 'dim', 'dim'])
  expect(await ui.find({ type: 'Text', text: '● b' })).toBeUndefined()
  await ui.unmount()
})

test('bars are green under 70%, yellow below the threshold, red at it', { options: { threshold: 95 } }, async ($, on) => {
  await setup($, on, await seed())
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface)
    expect(await bars(ui)).toEqual([[4, 10, 'success'], [8, 10, 'warning'], [10, 10, 'error'], [3, 10, 'success']])
    await ui.unmount()
  }
})

test('a lower threshold turns the bar red sooner', { options: { threshold: 80 } }, async ($, on) => {
  await setup($, on, await seed())
  const ui = await mount($, 'terminal')
  expect((await bars(ui))[1]).toEqual([8, 10, 'error'])
  await ui.unmount()
})

test('narrow panes shorten the bar, then drop the email, and never overflow', async ($, on) => {
  await setup($, on, await seed())
  const cases: [number, number, boolean][] = [[60, 10, true], [45, 5, true], [30, 3, true], [26, 3, false], [14, 3, false], [8, 3, false]]
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const [columns, width, email] of cases) {
      const ui = await mount($, surface, columns)
      for (const t of await ui.findAll({ type: 'Text' })) expect(t.text.length).toBeLessThanOrEqual(columns)
      const all = await lines(ui)
      for (const l of all) expect(l.length).toBe(columns)
      if (columns >= 26) expect((await bars(ui))[0]).toEqual([Math.round(0.42 * width), width, 'success'])
      expect(all.some((l) => l.includes('a@example.com'))).toBe(email)
      expect(all[0]!.startsWith('╭')).toBe(columns >= 12)
      await ui.unmount()
    }
  }
})

test('tokens count input and output only', async ($, on) => {
  const io = await seed()
  const u = JSON.parse((await io.read('/t/state/usage/ua.json'))!) as Usage
  const day = localDay(Date.now())
  u.tokensByDay[day] = { input: 100, output: 20, cacheRead: 9000, cacheWrite: 7000 }
  await saveUsage(io, u)
  await setup($, on, io)
  const ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /Tokens {4}today 120 +this week/u })).toBeTruthy()
  await ui.unmount()
})

test('no line is wider than the pane', async ($, on) => {
  await setup($, on, await seed())
  const ui = await mount($, 'terminal', 40)
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts.length).toBeGreaterThan(4)
  for (const t of texts) expect((t.text ?? '').length).toBeLessThanOrEqual(40)
  await ui.unmount()
})

test('the error line fits a narrow pane', async ($, on) => {
  const io = await seed()
  await io.write('/t/state/usage/ua.json', '{nope')
  await setup($, on, io)
  const ui = await mount($, 'terminal', 20)
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts.map((t) => t.text).join(' ')).toContain('cannot read')
  for (const t of texts) expect((t.text ?? '').length).toBeLessThanOrEqual(20)
  await ui.unmount()
})

test('the empty state fits a narrow pane', async ($, on) => {
  await setup($, on, memoryIo({ HOME: '/h', TAGTEAM_HOME: '/t' }))
  const ui = await mount($, 'terminal', 20)
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts.length).toBeGreaterThan(1)
  for (const t of texts) expect((t.text ?? '').length).toBeLessThanOrEqual(20)
  await ui.unmount()
})

test('with no accounts the pane says so', async ($, on) => {
  await setup($, on, memoryIo({ HOME: '/h', TAGTEAM_HOME: '/t' }))
  const ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /No accounts yet/ })).toBeTruthy()
  await ui.unmount()
})

test('corrupt account or usage files draw an error line', async ($, on) => {
  const io = await seed()
  await io.write('/t/state/usage/ua.json', '{nope')
  await setup($, on, io)
  const ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /tagteam: cannot read accounts: / })).toBeTruthy()
  await io.write('/t/state/usage/ua.json', '{}')
  await io.write('/t/state/accounts/a.json', '{nope')
  const again = await mount($, 'desktop')
  expect(await again.find({ type: 'Text', text: /tagteam: cannot read accounts: / })).toBeTruthy()
  await ui.unmount()
  await again.unmount()
})

test('the top line shows auto switch on', { options: { autoSwitch: true, threshold: 95 } }, async ($, on) => {
  await setup($, on, await seed())
  const ui = await mount($, 'terminal')
  expect((await ui.findAll({ type: 'Text' }))[0]?.text).toContain('on at 95%')
  await ui.unmount()
})

test('the top line shows auto switch off', { options: { autoSwitch: false, threshold: 80 } }, async ($, on) => {
  await setup($, on, await seed())
  const ui = await mount($, 'terminal')
  expect((await ui.findAll({ type: 'Text' }))[0]?.text).toContain('off (asks at 80%)')
  await ui.unmount()
})
