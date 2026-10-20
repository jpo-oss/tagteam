import { expect, test } from 'claude-code/testing'
import { memoryIo } from './support/memory'
import { routeTo } from './support/route'
import { parseArgs, runCommand, type Deps } from '../src/commands'
import { linkShared, validLabel } from '../src/folders'
import { listAccounts, readActive, saveAccount, writeActive } from '../src/store'
import type { Account } from '../src/types'

const setup = async () => {
  const io = memoryIo({ HOME: '/h', TAGTEAM_HOME: '/t' })
  await io.write('/h/.claude/settings.json', '{}')
  await io.write('/h/.claude/projects/p.txt', 'x')
  await io.write('/h/.claude/.credentials.json', 'SECRET')
  await io.write('/h/.claude/x.lock', '')
  await io.write('/h/.claude.json', JSON.stringify({ theme: 'dark', oauthAccount: { accountUuid: 'home' } }))
  return io
}
const acct = (label: string, uuid: string, order = 0): Account =>
  ({ label, dir: `/t/${label}`, accountUuid: uuid, email: `${label}@x.io`, order, excluded: false, needsSignIn: false })
const stubLogin = (uuid: string): Deps['login'] => async (io, dir) =>
  io.write(`${dir}/.claude.json`, JSON.stringify({ oauthAccount: { accountUuid: uuid, emailAddress: 'a@b.c' } }))
const deps = (over: Partial<Deps> = {}): Deps => ({
  login: stubLogin('u-new'), logout: async () => {}, confirm: async () => true, ...over,
})

test('parseArgs', () => {
  expect(parseArgs('edit work name=job order=2 exclude=true')).toEqual({
    sub: 'edit', label: 'work', opts: { name: 'job', order: '2', exclude: 'true' },
  })
  expect(parseArgs('  status ')).toEqual({ sub: 'status', label: undefined, opts: {} })
  expect(parseArgs('')).toEqual({ sub: '', label: undefined, opts: {} })
})

test('validLabel', () => {
  expect(validLabel('work-2')).toBe(true)
  expect(validLabel('Work')).toBe(false)
  expect(validLabel('-x')).toBe(false)
  expect(validLabel('a'.repeat(33))).toBe(false)
  expect(validLabel('a'.repeat(32))).toBe(true)
})

test('linkShared links settings and projects, not credentials, and is idempotent', async () => {
  const io = await setup()
  await linkShared(io, '/t/work')
  await linkShared(io, '/t/work')
  const names = await io.list('/t/work')
  expect(names.sort()).toEqual(['projects', 'settings.json'])
})

test('add saves the account, activates the first, and warns about the browser', async () => {
  const io = await setup()
  const text = await runCommand(io, 'add work', deps())
  expect(text).toContain('a@b.c')
  expect(text).toContain('browser')
  const [a] = await listAccounts(io)
  expect(a).toMatchObject({ label: 'work', accountUuid: 'u-new', order: 0, dir: '/t/work' })
  expect(await readActive(io)).toBe('work')
  const seed = JSON.parse((await io.read('/t/work/.claude.json')) ?? '{}')
  expect(seed.oauthAccount.accountUuid).toBe('u-new')
})

test('add of a login that already belongs to main names main and removes the folder', async () => {
  const io = await setup()
  await saveAccount(io, acct('main', 'u-new'))
  const text = await runCommand(io, 'add work', deps())
  expect(text).toContain('main')
  expect(await io.exists('/t/work')).toBe(false)
  expect((await listAccounts(io)).map((a) => a.label)).toEqual(['main'])
})

test('add cleans up when login fails', async () => {
  const io = await setup()
  const text = await runCommand(io, 'add work', deps({ login: async () => { throw new Error('nope') } }))
  expect(text).toContain('nope')
  expect(await io.exists('/t/work')).toBe(false)
})

test('remove refuses the active account', async () => {
  const io = await setup()
  await runCommand(io, 'add work', deps())
  const text = await runCommand(io, 'remove work', deps())
  expect(text).toContain('active')
  expect(await io.exists('/t/work')).toBe(true)
})

test('remove deletes folder and record after confirmation, and cancel keeps them', async () => {
  const io = await setup()
  await saveAccount(io, acct('main', 'u1'))
  await writeActive(io, acct('main', 'u1'))
  await runCommand(io, 'add work', deps())
  const out: string[] = []
  const logout = async (_: unknown, dir: string) => void out.push(dir)
  expect(await runCommand(io, 'remove work', deps({ confirm: async () => false, logout }))).toBe('Cancelled.')
  expect(await io.exists('/t/work')).toBe(true)
  await runCommand(io, 'remove work', deps({ logout }))
  expect(out).toEqual(['/t/work'])
  expect(await io.exists('/t/work')).toBe(false)
  expect((await listAccounts(io)).map((a) => a.label)).toEqual(['main'])
})

test('remove never deletes a folder outside the state root', async () => {
  const io = await setup()
  await saveAccount(io, { ...acct('x', 'u9'), dir: '/h/important' })
  await io.write('/h/important/f', '1')
  await expect(runCommand(io, 'remove x', deps())).rejects.toThrow()
  expect(await io.exists('/h/important/f')).toBe(true)
})

test('edit renames folder and record, moves the active pointer, sets order and exclude', async () => {
  const io = await setup()
  await runCommand(io, 'add work', deps())
  const text = await runCommand(io, 'edit work name=job order=3 exclude=true', deps())
  expect(text).toContain('job')
  const [a] = await listAccounts(io)
  expect(a).toMatchObject({ label: 'job', dir: '/t/job', order: 3, excluded: true })
  expect(await io.exists('/t/work')).toBe(false)
  expect(await io.exists('/t/job/.claude.json')).toBe(true)
  expect(await readActive(io)).toBe('job')
})

test('edit rejects bad values and clashing names', async () => {
  const io = await setup()
  await saveAccount(io, acct('a', 'u1'))
  await saveAccount(io, acct('b', 'u2', 1))
  expect(await runCommand(io, 'edit a name=b', deps())).toContain('exists')
  expect(await runCommand(io, 'edit a name=Bad', deps())).toContain('lowercase')
  expect(await runCommand(io, 'edit a exclude=maybe', deps())).toContain('true or false')
  expect(await runCommand(io, 'edit a order=x', deps())).toContain('whole number')
  expect(await runCommand(io, 'edit zz order=1', deps())).toContain('No account')
})

test('router: stubs, usage and bad labels', async () => {
  const io = await setup()
  expect(await runCommand(io, 'status', deps())).toContain('Not available')
  expect(await runCommand(io, 'bogus', deps())).toContain('Usage')
  expect(await runCommand(io, 'add', deps())).toContain('Usage')
  expect(await runCommand(io, 'add ../x', deps())).toContain('lowercase')
})

test('without a process the command asks for the terminal', async () => {
  const io = { ...(await setup()), run: async () => { throw new Error('process is CLI only') } }
  expect(await runCommand(io, 'add work', deps())).toBe('Run this from the terminal.')
})

test('/tagteam is registered and routed through the hook', async ($, on) => {
  const io = await setup()
  routeTo(on, io)
  let name = ''
  on('command.register', (_, e) => ((name = e.name), { value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(name).toBe('tagteam')
  const r = await $.command.run({ command: 'tagteam', args: 'status' } as never)
  expect(r.text).toContain('Not available')
})
