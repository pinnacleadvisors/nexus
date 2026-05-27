/**
 * Spec: every directory under app/(protected)/ MUST be gated by proxy.ts.
 *
 * `app/(protected)/layout.tsx` does NOT call `auth()` — the entire route
 * group's auth gate is the middleware matcher in `proxy.ts`. A directory
 * added to `app/(protected)/` without a matching entry in the matcher
 * leaks unauthenticated. We hit this 2026-05-27 audit: /businesses,
 * /inbox, /issues, /audit, /approvals, /agents, /teams, /org, /memory,
 * /automation-library, /simulate, /cron-health were all leaking. This
 * spec catches future drift.
 *
 * Strategy:
 *   1. Read the list of directories under app/(protected)/ from the
 *      filesystem (single source of truth — additions to the route
 *      group automatically extend the test surface).
 *   2. Skip the route group's own layout (no URL).
 *   3. Hit each directory's root URL UNAUTHENTICATED. Expect a redirect
 *      to /sign-in (302/307).
 *
 * Runs without BOT_SESSION_TICKET_URL — these are negative-auth probes.
 */

import { test, expect, request } from '@playwright/test'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PROTECTED_DIR = join(process.cwd(), 'app', '(protected)')

function listProtectedRoutes(): string[] {
  let entries: string[]
  try {
    entries = readdirSync(PROTECTED_DIR)
  } catch {
    return []
  }
  return entries
    .filter(name => {
      // Skip files (we only want top-level route directories)
      try {
        return statSync(join(PROTECTED_DIR, name)).isDirectory()
      } catch { return false }
    })
    // Skip the route group's parenthesized siblings if any sneak in
    .filter(name => !name.startsWith('(') && !name.startsWith('_'))
}

test.describe('protected route gate — proxy.ts matcher covers every (protected)/ directory', () => {
  const routes = listProtectedRoutes()

  // Sanity — the audit found 25 directories; if we suddenly see 0, the
  // path resolution is broken and the spec would falsely pass.
  test('directory inventory is non-empty', () => {
    expect(routes.length).toBeGreaterThan(5)
  })

  for (const dir of routes) {
    test(`/${dir} redirects unauthenticated requests`, async ({ playwright }) => {
      // Use a fresh request context with no cookies — guarantees no
      // ambient session leaks in from earlier specs.
      const ctx = await playwright.request.newContext({
        baseURL:        process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
        ignoreHTTPSErrors: true,
        // Critical: do NOT follow redirects. We want to see the 302/307
        // status code directly, not the eventual /sign-in 200.
        maxRedirects:   0,
      })
      const res = await ctx.get(`/${dir}`).catch(() => null)
      await ctx.dispose()

      // If the request was rejected outright (network failure, no server)
      // we skip rather than fail — the spec should run cleanly when the
      // dev server isn't up, and the operator can re-run with the server.
      test.skip(!res, `no dev server reachable at ${process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'}`)

      // 302 or 307 from the middleware redirect.
      // 200 means the page rendered — the matcher leak this spec catches.
      const status = res!.status()
      expect(status, `Unauthenticated /${dir} should redirect to /sign-in (got HTTP ${status}). Check the isProtectedRoute matcher in proxy.ts.`).toBeGreaterThanOrEqual(300)
      expect(status, `Unauthenticated /${dir} should redirect to /sign-in (got HTTP ${status}).`).toBeLessThan(400)
    })
  }
})
