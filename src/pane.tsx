import type { Io } from './io'
import { localDay, when } from './session'
import { listAccounts, loadUsage, readActive } from './store'
import type { Tokens } from './types'
import { effectivePercent } from './usage'

export type Row = { label: string; email: string; active: boolean; state: string; windows: string; tokens: string; early?: string }

const total = (t?: Tokens): number => (t ? t.input + t.output + t.cacheRead + t.cacheWrite : 0)
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
      windows: windows.join(' · ') || 'no reading yet',
      tokens: `today ${short(total(u.tokensByDay[days[0]!]))} · week ${short(days.reduce((s, d) => s + total(u.tokensByDay[d]), 0))}`,
      early: last ? `last early reset ${when(last, now)}` : undefined,
    })
  }
  return rows
}

type Parts = { Box: any; Text: any }

// A function declaration, like the other files that take engine parts.
export function drawPane({ Box, Text }: Parts, rows: Row[], columns: number) {
  const fit = (s: string) => (s.length > columns ? `${s.slice(0, Math.max(1, columns - 1))}…` : s)
  if (!rows.length) return <Text dimColor>No accounts yet. Run /tagteam add &lt;label&gt;.</Text>
  return (
    <Box flexDirection="column" width={columns}>
      {rows.map((r) => (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold={r.active} wrap="wrap">{`${r.active ? '●' : ' '} ${r.label} · ${r.email} · ${r.state} · ${r.windows}`}</Text>
          <Text dimColor>{fit(`  ${r.tokens}${r.early ? ` · ${r.early}` : ''}`)}</Text>
        </Box>
      ))}
    </Box>
  )
}
