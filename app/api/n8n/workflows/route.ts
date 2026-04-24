/**
 * GET /api/n8n/workflows
 * Proxies listWorkflows() from the n8n client and returns the workflow list.
 */

import { NextResponse } from 'next/server'
import { getBaseUrl, isConfigured, listWorkflows } from '@/lib/n8n/client'

export const runtime = 'nodejs'

export async function GET() {
  if (!isConfigured()) {
    // Return 200 with empty list + error field so the UI can display a
    // friendly banner without the browser logging a 5xx as a console error.
    // The `configured: false` flag lets callers disambiguate from an
    // unreachable-but-configured instance.
    return NextResponse.json({
      workflows: [],
      total: 0,
      configured: false,
      error: 'n8n not configured — set N8N_BASE_URL and N8N_API_KEY in Doppler',
    })
  }

  try {
    const workflows = await listWorkflows()
    return NextResponse.json({
      workflows,
      total: workflows.length,
      configured: true,
      baseUrl: getBaseUrl(),
    })
  } catch (err) {
    // Unreachable or API error. Respond 200 with error payload so the UI can
    // render a warning without surfacing a 502 in the browser console — the
    // `error` field drives the banner in components/tools/n8n.
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({
      workflows: [],
      total: 0,
      configured: true,
      error: message,
      baseUrl: getBaseUrl(),
    })
  }
}
