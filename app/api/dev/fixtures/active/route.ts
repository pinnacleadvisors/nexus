/**
 * GET   /api/dev/fixtures/active — current fixture-mode state for the operator.
 * PATCH /api/dev/fixtures/active — toggle it (body: { enabled: boolean, reason?: string }).
 *
 * Backs `components/settings/FixtureModeSwitch`. The flip is INSTANT for
 * later calls in the same process — `setFixtureMode` invalidates +
 * warms the cache, so the next `executeBusinessAction` sees the new
 * value within the same request boundary (no redeploy, no cron tick).
 *
 * Auth: Clerk session + ALLOWED_USER_IDS gate. PATCH is rate-limited
 * tight (5/min) to discourage thrashing.
 *
 * Why this lives under /api/dev/ instead of /api/settings/:
 *   - The harness is explicitly a dev-tool. The path makes the intent
 *     visible in logs (anything under /api/dev/ is local-loop, not
 *     business-affecting).
 *   - Easier to add more dev-loop endpoints later (e.g. /api/dev/seed,
 *     /api/dev/scenarios) without re-namespacing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { getFixtureMode, setFixtureMode } from '@/lib/fixtures/store'
import { activeFixtureAccounts } from '@/lib/fixtures/connected-accounts'
import { fixtureCoverage } from '@/lib/fixtures/actions'

export const runtime = 'nodejs'
export const maxDuration = 10

interface PatchBody { enabled?: unknown; reason?: unknown }

export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 60, window: '1 m', prefix: 'dev:fixtures:active:get' },
  })
  if ('response' in g) return g.response

  const enabled  = await getFixtureMode(g.userId)
  const accounts = activeFixtureAccounts()
  const coverage = fixtureCoverage()
  return NextResponse.json({
    ok:               true,
    enabled,
    // Surface what fixture mode would activate so the panel can show the
    // operator "12 platforms / 21 verbs covered" before they flip the toggle.
    coverage: {
      platforms:       accounts.length,
      action_platforms: coverage.platforms,
      action_verbs:    coverage.verbs,
    },
    platforms:        accounts.map(a => ({ platform: a.platform, display_name: a.display_name })),
  })
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 5, window: '1 m', prefix: 'dev:fixtures:active:set' },
  })
  if ('response' in g) return g.response

  const body    = await req.json().catch(() => ({})) as PatchBody
  const enabled = body.enabled === true
  const reason  = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : null

  const out = await setFixtureMode(g.userId, enabled, reason)
  if (!out.ok) {
    return NextResponse.json({
      ok:        false,
      error:     out.error,
      degraded:  out.degraded,
      hint:      out.degraded
        ? 'Migration 084 not applied. Run `doppler run -- npm run migrate` then retry.'
        : undefined,
    })
  }
  return NextResponse.json({ ok: true, enabled: out.enabled })
}
