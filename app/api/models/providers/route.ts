/**
 * GET /api/models/providers — list the operator's disabled providers.
 *
 * Returns: { disabled: Array<{ provider, reason, disabled_at }> }
 *
 * Read-only view onto the ai_provider_disabled table (migration 082). The
 * Settings → AI Providers tab loads this once at mount to render initial
 * toggle state per card; subsequent flips happen via
 * PATCH /api/models/providers/[provider].
 *
 * Returns an empty list (NOT an error) when the migration isn't applied —
 * the UI then shows every provider as enabled by default and the PATCH
 * endpoint surfaces a `degraded` marker when the operator first tries to
 * disable one.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'
import { loadDisabledProviders } from '@/lib/models/provider-toggle'

export const runtime = 'nodejs'
export const maxDuration = 10

export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 60, window: '1 m', prefix: 'models:providers:list' },
  })
  if ('response' in g) return g.response

  const db = createServerClient()
  // Migration-missing path: returns empty list rather than 5xx so the UI
  // boots cleanly on a fresh install. loadDisabledProviders fail-soft
  // already handles the missing-table case.
  const disabled = await loadDisabledProviders(db, g.userId)
  return NextResponse.json({
    disabled: Array.from(disabled).map(provider => ({ provider })),
  })
}
