import type { On } from 'claude-code'
import type { EnvName, Io } from '../../src/io'

// Answers the plugin's own fs/process/env/clock calls from an Io, since the
// test runtime has no disk or process beneath the plugin.
export const routeTo = (on: On, io: Io, silentLog = true): void => {
  on('fs.read', async (_, e) => ({ value: (await io.read(e.path)) ?? '' }))
  on('fs.write', async (_, e) => (await io.write(e.path, e.text), { value: undefined }))
  on('fs.exists', async (_, e) => ({ value: await io.exists(e.path) }))
  on('fs.list', async (_, e) => ({
    value: (await io.list(e.path)).map((name) => ({ name, kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('fs.stat', async (_, e) => ({
    value: { kind: 'file' as const, size: 0, mtimeMs: (await io.mtimeMs(e.path)) ?? 0, isLink: false },
  }))
  on('process.run', async (_, e) => ({
    value: { ...(await io.run([...e.argv], e.init)), isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('env.get', async (_, e) => ({ value: await io.env(e.name as EnvName) }))
  on('clock.now', async () => ({ value: await io.now() }))
  if (silentLog) on('ui.log', () => ({ value: undefined }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
}
