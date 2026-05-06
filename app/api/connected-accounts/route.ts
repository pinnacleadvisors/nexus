/**
 * GET /api/connected-accounts?businessSlug=<slug>
 *
 * Lists active OAuth connections for the current user, optionally scoped to
 * one business. The client is a Server Component or fetch from the Settings →
 * Accounts page; we never expose Composio account IDs in URLs or hash params.
 *
 * Returns:
 *   { accounts: Array<{
 *       id: string, platform: string, businessSlug: string|null,
 *       status: 'active'|'revoked'|'error',
 *       createdAt: string, lastUsedAt: string|null
 *   }> }
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { createServerClient } from '@/lib/supabase'
import { isBusinessSlug } from '@/lib/claw/business-client'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'connected-accounts:list' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const businessSlug = new URL(req.url).searchParams.get('businessSlug')
  if (businessSlug && !isBusinessSlug(businessSlug)) {
    return NextResponse.json({ error: 'invalid businessSlug' }, { status: 400 })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ accounts: [] })

  // Build the query without `any` casts — narrow the chain explicitly.
  type AccountRow = {
    id:                  string
    platform:            string
    business_slug:       string | null
    status:              'active' | 'revoked' | 'error'
    created_at:          string
    last_used_at:        string | null
  }
  type SelectChain = { eq: (col: string, val: unknown) => SelectChain; order: (col: string, opts: { ascending: boolean }) => Promise<{ data: AccountRow[] | null; error: { message: string } | null }> }

  let q = (db.from('connected_accounts' as never) as unknown as {
    select: (cols: string) => SelectChain
  }).select('id, platform, business_slug, status, created_at, last_used_at')
    .eq('user_id', session.userId)
    .eq('status', 'active')

  if (businessSlug) q = q.eq('business_slug', businessSlug)

  const { data, error } = await q.order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    accounts: (data ?? []).map(r => ({
      id:           r.id,
      platform:     r.platform,
      businessSlug: r.business_slug,
      status:       r.status,
      createdAt:    r.created_at,
      lastUsedAt:   r.last_used_at,
    })),
  })
}
