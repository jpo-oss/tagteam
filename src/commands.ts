import type { Io } from './io'
import { withSeed } from './appstate'
import { homeAppState, linkShared, login, logout, prepareFolder, validLabel } from './folders'
import { clearActive, folderInUse, listAccounts, readActive, readJson, removeAccountRecord, saveAccount, stateRoot, writeActive, writeJsonAtomic } from './store'
import type { Account } from './types'

export type Deps = {
  login(io: Io, dir: string): Promise<void>
  logout(io: Io, dir: string): Promise<boolean>
  confirm(question: string): Promise<boolean>
  switchTo(label: string): Promise<string>
  pluginRoot: string
  openPane(): Promise<string>
  refreshLater(accounts: Account[]): void
}

export const realDeps = (
  confirm: Deps['confirm'], switchTo: Deps['switchTo'], pluginRoot: string, openPane: Deps['openPane'], refreshLater: Deps['refreshLater'],
): Deps => ({ login, logout, confirm, switchTo, pluginRoot, openPane, refreshLater })

export const USAGE = 'Usage: /tagteam add <label> | edit <label> [name=] [order=] [exclude=true|false] | remove (or delete) <label> | switch <label> | status | refresh | install'

// A one-line run on each account: that session loads tagteam too and records its own usage reading.
// Runs from the state folder so no project hooks, instructions or MCP servers load.
export async function refreshAccounts(io: Io, accounts: readonly Account[]): Promise<string> {
  const cwd = `${await stateRoot(io)}/state`
  const failed: string[] = []
  let done = 0
  for (const a of accounts) {
    if (a.excluded || a.needsSignIn) continue
    try {
      const r = await io.run(['claude', '-p', '--model', 'haiku', 'Reply with OK.'], { cwd, env: { CLAUDE_CONFIG_DIR: a.dir, TAGTEAM_REFRESH: '1' }, stdin: '', timeoutMs: 60_000 })
      if (r.exitCode === 0) done++
      else failed.push(a.label)
    } catch {
      failed.push(a.label)
    }
  }
  return `Refreshed ${done} of ${accounts.length} accounts.${failed.length ? ` Failed: ${failed.join(', ')}.` : ''}`
}
const TERMINAL = 'Run this from the terminal.'

export function parseArgs(args: string): { sub: string; label?: string; opts: Record<string, string> } {
  const [sub = '', ...rest] = args.trim().split(/\s+/).filter(Boolean)
  const opts: Record<string, string> = {}
  let label: string | undefined
  for (const t of rest) {
    const i = t.indexOf('=')
    if (i > 0) opts[t.slice(0, i)] = t.slice(i + 1)
    else label ??= t
  }
  return { sub, label, opts }
}

const LABEL_MSG = 'Labels are lowercase letters, digits and dashes, up to 32 characters.'
const labelProblem = (l: string): string | undefined =>
  !validLabel(l) ? LABEL_MSG : l === 'state' ? '"state" is reserved.' : undefined

// Only ever one valid label right under the root, so a bad record can't point rm -rf anywhere else.
export const assertUnderRoot = async (io: Io, dir: string): Promise<void> => {
  const root = (await stateRoot(io)).replace(/\/+$/, '')
  const rest = dir.startsWith(`${root}/`) ? dir.slice(root.length + 1) : ''
  if (labelProblem(rest)) throw new Error(`Refusing to touch ${dir}: not an account folder inside ${root}`)
}

const rmUnderRoot = async (io: Io, dir: string): Promise<void> => {
  await assertUnderRoot(io, dir)
  const r = await io.run(['rm', '-rf', dir])
  if (r.exitCode !== 0) throw new Error(`Could not delete ${dir}: ${r.stderr.trim()}`)
}

const identity = async (io: Io, dir: string): Promise<{ uuid?: string; email: string }> => {
  const j = await readJson<{ oauthAccount?: { accountUuid?: string; emailAddress?: string } }>(io, `${dir}/.claude.json`, {})
  return { uuid: j.oauthAccount?.accountUuid || undefined, email: j.oauthAccount?.emailAddress ?? '' }
}

// Saves a signed-in folder as an account, unless another account already has that login.
const enroll = async (io: Io, label: string, dir: string, prepare: () => Promise<void>): Promise<{ account?: Account; dup?: Account }> => {
  const { uuid, email } = await identity(io, dir)
  if (!uuid) throw new Error('Login finished but no account was found in the new folder')
  const accounts = await listAccounts(io)
  const dup = accounts.find((a) => a.accountUuid === uuid)
  if (dup) return { dup }
  await prepare()
  const order = accounts.reduce((n, a) => Math.max(n, a.order + 1), 0)
  const account: Account = { label, dir, accountUuid: uuid, email, order, excluded: false, needsSignIn: false }
  await saveAccount(io, account)
  if (!(await readActive(io))) await writeActive(io, account)
  return { account }
}

const REMOTE = 'On a remote machine, run tagteam add <label> in a terminal instead.'

async function add(io: Io, label: string, deps: Deps): Promise<string> {
  const root = await stateRoot(io)
  const dir = `${root}/${label}`
  if ((await listAccounts(io)).some((a) => a.label === label) || (await io.exists(dir))) return `${label} already exists.`
  try {
    await prepareFolder(io, dir)
    await deps.login(io, dir)
    const { account, dup } = await enroll(io, label, dir, async () => undefined)
    if (dup) {
      await cleanup(io, dir, label, deps.logout)
      return `That login is already the account "${dup.label}". Nothing added.`
    }
    deps.refreshLater([account!])
    return `Added ${label} (${account!.email}). The browser signs in whichever claude.ai account it already has open, so check it matches.`
  } catch (err) {
    await cleanup(io, dir, label, deps.logout)
    // Ctrl+C during sign-in aborts the login process.
    if (err instanceof Error && /\baborted\b/.test(err.message)) return 'Cancelled. Nothing added.'
    return `Could not add ${label}: ${err instanceof Error ? err.message : String(err)}`
  }
}

const cleanup = async (io: Io, dir: string, label: string, signOut: Deps['logout']): Promise<void> => {
  await signOut(io, dir).catch(() => undefined)
  await rmUnderRoot(io, dir).catch(() => undefined)
  await removeAccountRecord(io, label).catch(() => undefined)
}

// Picks up folders that `tagteam add` signed in from a terminal, which leaves the record to the plugin.
export async function adoptFolders(io: Io, log: (text: string) => void, signOut: Deps['logout'] = logout): Promise<string[]> {
  const root = await stateRoot(io)
  const accounts = await listAccounts(io)
  const taken = new Set(accounts.flatMap((a) => [a.label, a.dir]))
  const notes: string[] = []
  for (const label of await io.list(root)) {
    const dir = `${root}/${label}`
    if (labelProblem(label) || taken.has(label) || taken.has(dir)) continue
    try {
      if (!(await identity(io, dir).catch(() => undefined))?.uuid) continue
      const { account, dup } = await enroll(io, label, dir, async () => {
        await linkShared(io, dir)
        const file = `${dir}/.claude.json`
        await writeJsonAtomic(io, file, withSeed(await readJson(io, file, {}), await homeAppState(io)))
      })
      if (dup) {
        await cleanup(io, dir, label, signOut)
        notes.push(`Removed ${label}: same login as ${dup.label}`)
      } else notes.push(`Added ${label} (${account!.email})`)
    } catch (err) {
      log(`tagteam: could not add ${dir}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return notes
}

const EDIT_KEYS = ['name', 'order', 'exclude']

async function edit(io: Io, label: string, opts: Record<string, string>): Promise<string> {
  const a = (await listAccounts(io)).find((x) => x.label === label)
  if (!a) return `No account named ${label}.`
  const unknown = Object.keys(opts).filter((k) => !EDIT_KEYS.includes(k))
  if (unknown.length) return `Unknown option ${unknown.join(', ')}. Valid options: ${EDIT_KEYS.join(', ')}.`
  const next = { ...a }
  if (opts.order !== undefined) {
    if (!/^\d+$/.test(opts.order)) return 'order must be a whole number.'
    next.order = Number(opts.order)
  }
  if (opts.exclude !== undefined) {
    if (opts.exclude !== 'true' && opts.exclude !== 'false') return 'exclude must be true or false.'
    next.excluded = opts.exclude === 'true'
  }
  const rename = opts.name !== undefined && opts.name !== label
  if (rename) {
    const name = opts.name!
    const problem = labelProblem(name)
    if (problem) return problem
    const root = await stateRoot(io)
    if ((await listAccounts(io)).some((x) => x.label === name) || (await io.exists(`${root}/${name}`))) return `${name} already exists.`
    // The folder stays put: on macOS the keychain login is keyed to its path, so moving it signs the account out.
    next.label = name
  }
  await saveAccount(io, next)
  if (!rename) return `Updated ${label}.`
  await removeAccountRecord(io, label)
  if ((await readActive(io)) === label) await writeActive(io, next)
  return `Updated ${next.label}.`
}

async function remove(io: Io, label: string, deps: Deps): Promise<string> {
  const a = (await listAccounts(io)).find((x) => x.label === label)
  if (!a) return `No account named ${label}.`
  if (await folderInUse(io, a.dir)) return `${label} is in use by a running tagteam session. Switch that session to another account first.`
  await assertUnderRoot(io, a.dir)
  if (!(await deps.confirm(`Remove ${label} (${a.email}) and sign it out?`))) return 'Cancelled.'
  const signedOut = await deps.logout(io, a.dir)
  await rmUnderRoot(io, a.dir)
  await removeAccountRecord(io, label)
  let text = signedOut ? `Removed ${label}.` : `Removed ${label}, but sign-out failed. Sign out of that login at claude.ai if needed.`
  if ((await readActive(io)) === label) {
    const next = (await listAccounts(io))[0]
    if (next) await writeActive(io, next)
    else await clearActive(io)
    text += next ? ` tagteam now starts on ${next.label}.` : ' No accounts left for tagteam to start on.'
  }
  return text
}

const launcherPath = async (io: Io): Promise<string> => {
  const home = await io.env('HOME')
  if (!home) throw new Error('HOME is not set')
  return `${home}/.local/bin/tagteam`
}

const copyLauncher = async (io: Io, pluginRoot: string, dest: string): Promise<'copied' | 'same'> => {
  const text = await io.read(`${pluginRoot}/bin/tagteam`)
  if (text === undefined) throw new Error(`No launcher found in ${pluginRoot}/bin`)
  if ((await io.read(dest)) === text) return 'same'
  const tmp = `${dest}.tmp-${Math.random().toString(36).slice(2)}`
  const must = async (argv: string[]) => {
    const r = await io.run(argv)
    if (r.exitCode !== 0) throw new Error(`${argv[0]} failed: ${r.stderr.trim()}`)
  }
  await must(['mkdir', '-p', dest.slice(0, dest.lastIndexOf('/'))])
  try {
    await io.write(tmp, text)
    await must(['chmod', '755', tmp])
    await must(['mv', tmp, dest])
  } catch (err) {
    await io.run(['rm', '-f', tmp])
    throw err
  }
  return 'copied'
}

async function install(io: Io, pluginRoot: string): Promise<string> {
  const dest = await launcherPath(io)
  const result = await copyLauncher(io, pluginRoot, dest)
  const bin = dest.slice(0, dest.lastIndexOf('/'))
  const onPath = ((await io.env('PATH')) ?? '').split(':').some((p) => p.replace(/\/+$/, '') === bin)
  const done = result === 'same' ? `${dest} is already up to date.` : `Installed ${dest}.`
  return onPath
    ? `${done} Start Claude with \`tagteam\` instead of \`claude\`.`
    : `${done} ${bin} is not on your PATH. Add it in your shell profile, then start Claude with \`tagteam\`.`
}

// bin/tagteam's own header line, so a different program called tagteam is never replaced.
const LAUNCHER_HEADER = '# Runs claude on the active tagteam account'

// Keeps an installed launcher in step with plugin updates; never installs one unasked.
export async function refreshLauncher(io: Io, pluginRoot: string): Promise<void> {
  const dest = await launcherPath(io)
  const head = ((await io.read(dest)) ?? '').split('\n', 5)
  if (head.some((l) => l.startsWith(LAUNCHER_HEADER))) await copyLauncher(io, pluginRoot, dest)
}

export async function runCommand(io: Io, args: string, deps: Deps): Promise<string> {
  const parsed = parseArgs(args)
  const { label, opts } = parsed
  const sub = parsed.sub === 'delete' ? 'remove' : parsed.sub
  if (sub === '' || sub === 'status') return deps.openPane()
  if (!['add', 'edit', 'remove', 'switch', 'install', 'refresh'].includes(sub)) return USAGE
  if (sub !== 'install' && sub !== 'refresh') {
    if (!label) return USAGE
    const problem = sub === 'add' || sub === 'edit' ? labelProblem(label) : validLabel(label) ? undefined : LABEL_MSG
    if (problem) return problem
  }
  try {
    await io.run(['true'])
  } catch {
    return TERMINAL
  }
  if (sub === 'install') return install(io, deps.pluginRoot)
  if (sub === 'refresh') {
    const text = await refreshAccounts(io, await listAccounts(io))
    await deps.openPane().catch(() => undefined)
    return text
  }
  if (!label) return USAGE
  if (sub === 'switch') return deps.switchTo(label)
  if (sub === 'add') return `${await add(io, label, deps)}\n${REMOTE}`
  if (sub === 'edit') return edit(io, label, opts)
  return remove(io, label, deps)
}
