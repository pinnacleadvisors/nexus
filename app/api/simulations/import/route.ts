/**
 * POST /api/simulations/import — create a new run from an exported JSON.
 *
 * Body: { payload: ExportPayload, target_slug?: string }
 *
 * Behavior: inserts a new simulation_runs row with status='pending' and
 * the imported seed. Operator then visits /businesses/<slug>/simulate
 * and clicks Run to actually replay. Same seed = identical timeline.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'
import { importRun, type ExportPayload } from '@/lib/simulation/export'

export const runtime = 'nodejs'
export const maxDuration = 30

interface ImportBody {
  payload?:     ExportPayload
  target_slug?: string
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 10, window: '1 m', prefix: 'sim:import' },
  })
  if ('response' in g) return g.response

  const body = await req.json().catch(() => ({})) as ImportBody
  if (!body.payload) return NextResponse.json({ ok: false, error: 'payload required' })

  // Soft size cap — typical exports are <500KB; refuse anything > 5MB
  // so a malicious operator can't ingest a multi-GB blob.
  const sizeApprox = JSON.stringify(body.payload).length
  if (sizeApprox > 5 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: 'payload_too_large' })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  const out = await importRun({
    db,
    userId:     g.userId,
    payload:    body.payload,
    targetSlug: body.target_slug,
  })
  return NextResponse.json(out)
}
