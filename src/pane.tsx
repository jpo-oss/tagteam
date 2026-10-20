import type { ElementTable } from 'claude-code'
import type { Io } from './io'
import { localDay, when } from './session'
import { listAccounts, loadUsage, readActive } from './store'
import type { Settings, Tokens } from './types'
import { effectivePercent, windowName } from './usage'

export type Bar = { name: string; pct: number; color: string; reset?: string }
export type Row = { label: string; email: string; active: boolean; state: string; windows: Bar[]; today: string; week: string; early?: string }

const total = (t?: Tokens): number => (t ? t.input + t.output : 0)
const short = (n: number): string => (n < 1000 ? String(n) : n < 1e6 ? `${(n / 1e3).toFixed(1)}k` : `${(n / 1e6).toFixed(1)}M`)
const NAMES: Record<string, string> = { five_hour: '5-hour', seven_day: 'Weekly' }

export const barColor = (pct: number, threshold: number): string => (pct >= threshold ? 'error' : pct >= 70 ? 'warning' : 'success')

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
    const state = a.excluded ? 'Excluded'
      : a.needsSignIn ? 'Needs sign-in'
      : full.length ? `Limited, ${when(Math.max(...full), now)}`
      : isActive ? 'Active' : 'Available'
    const windows = ws.map((w) => {
      const reset = Date.parse(w.resetsAt ?? '')
      const pct = Math.round(effectivePercent(w, now))
      return { name: NAMES[w.kind] ?? windowName(w.kind), pct, color: barColor(pct, threshold), reset: !Number.isNaN(reset) && reset > now ? `resets ${when(reset, now)}` : undefined }
    })
    const last = Math.max(0, ...u.earlyResets.map((r) => r.at))
    rows.push({
      label: a.label, email: a.email, active: isActive, state, windows,
      today: short(total(u.tokensByDay[days[0]!])),
      week: short(days.reduce((s, d) => s + total(u.tokensByDay[d]), 0)),
      early: last ? `early, ${when(last, now)}` : undefined,
    })
  }
  return rows
}

type Parts = Pick<ElementTable, 'Box' | 'Text'>

// Joins segments with two spaces onto lines no wider than the pane; a lone segment that is still too wide is cut.
export function wrapLine(segments: string[], columns: number, indent = '  ', sep = '  '): string[] {
  const lines: string[] = []
  let cur = ''
  for (const seg of segments) {
    const next = cur ? `${cur}${sep}${seg}` : seg
    if (cur && next.length > columns) {
      lines.push(cur)
      cur = indent + seg
    } else cur = next
  }
  if (cur) lines.push(cur)
  return lines.map((l) => (l.length > columns ? `${l.slice(0, Math.max(1, columns - 1))}…` : l))
}

export const settingsLine = (s: Settings): string =>
  s.autoSwitch ? `Auto switch on at ${s.threshold}%` : `Auto switch off (asks at ${s.threshold}%)`

const plain = (text: string, columns: number): string[] => wrapLine(text.split(/\s+/), columns, '', ' ')

type Seg = { text: string; color?: string; bold?: boolean; dimColor?: boolean }

// Cuts or pads the segments to exactly n cells, marking a cut with an ellipsis.
const fitSegs = (segs: Seg[], n: number): Seg[] => {
  const out: Seg[] = []
  let left = n
  for (const s of segs) {
    if (left <= 0) break
    const text = s.text.slice(0, left)
    out.push({ ...s, text })
    left -= text.length
  }
  const last = out[out.length - 1]
  if (last && segs.reduce((w, s) => w + s.text.length, 0) > n) last.text = `${last.text.slice(0, -1)}…`
  if (left > 0) out.push({ text: ' '.repeat(left) })
  return out
}

const LABEL = 10
const FRAMED = 12

const cardLines = (r: Row, columns: number, bar: number): Seg[][] => {
  const framed = columns >= FRAMED
  const inner = framed ? columns - 4 : columns
  const edge = (text: string): Seg => (r.active ? { text, color: 'claude' } : { text, dimColor: true })
  const line = (label: string, value: Seg[]): Seg[] => {
    const body = fitSegs([{ text: label.padEnd(LABEL) }, ...value], inner)
    return framed ? [edge('│ '), ...body, edge(' │')] : body
  }
  const title: Seg = { text: r.active ? `● ${r.label}` : r.label, bold: r.active }
  let top: Seg[]
  if (!framed) top = fitSegs([title], columns)
  else {
    const withEmail = columns - 8 - title.text.length - r.email.length
    const fill = withEmail >= 3 ? withEmail : columns - 5 - title.text.length
    const right = withEmail >= 3 ? ` ${r.email} ─╮` : '╮'
    top = fill >= 1
      ? [edge('╭─ '), title, edge(` ${'─'.repeat(fill)}${right}`)]
      : [edge('╭─ '), ...fitSegs([title], columns - 6), edge(' ─╮')]
  }
  const usage = r.windows.length
    ? r.windows.map((w) => {
      const filled = Math.round((Math.min(100, Math.max(0, w.pct)) / 100) * bar)
      return line(w.name, [
        { text: '█'.repeat(filled) + '░'.repeat(bar - filled), color: w.color },
        { text: ` ${`${w.pct}%`.padStart(4)}${w.reset ? `  ${w.reset}` : ''}` },
      ])
    })
    : [line('Usage', [{ text: 'no reading yet', dimColor: true }])]
  return [
    top,
    line('State', [{ text: r.state }]),
    ...usage,
    line('Tokens', [{ text: `today ${r.today}`.padEnd(13) }, { text: `this week ${r.week}` }]),
    ...(r.early ? [line('Reset', [{ text: r.early }])] : []),
    ...(framed ? [[edge(`╰${'─'.repeat(columns - 2)}╯`)]] : []),
  ]
}

// A function declaration, like the other files that take engine parts.
export function drawPane({ Box, Text }: Parts, rows: Row[], columns: number, settings: string) {
  const head = plain(settings, columns).map((l, i) => <Text key={`s${i}`}>{l}</Text>)
  if (!rows.length) return <Box flexDirection="column">{head}{plain('No accounts yet. Run /tagteam add <label>.', columns).map((l, i) => <Text key={String(i)} dimColor>{l}</Text>)}</Box>
  // Room left beside the label, percent and the longest reset text ("resets Thu 12:30 PM").
  const bar = Math.max(3, Math.min(10, columns - 4 - LABEL - 7 - 19))
  return (
    <Box flexDirection="column" width={columns}>
      <Box marginBottom={1} flexDirection="column">{head}</Box>
      {rows.map((r) => (
        <Box key={r.label} flexDirection="column">
          {cardLines(r, columns, bar).map((segs, i) => (
            <Text key={String(i)} wrap="truncate-end">{segs.map((s, j) => <Text key={String(j)} color={s.color} bold={s.bold} dimColor={s.dimColor}>{s.text}</Text>)}</Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

export function drawError({ Box, Text }: Parts, msg: string, columns: number) {
  return <Box flexDirection="column">{plain(`tagteam: cannot read accounts: ${msg}`, columns).map((l, i) => <Text key={String(i)}>{l}</Text>)}</Box>
}
