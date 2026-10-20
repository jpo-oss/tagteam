import type { Io } from './io'
import { listAccounts, loadUsage, saveUsage } from './store'
import type { Account, Reading, Tokens } from './types'
import { addTokens, applyReadings, effectivePercent } from './usage'

export type Ui = { toast(text: string): void; status(text: string): void }

export const currentAccountUuid = async (io: Io): Promise<string | undefined> => {
  const dir = await io.env('CLAUDE_CONFIG_DIR')
  const file = dir ? `${dir}/.claude.json` : `${(await io.env('HOME')) ?? ''}/.claude.json`
  const text = await io.read(file)
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

const showStatus = async (io: Io, ui: Ui, uuid: string, windows: Record<string, Reading>, now: number) => {
  const top = Object.values(windows)
    .map((w) => ({ kind: w.kind, pct: effectivePercent({ ...w, readAt: now }, now) }))
    .sort((a, b) => b.pct - a.pct)[0]
  if (!top) return
  const label = labelFor(await listAccounts(io), uuid) ?? 'unmanaged'
  ui.status(`${label} · ${top.kind} ${Math.round(top.pct)}%`)
}

export const recordMeasure = async (io: Io, ui: Ui, readings: readonly Reading[]): Promise<void> => {
  const uuid = await currentAccountUuid(io)
  if (!uuid || readings.length === 0) return
  const now = await io.now()
  const { next, earlyResets } = applyReadings(await loadUsage(io, uuid), readings, now)
  await saveUsage(io, next)
  try {
    for (const kind of earlyResets) ui.toast(`Your ${kind} usage window reset early`)
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
