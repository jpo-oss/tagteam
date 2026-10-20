import type { EngineInterface, PluginOptions } from 'claude-code'
import { withTrust } from './appstate'
import type { Io } from './io'
import { pickTarget } from './pick'
import { configFile, currentAccountUuid } from './session'
import {
  awaitDecision, claimDecision, dropDecision, listAccounts, loadUsage, pruneDecisions, readActive, readJson,
  releaseDecision, snooze, snoozed, stateRoot, writeActive, writeJsonAtomic, writeSwitchRequest,
} from './store'
import type { Account, Settings, Window } from './types'
import { effectivePercent } from './usage'

export type SwitchUi = {
  ask(question: string, options: string[]): Promise<string>
  toast(text: string): void
  notify(text: string): Promise<unknown>
  cwd(): Promise<string>
  sessionId(): Promise<string>
  exitSoon(): void
}
export type SwitchState = { inTurn: boolean; pendingExit: boolean; exitScheduled: boolean; told: Set<string> }
export type SwitchCtx = { io: Io; ui: SwitchUi; state: SwitchState; settings: Settings }

export const newState = (): SwitchState => ({ inTurn: false, pendingExit: false, exitScheduled: false, told: new Set() })

type Dollar = Pick<EngineInterface, 'ui' | 'session' | 'clock' | 'command'>

// A function declaration: the mod loader follows $ into one, not into an arrow.
export function uiFrom($: Dollar): SwitchUi {
  return {
    ask: (q, options) => $.ui.ask(q, options),
    toast: (t) => $.ui.toast(t),
    notify: (t) => $.ui.notify(t),
    cwd: () => $.session.cwd(),
    sessionId: () => $.session.id(),
    // Never call command.run directly: inside a command.run hook the engine refuses it.
    exitSoon: () => void $.clock.after(500, () => void $.command.run({ command: 'exit' }).catch(() => undefined)),
  }
}

export function settingsFrom(o: PluginOptions): Settings {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  return {
    autoSwitch: o.autoSwitch === true,
    threshold: Math.min(100, Math.max(50, num(o.threshold, 95))),
    stallTimeoutSeconds: Math.max(1, num(o.stallTimeoutSeconds, 30)),
  }
}

export function handover(from: string, to: string, reason: string): string {
  const moved = from === to
    ? `This session was paused on the ${from} account because ${reason}, and resumed once the limit reset.`
    : `This session was closed on the ${from} account and reopened on ${to} because ${reason}.`
  return `${moved} Before anything else, check every subagent and background task that was running when it closed. ` +
    'Resume any subagent that had not finished, with its history, and re-run any background task that died. ' +
    'Then carry on with the task you were on. Do not start anything that was not already in progress.'
}

export const scheduleExit = (ctx: SwitchCtx): void => {
  if (ctx.state.exitScheduled) return
  ctx.state.exitScheduled = true
  ctx.ui.exitSoon()
}

const clock = (ms: number): string => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const kv = (text: string): Record<string, string> =>
  Object.fromEntries(text.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))

const trimSlash = (p: string) => p.replace(/\/+$/, '')

// A running claude keeps rewriting its own .claude.json, so writing to it then would be lost or clobber it.
const inUse = async (io: Io, dir: string): Promise<boolean> => {
  const state = `${await stateRoot(io)}/state`
  for (const name of await io.list(state)) {
    if (!name.startsWith('run-') || name.includes('.tmp-')) continue
    const r = kv((await io.read(`${state}/${name}`)) ?? '')
    if (trimSlash(r.dir ?? '') !== trimSlash(dir) || !/^\d+$/.test(r.pid ?? '')) continue
    if ((await io.run(['kill', '-0', r.pid!])).exitCode === 0) return true
  }
  return false
}

const copyTrust = async (io: Io, cwd: string, dir: string): Promise<void> => {
  if (await inUse(io, dir)) return
  const path = `${dir}/.claude.json`
  const target = await readJson<Record<string, unknown> | undefined>(io, path, undefined)
  if (!target) return
  const next = withTrust(target, await readJson<Record<string, unknown>>(io, await configFile(io), {}), cwd)
  if (JSON.stringify(next) !== JSON.stringify(target)) await writeJsonAtomic(io, path, next)
}

export async function requestSwitch(ctx: SwitchCtx, from: string, target: Account, reason: string, resumeAt?: number): Promise<void> {
  const { io, ui, state, settings } = ctx
  const run = await io.env('TAGTEAM_RUN')
  if (!run) throw new Error('This session was not started by the tagteam launcher')
  await copyTrust(io, await ui.cwd(), target.dir)
  await writeSwitchRequest(io, {
    run, session: await ui.sessionId(), targetLabel: target.label, targetDir: target.dir,
    resumeAt: resumeAt === undefined ? undefined : Math.ceil(resumeAt / 1000),
    reason, handover: handover(from, target.label, reason), stallSeconds: settings.stallTimeoutSeconds,
  })
  await writeActive(io, target)
  state.pendingExit = true
  if (!state.inTurn) scheduleExit(ctx)
}

const topWindow = (ws: Record<string, Window>, threshold: number, now: number) =>
  Object.values(ws)
    .map((w) => ({ w, pct: effectivePercent(w, now) }))
    .filter((x) => x.pct >= threshold)
    .sort((a, b) => b.pct - a.pct)[0]

// One question per window episode across every session; the rest wait for its answer.
async function decide(ctx: SwitchCtx, uuid: string, w: Window, question: string, now: number): Promise<boolean> {
  const { io, ui } = ctx
  await pruneDecisions(io, now)
  if (!(await claimDecision(io, uuid, w.kind, w.resetsAt))) return (await awaitDecision(io, uuid, w.kind, w.resetsAt)) === 'yes'
  const answer = await ui.ask(question, ['Yes', 'No']).catch(() => undefined)
  if (answer !== 'Yes' && answer !== 'No') {
    await dropDecision(io, uuid, w.kind, w.resetsAt)
    return false
  }
  if (answer === 'No') await snooze(io, uuid, w.kind, w.resetsAt ?? '')
  await releaseDecision(io, uuid, w.kind, w.resetsAt, answer === 'Yes' ? 'yes' : 'no')
  return answer === 'Yes'
}

export async function evaluate(ctx: SwitchCtx, now: number): Promise<void> {
  const { io, ui, state, settings } = ctx
  if (state.pendingExit) return
  const uuid = await currentAccountUuid(io)
  if (!uuid) return
  const accounts = await listAccounts(io)
  const current = accounts.find((a) => a.accountUuid === uuid)
  const run = await io.env('TAGTEAM_RUN')

  if (run && current) {
    const active = await readActive(io)
    const lead = accounts.find((a) => a.label === active && a.label !== current.label && !a.needsSignIn)
    if (lead && !topWindow((await loadUsage(io, lead.accountUuid)).windows, settings.threshold, now)) {
      await requestSwitch(ctx, current.label, lead, `another session switched to ${lead.label}`)
      ui.toast(`Following the switch from ${current.label} to ${lead.label}`)
      return
    }
  }

  const top = topWindow((await loadUsage(io, uuid)).windows, settings.threshold, now)
  if (!top) return
  const { w } = top
  const pct = Math.round(top.pct)
  const said = `${current?.label ?? 'This account'} is at ${pct}% of its ${w.kind} limit`
  const episode = `${uuid}:${w.kind}:${w.resetsAt ?? ''}`
  const once = (key: string) => !state.told.has(key) && !!state.told.add(key)

  if (!run || !current) {
    const fix = !run ? 'Start Claude with the tagteam launcher to switch accounts.' : 'Add it with /tagteam add so tagteam can switch away from it.'
    if (once(`warn:${episode}`)) ui.toast(`${said}. ${fix}`)
    return
  }
  if (await snoozed(io, uuid, w.kind, w.resetsAt ?? '')) return

  const usage = Object.fromEntries(await Promise.all(accounts.map(async (a) => [a.accountUuid, await loadUsage(io, a.accountUuid)] as const)))
  const pick = pickTarget(accounts, usage, current.label, settings.threshold, now)
  if (pick.kind === 'none') {
    if (once(`none:${episode}`)) await ui.notify(`${said} and no account is available to switch to.`)
    return
  }
  const target = accounts.find((a) => a.label === pick.label)
  if (!target) return
  const resumeAt = pick.kind === 'wait' ? pick.resumeAt : undefined

  if (!settings.autoSwitch) {
    const question = resumeAt === undefined
      ? `${said}. Switch to ${target.label}?`
      : `${said} and every other account is limited too. Close now and resume on ${target.label} at ${clock(resumeAt)}?`
    if (!(await decide(ctx, uuid, w, question, now))) return
  }
  await requestSwitch(ctx, current.label, target, `${current.label} reached ${pct}% of its ${w.kind} limit`, resumeAt)
  ui.toast(resumeAt === undefined
    ? `Switched from ${current.label} (${pct}% ${w.kind}) to ${target.label}`
    : `${current.label} (${pct}% ${w.kind}) is closing and resumes on ${target.label} at ${clock(resumeAt)}`)
}

export async function manualSwitch(ctx: SwitchCtx, label: string): Promise<string> {
  const { io } = ctx
  if (!(await io.env('TAGTEAM_RUN'))) return 'This session was not started with the tagteam launcher, so it cannot switch. Restart it with tagteam.'
  const accounts = await listAccounts(io)
  const target = accounts.find((a) => a.label === label)
  if (!target) return `No account named ${label}.`
  if (target.needsSignIn) return `${label} needs to sign in again first.`
  const uuid = await currentAccountUuid(io)
  const from = accounts.find((a) => a.accountUuid === uuid)?.label ?? 'unmanaged'
  if (from === label) return `Already on ${label}.`
  await requestSwitch(ctx, from, target, `you switched to ${label} with /tagteam switch`)
  return `Switching to ${label}. This session closes and reopens there in a moment.`
}
