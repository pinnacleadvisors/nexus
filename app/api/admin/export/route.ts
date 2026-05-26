/**
 * GET /api/admin/export — operator-only data dump for cross-machine
 * migration (Phase 5 of task_plan-desktop-app.md).
 *
 * Returns Content-Disposition: attachment so the browser saves it as a
 * file. The format is documented in lib/admin/export-import.ts; bump
 * EXPORT_SCHEMA_VERSION there to evolve.
 *
 * Includes every operator-built record: businesses, agents, goals,
 * issues, simulation runs/events/benchmarks, operator_tasks,
 * learning_cards, memories. Intentionally EXCLUDES secrets,
 * token_events (observability noise), and run_events (verbose).
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'
import { exportData } from '@/lib/admin/export-import'

export const runtime    = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 5, window: '1 m', prefix: 'admin:export' },
  })
  if ('response' in g) return g.response

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  const payload = await exportData(db, g.userId)
  const stamp   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const totalRows = Object.values(payload.counts).reduce((s, n) => s + n, 0)
  const filename = `nexus-export-${stamp}-${totalRows}rows.json`

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type':        'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control':       'no-store',
    },
  })
}
