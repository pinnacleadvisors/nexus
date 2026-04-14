/**
 * POST /api/n8n/workflows/[id]/deactivate
 */

import { NextRequest, NextResponse } from 'next/server'
import { deactivateWorkflow, isConfigured } from '@/lib/n8n/client'

export const runtime = 'nodejs'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isConfigured()) {
    return NextResponse.json({ error: 'n8n not configured' }, { status: 503 })
  }
  const { id } = await params
  try {
    await deactivateWorkflow(id)
    return NextResponse.json({ ok: true, id, active: false })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 502 },
    )
  }
}
