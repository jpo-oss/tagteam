import { effectivePercent } from './usage'
import type { Account, Pick, Usage, Window } from './types'

const level = (ws: readonly Window[], now: number) =>
  ws.reduce((m, w) => Math.max(m, effectivePercent(w, now)), 0)

const lastRead = (ws: readonly Window[]) => ws.reduce((m, w) => Math.max(m, w.readAt), -Infinity)

export function pickTarget(
  accounts: readonly Account[],
  usage: Readonly<Record<string, Usage>>,
  currentLabel: string,
  threshold: number,
  now: number,
): Pick {
  const rows = accounts
    .filter((a) => !a.excluded && !a.needsSignIn && a.label !== currentLabel)
    .map((a) => {
      const ws = Object.values(usage[a.accountUuid]?.windows ?? {})
      return { a, ws, level: level(ws, now), read: lastRead(ws) }
    })

  const open = rows
    .filter((r) => r.level < threshold)
    .sort(
      (x, y) =>
        x.level - y.level ||
        Number(!x.ws.length) - Number(!y.ws.length) ||
        x.a.order - y.a.order ||
        x.read - y.read,
    )
  if (open[0]) return { kind: 'switch', label: open[0].a.label }

  let best: { label: string; resumeAt: number } | undefined
  for (const r of rows) {
    const resets = r.ws
      .filter((w) => effectivePercent(w, now) >= threshold)
      .map((w) => Date.parse(w.resetsAt ?? ''))
    if (!resets.length || resets.some(Number.isNaN)) continue
    const resumeAt = Math.max(...resets)
    if (!best || resumeAt < best.resumeAt) best = { label: r.a.label, resumeAt }
  }
  return best ? { kind: 'wait', ...best } : { kind: 'none' }
}
