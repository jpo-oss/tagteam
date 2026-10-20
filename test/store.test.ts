import { expect, test } from 'claude-code/testing'
import type { Io } from '../src/io'
import {
  awaitDecision, claimDecision, listAccounts, loadUsage, readActive, releaseDecision,
  pruneDecisions, removeAccountRecord, saveAccount, saveUsage, snooze, snoozed, stateRoot, writeActive,
  writeJsonAtomic, writeSwitchRequest,
} from '../src/store'
import type { Account } from '../src/types'
import { memoryIo } from './support/memory'

const acct = (label: string, order: number): Account => ({
  label, dir: `/d/${label}`, accountUuid: `u-${label}`, email: `${label}@example.com`,
  order, excluded: false, needsSignIn: false,
})

const fresh = async (): Promise<{ io: Io; root: string }> => {
  const root = `/tmp/tagteam-test-${Math.random().toString(36).slice(2)}`
  return { io: memoryIo({ TAGTEAM_HOME: root }), root }
}

test('stateRoot uses TAGTEAM_HOME, else HOME/.claude-accounts', async () => {
  expect(await stateRoot(memoryIo({ TAGTEAM_HOME: '/t', HOME: '/h' }))).toBe('/t')
  expect(await stateRoot(memoryIo({ HOME: '/h' }))).toBe('/h/.claude-accounts')
})

test('accounts round-trip sorted by order, and can be removed', async () => {
  const { io } = await fresh()
  await saveAccount(io, acct('b', 2))
  await saveAccount(io, acct('a', 1))
  expect((await listAccounts(io)).map((a) => a.label)).toEqual(['a', 'b'])
  await removeAccountRecord(io, 'a')
  expect((await listAccounts(io)).map((a) => a.label)).toEqual(['b'])
})

test('usage round-trips and defaults to empty', async () => {
  const { io } = await fresh()
  expect((await loadUsage(io, 'u1')).windows).toEqual({})
  const u = await loadUsage(io, 'u1')
  u.windows.five_hour = { kind: 'five_hour', percentUsed: 40, readAt: 1 }
  await saveUsage(io, u)
  expect(await loadUsage(io, 'u1')).toEqual(u)
})

test('writeJsonAtomic leaves no tmp files', async () => {
  const { io, root } = await fresh()
  await writeJsonAtomic(io, `${root}/state/x.json`, { a: 1 })
  await writeJsonAtomic(io, `${root}/state/x.json`, { a: 2 })
  expect(await io.list(`${root}/state`)).toEqual(['x.json'])
  expect(JSON.parse((await io.read(`${root}/state/x.json`))!)).toEqual({ a: 2 })
})

test('active label and dir are one line each', async () => {
  const { io, root } = await fresh()
  expect(await readActive(io)).toBeUndefined()
  await writeActive(io, acct('a', 1))
  expect(await readActive(io)).toBe('a')
  expect(await io.read(`${root}/state/active`)).toBe('a\n')
  expect(await io.read(`${root}/state/active-dir`)).toBe('/d/a\n')
})

test('switch request file has the exact lines', async () => {
  const { io, root } = await fresh()
  await writeSwitchRequest(io, {
    run: 'r1', session: 's1', targetLabel: 'b', targetDir: '/d/b', resumeAt: 1700000000,
    reason: 'five_hour\nat 96', handover: 'line one\r\nline two',
  })
  expect(await io.read(`${root}/state/switch-r1`)).toBe(
    'session=s1\ntarget_label=b\ntarget_dir=/d/b\nresume_at=1700000000\nreason=five_hour at 96\nhandover=line one line two\n',
  )
  await writeSwitchRequest(io, {
    run: 'r2', session: 's', targetLabel: 'b', targetDir: '/d/b', reason: 'r', handover: 'h',
  })
  expect(await io.read(`${root}/state/switch-r2`)).toContain('resume_at=\n')
})

test('snooze matches only the same reset time', async () => {
  const { io } = await fresh()
  expect(await snoozed(io, 'u', 'five_hour', 'T1')).toBe(false)
  await snooze(io, 'u', 'five_hour', 'T1')
  expect(await snoozed(io, 'u', 'five_hour', 'T1')).toBe(true)
  expect(await snoozed(io, 'u', 'five_hour', 'T2')).toBe(false)
  expect(await snoozed(io, 'u', 'seven_day', 'T1')).toBe(false)
})

const T1 = '2030-01-01T00:00:00Z'
const T2 = '2030-01-01T05:00:00Z'

test('claimDecision is true once, then false', async () => {
  const { io } = await fresh()
  expect(await claimDecision(io, 'u1', 'five_hour', T1)).toBe(true)
  expect(await claimDecision(io, 'u1', 'five_hour', T1)).toBe(false)
  expect(await claimDecision(io, 'u2', 'five_hour', T1)).toBe(true)
  expect(await claimDecision(io, 'u1', 'seven_day', T1)).toBe(true)
})

test('a new window episode can be claimed after an answered one', async () => {
  const { io } = await fresh()
  await claimDecision(io, 'u1', 'five_hour', T1)
  await releaseDecision(io, 'u1', 'five_hour', T1, 'yes')
  expect(await claimDecision(io, 'u1', 'five_hour', T2)).toBe(true)
})

test('awaitDecision returns the released answer', async () => {
  const { io } = await fresh()
  await claimDecision(io, 'u1', 'five_hour', T1)
  const waiting = awaitDecision(io, 'u1', 'five_hour', T1)
  await io.sleep(50)
  await releaseDecision(io, 'u1', 'five_hour', T1, 'yes')
  expect(await waiting).toBe('yes')
})

test('an unanswered decision older than 10 minutes is abandoned and reclaimed', async () => {
  const { io, root } = await fresh()
  await claimDecision(io, 'u1', 'five_hour')
  await io.run(['touch', '-t', '200001010000', `${root}/state/decision-u1-five_hour-none`])
  expect(await claimDecision(io, 'u1', 'five_hour')).toBe(true)
  expect(await io.list(`${root}/state`)).toEqual(['decision-u1-five_hour-none'])
})

test('a lost mv race means the claim is false', async () => {
  const { io, root } = await fresh()
  await claimDecision(io, 'u1', 'five_hour')
  await io.run(['touch', '-t', '200001010000', `${root}/state/decision-u1-five_hour-none`])
  const racing: Io = {
    ...io,
    run: async (argv, o) => {
      if (argv[0] === 'mv') await io.run(argv, o)
      return io.run(argv, o)
    },
  }
  expect(await claimDecision(racing, 'u1', 'five_hour')).toBe(false)
})

test('pruneDecisions drops past episodes and keeps future and none', async () => {
  const { io, root } = await fresh()
  const past = '2020-01-01T00:00:00Z'
  await claimDecision(io, 'u1', 'five_hour', past)
  await claimDecision(io, 'u1', 'seven_day', T1)
  await claimDecision(io, 'u1', 'x')
  await pruneDecisions(io, Date.parse('2025-01-01T00:00:00Z'))
  expect((await io.list(`${root}/state`)).sort()).toEqual([
    'decision-u1-five_hour-none'.replace('five_hour', 'x'),
    `decision-u1-seven_day-${Date.parse(T1) / 1000}`,
  ].sort())
})

test('stateRoot throws when neither variable is set', async () => {
  let msg = ''
  try { await stateRoot(memoryIo()) } catch (e) { msg = String(e) }
  expect(msg).toContain('TAGTEAM_HOME')
})
