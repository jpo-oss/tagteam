export const ACCOUNT_KEYS: readonly RegExp[] = [
  /^oauthAccount$/, /^userID$/, /^primaryApiKey$/, /^customApiKeyResponses$/,
  /[Ss]ubscription/, /^overage/, /^passes/, /^s1m/, /^grove/, /[Cc]ache/,
  /^hasVisitedExtraUsage$/, /^fableOverageConsent/,
  /^hasVisitedPasses$/, /^isQualifiedForDataSharing$/, /^penguinModeOrgEnabled$/,
  /^claudeAiMcpEverConnected$/, /^teamOnboardingLastUsedAt$/, /^hasRemoteEnvironment$/,
]

const TRUST_FLAG = /^has\w*(Accepted|Approved)$/

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})

export function seedAppState(home: Readonly<Obj>): Obj {
  return Object.fromEntries(Object.entries(home).filter(([k]) => !ACCOUNT_KEYS.some((re) => re.test(k))))
}

export function withTrust(target: Readonly<Obj>, source: Readonly<Obj>, cwd: string): Obj {
  const flags = Object.entries(obj(obj(source.projects)[cwd])).filter(([k]) => TRUST_FLAG.test(k))
  if (!flags.length) return { ...target }
  const projects = obj(target.projects)
  return { ...target, projects: { ...projects, [cwd]: { ...obj(projects[cwd]), ...Object.fromEntries(flags) } } }
}
