import type { Reading, Tokens, Usage, Window } from './types'

export const emptyUsage = (accountUuid: string): Usage => ({
  accountUuid,
  windows: {},
  tokensByDay: {},
  earlyResets: [],
})

export const effectivePercent = (w: Window, now: number): number =>
  w.resetsAt && Date.parse(w.resetsAt) <= now ? 0 : w.percentUsed

const isEarly = (prev: Window | undefined, r: Reading, now: number): boolean => {
  if (!prev?.resetsAt) return false
  const was = Date.parse(prev.resetsAt)
  if (was <= now) return false
  return r.percentUsed < prev.percentUsed || (r.resetsAt !== undefined && Date.parse(r.resetsAt) < was)
}

export function applyReadings(
  prev: Usage,
  readings: readonly Reading[],
  now: number,
): { next: Usage; earlyResets: string[] } {
  const windows = { ...prev.windows }
  const early: string[] = []
  for (const r of readings) {
    if (isEarly(windows[r.kind], r, now)) early.push(r.kind)
    windows[r.kind] = { ...r, readAt: now }
  }
  return {
    next: { ...prev, windows, earlyResets: [...prev.earlyResets, ...early.map((kind) => ({ kind, at: now }))] },
    earlyResets: early,
  }
}

export function addTokens(prev: Usage, t: Tokens, day: string): Usage {
  const d = prev.tokensByDay[day] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  return {
    ...prev,
    tokensByDay: {
      ...prev.tokensByDay,
      [day]: {
        input: d.input + t.input,
        output: d.output + t.output,
        cacheRead: d.cacheRead + t.cacheRead,
        cacheWrite: d.cacheWrite + t.cacheWrite,
      },
    },
  }
}
