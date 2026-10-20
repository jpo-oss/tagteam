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

const uses24h = (): boolean => {
  try {
    const c = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle
    return c === 'h23' || c === 'h24'
  } catch {
    return false
  }
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Every time shown to the person: "in 5h 20m", "2h ago", "Thu 8 PM", "Oct 30".
export const when = (ms: number, now: number, h24 = uses24h()): string => {
  const mins = Math.round(Math.abs(ms - now) / 60_000)
  if (mins < 24 * 60) {
    if (mins === 0) return 'now'
    const span = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}`
    return ms > now ? `in ${span}` : `${span} ago`
  }
  const d = new Date(ms)
  if (mins >= 7 * 24 * 60) return `${MONTHS[d.getMonth()]} ${d.getDate()}`
  const h = d.getHours()
  const m = d.getMinutes()
  const mm = String(m).padStart(2, '0')
  const time = h24 ? `${String(h).padStart(2, '0')}:${mm}` : `${h % 12 || 12}${m ? `:${mm}` : ''} ${h < 12 ? 'AM' : 'PM'}`
  return `${DAYS[d.getDay()]} ${time}`
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
