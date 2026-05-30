/**
 * GET /api/models/providers/available — the operator's ENABLED provider set.
 *
 * Canonical "what can I pick a model from" surface: every reachable provider
 * (subscription gateway, env key, codex/openrouter gateways, connected_accounts)
 * MINUS the ones the operator disabled on the AI Providers tab. Distinct from
 * GET /api/models/providers, which returns only the DISABLED list.
 *
 * Feeds the per-skill (and, later, per-agent) model dropdowns so they widen the
 * moment a provider is connected — no Claude-only collapse in lean-mode, no
 * redeploy. Reuses the shipped lib/models/providers.ts#detectAvailableProviders
 * (which already applies the disabled-toggle from migration 082) — one detector,
 * not a per-surface re-implementation.
 *
 * Always 200: a poll-style read used by the UI on mount. detectAvailableProviders
 * fails soft internally; we additionally default to ['anthropic'] so the dropdown
 * is never empty (the gateway is the baseline in every deploy).
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { detectAvailableProviders } from '@/lib/models/providers'

export const runtime = 'nodejs'
export const maxDuration = 10

export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 60, window: '1 m', prefix: 'models:providers:available' },
  })
  if ('response' in g) return g.response

  let providers: string[] = []
  try {
    providers = await detectAvailableProviders(g.userId)
  } catch {
    providers = []
  }
  if (providers.length === 0) providers = ['anthropic']
  return NextResponse.json({ providers })
}
