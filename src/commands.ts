import type { Io } from './io'
import { login, logout, prepareFolder, validLabel } from './folders'
import { listAccounts, readActive, readJson, removeAccountRecord, saveAccount, stateRoot, writeActive } from './store'
import type { Account } from './types'

export type Deps = {
  login(io: Io, dir: string): Promise<void>
  logout(io: Io, dir: string): Promise<void>
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

const rmUnderRoot = async (io: Io, dir: string): Promise<void> => {
  const root = await stateRoot(io)
  if (!dir.startsWith(`${root}/`) || dir.includes('/../') || dir.endsWith('/..')) throw new Error(`Refusing to delete ${dir}: not inside ${root}`)
  await io.run(['rm', '-rf', dir])
}

const identity = async (io: Io, dir: string): Promise<{ uuid?: string; email: string }> => {
  const j = await readJson<{ oauthAccount?: { accountUuid?: string; emailAddress?: string } }>(io, `${dir}/.claude.json`, {})
  return { uuid: j.oauthAccount?.accountUuid || undefined, email: j.oauthAccount?.emailAddress ?? '' }
}

async function add(io: Io, label: string, deps: Deps): Promise<string> {
  const root = await stateRoot(io)
  const dir = `${root}/${label}`
  if ((await listAccounts(io)).some((a) => a.label === label) || (await io.exists(dir))) return `${label} already exists.`
  try {
    await prepareFolder(io, dir)
    await deps.login(io, dir)
    const { uuid, email } = await identity(io, dir)
    if (!uuid) throw new Error('Login finished but no account was found in the new folder')
    const accounts = await listAccounts(io)
    const dup = accounts.find((a) => a.accountUuid === uuid)
    if (dup) {
      await rmUnderRoot(io, dir)
      return `That login is already the account "${dup.label}". Nothing added.`
    }
    const account: Account = { label, dir, accountUuid: uuid, email, order: accounts.length, excluded: false, needsSignIn: false }
    await saveAccount(io, account)
    if (!(await readActive(io))) await writeActive(io, account)
    return `Added ${label} (${email}). The browser signs in whichever claude.ai account it already has open, so check it matches.`
  } catch (err) {
    await rmUnderRoot(io, dir).catch(() => undefined)
    return `Could not add ${label}: ${err instanceof Error ? err.message : String(err)}`
  }
}

async function edit(io: Io, label: string, opts: Record<string, string>): Promise<string> {
  const a = (await listAccounts(io)).find((x) => x.label === label)
  if (!a) return `No account named ${label}.`
  const next = { ...a }
  if (opts.order !== undefined) {
    if (!/^\d+$/.test(opts.order)) return 'order must be a whole number.'
    next.order = Number(opts.order)
  }
  if (opts.exclude !== undefined) {
    if (opts.exclude !== 'true' && opts.exclude !== 'false') return 'exclude must be true or false.'
    next.excluded = opts.exclude === 'true'
  }
  if (opts.name !== undefined && opts.name !== label) {
    const name = opts.name
    if (!validLabel(name)) return 'Names are lowercase letters, digits and dashes, up to 32 characters.'
    const root = await stateRoot(io)
    if ((await listAccounts(io)).some((x) => x.label === name) || (await io.exists(`${root}/${name}`))) return `${name} already exists.`
    const r = await io.run(['mv', a.dir, `${root}/${name}`])
    if (r.exitCode !== 0) return `Could not rename: ${r.stderr.trim()}`
    next.label = name
    next.dir = `${root}/${name}`
    await removeAccountRecord(io, label)
  }
  await saveAccount(io, next)
  if (next.label !== label && (await readActive(io)) === label) await writeActive(io, next)
  return `Updated ${next.label}.`
}

async function remove(io: Io, label: string, deps: Deps): Promise<string> {
  const a = (await listAccounts(io)).find((x) => x.label === label)
  if (!a) return `No account named ${label}.`
  if ((await readActive(io)) === label) return `${label} is the active account. Switch to another first.`
  if (!(await deps.confirm(`Remove ${label} (${a.email}) and sign it out?`))) return 'Cancelled.'
  await deps.logout(io, a.dir)
  await rmUnderRoot(io, a.dir)
  await removeAccountRecord(io, label)
  return `Removed ${label}.`
}

export async function runCommand(io: Io, args: string, deps: Deps): Promise<string> {
  const { sub, label, opts } = parseArgs(args)
  if (sub === 'switch' || sub === 'status' || sub === 'install') return NOT_YET
  if (sub !== 'add' && sub !== 'edit' && sub !== 'remove') return USAGE
  if (!label) return USAGE
  if (!validLabel(label)) return 'Labels are lowercase letters, digits and dashes, up to 32 characters.'
  try {
    await io.run(['true'])
  } catch {
    return TERMINAL
  }
  if (sub === 'add') return add(io, label, deps)
  if (sub === 'edit') return edit(io, label, opts)
  return remove(io, label, deps)
}
