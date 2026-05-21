/**
 * /api/provider-prefs
 *
 * GET  ?provider=anthropic|openai  → returns the stored preferences for the
 *                                    operator + provider, plus the static
 *                                    "what tiers/modes apply here" enum so
 *                                    the dropdowns can render without
 *                                    duplicating the registry on the client.
 * POST { provider, subscription_tier?, execution_mode? }  → upsert prefs.
 *                                    Returns the sanitized prefs actually
 *                                    written (server drops anything outside
 *                                    the allowed enum).
 *
 * Storage: user_secrets row with name='preferences' and metadata jsonb
 * (migration 045). The row's encrypted `value` is a sentinel — see
 * lib/user-secrets.ts for the rationale.
 *
 * Manual toggle only — this PR doesn't auto-detect plan tier (the platforms
 * don't expose it via API). A future telemetry-derived inference layer will
 * read gateway_turns once token counts populate (post-PR #241).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getProviderPrefs, setProviderPrefs } from '@/lib/user-secrets'

export const runtime = 'nodejs'

type ProviderId = 'anthropic' | 'openai'
const VALID_PROVIDERS: ReadonlySet<ProviderId> = new Set(['anthropic', 'openai'])

// Per-provider enum of valid options. Lives server-side so the dropdowns
// can render consistently without each client duplicating the list. Only
// the anthropic provider exposes 'node-pty' today — see Task G2 in
// task_plan-claude-headless-cost-recovery.md for the execution path.
const PROVIDER_OPTIONS = {
  anthropic: {
    subscription_tier: ['Pro', '5x Max', '20x Max', 'API only'] as const,
    execution_mode:    ['subscription', 'api', 'node-pty']      as const,
  },
  openai: {
    subscription_tier: ['Pro', 'API only']           as const,
    execution_mode:    ['subscription', 'api']       as const,
  },
} as const satisfies Record<ProviderId, { subscription_tier: readonly string[]; execution_mode: readonly string[] }>

function parseProvider(raw: string | null): ProviderId | null {
  if (!raw) return null
  return VALID_PROVIDERS.has(raw as ProviderId) ? raw as ProviderId : null
}

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const provider = parseProvider(url.searchParams.get('provider'))
  if (!provider) {
    return NextResponse.json({ error: 'provider query param required (anthropic|openai)' }, { status: 400 })
  }

  const prefs = await getProviderPrefs(userId, provider)
  return NextResponse.json({
    provider,
    prefs,
    options: PROVIDER_OPTIONS[provider],
  }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'body must be an object' }, { status: 400 })
  }
  const b = body as { provider?: unknown; subscription_tier?: unknown; execution_mode?: unknown }

  const provider = parseProvider(typeof b.provider === 'string' ? b.provider : null)
  if (!provider) {
    return NextResponse.json({ error: 'provider must be anthropic|openai' }, { status: 400 })
  }

  // Validate against the per-provider enum to reject e.g. node-pty on openai.
  const allowedTiers = PROVIDER_OPTIONS[provider].subscription_tier as readonly string[]
  const allowedModes = PROVIDER_OPTIONS[provider].execution_mode    as readonly string[]
  const incomingTier = typeof b.subscription_tier === 'string' && allowedTiers.includes(b.subscription_tier) ? b.subscription_tier : undefined
  const incomingMode = typeof b.execution_mode    === 'string' && allowedModes.includes(b.execution_mode)    ? b.execution_mode    : undefined

  // Merge with existing — POST is partial-update, not full-replace, so the
  // UI can save tier without re-sending mode and vice versa.
  const existing = await getProviderPrefs(userId, provider)
  const merged   = {
    subscription_tier: incomingTier ?? existing.subscription_tier,
    execution_mode:    incomingMode ?? existing.execution_mode,
  }
  const result = await setProviderPrefs(userId, provider, merged as Parameters<typeof setProviderPrefs>[2])
  if (!result.ok) {
    return NextResponse.json({ error: 'failed to persist preferences' }, { status: 500 })
  }
  // `degraded: true` surfaces when migration 045 isn't applied yet — the row
  // landed without metadata. UI can show a warning so the operator runs the
  // migration. Status stays 200 because the write technically succeeded.
  return NextResponse.json({
    ok:     true,
    prefs:  result.written,
    ...(result.degraded ? { degraded: 'migration 045 not applied — re-run `doppler run -- npm run migrate` to persist metadata' } : {}),
  })
}
