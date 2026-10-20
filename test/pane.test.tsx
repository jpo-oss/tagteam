import { expect, test } from 'claude-code/testing'
import { memoryIo } from './support/memory'
import { routeTo } from './support/route'
import { localDay } from '../src/session'
import { saveAccount, saveUsage, writeActive } from '../src/store'
import type { Account, Usage } from '../src/types'

declare const setTimeout: (fn: (v?: unknown) => void, ms: number) => unknown

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
  await io.write('/h/.claude.json', JSON.stringify({ oauthAccount: { accountUuid: 'ua' } }))
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

// Each poll period waits here until the test fires it.
const ticks: (() => void)[] = []
const setup = async ($: any, on: any, io: ReturnType<typeof memoryIo>) => {
  routeTo(on, io)
  on('clock.every', () => new Promise((r) => ticks.push(() => r({ value: undefined }))))
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
// [filled cells, bar width, filled color]; empty cells are always dim with no color.
const bars = async (ui: Mounted) => {
  for (const t of await ui.findAll({ type: 'Text', text: /^░+$/ })) expect([t.props.color, t.props.dimColor]).toEqual([undefined, true])
  const colors = (await ui.findAll({ type: 'Text', text: /^█+$/ })).map((t) => t.props.color)
  return (await lines(ui)).flatMap((l) => l.match(/[█░]{3,}/g) ?? []).map((b) => {
    const filled = b.replace(/░/g, '').length
    return [filled, b.length, filled ? colors.shift() : undefined]
  })
}

test('each account is a card with state, bars, reset times and tokens, on every surface', async ($, on) => {
  await setup($, on, await seed())
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface)
    const all = await lines(ui)
    const a = card(all, 'a')
    expect(a[0]).toMatch(/^╭─ a ─+ a@example\.com ─╮$/)
    expect(a[1]).toMatch(/^│ State {5}This session +│$/)
    expect(a[2]).toMatch(/^│ 5-hour {4}████░░░░░░ {2}42% {2}resets in 1h +│$/)
    expect(a[3]).toMatch(/^│ Weekly {4}████████░░ {2}80% {2}resets in 1h +│$/)
    expect(a[4]).toMatch(/^│ Tokens {4}today 1\.2k {3}this week 1\.5k +│$/)
    expect(a[5]).toMatch(/^╰─+╯$/)
    expect(card(all, 'b')[1]).toContain('State     Excluded')
    expect(card(all, 'c')[1]).toContain('State     Needs sign-in')
    expect(card(all, 'c')[2]).toContain('Usage     no reading yet')
    expect(card(all, 'd')[1]).toContain('State     Limited for 1h')
    expect(card(all, 'd')[2]).toContain('██████████ 100%')
    await ui.unmount()
  }
})

test('only color marks the card of the account this session uses: its border and whole header', async ($, on) => {
  await setup($, on, await seed())
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: /●/ })).toBeUndefined()
    const style = (t?: Found) => ({ color: t?.props.color, dimColor: t?.props.dimColor, bold: t?.props.bold })
    expect(style(await ui.find({ type: 'Text', text: /^a$/ }))).toEqual({ color: 'claude', dimColor: undefined, bold: undefined })
    expect(style(await ui.find({ type: 'Text', text: /^a@example\.com$/ }))).toEqual({ color: 'claude', dimColor: undefined, bold: undefined })
    expect(style(await ui.find({ type: 'Text', text: /^b$/ }))).toEqual({ color: undefined, dimColor: undefined, bold: undefined })
    expect(style(await ui.find({ type: 'Text', text: /^b@example\.com$/ }))).toEqual({ color: undefined, dimColor: undefined, bold: undefined })
    const borders = (await ui.findAll({ type: 'Text', text: /^[╭╰│]/ })).filter((t) => t.props.wrap === undefined)
    const active = borders.filter((t) => t.props.color === 'claude').length
    expect(active).toBe(card(await lines(ui), 'a').length)
    for (const t of borders) expect(t.props.color === 'claude' || t.props.dimColor === true).toBe(true)
    await ui.unmount()
  }
})

test('a limit that ends days away says until', async ($, on) => {
  const io = await seed()
  const u = JSON.parse((await io.read('/t/state/usage/ud.json'))!) as Usage
  u.windows.five_hour!.resetsAt = new Date(Date.now() + 2 * 86400_000).toISOString()
  u.windows.seven_day!.resetsAt = new Date(Date.now() + 2 * 86400_000).toISOString()
  await saveUsage(io, u)
  await setup($, on, io)
  const ui = await mount($, 'terminal')
  expect(card(await lines(ui), 'd')[1]).toMatch(/State {5}Limited until (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d/)
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
  const cases: [number, number, boolean][] = [[62, 10, true], [47, 5, true], [32, 3, true], [26, 3, false], [16, 3, false], [10, 3, false]]
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const [columns, width, email] of cases) {
      const ui = await mount($, surface, columns)
      for (const t of await ui.findAll({ type: 'Text' })) expect(t.text.length).toBeLessThanOrEqual(columns)
      const all = await lines(ui)
      for (const l of all) expect(l.length).toBe(columns - 2)
      if (columns >= 26) expect((await bars(ui))[0]).toEqual([Math.round(0.42 * width), width, 'success'])
      expect(all.some((l) => l.includes('a@example.com'))).toBe(email)
      expect(all[0]!.startsWith('╭')).toBe(columns >= 14)
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

const stateOf = async ($: any) => {
  const ui = await mount($, 'terminal')
  const all = await lines(ui)
  const highlighted = (await ui.findAll({ type: 'Text', text: /^╭─ $/ })).filter((t) => t.props.color === 'claude').length
  const note = await ui.find({ type: 'Text', text: /doesn't manage/ })
  await ui.unmount()
  return { all, highlighted, note: note?.text }
}

test('the card for the account this session uses is highlighted', async ($, on) => {
  const io = await seed()
  await io.write('/h/.claude.json', JSON.stringify({ oauthAccount: { accountUuid: 'ud' } }))
  await setup($, on, io)
  const { all, highlighted, note } = await stateOf($)
  expect(card(all, 'd')[1]).toMatch(/State {5}This session, limited for 1h +│$/)
  expect(card(all, 'a')[1]).toMatch(/State {5}Available +│$/)
  expect(highlighted).toBe(1)
  expect(note).toBeUndefined()
})

test('only the session card says This session', async ($, on) => {
  await setup($, on, await seed())
  const { all, highlighted } = await stateOf($)
  expect(all.filter((l) => l.includes('This session')).length).toBe(1)
  expect(highlighted).toBe(1)
})

test('a session on an account tagteam does not manage highlights nothing and says so', async ($, on) => {
  const io = await seed()
  await io.write('/h/.claude.json', JSON.stringify({ oauthAccount: { accountUuid: 'elsewhere' } }))
  await setup($, on, io)
  const { all, highlighted, note } = await stateOf($)
  expect(note).toBe("This session uses an account tagteam doesn't manage.")
  expect(highlighted).toBe(0)
  expect(card(all, 'a')[1]).toMatch(/State {5}Available +│$/)
})

test('the pane has a margin each side and a blank line on top', async ($, on) => {
  await setup($, on, await seed())
  const ui = await mount($, 'terminal', 40)
  const boxes = await ui.findAll({ type: 'Box' })
  expect(boxes[0]?.props).toMatchObject({ width: 40, paddingX: 1, paddingTop: 1 })
  await ui.unmount()
})

const measure = (percentUsed: number) =>
  ({ context: { window: 1000 }, rateLimits: [{ kind: 'five_hour', percentUsed }], changed: ['rateLimits' as const] }) as never

test('a reading this session records redraws the open pane', async ($, on) => {
  await setup($, on, await seed())
  const ui = await mount($, 'terminal')
  expect(card(await lines(ui), 'a')[2]).toContain(' 42%')
  await $.session.measure(measure(55))
  expect(card(await lines(ui), 'a')[2]).toContain(' 55%')
  await ui.unmount()
})

// Stands in for the person closing the pane: the test engine raises ui.close only through a plugin.
const closer = {
  name: 'closer',
  register(on: any) {
    on('turn.start', async ($: any, e: any, next: any) => {
      await $.ui.close({ id: 'tagteam' })
      return next(e)
    })
  },
}

test('the open pane polls for other sessions, and stops when it closes', { plugins: [closer] }, async ($, on) => {
  const io = await seed()
  on('ui.close', () => ({ value: undefined }))
  await setup($, on, io)
  ticks.length = 0
  let stamps = 0
  const list = io.list
  io.list = async (p) => (p === '/t/state/usage' && stamps++, list(p))
  const ui = await mount($, 'terminal')
  expect(ticks.length).toBe(1)
  const usage = JSON.parse((await io.read('/t/state/usage/ua.json'))!) as Usage
  usage.windows.five_hour!.percentUsed = 64
  await new Promise((r) => setTimeout(r, 5))
  await saveUsage(io, usage)
  const before = stamps
  ticks.shift()!()
  await new Promise((r) => setTimeout(r, 50))
  expect(stamps).toBeGreaterThan(before)
  expect(card(await lines(ui), 'a')[2]).toContain(' 64%')
  await $.turn.start({ turnId: 't', prompt: '' } as never)
  const after = stamps
  for (const t of ticks.splice(0)) t()
  await new Promise((r) => setTimeout(r, 50))
  expect(ticks.length).toBe(0)
  expect(stamps).toBe(after)
  await ui.unmount()
})
