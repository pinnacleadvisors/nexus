/**
 * POST /api/n8n/workflows/[id]/activate
 */

import { NextRequest, NextResponse } from 'next/server'
import { activateWorkflow, isConfigured } from '@/lib/n8n/client'

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
    await activateWorkflow(id)
    return NextResponse.json({ ok: true, id, active: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 502 },
    )
  }
}
