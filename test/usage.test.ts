import { expect, test } from 'claude-code/testing'
import { addTokens, applyReadings, effectivePercent, emptyUsage } from '../src/usage'

const now = Date.parse('2026-10-20T10:00:00Z')
const win = (percentUsed: number, resetsAt: string) => ({ kind: 'x', percentUsed, resetsAt, readAt: 0 })

test('a reading replaces the window and stamps readAt', async () => {
  const r = applyReadings(emptyUsage('u'), [{ kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-20T13:00:00Z' }], now)
  expect(r.next.windows.five_hour).toEqual({ kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-20T13:00:00Z', readAt: now })
  expect(r.earlyResets).toEqual([])
})

test('a drop before resetsAt is an early reset', async () => {
  const prev = { ...emptyUsage('u'), windows: { five_hour: { ...win(80, '2026-10-20T13:00:00Z'), kind: 'five_hour' } } }
  const r = applyReadings(prev, [{ kind: 'five_hour', percentUsed: 5, resetsAt: '2026-10-20T13:00:00Z' }], now)
  expect(r.earlyResets).toEqual(['five_hour'])
  expect(r.next.earlyResets).toEqual([{ kind: 'five_hour', at: now }])
})

test('resetsAt moving earlier is an early reset', async () => {
  const prev = { ...emptyUsage('u'), windows: { seven_day: { ...win(50, '2026-10-23T00:00:00Z'), kind: 'seven_day' } } }
  const r = applyReadings(prev, [{ kind: 'seven_day', percentUsed: 50, resetsAt: '2026-10-21T00:00:00Z' }], now)
  expect(r.earlyResets).toEqual(['seven_day'])
})

test('a drop after the scheduled reset is not early', async () => {
  const prev = { ...emptyUsage('u'), windows: { five_hour: { ...win(80, '2026-10-20T09:00:00Z'), kind: 'five_hour' } } }
  const r = applyReadings(prev, [{ kind: 'five_hour', percentUsed: 3, resetsAt: '2026-10-20T14:00:00Z' }], now)
  expect(r.earlyResets).toEqual([])
})

test('a window missing from a reading is kept', async () => {
  const prev = { ...emptyUsage('u'), windows: { seven_day: { ...win(50, '2026-10-23T00:00:00Z'), kind: 'seven_day' } } }
  const r = applyReadings(prev, [{ kind: 'five_hour', percentUsed: 1 }], now)
  expect(r.next.windows.seven_day.percentUsed).toBe(50)
})

test('effectivePercent is 0 once the window has reset', async () => {
  const w = win(100, '2026-10-20T09:00:00Z')
  expect(effectivePercent(w, now)).toBe(0)
  expect(effectivePercent(w, Date.parse('2026-10-20T08:00:00Z'))).toBe(100)
})

test('addTokens sums per day', async () => {
  const t = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }
  const u = addTokens(addTokens(emptyUsage('u'), t, '2026-10-20'), t, '2026-10-20')
  expect(u.tokensByDay['2026-10-20']).toEqual({ input: 2, output: 4, cacheRead: 6, cacheWrite: 8 })
  expect(Object.keys(u.tokensByDay)).toEqual(['2026-10-20'])
})
