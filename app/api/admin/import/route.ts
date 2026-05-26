/**
 * POST /api/admin/import — restore an exported JSON dump.
 *
 * Body: { payload: ExportPayload, rewrite_user_id?: boolean }
 * Default rewrite_user_id=true means every row's user_id is replaced
 * with the importing operator's clerk userId — clean when migrating
 * from local-operator to a multi-tenant deployment.
 *
 * Refuses payloads over 50 MB so a malicious operator can't blow up
 * the JSON parser. Refuses schema_version mismatches.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'
import { importData, type ExportPayload } from '@/lib/admin/export-import'

export const runtime    = 'nodejs'
export const maxDuration = 120

interface ImportBody {
  payload?:         ExportPayload
  rewrite_user_id?: boolean
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 3, window: '1 m', prefix: 'admin:import' },
  })
  if ('response' in g) return g.response

  const body = await req.json().catch(() => ({})) as ImportBody
  if (!body.payload) {
    return NextResponse.json({ ok: false, error: 'payload required' })
  }
  const sizeApprox = JSON.stringify(body.payload).length
  if (sizeApprox > 50 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: 'payload_too_large', limit_mb: 50 })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  const out = await importData({
    db,
    targetUserId:  g.userId,
    payload:       body.payload,
    rewriteUserId: body.rewrite_user_id !== false,
  })

  return NextResponse.json(out)
}
