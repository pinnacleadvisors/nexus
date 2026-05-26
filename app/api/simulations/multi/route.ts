/**
 * POST /api/simulations/multi — start an A/B comparison (2-4 policies
 * against the same seed). Returns the group_id + an array of run ids.
 *
 * After creation, the operator polls each run individually via the
 * existing /api/simulations/:id/run endpoint OR reads the consolidated
 * /api/simulations/group/:gid summary.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'
import { startAB } from '@/lib/simulation/multi'
import type { ApproverPolicy } from '@/lib/simulation/auto-approver'

export const runtime = 'nodejs'
export const maxDuration = 30

interface MultiBody {
  business_slug?:        string
  policies?:             ApproverPolicy[]
  compress_days?:        number
  wallclock_budget_sec?: number
  synthetic_voice?:      'template' | 'llm'
}

const VALID_POLICIES: ReadonlySet<ApproverPolicy> = new Set(['permissive', 'skeptical', 'random'])
const VALID_VOICES:   ReadonlySet<string>         = new Set(['template', 'llm'])

export async function POST(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 6, window: '1 m', prefix: 'sim:multi' },
  })
  if ('response' in g) return g.response

  const body = await req.json().catch(() => ({})) as MultiBody
  const business_slug = String(body.business_slug ?? '').trim()
  if (!business_slug) return NextResponse.json({ ok: false, error: 'business_slug required' })
  const policies = Array.isArray(body.policies) ? body.policies : []
  if (policies.some(p => !VALID_POLICIES.has(p))) {
    return NextResponse.json({ ok: false, error: 'invalid_policy' })
  }
  const compress_days = Math.max(1, Math.min(365, Number(body.compress_days ?? 30)))
  const wallclock_budget_sec = Math.max(60, Math.min(86_400, Number(body.wallclock_budget_sec ?? 3_600)))
  const voice = (body.synthetic_voice && VALID_VOICES.has(body.synthetic_voice))
    ? body.synthetic_voice
    : 'template'

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  const out = await startAB({
    db,
    userId:               g.userId,
    businessSlug:         business_slug,
    policies,
    compress_days,
    wallclock_budget_sec,
    synthetic_voice:      voice,
  })
  return NextResponse.json(out)
}
