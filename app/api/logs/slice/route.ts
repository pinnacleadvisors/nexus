/**
 * POST /api/logs/slice
 *
 * Bot-only — returns a markdown slice of the last `windowSeconds` of Vercel
 * function logs anchored to now. Used by the qa-runner orchestrator on a
 * smoke failure to attach server-side context to the gateway dispatch brief.
 *
 * Body:
 *   { windowSeconds?: number = 30, deploymentId?: string, requestId?: string,
 *     route?: string, level?: string, maxLines?: number = 80 }
 *
 * Auth: `Authorization: Bearer <BOT_API_TOKEN>` only — log slices contain
 * potentially sensitive context (request IDs, status codes, route paths). No
 * Clerk session path; this is for automation only.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { authBotToken } from '@/lib/auth/bot'
import { attachLogsToBrief } from '@/lib/logs/vercel'

export const runtime = 'nodejs'

interface SliceBody {
  windowSeconds?: number
  deploymentId?:  string
  requestId?:     string
  maxLines?:      number
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const userId = authBotToken(req)
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body: SliceBody = {}
  try { body = (await req.json()) as SliceBody } catch { /* tolerate empty */ }

  const markdown = await attachLogsToBrief({
    windowSeconds: body.windowSeconds,
    deploymentId:  body.deploymentId,
    requestId:     body.requestId,
    maxLines:      body.maxLines,
  })

  return NextResponse.json({ ok: true, markdown })
}
