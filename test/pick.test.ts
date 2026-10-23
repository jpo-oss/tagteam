import { expect, test } from 'claude-code/testing'
import { pickTarget } from '../src/pick'
import type { Account, Usage } from '../src/types'

const now = Date.parse('2026-10-20T12:00:00Z')
const H = 3600_000

const acct = (label: string, over: Partial<Account> = {}): Account => ({
  label, dir: `/x/${label}`, accountUuid: `u-${label}`, email: `${label}@example.com`,
  order: 0, excluded: false, needsSignIn: false, ...over,
})

const use = (label: string, ...ws: [string, number, number?, number?][]): Usage => ({
  accountUuid: `u-${label}`,
  windows: Object.fromEntries(ws.map(([kind, p, reset, readAt]) => [kind, {
    kind, percentUsed: p, readAt: readAt ?? now,
    ...(reset === undefined ? {} : { resetsAt: new Date(reset).toISOString() }),
  }])),
  tokensByDay: {}, earlyResets: [],
})

const byUuid = (...us: Usage[]) => Object.fromEntries(us.map((u) => [u.accountUuid, u]))

test('lowest level wins', () => {
  const r = pickTarget(
    [acct('a'), acct('b'), acct('c')],
    byUuid(use('a', ['five_hour', 96]), use('b', ['five_hour', 40]), use('c', ['five_hour', 8])),
    'a', 95, now,
  )
  expect(r).toEqual({ kind: 'switch', label: 'c' })
})

test('ties go to order, then oldest reading', () => {
  const u = byUuid(use('b', ['five_hour', 10]), use('c', ['five_hour', 10]))
  expect(pickTarget([acct('a'), acct('b', { order: 2 }), acct('c', { order: 1 })], u, 'a', 95, now))
    .toEqual({ kind: 'switch', label: 'c' })
  const u2 = byUuid(use('b', ['five_hour', 10, undefined, now - 5000]), use('c', ['five_hour', 10, undefined, now - 9000]))
  expect(pickTarget([acct('a'), acct('b'), acct('c')], u2, 'a', 95, now))
    .toEqual({ kind: 'switch', label: 'c' })
})

test('within 10 points the sooner weekly reset wins, beyond that the lower level does', () => {
  const accounts = [acct('a'), acct('b'), acct('c')]
  const close = byUuid(use('b', ['seven_day', 21, now + 6 * 24 * H]), use('c', ['seven_day', 28, now + 2 * H]))
  expect(pickTarget(accounts, close, 'a', 95, now)).toEqual({ kind: 'switch', label: 'c' })
  const far = byUuid(use('b', ['seven_day', 21, now + 6 * 24 * H]), use('c', ['seven_day', 31, now + 2 * H]))
  expect(pickTarget(accounts, far, 'a', 95, now)).toEqual({ kind: 'switch', label: 'b' })
})

test('a weekly reset already past or missing never counts as sooner', () => {
  const u = byUuid(
    use('b', ['seven_day', 0, now - H], ['five_hour', 22]),
    use('c', ['five_hour', 24]),
    use('d', ['seven_day', 25, now + 3 * 24 * H]),
  )
  expect(pickTarget([acct('a'), acct('b'), acct('c'), acct('d')], u, 'a', 95, now)).toEqual({ kind: 'switch', label: 'd' })
})

test('skips excluded, needsSignIn and current', () => {
  const u = byUuid(use('b', ['five_hour', 1]), use('c', ['five_hour', 1]), use('d', ['five_hour', 50]))
  const r = pickTarget(
    [acct('a'), acct('b', { excluded: true }), acct('c', { needsSignIn: true }), acct('d')],
    u, 'a', 95, now,
  )
  expect(r).toEqual({ kind: 'switch', label: 'd' })
})

test('no readings counts as 0% but loses a tie to a known reading', () => {
  const u = byUuid(use('c', ['five_hour', 0]))
  expect(pickTarget([acct('a'), acct('b'), acct('c', { order: 5 })], u, 'a', 95, now))
    .toEqual({ kind: 'switch', label: 'c' })
  expect(pickTarget([acct('a'), acct('b')], {}, 'a', 95, now)).toEqual({ kind: 'switch', label: 'b' })
})

test('expired windows count as 0%', () => {
  const u = byUuid(use('b', ['five_hour', 99, now - 1]), use('c', ['five_hour', 30]))
  expect(pickTarget([acct('a'), acct('b'), acct('c')], u, 'a', 95, now))
    .toEqual({ kind: 'switch', label: 'b' })
})

test('empty current label is fine', () => {
  expect(pickTarget([acct('a')], {}, '', 95, now)).toEqual({ kind: 'switch', label: 'a' })
})

test('waits for the earliest reset when nothing is eligible', () => {
  const u = byUuid(
    use('b', ['seven_day', 100, now + 48 * H]),
    use('c', ['five_hour', 99, now + 3 * H]),
  )
  expect(pickTarget([acct('a'), acct('b'), acct('c')], u, 'a', 95, now))
    .toEqual({ kind: 'wait', label: 'c', resumeAt: now + 3 * H })
})

test('several blocking windows use the latest reset', () => {
  const u = byUuid(
    use('b', ['seven_day', 100, now + 48 * H], ['five_hour', 99, now + 2 * H]),
    use('c', ['five_hour', 99, now + 5 * H]),
  )
  expect(pickTarget([acct('a'), acct('b'), acct('c')], u, 'a', 95, now))
    .toEqual({ kind: 'wait', label: 'c', resumeAt: now + 5 * H })
})

test('none when nothing is eligible and no reset times', () => {
  const u = byUuid(use('b', ['five_hour', 99]))
  expect(pickTarget([acct('a'), acct('b')], u, 'a', 95, now)).toEqual({ kind: 'none' })
  expect(pickTarget([acct('a')], {}, 'a', 95, now)).toEqual({ kind: 'none' })
})

test('wait includes the current account', () => {
  const u = byUuid(
    use('a', ['five_hour', 99, now + H]),
    use('b', ['seven_day', 100, now + 48 * H]),
    use('c', ['seven_day', 100, now + 72 * H]),
  )
  expect(pickTarget([acct('a'), acct('b'), acct('c')], u, 'a', 95, now))
    .toEqual({ kind: 'wait', label: 'a', resumeAt: now + H })
})

test('wait skips excluded and needsSignIn accounts', () => {
  const u = byUuid(
    use('b', ['five_hour', 99, now + H]),
    use('c', ['five_hour', 99, now + 2 * H]),
    use('d', ['five_hour', 99, now + 3 * H]),
  )
  expect(pickTarget([acct('a'), acct('b', { excluded: true }), acct('c', { needsSignIn: true }), acct('d')], u, 'a', 95, now))
    .toEqual({ kind: 'wait', label: 'd', resumeAt: now + 3 * H })
})

test('wait ignores an account with no reset time', () => {
  const u = byUuid(use('b', ['five_hour', 99]), use('c', ['five_hour', 99, now + 4 * H]))
  expect(pickTarget([acct('a'), acct('b'), acct('c')], u, 'a', 95, now))
    .toEqual({ kind: 'wait', label: 'c', resumeAt: now + 4 * H })
})

test('wait skips an account with a blocking window lacking a reset', () => {
  const u = byUuid(
    use('b', ['five_hour', 99, now + H], ['seven_day', 100]),
    use('c', ['five_hour', 99, now + 4 * H]),
  )
  expect(pickTarget([acct('a'), acct('b'), acct('c')], u, 'a', 95, now))
    .toEqual({ kind: 'wait', label: 'c', resumeAt: now + 4 * H })
})
