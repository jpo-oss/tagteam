import { expect, test } from 'claude-code/testing'
import { seedAppState, withTrust } from '../src/appstate'

test('seed drops login-bound keys and keeps the rest', async () => {
  const home = {
    oauthAccount: { emailAddress: 'a@x.io' }, userID: 'u', cachedGrowthBookFeatures: {},
    hasCompletedOnboarding: true, theme: 'dark', mcpServers: { a: {} }, projects: { '/p': {} },
  }
  const seed = seedAppState(home)
  expect(Object.keys(seed).sort()).toEqual(['hasCompletedOnboarding', 'mcpServers', 'projects', 'theme'])
  expect(home.oauthAccount).toBeTruthy()
})

test('seed drops subscription, overage and pass state', async () => {
  const seed = seedAppState({ hasAvailableSubscription: true, overageCreditGrantCache: {}, passesLastSeenRemaining: 1, s1mAccessCache: {}, groveConfigCache: {}, hasVisitedExtraUsage: true, fableOverageConsentV2: true, keep: 1 })
  expect(seed).toEqual({ keep: 1 })
})

test('withTrust copies the accepted flags for cwd and leaves the rest of target', async () => {
  const source = { projects: { '/w': { hasTrustDialogAccepted: true, lastCost: 9, allowedTools: ['x'] } } }
  const target = { oauthAccount: { a: 1 }, projects: { '/o': { hasTrustDialogAccepted: true }, '/w': { lastCost: 1 } } }
  const out = withTrust(target, source, '/w') as any
  expect(out.projects['/w']).toEqual({ lastCost: 1, hasTrustDialogAccepted: true })
  expect(out.projects['/o']).toEqual({ hasTrustDialogAccepted: true })
  expect(out.oauthAccount).toEqual({ a: 1 })
  expect(target.projects['/w']).toEqual({ lastCost: 1 })
})

test('withTrust creates the project entry when target lacks it', async () => {
  const out = withTrust({}, { projects: { '/w': { hasTrustDialogAccepted: true } } }, '/w') as any
  expect(out.projects['/w']).toEqual({ hasTrustDialogAccepted: true })
})

test('withTrust is a no-op when source never trusted cwd', async () => {
  const target = { projects: { '/o': {} } }
  expect(withTrust(target, { projects: { '/w': { lastCost: 1 } } }, '/w')).toEqual(target)
  expect(withTrust(target, {}, '/w')).toEqual(target)
})
