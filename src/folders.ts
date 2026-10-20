import type { Io } from './io'
import { seedAppState } from './appstate'

const SKIP = new Set(['.credentials.json', '.claude.json', 'backups'])

export const validLabel = (s: string): boolean => /^[a-z0-9][a-z0-9-]{0,31}$/.test(s)

const mustRun = async (io: Io, argv: string[]): Promise<void> => {
  const r = await io.run(argv)
  if (r.exitCode !== 0) throw new Error(`${argv.join(' ')} failed (${r.exitCode}): ${r.stderr.trim()}`)
}

export const homeDir = async (io: Io): Promise<string> => {
  const home = await io.env('HOME')
  if (!home) throw new Error('HOME is not set')
  return home
}

export async function linkShared(io: Io, dir: string): Promise<void> {
  const src = `${await homeDir(io)}/.claude`
  for (const name of await io.list(src)) {
    if (SKIP.has(name) || name.endsWith('.lock')) continue
    await mustRun(io, ['ln', '-sfn', `${src}/${name}`, `${dir}/${name}`])
  }
}

export async function prepareFolder(io: Io, dir: string): Promise<void> {
  await mustRun(io, ['mkdir', '-p', dir])
  await linkShared(io, dir)
  const file = `${dir}/.claude.json`
  if (await io.exists(file)) return
  await io.write(file, JSON.stringify(seedAppState(await homeAppState(io)), null, 2) + '\n')
}

export async function homeAppState(io: Io): Promise<Record<string, unknown>> {
  const text = await io.read(`${await homeDir(io)}/.claude.json`)
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return {} // unreadable home state: start the account with an empty one
  }
}

export async function login(io: Io, dir: string): Promise<void> {
  const r = await io.run(['claude', 'auth', 'login'], { env: { CLAUDE_CONFIG_DIR: dir }, timeoutMs: 600000 })
  if (r.exitCode !== 0) throw new Error(`claude auth login failed (${r.exitCode}): ${r.stderr.trim()}`)
}

export async function logout(io: Io, dir: string): Promise<boolean> {
  try {
    return (await io.run(['claude', 'auth', 'logout'], { env: { CLAUDE_CONFIG_DIR: dir }, timeoutMs: 60000 })).exitCode === 0
  } catch {
    return false
  }
}
