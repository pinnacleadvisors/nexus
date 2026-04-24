/**
 * GET /api/n8n/workflows
 * Proxies listWorkflows() from the n8n client and returns the workflow list.
 */

import { NextResponse } from 'next/server'
import { getBaseUrl, isConfigured, listWorkflows } from '@/lib/n8n/client'

export const runtime = 'nodejs'

export async function GET() {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: 'n8n not configured — set N8N_BASE_URL and N8N_API_KEY in Doppler' },
      { status: 503 },
    )
  }

  try {
    const workflows = await listWorkflows()
    return NextResponse.json({ workflows, total: workflows.length, baseUrl: getBaseUrl() })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message, baseUrl: getBaseUrl() }, { status: 502 })
  }
}
