import type { ElementTable } from 'claude-code'
import type { Io } from './io'
import { localDay, when } from './session'
import { listAccounts, loadUsage, readActive } from './store'
import type { Tokens } from './types'
import { effectivePercent } from './usage'

export type Row = { label: string; email: string; active: boolean; state: string; windows: string[]; tokens: string; early?: string }

const total = (t?: Tokens): number => (t ? t.input + t.output : 0)
const short = (n: number): string => (n < 1000 ? String(n) : n < 1e6 ? `${(n / 1e3).toFixed(1)}k` : `${(n / 1e6).toFixed(1)}M`)
const NAMES: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

export async function paneRows(io: Io, now: number, threshold: number): Promise<Row[]> {
  const active = await readActive(io)
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    return localDay(d.getTime())
  })
  const rows: Row[] = []
  for (const a of await listAccounts(io)) {
    const u = await loadUsage(io, a.accountUuid)
    const ws = Object.values(u.windows)
    const full = ws.filter((w) => effectivePercent(w, now) >= threshold).map((w) => Date.parse(w.resetsAt ?? '')).filter((t) => !Number.isNaN(t))
    const isActive = a.label === active
    const state = a.excluded ? 'excluded'
      : a.needsSignIn ? 'needs sign-in'
      : full.length ? `limited until ${when(Math.max(...full), now)}`
      : isActive ? 'active' : 'available'
    const windows = ws.map((w) => {
      const reset = Date.parse(w.resetsAt ?? '')
      const live = !Number.isNaN(reset) && reset > now
      return `${NAMES[w.kind] ?? w.kind} ${Math.round(effectivePercent(w, now))}%${live ? ` resets ${when(reset, now)}` : ''}`
    })
    const last = Math.max(0, ...u.earlyResets.map((r) => r.at))
    rows.push({
      label: a.label, email: a.email, active: isActive, state,
      windows: windows.length ? windows : ['no reading yet'],
      tokens: `tokens in/out today ${short(total(u.tokensByDay[days[0]!]))} · week ${short(days.reduce((s, d) => s + total(u.tokensByDay[d]), 0))}`,
      early: last ? `last early reset ${when(last, now)}` : undefined,
    })
  }
  return rows
}

type Parts = Pick<ElementTable, 'Box' | 'Text'>

// Joins segments with " · " onto lines no wider than the pane; a lone segment that is still too wide is cut.
export function wrapLine(segments: string[], columns: number, indent = '  '): string[] {
  const lines: string[] = []
  let cur = ''
  for (const seg of segments) {
    const next = cur ? `${cur} · ${seg}` : seg
    if (cur && next.length > columns) {
      lines.push(cur)
      cur = indent + seg
    } else cur = next
  }
  if (cur) lines.push(cur)
  return lines.map((l) => (l.length > columns ? `${l.slice(0, Math.max(1, columns - 1))}…` : l))
}

// A function declaration, like the other files that take engine parts.
export function drawPane({ Box, Text }: Parts, rows: Row[], columns: number) {
  if (!rows.length) return <Text dimColor>{'No accounts yet. Run /tagteam add <label>.'}</Text>
  return (
    <Box flexDirection="column" width={columns}>
      {rows.map((r) => (
        <Box key={r.label} flexDirection="column" marginBottom={1}>
          {wrapLine([`${r.active ? '●' : ' '} ${r.label}`, r.email, r.state, ...r.windows], columns).map((l) => (
            <Text bold={r.active}>{l}</Text>
          ))}
          {wrapLine([r.tokens, ...(r.early ? [r.early] : [])], columns).map((l) => (
            <Text dimColor>{`  ${l.trimStart()}`.slice(0, columns)}</Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

export function drawError({ Text }: Parts, msg: string) {
  return <Text>{`tagteam: cannot read accounts: ${msg}`}</Text>
}
