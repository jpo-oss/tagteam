export type RunResult = { exitCode: number; stdout: string; stderr: string }

export type Io = {
  read(path: string): Promise<string | undefined>
  write(path: string, text: string): Promise<void>
  exists(path: string): Promise<boolean>
  list(path: string): Promise<string[]>
  mtimeMs(path: string): Promise<number | undefined>
  run(argv: string[], opts?: { env?: Record<string, string>; timeoutMs?: number }): Promise<RunResult>
  env(name: string): Promise<string | undefined>
  now(): Promise<number>
  sleep(ms: number): Promise<void>
}

type Dollar = {
  fs: {
    read(p: string): Promise<string>
    write(p: string, t: string): Promise<void>
    exists(p: string): Promise<boolean>
    list(p: string): Promise<{ name: string }[]>
    stat(p: string): Promise<{ mtimeMs: number }>
  }
  process: { run(argv: string[], init?: { env?: Record<string, string>; timeoutMs?: number }): Promise<RunResult> }
  env: { get(name: string): Promise<string | undefined> }
  clock: { now(): Promise<number>; sleep(ms: number): Promise<void> }
}

export const ioFrom = ($: Dollar): Io => ({
  read: async (p) => ((await $.fs.exists(p)) ? $.fs.read(p) : undefined),
  write: (p, t) => $.fs.write(p, t),
  exists: (p) => $.fs.exists(p),
  list: async (p) => ((await $.fs.exists(p)) ? (await $.fs.list(p)).map((e) => e.name) : []),
  mtimeMs: async (p) => ((await $.fs.exists(p)) ? (await $.fs.stat(p)).mtimeMs : undefined),
  run: (argv, opts) => $.process.run(argv, opts),
  env: (n) => $.env.get(n),
  now: () => $.clock.now(),
  sleep: (ms) => $.clock.sleep(ms),
})
