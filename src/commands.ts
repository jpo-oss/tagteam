import type { Io } from './io'
import { login, logout, prepareFolder, validLabel } from './folders'
import { listAccounts, readActive, readJson, removeAccountRecord, saveAccount, stateRoot, writeActive } from './store'
import type { Account } from './types'

export type Deps = {
  login(io: Io, dir: string): Promise<void>
  logout(io: Io, dir: string): Promise<boolean>
  confirm(question: string): Promise<boolean>
}

export const realDeps = (confirm: Deps['confirm']): Deps => ({ login, logout, confirm })

export const USAGE = 'Usage: /tagteam add <label> | edit <label> [name=] [order=] [exclude=true|false] | remove <label> | switch | status | install'
const NOT_YET = 'Not available yet.'
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

export const assertUnderRoot = async (io: Io, dir: string): Promise<void> => {
  const root = (await stateRoot(io)).replace(/\/+$/, '')
  const bad =
    !dir.startsWith(`${root}/`) ||
    dir === `${root}/` ||
    dir.split('/').includes('..') ||
    dir === `${root}/state` ||
    dir.startsWith(`${root}/state/`)
  if (bad) throw new Error(`Refusing to touch ${dir}: not an account folder inside ${root}`)
}

const rmUnderRoot = async (io: Io, dir: string): Promise<void> => {
  await assertUnderRoot(io, dir)
  const r = await io.run(['rm', '-rf', dir])
  if (r.exitCode !== 0) throw new Error(`Could not delete ${dir}: ${r.stderr.trim()}`)
}

const LABEL_MSG = 'Labels are lowercase letters, digits and dashes, up to 32 characters.'
const labelProblem = (l: string): string | undefined =>
  !validLabel(l) ? LABEL_MSG : l === 'state' ? '"state" is reserved.' : undefined

const identity = async (io: Io, dir: string): Promise<{ uuid?: string; email: string }> => {
  const j = await readJson<{ oauthAccount?: { accountUuid?: string; emailAddress?: string } }>(io, `${dir}/.claude.json`, {})
  return { uuid: j.oauthAccount?.accountUuid || undefined, email: j.oauthAccount?.emailAddress ?? '' }
}

async function add(io: Io, label: string, deps: Deps): Promise<string> {
  const root = await stateRoot(io)
  const dir = `${root}/${label}`
  if ((await listAccounts(io)).some((a) => a.label === label) || (await io.exists(dir))) return `${label} already exists.`
  let saved = false
  try {
    await prepareFolder(io, dir)
    await deps.login(io, dir)
    const { uuid, email } = await identity(io, dir)
    if (!uuid) throw new Error('Login finished but no account was found in the new folder')
    const accounts = await listAccounts(io)
    const dup = accounts.find((a) => a.accountUuid === uuid)
    if (dup) {
      await cleanup(io, dir, label, saved, deps)
      return `That login is already the account "${dup.label}". Nothing added.`
    }
    const account: Account = { label, dir, accountUuid: uuid, email, order: accounts.length, excluded: false, needsSignIn: false }
    await saveAccount(io, account)
    saved = true
    if (!(await readActive(io))) await writeActive(io, account)
    return `Added ${label} (${email}). The browser signs in whichever claude.ai account it already has open, so check it matches.`
  } catch (err) {
    await cleanup(io, dir, label, saved, deps)
    return `Could not add ${label}: ${err instanceof Error ? err.message : String(err)}`
  }
}

const cleanup = async (io: Io, dir: string, label: string, saved: boolean, deps: Deps): Promise<void> => {
  await deps.logout(io, dir).catch(() => undefined)
  await rmUnderRoot(io, dir).catch(() => undefined)
  if (saved) await removeAccountRecord(io, label).catch(() => undefined)
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
    await assertUnderRoot(io, a.dir)
    next.label = name
    next.dir = `${root}/${name}`
  }
  await saveAccount(io, next)
  if (!rename) return `Updated ${label}.`
  const r = await io.run(['mv', a.dir, next.dir])
  if (r.exitCode !== 0) {
    await removeAccountRecord(io, next.label)
    throw new Error(`Could not rename: ${r.stderr.trim()}`)
  }
  await removeAccountRecord(io, label)
  if ((await readActive(io)) === label) await writeActive(io, next)
  return `Updated ${next.label}.`
}

async function remove(io: Io, label: string, deps: Deps): Promise<string> {
  const a = (await listAccounts(io)).find((x) => x.label === label)
  if (!a) return `No account named ${label}.`
  if ((await readActive(io)) === label) return `${label} is the active account. Switch to another first.`
  await assertUnderRoot(io, a.dir)
  if (!(await deps.confirm(`Remove ${label} (${a.email}) and sign it out?`))) return 'Cancelled.'
  const signedOut = await deps.logout(io, a.dir)
  await rmUnderRoot(io, a.dir)
  await removeAccountRecord(io, label)
  return signedOut ? `Removed ${label}.` : `Removed ${label}, but sign-out failed. Sign out of that login at claude.ai if needed.`
}

export async function runCommand(io: Io, args: string, deps: Deps): Promise<string> {
  const { sub, label, opts } = parseArgs(args)
  if (sub === 'switch' || sub === 'status' || sub === 'install') return NOT_YET
  if (sub !== 'add' && sub !== 'edit' && sub !== 'remove') return USAGE
  if (!label) return USAGE
  const problem = sub === 'add' || sub === 'edit' ? labelProblem(label) : validLabel(label) ? undefined : LABEL_MSG
  if (problem) return problem
  try {
    await io.run(['true'])
  } catch {
    return TERMINAL
  }
  if (sub === 'add') return add(io, label, deps)
  if (sub === 'edit') return edit(io, label, opts)
  return remove(io, label, deps)
}
