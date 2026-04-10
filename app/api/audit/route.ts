/**
 * GET /api/audit — read recent audit log entries (server-side only)
 *
 * Query params:
 *   limit    — max rows (default 50)
 *   resource — filter by resource type ('task', 'agent', 'oauth', 'skill')
 *   action   — filter by action ('board.approve', 'claw.dispatch_phases', …)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAuditLog } from '@/lib/audit'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  const entries = await getAuditLog({
    limit:    parseInt(searchParams.get('limit') ?? '50', 10),
    resource: searchParams.get('resource') ?? undefined,
    action:   searchParams.get('action')   ?? undefined,
    userId:   searchParams.get('userId')   ?? undefined,
  })

  return NextResponse.json({ entries })
}
