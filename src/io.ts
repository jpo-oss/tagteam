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

type Dollar = Pick<EngineInterface, 'fs' | 'process' | 'env' | 'clock'>

// Reads the launcher's run id and unsets it, so a claude started from this session's Bash tool doesn't claim it too.
export async function takeRun($: Pick<EngineInterface, 'env'>): Promise<string | undefined> {
  const run = await $.env.get('TAGTEAM_RUN')
  if (run) await $.env.set('TAGTEAM_RUN', undefined)
  return run
}

// A function declaration: the mod loader follows $ into one, not into an arrow.
// `run` is the id takeRun kept; until session.start has taken it, the variable is still set.
export function ioFrom($: Dollar, run?: string): Io {
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
      if (n === 'TAGTEAM_RUN') return run ?? $.env.get('TAGTEAM_RUN')
      if (n === 'PATH') return $.env.get('PATH')
      return $.env.get('CLAUDE_CONFIG_DIR')
    },
    now: () => $.clock.now(),
    sleep: (ms) => $.clock.sleep(ms),
  }
}
