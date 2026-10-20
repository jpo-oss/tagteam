import { expect, test } from 'claude-code/testing'
import { memoryIo } from './support/memory'
import { routeTo } from './support/route'
import type { Io } from '../src/io'
import { runCommand, type Deps } from '../src/commands'
import { readActive, saveAccount, saveUsage, snoozed } from '../src/store'
import { evaluate, handover, manualSwitch, newState, settingsFrom, type SwitchCtx, type SwitchUi } from '../src/switch'
import type { Account, Settings } from '../src/types'

declare const setTimeout: (fn: () => void, ms: number) => unknown
const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const RESET = new Date(Date.now() + 3600_000).toISOString()
const acct = (label: string, order: number): Account =>
  ({ label, dir: `/t/${label}`, accountUuid: `u${label}`, email: `${label}@x.io`, order, excluded: false, needsSignIn: false })

const setup = async (opts: { run?: string; pct?: number; live?: string[] } = {}) => {
  const env: Record<string, string> = { HOME: '/h', TAGTEAM_HOME: '/t', CLAUDE_CONFIG_DIR: '/t/a' }
  if (opts.run !== '') env.TAGTEAM_RUN = opts.run ?? 'r1'
  const io = memoryIo(env, opts.live)
  await saveAccount(io, acct('a', 0))
  await saveAccount(io, acct('b', 1))
  await io.write('/t/state/active', 'a\n')
  await io.write('/t/a/.claude.json', JSON.stringify({
    oauthAccount: { accountUuid: 'ua' }, projects: { '/w': { hasTrustDialogAccepted: true } },
  }))
  await io.write('/t/b/.claude.json', JSON.stringify({ oauthAccount: { accountUuid: 'ub' }, theme: 'dark' }))
  await setPct(io, 'ua', opts.pct ?? 95)
  return io
}
const setPct = (io: Io, uuid: string, pct: number, resetsAt = RESET) =>
  saveUsage(io, {
    accountUuid: uuid, tokensByDay: {}, earlyResets: [],
    windows: { five_hour: { kind: 'five_hour', percentUsed: pct, resetsAt, readAt: Date.now() } },
  })

type Calls = { asks: string[]; toasts: string[]; notes: string[]; exits: number }
const fakeUi = (answer?: () => Promise<string>): { ui: SwitchUi; calls: Calls } => {
  const calls: Calls = { asks: [], toasts: [], notes: [], exits: 0 }
  const ui: SwitchUi = {
    ask: async (q) => (calls.asks.push(q), answer ? answer() : 'Yes'),
    toast: (t) => void calls.toasts.push(t),
    notify: async (t) => void calls.notes.push(t),
    cwd: async () => '/w',
    sessionId: async () => 's1',
    exitSoon: () => void calls.exits++,
  }
  return { ui, calls }
}
const SETTINGS: Settings = { autoSwitch: true, threshold: 95, stallTimeoutSeconds: 30 }
const ctx = (io: Io, ui: SwitchUi, over: Partial<Settings> = {}): SwitchCtx =>
  ({ io, ui, state: newState(), settings: { ...SETTINGS, ...over } })
const request = async (io: Io, run = 'r1') => {
  const text = await io.read(`/t/state/switch-${run}`)
  return text === undefined ? undefined : Object.fromEntries(text.trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
}

test('auto on: switches to the fresh account, copies trust and tells the user once', async () => {
  const io = await setup()
  const { ui, calls } = fakeUi()
  const c = ctx(io, ui)
  await evaluate(c, Date.now())
  const r = await request(io)
  expect(r).toMatchObject({ session: 's1', target_label: 'b', target_dir: '/t/b', resume_at: '', stall: '30' })
  expect(r?.handover).toContain('b')
  expect(await readActive(io)).toBe('b')
  expect(calls.toasts).toEqual(['Switched from a (95% five_hour) to b'])
  expect(calls.asks).toEqual([])
  expect(calls.exits).toBe(1)
  expect(c.state.pendingExit).toBe(true)
  const b = JSON.parse((await io.read('/t/b/.claude.json')) ?? '{}')
  expect(b.projects['/w'].hasTrustDialogAccepted).toBe(true)
  expect(b.theme).toBe('dark')
})

test('a pending exit waits for the turn to finish', async () => {
  const io = await setup()
  const { ui, calls } = fakeUi()
  const c = ctx(io, ui)
  c.state.inTurn = true
  await evaluate(c, Date.now())
  expect(c.state.pendingExit).toBe(true)
  expect(calls.exits).toBe(0)
})

test('under the threshold nothing happens', async () => {
  const io = await setup({ pct: 94 })
  const { ui, calls } = fakeUi()
  await evaluate(ctx(io, ui), Date.now())
  expect(await request(io)).toBeUndefined()
  expect(calls).toEqual({ asks: [], toasts: [], notes: [], exits: 0 })
})

test('trust is not copied while another claude runs in the target folder', async () => {
  const io = await setup({ live: ['4242'] })
  await io.write('/t/state/run-other', 'dir=/t/b\npid=4242\n')
  const { ui } = fakeUi()
  await evaluate(ctx(io, ui), Date.now())
  expect((await request(io))?.target_label).toBe('b')
  expect(JSON.parse((await io.read('/t/b/.claude.json')) ?? '{}').projects).toBeUndefined()
})

test('auto off: Yes switches', async () => {
  const io = await setup()
  const { ui, calls } = fakeUi(async () => 'Yes')
  await evaluate(ctx(io, ui, { autoSwitch: false }), Date.now())
  expect(calls.asks.length).toBe(1)
  expect(calls.asks[0]).toContain('95%')
  expect((await request(io))?.target_label).toBe('b')
  expect(await readActive(io)).toBe('b')
})

test('auto off: No snoozes the window and a later reading asks nothing', async () => {
  const io = await setup()
  const { ui, calls } = fakeUi(async () => 'No')
  const c = ctx(io, ui, { autoSwitch: false })
  await evaluate(c, Date.now())
  expect(await request(io)).toBeUndefined()
  expect(await snoozed(io, 'ua', 'five_hour', RESET)).toBe(true)
  await setPct(io, 'ua', 97)
  await evaluate(c, Date.now())
  expect(calls.asks.length).toBe(1)
  expect(await request(io)).toBeUndefined()
  expect(await readActive(io)).toBe('a')
})

test('auto off: a dismissed question neither switches nor snoozes, and can be asked again', async () => {
  const io = await setup()
  const { ui, calls } = fakeUi(() => Promise.reject(new Error('dismissed')))
  const c = ctx(io, ui, { autoSwitch: false })
  await evaluate(c, Date.now())
  expect(await request(io)).toBeUndefined()
  expect(await snoozed(io, 'ua', 'five_hour', RESET)).toBe(false)
  await evaluate(c, Date.now())
  expect(calls.asks.length).toBe(2)
})

test('auto off: two sessions on one account get one question and both follow it', async () => {
  const io = await setup()
  const io2: Io = { ...io, env: async (n) => (n === 'TAGTEAM_RUN' ? 'r2' : io.env(n)) }
  let release!: (a: string) => void
  const asked = new Promise<string>((r) => (release = r))
  const one = fakeUi(() => asked)
  const two = fakeUi(() => asked)
  const first = evaluate(ctx(io, one.ui, { autoSwitch: false }), Date.now())
  await tick(20)
  const second = evaluate(ctx(io2, two.ui, { autoSwitch: false }), Date.now())
  await tick(20)
  release('Yes')
  await Promise.all([first, second])
  expect(one.calls.asks.length + two.calls.asks.length).toBe(1)
  expect((await request(io, 'r1'))?.target_label).toBe('b')
  expect((await request(io, 'r2'))?.target_label).toBe('b')
})

test('without the launcher it warns once and writes nothing', async () => {
  const io = await setup({ run: '' })
  const { ui, calls } = fakeUi()
  const c = ctx(io, ui)
  await evaluate(c, Date.now())
  await evaluate(c, Date.now())
  expect(calls.toasts.length).toBe(1)
  expect(calls.toasts[0]).toContain('95%')
  expect(calls.toasts[0]).toContain('launcher')
  expect(await request(io)).toBeUndefined()
  expect(await readActive(io)).toBe('a')
  expect(calls.exits).toBe(0)
})

test('a session behind the active account follows it without asking', async () => {
  const io = await setup({ pct: 10 })
  await io.write('/t/state/active', 'b\n')
  const { ui, calls } = fakeUi()
  await evaluate(ctx(io, ui, { autoSwitch: false }), Date.now())
  expect((await request(io))?.target_label).toBe('b')
  expect(calls.asks).toEqual([])
})

test('a session does not follow an active account that is itself limited', async () => {
  const io = await setup({ pct: 10 })
  await io.write('/t/state/active', 'b\n')
  await setPct(io, 'ub', 99)
  const { ui } = fakeUi()
  await evaluate(ctx(io, ui), Date.now())
  expect(await request(io)).toBeUndefined()
})

test('when every account is limited it waits for the soonest reset', async () => {
  const io = await setup()
  const later = new Date(Date.now() + 7200_000).toISOString()
  await setPct(io, 'ub', 99, later)
  const { ui } = fakeUi()
  await evaluate(ctx(io, ui), Date.now())
  const r = await request(io)
  expect(r?.target_label).toBe('a')
  expect(r?.target_dir).toBe('/t/a')
  expect(r?.resume_at).toBe(String(Math.ceil(Date.parse(RESET) / 1000)))
})

test('with no account to go to it notifies once and stays', async () => {
  const io = await setup()
  await saveAccount(io, { ...acct('b', 1), excluded: true })
  await setPct(io, 'ua', 96, '')
  const { ui, calls } = fakeUi()
  const c = ctx(io, ui)
  await evaluate(c, Date.now())
  await evaluate(c, Date.now())
  expect(await request(io)).toBeUndefined()
  expect(calls.notes.length).toBe(1)
  expect(calls.notes[0]?.toLowerCase()).toContain('no account is available')
  expect(calls.exits).toBe(0)
})

test('handover names both accounts and the reason, and asks to resume only what was running', () => {
  const text = handover('a', 'b', 'a reached 95% of its five_hour limit')
  expect(text).toContain('a reached 95% of its five_hour limit')
  expect(text).toContain('subagent')
  expect(text).toContain('background task')
  expect(text).not.toMatch(/[–—\n]/)
  expect(handover('a', 'a', 'x')).not.toContain('reopened on a')
})

test('settingsFrom applies defaults and clamps the threshold', () => {
  expect(settingsFrom({})).toEqual({ autoSwitch: false, threshold: 95, stallTimeoutSeconds: 30 })
  expect(settingsFrom({ autoSwitch: true, threshold: 20, stallTimeoutSeconds: 5 })).toEqual({
    autoSwitch: true, threshold: 50, stallTimeoutSeconds: 5,
  })
})

test('manualSwitch moves to the named account', async () => {
  const io = await setup({ pct: 10 })
  const { ui, calls } = fakeUi()
  const c = ctx(io, ui)
  expect(await manualSwitch(c, 'b')).toContain('b')
  expect((await request(io))?.target_label).toBe('b')
  expect(await readActive(io)).toBe('b')
  expect(calls.exits).toBe(1)
  expect(await manualSwitch(ctx(io, ui), 'zz')).toContain('No account named zz')
})

test('manualSwitch needs the launcher', async () => {
  const io = await setup({ run: '', pct: 10 })
  const { ui } = fakeUi()
  expect(await manualSwitch(ctx(io, ui), 'b')).toContain('launcher')
  expect(await request(io)).toBeUndefined()
})

test('/tagteam switch <label> goes through deps', async () => {
  const io = await setup()
  const seen: string[] = []
  const deps: Deps = {
    login: async () => undefined, logout: async () => true, confirm: async () => true,
    switchTo: async (l) => (seen.push(l), `Switching to ${l}.`),
  }
  expect(await runCommand(io, 'switch b', deps)).toBe('Switching to b.')
  expect(seen).toEqual(['b'])
})

test('hooks: a reading over the threshold with auto on closes the session after the turn', { options: { autoSwitch: true } }, async ($, on) => {
  const io = await setup({ pct: 10 })
  routeTo(on, io)
  const toasts: string[] = []
  const commands: string[] = []
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 's1' }))
  on('command.run', (_, e) => (commands.push(e.command), { text: '' }))
  on('clock.after', () => ({ value: undefined }))
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await $.session.measure({ context: { window: 1000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 96, resetsAt: RESET }], changed: ['rateLimits'] } as never)
  for (let i = 0; i < 100 && !(await io.exists('/t/state/switch-r1')); i++) await tick(10)
  expect((await request(io))?.target_label).toBe('b')
  expect(toasts).toContain('Switched from a (96% five_hour) to b')
  expect(commands).toEqual([])
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  for (let i = 0; i < 100 && !commands.length; i++) await tick(10)
  expect(commands).toEqual(['exit'])
})
