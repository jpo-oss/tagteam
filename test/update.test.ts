import { expect, test } from 'claude-code/testing'
import { memoryIo } from './support/memory'
import { routeTo } from './support/route'
import { checkForUpdate, isNewer } from '../src/update'

const setup = async (installed = '0.1.0', reply: { ok: boolean; text: string } | Error = { ok: true, text: '{"tag_name":"v0.2.0"}' }) => {
  const io = memoryIo({ HOME: '/h', TAGTEAM_HOME: '/t' })
  await io.write('/p/.claude-plugin/plugin.json', JSON.stringify({ version: installed }))
  const toasts: string[] = []
  let requests = 0
  const deps = {
    io,
    pluginRoot: '/p',
    fetch: async () => {
      requests++
      if (reply instanceof Error) throw reply
      return reply
    },
    toast: (t: string) => void toasts.push(t),
  }
  return { io, deps, toasts, requests: () => requests }
}

test('isNewer compares major.minor.patch and ignores a v prefix', () => {
  expect(isNewer('0.1.1', '0.1.0')).toBe(true)
  expect(isNewer('0.2.0', '0.1.1')).toBe(true)
  expect(isNewer('1.0.0', '0.2.0')).toBe(true)
  expect(isNewer('v0.1.1', '0.1.0')).toBe(true)
  expect(isNewer('0.1.0', '0.1.1')).toBe(false)
  expect(isNewer('0.10.0', '0.9.0')).toBe(true)
  expect(isNewer('0.1.0', 'v0.1.0')).toBe(false)
  expect(isNewer('nope', '0.1.0')).toBe(false)
})

test('a newer release is announced once', async () => {
  const { io, deps, toasts } = await setup()
  await checkForUpdate(deps)
  expect(toasts).toEqual([
    'tagteam 0.2.0 is out. Turn on auto-update in /plugin > Marketplaces > tagteam, or run: claude plugin update tagteam@tagteam',
  ])
  const saved = JSON.parse((await io.read('/t/state/update-check.json')) ?? '{}')
  expect(saved.announced).toBe('0.2.0')
  await io.write('/t/state/update-check.json', JSON.stringify({ checkedAt: 0, announced: '0.2.0' }))
  await checkForUpdate(deps)
  expect(toasts.length).toBe(1)
})

test('the same or an older release stays quiet', async () => {
  for (const tag of ['v0.1.0', 'v0.0.9']) {
    const { deps, toasts } = await setup('0.1.0', { ok: true, text: JSON.stringify({ tag_name: tag }) })
    await checkForUpdate(deps)
    expect(toasts).toEqual([])
  }
})

test('a second session within 24 hours makes no request', async () => {
  const { deps, requests } = await setup()
  await checkForUpdate(deps)
  await checkForUpdate(deps)
  expect(requests()).toBe(1)
})

test('a failed lookup rejects, stays quiet and is not retried within the day', async () => {
  for (const reply of [new Error('offline'), { ok: false, text: '' }, { ok: true, text: 'not json' }]) {
    const { deps, toasts, requests } = await setup('0.1.0', reply)
    await expect(checkForUpdate(deps)).rejects.toBeDefined()
    await checkForUpdate(deps)
    expect(toasts).toEqual([])
    expect(requests()).toBe(1)
  }
})

test('session.start logs a failed lookup and still finishes', async ($, on) => {
  const io = memoryIo({ HOME: '/h', TAGTEAM_HOME: '/t' })
  routeTo(on, io, false)
  const logs: string[] = []
  on('ui.log', (_, e) => (logs.push(JSON.stringify(e)), { value: undefined }))
  on('http.fetch', () => Promise.reject(new Error('offline')))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await io.sleep(50)
  expect(logs.join('\n')).toContain('update check failed')
})
