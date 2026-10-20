import { expect, test } from 'claude-code/testing'
import { when } from '../src/session'

// Local wall-clock times, so the assertions hold in any time zone. 2026-10-20 is a Tuesday.
const now = new Date(2026, 9, 20, 9, 0).getTime()
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).getTime()
const MIN = 60_000

test('under a day reads as a countdown', () => {
  expect(when(now + 45 * MIN, now, false)).toBe('in 45m')
  expect(when(now + 320 * MIN, now, false)).toBe('in 5h 20m')
  expect(when(now + 180 * MIN, now, false)).toBe('in 3h')
  expect(when(now + 20_000, now, false)).toBe('now')
  expect(when(now - 125 * MIN, now, false)).toBe('2h 5m ago')
})

test('within a week reads as weekday and time, 12 or 24 hour', () => {
  expect(when(at(22, 20), now, false)).toBe('Thu 8 PM')
  expect(when(at(22, 20, 30), now, false)).toBe('Thu 8:30 PM')
  expect(when(at(23, 0, 5), now, false)).toBe('Fri 12:05 AM')
  expect(when(at(24, 12), now, false)).toBe('Sat 12 PM')
  expect(when(at(22, 20), now, true)).toBe('Thu 20:00')
  expect(when(at(23, 7, 5), now, true)).toBe('Fri 07:05')
  expect(when(at(18, 8), now, false)).toBe('Sun 8 AM')
})

test('a week or more away reads as month and day', () => {
  expect(when(at(30, 10), now, false)).toBe('Oct 30')
  expect(when(new Date(2026, 10, 3, 10).getTime(), now, true)).toBe('Nov 3')
  expect(when(at(1, 10), now, false)).toBe('Oct 1')
})

test('the default follows the system clock preference and still formats', () => {
  expect(when(at(22, 20), now)).toMatch(/^Thu (8 PM|20:00)$/)
})
