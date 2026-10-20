import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { memoryIo } from './support/memory'
import { routeTo } from './support/route'
import { currentAccountUuid, labelFor, localDay } from '../src/session'
import type { Usage } from '../src/types'

const setup = async (opts: { uuid?: string; configDir?: string } = {}) => {
  const env: Record<string, string> = { HOME: '/home/t', TAGTEAM_HOME: '/t' }
  if (opts.configDir) env.CLAUDE_CONFIG_DIR = opts.configDir
  const io = memoryIo(env)
  const uuid = 'uuid' in opts ? opts.uuid : 'u1'
  const file = `${opts.configDir ?? '/home/t'}/.claude.json`
  if (uuid) await io.write(file, JSON.stringify({ oauthAccount: { accountUuid: uuid } }))
  return io
}
const usageOf = async (io: Awaited<ReturnType<typeof setup>>, uuid = 'u1') =>
  JSON.parse((await io.read(`/t/state/usage/${uuid}.json`)) ?? 'null') as Usage | null

const turn = {
  answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' as const,
  usage: { model: 'm', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 },
}
const measure = (rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]) =>
  ({ context: { window: 1000 }, rateLimits, changed: ['rateLimits' as const] }) as never

test('currentAccountUuid reads HOME, or CLAUDE_CONFIG_DIR when set', async () => {
  expect(await currentAccountUuid(await setup())).toBe('u1')
  expect(await currentAccountUuid(await setup({ configDir: '/acct/a', uuid: 'u2' }))).toBe('u2')
  expect(await currentAccountUuid(await setup({ uuid: '' }))).toBeUndefined()
})

test('labelFor finds the account by uuid', () => {
  const a = { label: 'work', dir: '/d', accountUuid: 'u1', email: '', order: 1, excluded: false, needsSignIn: false }
  expect(labelFor([a], 'u1')).toBe('work')
  expect(labelFor([a], 'zz')).toBeUndefined()
})

const statusOf = (on: On) => {
  const status: (string | undefined)[] = []
  on('ui.status', (_, e) => (status.push(e.text as string | undefined), { value: undefined }))
  return status
}

test('session.measure stores the reading and hides the status under 70%', async ($, on) => {
  const io = await setup()
  routeTo(on, io)
  const status = statusOf(on)
  const resetsAt = new Date(Date.now() + 3600_000).toISOString()
  await $.session.measure(measure([{ kind: 'five_hour', percentUsed: 42, resetsAt }]))
  const u = await usageOf(io)
  expect(u?.windows.five_hour?.percentUsed).toBe(42)
  expect(u?.windows.five_hour?.resetsAt).toBe(resetsAt)
  expect(status).toEqual([undefined])
})

const workAccount = (io: Awaited<ReturnType<typeof setup>>) =>
  io.write('/t/state/accounts/work.json', JSON.stringify({
    label: 'work', dir: '/d', accountUuid: 'u1', email: 'a@example.com', order: 1, excluded: false, needsSignIn: false,
  }))

test('status shows the plain text at 82% weekly, with the account label', async ($, on) => {
  const io = await setup()
  await workAccount(io)
  routeTo(on, io)
  const status = statusOf(on)
  await $.session.measure(measure([{ kind: 'five_hour', percentUsed: 10 }, { kind: 'seven_day', percentUsed: 82 }]))
  expect(status).toEqual(['work at 82% of its weekly limit'])
})

test('status for an unmanaged account says this account', async ($, on) => {
  const io = await setup()
  routeTo(on, io)
  const status = statusOf(on)
  await $.session.measure(measure([{ kind: 'five_hour', percentUsed: 75 }]))
  expect(status).toEqual(['this account at 75% of its 5-hour limit'])
})

test('status at the threshold says it will ask to switch', async ($, on) => {
  const io = await setup()
  await workAccount(io)
  routeTo(on, io)
  const status = statusOf(on)
  await $.session.measure(measure([{ kind: 'five_hour', percentUsed: 96 }]))
  expect(status).toEqual(['work at 96% of its 5-hour limit, will ask to switch'])
})

test('status at the threshold says switching soon when auto switch is on', { options: { autoSwitch: true } }, async ($, on) => {
  const io = await setup()
  await workAccount(io)
  routeTo(on, io)
  on('session.surfaces', () => ({ value: ['terminal'] }))
  const status = statusOf(on)
  await $.session.measure(measure([{ kind: 'five_hour', percentUsed: 96 }]))
  expect(status[0]).toBe('work at 96% of its 5-hour limit, switching soon')
})

test('status clears when a reset drops the window under 70%', async ($, on) => {
  const io = await setup()
  routeTo(on, io)
  const status = statusOf(on)
  const resetsAt = new Date(Date.now() + 3600_000).toISOString()
  await $.session.measure(measure([{ kind: 'five_hour', percentUsed: 80, resetsAt }]))
  await $.session.measure(measure([{ kind: 'five_hour', percentUsed: 3, resetsAt }]))
  expect(status).toEqual(['this account at 80% of its 5-hour limit', undefined])
})

test('an early reset raises one toast naming the window', async ($, on) => {
  const io = await setup()
  routeTo(on, io)
  const toasts: string[] = []
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  const resetsAt = new Date(Date.now() + 3600_000).toISOString()
  await $.session.measure(measure([{ kind: 'five_hour', percentUsed: 80, resetsAt }]))
  expect(toasts).toEqual([])
  await $.session.measure(measure([{ kind: 'five_hour', percentUsed: 3, resetsAt }]))
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toBe('Your 5-hour limit reset early')
  expect((await usageOf(io))?.earlyResets.length).toBe(1)
})

test('turn.complete adds the turn tokens to today', async ($, on) => {
  const io = await setup()
  routeTo(on, io)
  await $.turn.complete(turn)
  await $.turn.complete(turn)
  const day = localDay(Date.now())
  expect((await usageOf(io))?.tokensByDay[day]).toEqual({ input: 20, output: 10, cacheRead: 4, cacheWrite: 2 })
})

test('no account file means nothing is recorded', async ($, on) => {
  const io = await setup({ uuid: '' })
  routeTo(on, io)
  const r = await $.turn.complete(turn)
  expect(r.text).toBe('')
  expect(await io.exists('/t/state')).toBe(false)
})

test('a corrupt usage file never breaks measure or turn.complete', async ($, on) => {
  const io = await setup()
  await io.write('/t/state/usage/u1.json', '{nope')
  routeTo(on, io)
  const m = await $.session.measure(measure([{ kind: 'five_hour', percentUsed: 5 }]))
  expect(m.changed).toEqual(['rateLimits'])
  expect((await $.turn.complete({ ...turn, answer: 'hi' })).text).toBe('hi')
})

test('a corrupt account file never breaks measure or turn.complete', async ($, on) => {
  const io = await setup()
  await io.write('/t/state/accounts/bad.json', '{nope')
  routeTo(on, io)
  const m = await $.session.measure(measure([{ kind: 'five_hour', percentUsed: 5 }]))
  expect(m.changed).toEqual(['rateLimits'])
  expect((await $.turn.complete({ ...turn, answer: 'hi' })).text).toBe('hi')
  expect((await usageOf(io))?.windows.five_hour?.percentUsed).toBe(5)
})
