import type { Io } from './io'
import { listAccounts, loadUsage, saveUsage } from './store'
import type { Account, Reading, Tokens } from './types'
import { addTokens, applyReadings, effectivePercent, windowName } from './usage'

export type Ui = { toast(text: string): void; status(text: string): void }

export const configFile = async (io: Io): Promise<string> => {
  const dir = await io.env('CLAUDE_CONFIG_DIR')
  return dir ? `${dir}/.claude.json` : `${(await io.env('HOME')) ?? ''}/.claude.json`
}

export const currentAccountUuid = async (io: Io): Promise<string | undefined> => {
  const text = await io.read(await configFile(io))
  if (!text) return undefined
  try {
    const uuid = JSON.parse(text)?.oauthAccount?.accountUuid
    return typeof uuid === 'string' && uuid ? uuid : undefined
  } catch {
    return undefined
  }
}

export const labelFor = (accounts: readonly Account[], uuid: string): string | undefined =>
  accounts.find((a) => a.accountUuid === uuid)?.label

export const localDay = (ms: number): string => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const when = (ms: number, now: number): string => {
  const d = new Date(ms)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return localDay(ms) === localDay(now) ? hm : `${localDay(ms)} ${hm}`
}

const showStatus = async (io: Io, ui: Pick<Ui, 'status'>, uuid: string, windows: Record<string, Reading>, now: number) => {
  const top = Object.values(windows)
    .map((w) => ({ kind: w.kind, pct: effectivePercent({ ...w, readAt: now }, now) }))
    .sort((a, b) => b.pct - a.pct)[0]
  if (!top) return
  const label = labelFor(await listAccounts(io), uuid) ?? 'unmanaged'
  ui.status(`${label}, ${windowName(top.kind)} ${Math.round(top.pct)}%`)
}

// Redraws the status line from the last saved reading, e.g. after an account is added or renamed.
export const refreshStatus = async (io: Io, ui: Pick<Ui, 'status'>): Promise<void> => {
  const uuid = await currentAccountUuid(io)
  if (uuid) await showStatus(io, ui, uuid, (await loadUsage(io, uuid)).windows, await io.now())
}

export const recordMeasure = async (io: Io, ui: Ui, readings: readonly Reading[]): Promise<void> => {
  const uuid = await currentAccountUuid(io)
  if (!uuid || readings.length === 0) return
  const now = await io.now()
  const { next, earlyResets } = applyReadings(await loadUsage(io, uuid), readings, now)
  await saveUsage(io, next)
  try {
    for (const kind of earlyResets) ui.toast(`Your ${windowName(kind)} usage window reset early`)
    await showStatus(io, ui, uuid, next.windows, now)
  } catch {
    // display only: the reading is already saved
  }
}

export const recordTurn = async (
  io: Io,
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number },
): Promise<void> => {
  const uuid = await currentAccountUuid(io)
  if (!uuid) return
  const t: Tokens = {
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens,
    cacheWrite: usage.cache_creation_input_tokens,
  }
  await saveUsage(io, addTokens(await loadUsage(io, uuid), t, localDay(await io.now())))
}
