import type { EngineInterface } from 'claude-code'
import type { Io } from './io'
import { readJson, readUpdateCheck, saveUpdateCheck } from './store'

const LATEST_URL = 'https://api.github.com/repos/jpo-oss/tagteam/releases/latest'
const DAY_MS = 24 * 60 * 60_000

export type UpdateDeps = {
  io: Io
  pluginRoot: string
  fetch(url: string): Promise<{ ok: boolean; text: string }>
  toast(text: string): void
}

type Dollar = Pick<EngineInterface, 'http' | 'ui'>

// A function declaration: the mod loader follows $ into one, not into an arrow.
export function updateDepsFrom($: Dollar, io: Io, pluginRoot: string): UpdateDeps {
  return {
    io,
    pluginRoot,
    fetch: (url) => $.http.fetch(url, { headers: { Accept: 'application/vnd.github+json' } }),
    // Session start has no other place to speak, and a toast clears itself. Long enough to read the command.
    toast: (t) => $.ui.toast(t, { timeoutMs: 12_000 }),
  }
}

const parts = (v: string): number[] | undefined => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}

export const isNewer = (candidate: string, installed: string): boolean => {
  const a = parts(candidate)
  const b = parts(installed)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!
  return false
}

// Throws on any failure; the caller logs it.
export async function checkForUpdate(d: UpdateDeps): Promise<void> {
  const { io } = d
  const state = await readUpdateCheck(io)
  const now = await io.now()
  if (now - state.checkedAt < DAY_MS) return
  await saveUpdateCheck(io, { ...state, checkedAt: now })

  const res = await d.fetch(LATEST_URL)
  if (!res.ok) throw new Error('release lookup was refused')
  const tag = String((JSON.parse(res.text) as { tag_name?: unknown }).tag_name ?? '')
  const latest = tag.replace(/^v/, '')
  const manifest = await readJson<{ version?: string }>(io, `${d.pluginRoot}/.claude-plugin/plugin.json`, {})
  if (!manifest.version || !isNewer(latest, manifest.version) || state.announced === latest) return

  await saveUpdateCheck(io, { checkedAt: now, announced: latest })
  d.toast(`tagteam ${latest} is out. Turn on auto-update in /plugin > Marketplaces > tagteam, or run: claude plugin update tagteam@tagteam`)
}
