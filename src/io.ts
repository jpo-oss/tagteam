import type { EngineInterface } from 'claude-code'

export type RunResult = { exitCode: number; stdout: string; stderr: string }

export type Io = {
  read(path: string): Promise<string | undefined>
  write(path: string, text: string): Promise<void>
  exists(path: string): Promise<boolean>
  list(path: string): Promise<string[]>
  mtimeMs(path: string): Promise<number | undefined>
  run(argv: string[], opts?: { env?: Record<string, string>; timeoutMs?: number }): Promise<RunResult>
  env(name: EnvName): Promise<string | undefined>
  now(): Promise<number>
  sleep(ms: number): Promise<void>
}

// $.env.get needs a literal name, so ioFrom lists every variable the mod reads.
export type EnvName = 'HOME' | 'TAGTEAM_HOME' | 'CLAUDE_CONFIG_DIR' | 'TAGTEAM_RUN' | 'PATH'

type Dollar = Pick<EngineInterface, 'fs' | 'process' | 'env' | 'clock' | 'state'>

// Session state outlives a plugin reload; a module variable would not.
const RUN = { plugin: 'tagteam', key: 'run' } as const

// Keeps the launcher's run id and unsets it, so a claude started from this session's Bash tool doesn't claim it too.
export async function takeRun($: Pick<EngineInterface, 'env' | 'state'>): Promise<void> {
  const run = await $.env.get('TAGTEAM_RUN')
  if (!run) return
  await $.state.set(RUN, run)
  await $.env.set('TAGTEAM_RUN', undefined)
}

// A function declaration: the mod loader follows $ into one, not into an arrow.
export function ioFrom($: Dollar): Io {
  return {
    read: async (p) => ((await $.fs.exists(p)) ? $.fs.read(p) : undefined),
    write: (p, t) => $.fs.write(p, t),
    exists: (p) => $.fs.exists(p),
    list: async (p) => ((await $.fs.exists(p)) ? (await $.fs.list(p)).map((e) => e.name) : []),
    mtimeMs: async (p) => ((await $.fs.exists(p)) ? (await $.fs.stat(p)).mtimeMs : undefined),
    run: (argv, opts) => $.process.run(argv, opts),
    env: async (n) => {
      if (n === 'HOME') return $.env.get('HOME')
      if (n === 'TAGTEAM_HOME') return $.env.get('TAGTEAM_HOME')
      if (n === 'TAGTEAM_RUN') return (await $.state.get(RUN)).value ?? $.env.get('TAGTEAM_RUN')
      if (n === 'PATH') return $.env.get('PATH')
      return $.env.get('CLAUDE_CONFIG_DIR')
    },
    now: () => $.clock.now(),
    sleep: (ms) => $.clock.sleep(ms),
  }
}
