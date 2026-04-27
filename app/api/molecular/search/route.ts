/**
 * POST /api/molecular/search — E5
 *
 * Body:
 *   {
 *     query:     string
 *     k?:        number   // default 12, max 50
 *     graphOnly?: boolean
 *     autoTouch?: boolean // default true (E3)
 *   }
 *
 * Returns hybrid retrieval hits combining the symbolic graph with the QMD
 * sidecar. Owner-gated. Rate-limited per user. Auto-bumps decay frontmatter on
 * matched atoms unless `autoTouch:false`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { hybridSearch } from '@/lib/molecular/hybrid'
import { qmdStatus } from '@/lib/molecular/qmd-client'

export const runtime = 'nodejs'

interface SearchBody {
  query?:     string
  k?:         number
  graphOnly?: boolean
  autoTouch?: boolean
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'molecular-search' })
  if (!rl.success) return rateLimitResponse(rl)

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: SearchBody
  try { body = (await req.json()) as SearchBody }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  const query = body.query?.trim()
  if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 })

  const result = await hybridSearch(query, {
    k:         body.k,
    graphOnly: body.graphOnly,
    autoTouch: body.autoTouch,
  })

  audit(req, {
    action:   'molecular.search',
    resource: 'memory',
    metadata: {
      query:    query.slice(0, 200),
      hits:     result.hits.length,
      used:     result.used,
      latency:  result.latency,
      errors:   result.errors.length,
    },
  })

  return NextResponse.json({ ok: true, ...result })
}

/** GET /api/molecular/search/health — quick reachability for QMD. */
export async function GET() {
  const status = await qmdStatus()
  return NextResponse.json({ ok: true, qmd: status })
}
