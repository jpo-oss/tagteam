export const ACCOUNT_KEYS: readonly RegExp[] = [
  /^oauthAccount$/, /^userID$/, /^primaryApiKey$/, /^customApiKeyResponses$/,
  /[Ss]ubscription/, /^overage/, /^passes/, /^s1m/, /^grove/, /[Cc]ache/,
  /^hasVisitedExtraUsage$/, /^fableOverageConsent/,
  /^hasVisitedPasses$/, /^isQualifiedForDataSharing$/, /^penguinModeOrgEnabled$/,
  /^claudeAiMcpEverConnected$/, /^teamOnboardingLastUsedAt$/, /^hasRemoteEnvironment$/,
  /token|secret|apikey|credential|oauth|email|organization|accountuuid/i,
]

const TRUST_FLAG = /^has\w*(Accepted|Approved)$/

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})

export function seedAppState(home: Readonly<Obj>): Obj {
  return Object.fromEntries(Object.entries(home).filter(([k]) => !ACCOUNT_KEYS.some((re) => re.test(k))))
}

const trustFlags = (p: unknown) =>
  Object.entries(obj(p)).filter(([k, v]) => TRUST_FLAG.test(k) && v === true)

function* paths(cwd: string) {
  let p = cwd
  while (p) {
    yield p
    p = p.slice(0, p.lastIndexOf('/'))
  }
  yield '/'
}

export function withTrust(target: Readonly<Obj>, source: Readonly<Obj>, cwd: string): Obj {
  const sp = obj(source.projects)
  for (const path of paths(cwd)) {
    const flags = trustFlags(sp[path])
    if (!flags.length) continue
    const projects = obj(target.projects)
    return { ...target, projects: { ...projects, [path]: { ...obj(projects[path]), ...Object.fromEntries(flags) } } }
  }
  return { ...target }
}
