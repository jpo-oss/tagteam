import type { Io, RunResult } from '../../src/io'

declare const setTimeout: (fn: () => void, ms: number) => unknown

// In-memory stand-in for the engine: `claude plugin test` gives a test no disk,
// no process and no Node/Bun globals. Emulates only what store.ts runs.
export const memoryIo = (env: Record<string, string> = {}, livePids: readonly string[] = []): Io => {
  const files = new Map<string, { text: string; mtime: number; link?: string }>()
  const dirs = new Map<string, number>()
  const parent = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/'
  const mkdirs = (p: string) => {
    for (let d = p; d !== '/' && d !== '' && !dirs.has(d); d = parent(d)) dirs.set(d, Date.now())
  }
  const has = (p: string) => files.has(p) || dirs.has(p)
  const under = (p: string) => (k: string) => k === p || k.startsWith(p + '/')
  const ok = (stdout = ''): RunResult => ({ exitCode: 0, stdout, stderr: '' })
  const fail = (stderr: string): RunResult => ({ exitCode: 1, stdout: '', stderr })

  const run = async (argv: string[]): Promise<RunResult> => {
    const [cmd, ...rest] = argv
    const args = rest.filter((a) => !a.startsWith('-'))
    const flags = rest.filter((a) => a.startsWith('-')).join('')
    if (cmd === 'mkdir') {
      const p = args[0]!
      if (flags.includes('p')) {
        if (files.has(p)) return fail(`mkdir: ${p}: File exists`)
        return mkdirs(p), ok()
      }
      if (has(p)) return fail(`mkdir: ${p}: File exists`)
      if (!dirs.has(parent(p))) return fail(`mkdir: ${p}: No such file or directory`)
      dirs.set(p, Date.now())
      return ok()
    }
    if (cmd === 'mv') {
      const [from, to] = args as [string, string]
      if (!has(from)) return fail(`mv: ${from}: No such file or directory`)
      const re = (k: string) => to + k.slice(from.length)
      for (const [k, v] of [...files].filter(([k]) => under(from)(k))) (files.delete(k), files.set(re(k), v))
      for (const [k, v] of [...dirs].filter(([k]) => under(from)(k))) (dirs.delete(k), dirs.set(re(k), v))
      return ok()
    }
    if (cmd === 'rm') {
      for (const p of args) {
        if (!flags.includes('f') && !has(p)) return fail(`rm: ${p}: No such file or directory`)
        if (!flags.includes('r') && dirs.has(p)) return fail(`rm: ${p}: is a directory`)
        for (const k of [...files.keys()].filter(under(p))) files.delete(k)
        for (const k of [...dirs.keys()].filter(under(p))) dirs.delete(k)
      }
      return ok()
    }
    if (cmd === 'true' || cmd === 'chmod') return ok()
    if (cmd === 'kill') return livePids.includes(args[0] ?? '') ? ok() : fail('kill: No such process')
    if (cmd === 'ln') {
      const [target, dest] = args as [string, string]
      if (dirs.has(dest) && !files.has(dest)) return fail(`ln: ${dest}: is a directory`)
      mkdirs(parent(dest))
      files.set(dest, { text: '', mtime: Date.now(), link: target })
      return ok()
    }
    if (cmd === 'touch') {
      const p = args[1] ?? args[0]!
      if (dirs.has(p)) dirs.set(p, Date.parse('2000-01-01'))
      else if (files.has(p)) files.get(p)!.mtime = Date.parse('2000-01-01')
      return ok()
    }
    return fail(`memoryIo: unsupported command ${cmd}`)
  }

  return {
    read: async (p) => files.get(p)?.text,
    write: async (p, text) => {
      mkdirs(parent(p))
      files.set(p, { text, mtime: Date.now() })
    },
    exists: async (p) => has(p),
    list: async (p) =>
      [...new Set([...files.keys(), ...dirs.keys()].filter((k) => parent(k) === p && k !== p).map((k) => k.slice(p.length + 1)))],
    mtimeMs: async (p) => files.get(p)?.mtime ?? dirs.get(p),
    run,
    env: async (n) => env[n],
    now: async () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  }
}
