/**
 * POST /api/molecular/touch — E3
 *
 * Body:
 *   { slug: string }            // single atom
 *   { slugs: string[] }         // bulk (max 50)
 *   { nodeIds: string[] }       // graph node IDs (`mem-<slug>`) — used by retrievers
 *
 * Owner-gated (Clerk auth). Bumps `lastAccessed` + `accessCount` on the atom
 * frontmatter. Files are stored on disk so on Vercel this only works during
 * builds / cron jobs that have a writable workspace. For ephemeral touches in
 * production, prefer calling the in-process helper from `lib/molecular/decay.ts`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { touchAtom, touchAtomsByNodeIds, type TouchResult } from '@/lib/molecular/decay'

export const runtime = 'nodejs'

interface TouchBody {
  slug?:    string
  slugs?:   string[]
  nodeIds?: string[]
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'molecular-touch' })
  if (!rl.success) return rateLimitResponse(rl)

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: TouchBody
  try { body = (await req.json()) as TouchBody }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }) }

  const results: TouchResult[] = []

  if (body.slug) {
    results.push(await touchAtom(body.slug))
  }
  if (Array.isArray(body.slugs)) {
    const slice = body.slugs.slice(0, 50)
    for (const s of slice) results.push(await touchAtom(s))
  }
  if (Array.isArray(body.nodeIds)) {
    const slice = body.nodeIds.slice(0, 50)
    const out = await touchAtomsByNodeIds(slice)
    results.push(...out)
  }

  if (results.length === 0) {
    return NextResponse.json({ error: 'pass slug, slugs, or nodeIds' }, { status: 400 })
  }

  audit(req, {
    action:   'molecular.touch',
    resource: 'memory_atom',
    metadata: {
      requested: results.length,
      ok:        results.filter(r => r.ok).length,
    },
  })

  return NextResponse.json({ ok: true, results })
}
