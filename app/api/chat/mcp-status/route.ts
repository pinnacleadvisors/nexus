/**
 * /api/chat/mcp-status
 *
 * GET — return the MCP server summary for a given chat scope.
 *
 * Audit 2026-05-16 Section 6 #6: "operator should see what's powering the
 * chat before they ask anything." V1 returns the manifested set + the
 * gateway's overall health. V2 (deferred) does live list_tools per MCP.
 *
 * Query:
 *   ?scope=platform                — admin chat (/manage-platform)
 *   ?scope=business:<slug>         — per-business chat (/businesses/:slug/chat)
 *
 * Owner-gated like the rest of the chat infrastructure. Per-business scope
 * also requires the caller to own that business (checked via getBusinessBySlug).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { listBusinessesForUser } from '@/lib/business/db'
import { getPlatformMcpSummary, getBusinessMcpSummary } from '@/lib/chat/mcp-summary'

export const runtime    = 'nodejs'
export const maxDuration = 10

function parseScope(raw: string | null): { kind: 'platform' } | { kind: 'business'; slug: string } | null {
  if (!raw) return null
  if (raw === 'platform') return { kind: 'platform' }
  if (raw.startsWith('business:')) {
    const slug = raw.slice('business:'.length)
    if (/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) return { kind: 'business', slug }
  }
  return null
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'chat:mcp-status' })
  if (!rl.success) return rateLimitResponse(rl)

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const scope = parseScope(new URL(req.url).searchParams.get('scope'))
  if (!scope) {
    return NextResponse.json(
      { ok: false, error: 'scope query param required: "platform" or "business:<slug>"' },
      { status: 400 },
    )
  }

  if (scope.kind === 'platform') {
    return NextResponse.json({ ok: true, summary: getPlatformMcpSummary() })
  }

  // Per-business: verify the operator owns this business before disclosing
  // the manifest. listBusinessesForUser is the user-gated path; using it
  // avoids leaking another operator's business config via slug guess.
  const owned = await listBusinessesForUser(userId)
  const biz   = owned.find(b => b.slug === scope.slug)
  if (!biz) {
    return NextResponse.json({ ok: false, error: 'business not found' }, { status: 404 })
  }
  return NextResponse.json({
    ok:      true,
    summary: getBusinessMcpSummary({
      slug:        biz.slug,
      niche:       biz.niche,
      moneyModel:  biz.money_model?.thesis ?? null,
    }),
  })
}
