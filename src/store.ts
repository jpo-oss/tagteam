import type { Io } from './io'
import type { Account, SwitchRequest, Usage } from './types'
import { emptyUsage } from './usage'

const ABANDONED_MS = 10 * 60_000

const mustRun = async (io: Io, argv: string[]): Promise<void> => {
  const r = await io.run(argv)
  if (r.exitCode !== 0) throw new Error(`${argv.join(' ')} failed (${r.exitCode}): ${r.stderr.trim()}`)
}

const dirOf = (p: string): string => p.slice(0, p.lastIndexOf('/')) || '/'
const oneLine = (s: string): string => s.replace(/[\r\n]+/g, ' ')

export const stateRoot = async (io: Io): Promise<string> => {
  const override = await io.env('TAGTEAM_HOME')
  if (override) return override
  const home = await io.env('HOME')
  if (!home) throw new Error('Cannot find the state folder: neither TAGTEAM_HOME nor HOME is set')
  return `${home}/.claude-accounts`
}

const stateDir = async (io: Io): Promise<string> => `${await stateRoot(io)}/state`

export const readJson = async <T>(io: Io, path: string, fallback: T): Promise<T> => {
  const text = await io.read(path)
  return text === undefined || text.trim() === '' ? fallback : (JSON.parse(text) as T)
}

const writeAtomic = async (io: Io, path: string, text: string): Promise<void> => {
  await mustRun(io, ['mkdir', '-p', dirOf(path)])
  const tmp = `${path}.tmp-${Math.random().toString(36).slice(2)}`
  await io.write(tmp, text)
  const r = await io.run(['mv', tmp, path])
  if (r.exitCode !== 0) {
    await io.run(['rm', '-f', tmp])
    throw new Error(`mv ${tmp} ${path} failed (${r.exitCode}): ${r.stderr.trim()}`)
  }
}

export const writeJsonAtomic = (io: Io, path: string, value: unknown): Promise<void> =>
  writeAtomic(io, path, JSON.stringify(value, null, 2) + '\n')

export const listAccounts = async (io: Io): Promise<Account[]> => {
  const dir = `${await stateDir(io)}/accounts`
  const names = (await io.list(dir)).filter((n) => n.endsWith('.json'))
  const all = await Promise.all(names.map((n) => readJson<Account | undefined>(io, `${dir}/${n}`, undefined)))
  return all.filter((a): a is Account => a !== undefined).sort((a, b) => a.order - b.order)
}

export const saveAccount = async (io: Io, a: Account): Promise<void> =>
  writeJsonAtomic(io, `${await stateDir(io)}/accounts/${a.label}.json`, a)

export const removeAccountRecord = async (io: Io, label: string): Promise<void> =>
  mustRun(io, ['rm', '-f', `${await stateDir(io)}/accounts/${label}.json`])

export const loadUsage = async (io: Io, uuid: string): Promise<Usage> =>
  readJson(io, `${await stateDir(io)}/usage/${uuid}.json`, emptyUsage(uuid))

export const saveUsage = async (io: Io, u: Usage): Promise<void> =>
  writeJsonAtomic(io, `${await stateDir(io)}/usage/${u.accountUuid}.json`, u)

// Changes whenever any session on this machine writes an account, a reading or the default.
export const stateStamp = async (io: Io): Promise<string> => {
  const dir = await stateDir(io)
  const parts = [`active:${await io.mtimeMs(`${dir}/active`)}`]
  for (const sub of ['accounts', 'usage']) {
    for (const n of await io.list(`${dir}/${sub}`)) parts.push(`${sub}/${n}:${await io.mtimeMs(`${dir}/${sub}/${n}`)}`)
  }
  return parts.join('|')
}

export const readActive = async (io: Io): Promise<string | undefined> => {
  const text = await io.read(`${await stateDir(io)}/active`)
  return text?.split('\n')[0]?.trim() || undefined
}

export const writeActive = async (io: Io, a: Account): Promise<void> => {
  const dir = await stateDir(io)
  await writeAtomic(io, `${dir}/active`, `${oneLine(a.label)}\n`)
  await writeAtomic(io, `${dir}/active-dir`, `${oneLine(a.dir)}\n`)
}

export const writeSwitchRequest = async (io: Io, r: SwitchRequest): Promise<void> => {
  const lines: [string, string][] = [
    ['session', r.session],
    ['target_label', r.targetLabel],
    ['target_dir', r.targetDir],
    ['resume_at', r.resumeAt === undefined ? '' : String(r.resumeAt)],
    ['reason', r.reason],
    ['handover', r.handover],
  ]
  const text = lines.map(([k, v]) => `${k}=${oneLine(v)}\n`).join('')
  await writeAtomic(io, `${await stateDir(io)}/switch-${r.run}`, text)
}

const snoozeKey = (uuid: string, kind: string): string => `${uuid}:${kind}`

export const snoozed = async (io: Io, uuid: string, kind: string, resetsAt: string): Promise<boolean> =>
  (await readJson<Record<string, string>>(io, `${await stateDir(io)}/snoozes.json`, {}))[snoozeKey(uuid, kind)] === resetsAt

export const snooze = async (io: Io, uuid: string, kind: string, resetsAt: string): Promise<void> => {
  const path = `${await stateDir(io)}/snoozes.json`
  const all = await readJson<Record<string, string>>(io, path, {})
  all[snoozeKey(uuid, kind)] = resetsAt
  await writeJsonAtomic(io, path, all)
}

const episode = (resetsAt?: string): string => {
  const t = resetsAt ? Date.parse(resetsAt) : NaN
  return Number.isNaN(t) ? 'none' : String(Math.floor(t / 1000))
}

const decisionDir = async (io: Io, uuid: string, kind: string, resetsAt?: string): Promise<string> =>
  `${await stateDir(io)}/decision-${uuid}-${kind}-${episode(resetsAt)}`

const isAbandoned = async (io: Io, dir: string): Promise<boolean> => {
  if (await io.exists(`${dir}/answer`)) return false
  const m = await io.mtimeMs(dir)
  return m !== undefined && (await io.now()) - m > ABANDONED_MS
}

// Only the caller whose mv succeeds owns the removal.
const retire = async (io: Io, dir: string): Promise<boolean> => {
  const stale = `${dir}.stale-${Math.random().toString(36).slice(2)}`
  if ((await io.run(['mv', dir, stale])).exitCode !== 0) return false
  await mustRun(io, ['rm', '-rf', stale])
  return true
}

export const claimDecision = async (io: Io, uuid: string, kind: string, resetsAt?: string): Promise<boolean> => {
  const dir = await decisionDir(io, uuid, kind, resetsAt)
  await mustRun(io, ['mkdir', '-p', dirOf(dir)])
  const r = await io.run(['mkdir', dir])
  if (r.exitCode === 0) return true
  if (!(await io.exists(dir))) throw new Error(`mkdir ${dir} failed (${r.exitCode}): ${r.stderr.trim()}`)
  if (!(await isAbandoned(io, dir)) || !(await retire(io, dir))) return false
  return (await io.run(['mkdir', dir])).exitCode === 0
}

export const releaseDecision = async (
  io: Io, uuid: string, kind: string, resetsAt: string | undefined, answer: 'yes' | 'no',
): Promise<void> => writeAtomic(io, `${await decisionDir(io, uuid, kind, resetsAt)}/answer`, `${answer}\n`)

export const awaitDecision = async (io: Io, uuid: string, kind: string, resetsAt?: string): Promise<'yes' | 'no'> => {
  const dir = await decisionDir(io, uuid, kind, resetsAt)
  for (;;) {
    const answer = (await io.read(`${dir}/answer`))?.trim()
    if (answer === 'yes' || answer === 'no') return answer
    if (!(await io.exists(dir))) return 'no'
    if (await isAbandoned(io, dir)) {
      await retire(io, dir)
      return 'no'
    }
    await io.sleep(1000)
  }
}

export const pruneDecisions = async (io: Io, now: number): Promise<void> => {
  const dir = await stateDir(io)
  for (const name of await io.list(dir)) {
    if (!name.startsWith('decision-')) continue
    const last = name.slice(name.lastIndexOf('-') + 1)
    if (/^\d+$/.test(last) && Number(last) * 1000 <= now) await retire(io, `${dir}/${name}`)
  }
}

export const dropDecision = async (io: Io, uuid: string, kind: string, resetsAt?: string): Promise<void> => {
  await retire(io, await decisionDir(io, uuid, kind, resetsAt))
}

export type UpdateCheck = { checkedAt: number; announced?: string }

export const readUpdateCheck = async (io: Io): Promise<UpdateCheck> =>
  readJson<UpdateCheck>(io, `${await stateDir(io)}/update-check.json`, { checkedAt: 0 })

export const saveUpdateCheck = async (io: Io, c: UpdateCheck): Promise<void> =>
  writeJsonAtomic(io, `${await stateDir(io)}/update-check.json`, c)
