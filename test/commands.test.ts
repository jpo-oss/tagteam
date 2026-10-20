import { expect, test } from 'claude-code/testing'
import { memoryIo } from './support/memory'
import { routeTo } from './support/route'
import { adoptFolders, assertUnderRoot, parseArgs, refreshLauncher, runCommand, type Deps } from '../src/commands'
import { linkShared, validLabel } from '../src/folders'
import { listAccounts, readActive, saveAccount, saveUsage, writeActive } from '../src/store'
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
  ({ label, dir: `/t/${label}`, accountUuid: uuid, email: `${label}@example.com`, order, excluded: false, needsSignIn: false })
const stubLogin = (uuid: string): Deps['login'] => async (io, dir) =>
  io.write(`${dir}/.claude.json`, JSON.stringify({ oauthAccount: { accountUuid: uuid, emailAddress: 'a@example.com' } }))
const deps = (over: Partial<Deps> = {}): Deps => ({
  login: stubLogin('u-new'), logout: async () => true, confirm: async () => true, switchTo: async () => '', pluginRoot: '/p', openPane: async () => 'pane', refreshLater: () => undefined, ...over,
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
  expect(text).toContain('a@example.com')
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

test('remove refuses an account a live tagteam session is using, and ignores a dead one', async () => {
  const io = await setup()
  await runCommand(io, 'add work', deps())
  await io.write('/t/state/run-1-2', 'dir=/t/work\npid=111\n')
  await io.write('/t/state/run-3-4', 'dir=/t/work\npid=222\n')
  const run = io.run
  let alive = '111'
  io.run = async (argv, opts) => (argv[0] === 'kill' ? { exitCode: argv[2] === alive ? 0 : 1, stdout: '', stderr: '' } : run(argv, opts))
  const text = await runCommand(io, 'remove work', deps())
  expect(text).toContain('in use by a running tagteam session')
  expect(await io.exists('/t/work')).toBe(true)
  alive = ''
  expect(await runCommand(io, 'remove work', deps())).toContain('Removed work.')
})

test('removing the launcher default moves it to the next account by order, or clears it', async () => {
  const io = await setup()
  await runCommand(io, 'add work', deps())
  await runCommand(io, 'add home', deps({ login: stubLogin('u-home') }))
  expect(await runCommand(io, 'delete work', deps())).toBe('Removed work.')
  expect(await readActive(io)).toBe('home')
  expect(await io.read('/t/state/active-dir')).toBe('/t/home\n')
  expect(await runCommand(io, 'remove home', deps())).toBe('Removed home.')
  expect(await readActive(io)).toBeUndefined()
  expect(await io.exists('/t/state/active-dir')).toBe(false)
})

test('remove deletes folder and record after confirmation, and cancel keeps them', async () => {
  const io = await setup()
  await saveAccount(io, acct('main', 'u1'))
  await writeActive(io, acct('main', 'u1'))
  await runCommand(io, 'add work', deps())
  const out: string[] = []
  const logout = async (_: unknown, dir: string) => (out.push(dir), true)
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

test('edit renames the label and record without moving the folder, moves the active pointer, sets order and exclude', async () => {
  const base = await setup()
  await runCommand(base, 'add work', deps())
  const moves: string[][] = []
  const io = { ...base, run: async (argv: string[], o?: never) => (argv[0] === 'mv' && moves.push(argv), base.run(argv, o)) }
  const text = await runCommand(io, 'edit work name=job order=3 exclude=true', deps())
  expect(text).toContain('job')
  const [a] = await listAccounts(io)
  expect(a).toMatchObject({ label: 'job', dir: '/t/work', order: 3, excluded: true })
  expect(moves.filter((m) => !m[1]?.includes('.tmp-'))).toEqual([])
  expect(await io.exists('/t/work/.claude.json')).toBe(true)
  expect(await io.exists('/t/job')).toBe(false)
  expect(await io.exists('/t/state/accounts/work.json')).toBe(false)
  expect(await readActive(io)).toBe('job')
  expect((await io.read('/t/state/active-dir'))?.trim()).toBe('/t/work')
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
  expect(await runCommand(io, 'status', deps())).toBe('pane')
  expect(await runCommand(io, '', deps())).toBe('pane')
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
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', (_, e) => ((name = e.name), { value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(name).toBe('tagteam')
  const r = await $.command.run({ command: 'tagteam', args: 'status' } as never)
  expect(r.text).toContain('pane opened')
})

test('an edit redraws the status line from the last reading', async ($, on) => {
  const io = await setup()
  await saveAccount(io, acct('main', 'home'))
  await saveUsage(io, {
    accountUuid: 'home', tokensByDay: {}, earlyResets: [],
    windows: { five_hour: { kind: 'five_hour', percentUsed: 42, resetsAt: new Date(Date.now() + 3600_000).toISOString(), readAt: 1 } },
  })
  routeTo(on, io)
  const status: string[] = []
  on('ui.status', (_, e) => (status.push(String(e.text)), { value: undefined }))
  const r = await $.command.run({ command: 'tagteam', args: 'edit main order=2' } as never)
  expect(r.text).toBe('Updated main.')
  expect(status).toEqual(['main, 5h 42%'])
})

const spy = (io: Awaited<ReturnType<typeof setup>>) => {
  const calls: string[] = []
  const run = io.run
  return { calls, io: { ...io, run: async (argv: string[], o?: never) => (calls.push(argv[0]!), run(argv, o)) } }
}

test('state is a reserved label for add and rename', async () => {
  const io = await setup()
  expect(await runCommand(io, 'add state', deps())).toContain('reserved')
  await saveAccount(io, acct('a', 'u1'))
  expect(await runCommand(io, 'edit a name=state', deps())).toContain('reserved')
  expect(await io.exists('/t/a')).toBe(false)
})

test('assertUnderRoot rejects ../, root, state and outside paths; accepts a trailing-slash root', async () => {
  const io = memoryIo({ HOME: '/h', TAGTEAM_HOME: '/t/' })
  await expect(assertUnderRoot(io, '/t/a/../../etc')).rejects.toThrow()
  await expect(assertUnderRoot(io, '/t')).rejects.toThrow()
  await expect(assertUnderRoot(io, '/t/')).rejects.toThrow()
  await expect(assertUnderRoot(io, '/t/state')).rejects.toThrow()
  await expect(assertUnderRoot(io, '/t/state/accounts')).rejects.toThrow()
  await expect(assertUnderRoot(io, '/other/a')).rejects.toThrow()
  for (const bad of ['/t//', '/t//state', '/t/a/b', '/t/../x', '/t/Bad']) await expect(assertUnderRoot(io, bad)).rejects.toThrow()
  await expect(assertUnderRoot(io, '/t/a')).resolves.toBeUndefined()
})

test('remove refuses a dir outside the root without rm or logout, and rename leaves it alone', async () => {
  const base = await setup()
  await saveAccount(base, { ...acct('x', 'u9'), dir: '/h/important' })
  await saveAccount(base, acct('main', 'u1', 1))
  await writeActive(base, acct('main', 'u1'))
  const { io, calls } = spy(base)
  let loggedOut = false
  const d = deps({ logout: async () => ((loggedOut = true), true) })
  expect(await runCommand(io, 'edit x name=y', d)).toBe('Updated y.')
  expect((await listAccounts(io)).find((a) => a.label === 'y')?.dir).toBe('/h/important')
  calls.length = 0
  await expect(runCommand(io, 'remove y', d)).rejects.toThrow()
  expect(calls.filter((c) => c === 'mv' || c === 'rm')).toEqual([])
  expect(loggedOut).toBe(false)
})

test('remove warns when logout fails and throws, keeping the record, when rm fails', async () => {
  const io = await setup()
  await saveAccount(io, acct('main', 'u1'))
  await writeActive(io, acct('main', 'u1'))
  await runCommand(io, 'add work', deps())
  await runCommand(io, 'add job', deps({ login: stubLogin('u3') }))
  expect(await runCommand(io, 'remove work', deps({ logout: async () => false }))).toContain('sign-out failed')
  expect(await io.exists('/t/work')).toBe(false)
  const failRm = { ...io, run: async (argv: string[], o?: never) => (argv[0] === 'rm' && argv[1] === '-rf' ? { exitCode: 1, stdout: '', stderr: 'denied' } : io.run(argv, o)) }
  await expect(runCommand(failRm, 'remove job', deps())).rejects.toThrow('denied')
  expect((await listAccounts(io)).map((a) => a.label)).toContain('job')
})

test('add logs the new folder out on the duplicate path', async () => {
  const io = await setup()
  await saveAccount(io, acct('main', 'u-new'))
  const out: string[] = []
  await runCommand(io, 'add work', deps({ logout: async (_, d) => (out.push(d), true) }))
  expect(out).toEqual(['/t/work'])
})

test('add removes the saved record when a later step fails', async () => {
  const io = await setup()
  const bad = { ...io, run: async (argv: string[], o?: never) => (argv[0] === 'mv' && argv[2]?.endsWith('/state/active') ? { exitCode: 1, stdout: '', stderr: 'disk' } : io.run(argv, o)) }
  expect(await runCommand(bad, 'add work', deps())).toContain('disk')
  expect(await listAccounts(io)).toEqual([])
  expect(await io.exists('/t/work')).toBe(false)
})

test('edit with an unknown key changes nothing', async () => {
  const io = await setup()
  await saveAccount(io, acct('a', 'u1'))
  const text = await runCommand(io, 'edit a nmae=b order=5', deps())
  expect(text).toContain('name, order, exclude')
  expect((await listAccounts(io))[0]?.order).toBe(0)
})

const withPath = async (path: string) => {
  const io = memoryIo({ HOME: '/h', TAGTEAM_HOME: '/t', PATH: path })
  await io.write('/p/bin/tagteam', '#!/bin/sh\nv1\n')
  return spy(io as never)
}

test('install copies the launcher to ~/.local/bin as 755 and warns when it is not on PATH', async () => {
  const { io: base } = await withPath('/usr/bin')
  const argvs: string[][] = []
  const io = { ...base, run: async (a: string[], o?: never) => (argvs.push(a), base.run(a, o)) }
  const text = await runCommand(io, 'install', deps())
  expect(await io.read('/h/.local/bin/tagteam')).toBe('#!/bin/sh\nv1\n')
  const chmod = argvs.find((a) => a[0] === 'chmod')
  expect(chmod?.[1]).toBe('755')
  expect(argvs.find((a) => a[0] === 'mv')).toEqual(['mv', chmod?.[2], '/h/.local/bin/tagteam'])
  expect(text).toContain('/h/.local/bin')
  expect(text).toContain('PATH')
  expect((await io.list('/h/.local/bin')).filter((n) => n.includes('.tmp-'))).toEqual([])
})

test('install on PATH does not warn, and a second install says it is current', async () => {
  const { io } = await withPath('/usr/bin:/h/.local/bin/')
  expect(await runCommand(io, 'install', deps())).not.toContain('PATH')
  expect(await runCommand(io, 'install', deps())).toContain('up to date')
})

test('install needs the terminal', async () => {
  const { io } = await withPath('/usr/bin')
  expect(await runCommand({ ...io, run: async () => { throw new Error('CLI only') } }, 'install', deps())).toBe('Run this from the terminal.')
})

const OLD_LAUNCHER = '#!/bin/sh\n# Runs claude on the active tagteam account and, when\nold\n'

test('refreshLauncher only updates an installed launcher that differs', async () => {
  const { io } = await withPath('/usr/bin')
  await refreshLauncher(io, '/p')
  expect(await io.exists('/h/.local/bin/tagteam')).toBe(false)
  await io.write('/h/.local/bin/tagteam', OLD_LAUNCHER)
  await refreshLauncher(io, '/p')
  expect(await io.read('/h/.local/bin/tagteam')).toBe('#!/bin/sh\nv1\n')
})

test('refreshLauncher leaves a different program called tagteam alone', async () => {
  const { io } = await withPath('/usr/bin')
  await io.write('/h/.local/bin/tagteam', '#!/bin/sh\necho someone else\n')
  await refreshLauncher(io, '/p')
  expect(await io.read('/h/.local/bin/tagteam')).toBe('#!/bin/sh\necho someone else\n')
})

test('session.start refreshes an installed launcher from the plugin folder', async ($, on) => {
  const base = await setup()
  const sources: string[] = []
  const isSource = (p: string) => p.endsWith('/bin/tagteam') && !p.startsWith('/h/')
  const io = {
    ...base,
    exists: async (p: string) => isSource(p) || base.exists(p),
    read: async (p: string) => (isSource(p) ? (sources.push(p), 'new') : base.read(p)),
  }
  routeTo(on, io)
  await io.write('/h/.local/bin/tagteam', OLD_LAUNCHER)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(sources.length).toBeGreaterThan(0)
  expect(sources.every((p) => p.length > '/bin/tagteam'.length)).toBe(true)
  expect(await io.read('/h/.local/bin/tagteam')).toBe('new')
})

const signedIn = (io: Awaited<ReturnType<typeof setup>>, dir: string, uuid: string, extra = {}) =>
  io.write(`${dir}/.claude.json`, JSON.stringify({ oauthAccount: { accountUuid: uuid, emailAddress: 'w@example.com' }, userID: 'id-1', ...extra }))

test('adoptFolders adds a folder signed in from the terminal once, after the last order', async () => {
  const io = await setup()
  await saveAccount(io, acct('main', 'u1', 5))
  await signedIn(io, '/t/work', 'u-w')
  expect(await adoptFolders(io, () => undefined)).toEqual(['Added work (w@example.com)'])
  expect((await listAccounts(io)).find((a) => a.label === 'work')).toMatchObject({ dir: '/t/work', accountUuid: 'u-w', order: 6 })
  expect((await io.list('/t/work')).sort()).toEqual(['.claude.json', 'projects', 'settings.json'])
  expect(await adoptFolders(io, () => undefined)).toEqual([])
})

test('adoptFolders makes the first account active', async () => {
  const io = await setup()
  await signedIn(io, '/t/work', 'u-w')
  await adoptFolders(io, () => undefined)
  expect(await readActive(io)).toBe('work')
})

test('adoptFolders seeds app state without touching login keys', async () => {
  const io = await setup()
  await signedIn(io, '/t/work', 'u-w', { numStartups: 3 })
  await adoptFolders(io, () => undefined)
  const j = JSON.parse((await io.read('/t/work/.claude.json')) ?? '{}')
  expect(j).toEqual({ oauthAccount: { accountUuid: 'u-w', emailAddress: 'w@example.com' }, userID: 'id-1', numStartups: 3, theme: 'dark' })
})

test('adoptFolders signs a duplicate login out, deletes its folder and says so once', async () => {
  const io = await setup()
  await saveAccount(io, acct('main', 'u-w'))
  await signedIn(io, '/t/work', 'u-w')
  const out: string[] = []
  const signOut = async (_: unknown, d: string) => (out.push(d), true)
  expect(await adoptFolders(io, () => undefined, signOut)).toEqual(['Removed work: same login as main'])
  expect(out).toEqual(['/t/work'])
  expect(await io.exists('/t/work')).toBe(false)
  expect((await listAccounts(io)).map((a) => a.label)).toEqual(['main'])
  expect(await adoptFolders(io, () => undefined, signOut)).toEqual([])
})

test('adoptFolders keeps going past a folder that fails and logs it', async () => {
  const base = await setup()
  await signedIn(base, '/t/aaa', 'u-a')
  await signedIn(base, '/t/bbb', 'u-b')
  const io = { ...base, run: async (argv: string[], o?: never) => (argv[0] === 'ln' && argv[3]?.startsWith('/t/aaa/') ? { exitCode: 1, stdout: '', stderr: 'denied' } : base.run(argv, o)) }
  const logs: string[] = []
  expect(await adoptFolders(io, (t) => logs.push(t))).toEqual(['Added bbb (w@example.com)'])
  expect(logs.length).toBe(1)
  expect(logs[0]).toContain('/t/aaa')
})

test('adoptFolders skips folders without a login, state, bad names and renamed accounts', async () => {
  const io = await setup()
  await io.write('/t/empty/x', '')
  await io.write('/t/half/.claude.json', '{"theme":"dark"}')
  await io.write('/t/broken/.claude.json', '{')
  await signedIn(io, '/t/Bad', 'u-b')
  await saveAccount(io, { ...acct('job', 'u-j'), dir: '/t/work' })
  await signedIn(io, '/t/work', 'u-j')
  expect(await adoptFolders(io, () => undefined)).toEqual([])
  expect((await listAccounts(io)).map((a) => a.label)).toEqual(['job'])
})

test('/tagteam add points remote users at the terminal command', async () => {
  const io = await setup()
  expect(await runCommand(io, 'add work', deps())).toContain('run tagteam add <label> in a terminal')
})

test('session.start toasts accounts it adopts', async ($, on) => {
  const io = await setup()
  await signedIn(io, '/t/work', 'u-w')
  routeTo(on, io)
  const toasts: string[] = []
  on('ui.toast', (_, e) => (toasts.push(String(e.text)), { value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(toasts).toEqual(['Added work (w@example.com)'])
})

test('add cancelled with Ctrl+C says nothing was added and cleans up', async () => {
  const io = await setup()
  const text = await runCommand(io, 'add work', deps({ login: async () => { throw new Error('$.process.run(claude) aborted') } }))
  expect(text.split('\n')[0]).toBe('Cancelled. Nothing added.')
  expect(await io.exists('/t/work')).toBe(false)
  expect(await listAccounts(io)).toEqual([])
})

test('add refreshes the new account in the background', async () => {
  const io = await setup()
  const later: string[][] = []
  await runCommand(io, 'add work', deps({ refreshLater: (a) => later.push(a.map((x) => x.label)) }))
  expect(later).toEqual([['work']])
})

test('refresh runs one short prompt per usable account and reports failures by label', async () => {
  const io = await setup()
  await saveAccount(io, acct('a', 'ua', 0))
  await saveAccount(io, { ...acct('b', 'ub', 1), excluded: true })
  await saveAccount(io, { ...acct('c', 'uc', 2), needsSignIn: true })
  await saveAccount(io, acct('d', 'ud', 3))
  await saveAccount(io, acct('e', 'ue', 4))
  const calls: [string[], Record<string, string> | undefined, number | undefined, string | undefined][] = []
  const run = io.run
  io.run = async (argv, opts) => {
    if (argv[0] !== 'claude') return run(argv, opts)
    calls.push([argv, opts?.env, opts?.timeoutMs, opts?.cwd])
    if (opts?.env?.CLAUDE_CONFIG_DIR === '/t/e') throw new Error('timed out')
    return { exitCode: opts?.env?.CLAUDE_CONFIG_DIR === '/t/d' ? 1 : 0, stdout: 'OK', stderr: '' }
  }
  let opened = 0
  const text = await runCommand(io, 'refresh', deps({ openPane: async () => (opened++, '') }))
  expect(text).toBe('Refreshed 1 of 5 accounts. Failed: d, e.')
  expect(calls.map((c) => c[1]?.CLAUDE_CONFIG_DIR)).toEqual(['/t/a', '/t/d', '/t/e'])
  expect(calls[0]).toEqual([['claude', '-p', '--model', 'haiku', 'Reply with OK.'], { CLAUDE_CONFIG_DIR: '/t/a', TAGTEAM_REFRESH: '1' }, 60000, '/t/state'])
  expect(opened).toBe(1)
})
