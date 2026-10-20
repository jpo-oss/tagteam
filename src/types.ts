export type Reading = { kind: string; percentUsed: number; resetsAt?: string }
export type Window = Reading & { readAt: number }
export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }
export type Usage = {
  accountUuid: string
  windows: Record<string, Window>
  tokensByDay: Record<string, Tokens> // key: YYYY-MM-DD, local time
  earlyResets: { kind: string; at: number }[]
}
export type Account = {
  label: string; dir: string; accountUuid: string; email: string
  order: number; excluded: boolean; needsSignIn: boolean
}
export type Settings = { autoSwitch: boolean; threshold: number }
export type Pick =
  | { kind: 'switch'; label: string }
  | { kind: 'wait'; label: string; resumeAt: number }
  | { kind: 'none' }
export type SwitchRequest = {
  run: string; session: string; targetLabel: string; targetDir: string
  resumeAt?: number; reason: string; handover: string
}
