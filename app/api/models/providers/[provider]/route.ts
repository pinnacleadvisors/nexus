/**
 * PATCH /api/models/providers/:provider — toggle the operator's disable
 * state for one AI provider.
 *
 * Body: { disabled: boolean, reason?: string }
 *
 * Presence in ai_provider_disabled = disabled. Writing { disabled: true }
 * upserts the row; writing { disabled: false } deletes it. Both are
 * idempotent (re-disabling = no-op, re-enabling = delete-of-nothing).
 *
 * The recommender, skill-recommend, and chat-fallback paths all read the
 * filtered list via detectAvailableProviders() in lib/models/providers.ts,
 * so this toggle takes effect on the next dispatch with no redeploy.
 *
 * Auth: Clerk session + ALLOWED_USER_IDS gate.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'
import { setProviderDisabled } from '@/lib/models/provider-toggle'
import type { AiProviderKey } from '@/lib/models/types'

export const runtime = 'nodejs'
export const maxDuration = 15

const VALID_PROVIDERS: ReadonlySet<AiProviderKey> = new Set<AiProviderKey>([
  'anthropic', 'openai', 'google', 'xai', 'deepseek',
  'replicate', 'meta', 'mistral', 'openrouter',
])

interface RouteCtx { params: Promise<{ provider: string }> }

interface PatchBody { disabled?: unknown; reason?: unknown }

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 30, window: '1 m', prefix: 'models:providers:toggle' },
  })
  if ('response' in g) return g.response

  const { provider: providerRaw } = await ctx.params
  const provider = providerRaw.toLowerCase() as AiProviderKey
  if (!VALID_PROVIDERS.has(provider)) {
    return NextResponse.json({ ok: false, error: `unknown provider: ${providerRaw}` }, { status: 200 })
  }

  const body = await req.json().catch(() => ({})) as PatchBody
  const disabled = body.disabled === true
  const reason   = typeof body.reason === 'string' ? body.reason.slice(0, 200) : undefined

  const db = createServerClient()
  if (!db) {
    return NextResponse.json({ ok: false, error: 'supabase_unconfigured' }, { status: 200 })
  }

  const out = await setProviderDisabled(db, g.userId, provider, disabled, reason)
  // setProviderDisabled returns its own degraded marker when migration 082
  // hasn't been applied; surface it as a warning so the UI can prompt the
  // operator to run migrate. Status stays 200 because the call succeeded
  // structurally (the table just doesn't exist yet).
  return NextResponse.json(out, { status: 200 })
}
