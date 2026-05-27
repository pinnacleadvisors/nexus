/**
 * GET  /api/llm-provider/active — return the operator's active LLM provider.
 * PATCH /api/llm-provider/active — set the active LLM provider.
 *
 * Body for PATCH:
 *   { provider: 'claude' | 'openrouter' | 'mimo' | 'ollama', model?: string, reason?: string }
 *
 * The dynamic setting overrides the Doppler LLM_PROVIDER env var. On flip,
 * the in-memory cache invalidates so the next getLlm() call in the same
 * process picks up the new value within ~1 round-trip (no redeploy).
 *
 * Auth: Clerk session + ALLOWED_USER_IDS gate. PATCH is rate-limited tight
 * (5/min) to discourage thrashing — a flip lands within seconds, no need
 * to spam.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { getActiveProvider, setActiveProvider } from '@/lib/llm/provider-settings'
import type { LlmProvider } from '@/lib/llm/provider'

export const runtime = 'nodejs'
export const maxDuration = 10

const VALID_PROVIDERS: ReadonlySet<LlmProvider> = new Set(['claude', 'openrouter', 'mimo', 'ollama', 'nim'])

interface PatchBody { provider?: unknown; model?: unknown; reason?: unknown }

export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 60, window: '1 m', prefix: 'llm-provider:active:get' },
  })
  if ('response' in g) return g.response

  const active = await getActiveProvider(g.userId)
  return NextResponse.json({
    ok:       true,
    provider: active.provider,
    model:    active.model,
    reason:   active.reason,
    source:   active.source,            // 'db' | 'env' | 'default'
    // Echo env so the UI can show "Doppler says X; you've overridden to Y"
    envProvider: process.env.LLM_PROVIDER ?? null,
  })
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 5, window: '1 m', prefix: 'llm-provider:active:set' },
  })
  if ('response' in g) return g.response

  const body = await req.json().catch(() => ({})) as PatchBody
  const rawProvider = typeof body.provider === 'string' ? body.provider.toLowerCase().trim() : ''
  if (!VALID_PROVIDERS.has(rawProvider as LlmProvider)) {
    return NextResponse.json({
      ok:    false,
      error: 'invalid_provider',
      hint:  'provider must be one of: claude, openrouter, mimo, ollama, nim',
    })
  }
  const provider = rawProvider as LlmProvider
  const model    = typeof body.model  === 'string' ? body.model.trim().slice(0, 100) : null
  const reason   = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : null

  const out = await setActiveProvider(g.userId, provider, { model, reason })
  if (!out.ok) {
    return NextResponse.json({
      ok:        false,
      error:     out.error,
      degraded:  out.degraded,
      hint:      out.degraded
        ? 'Migration 083 not applied. Run `doppler run -- npm run migrate` then retry.'
        : undefined,
    })
  }
  return NextResponse.json({ ok: true, record: out.record })
}
