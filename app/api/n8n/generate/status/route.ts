/**
 * POST /api/n8n/generate/status
 *
 * Polling companion to POST /api/n8n/generate. When the generate route
 * returns `{ async: true, jobId }` the client polls this endpoint with the
 * jobId AND the original request body. We proxy to the gateway's
 * `GET /api/jobs/:jobId` to read the job state, then run the same finalise
 * pipeline (parse → scaffold-fallback → n8n-write → persist) once the job
 * is done.
 *
 * Body:
 *   { jobId: string, request: GenerateBody }
 *
 * Response variants:
 *   { async: true, jobId, status: 'pending' | 'running', elapsedMs }
 *   { async: false, ...FinalisedResponse }   — when the gateway job finished
 *
 * The original request must be re-sent because finalisation writes a
 * SavedAutomation row that references the user's idea card (description,
 * tools, etc.). Keeping the route stateless avoids an extra Supabase table
 * for short-lived job metadata.
 */
import { NextRequest } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { resolveClaudeCodeConfig } from '@/lib/claw/business-client'
import { getGatewayJob } from '@/lib/claw/gateway-jobs'
import { AGENT_CAPABILITIES } from '@/lib/agent-capabilities'
import { finaliseGeneration, type GenerateBody } from '@/lib/n8n/finalize'

export const runtime = 'nodejs'
export const maxDuration = 60

interface StatusBody {
  jobId:   string
  request: GenerateBody
}

export async function POST(req: NextRequest) {
  let body: StatusBody
  try {
    body = await req.json() as StatusBody
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (!body.jobId || !body.request?.description) {
    return Response.json(
      { error: 'jobId and request.description are required' },
      { status: 400 },
    )
  }

  const { userId: clerkUserId } = await auth().catch(() => ({ userId: null }))
  if (!clerkUserId) {
    return Response.json({ error: 'auth required' }, { status: 401 })
  }

  const cfg = await resolveClaudeCodeConfig(clerkUserId)
  if (!cfg) {
    return Response.json(
      { error: 'gateway not configured — cannot poll a job that was never enqueued' },
      { status: 400 },
    )
  }

  const status = await getGatewayJob({
    gatewayUrl:  cfg.gatewayUrl,
    bearerToken: cfg.bearerToken,
    jobId:       body.jobId,
    userId:      clerkUserId,
    timeoutMs:   10_000,
  })

  if (!status.ok) {
    if (status.http === 404) {
      return Response.json(
        { error: 'job not found — it may have been garbage-collected', http: 404 },
        { status: 404 },
      )
    }
    return Response.json(
      { error: status.error ?? 'gateway status check failed' },
      { status: 502 },
    )
  }

  // Still running — tell the client to keep polling. Include a human-readable
  // phase hint so the UI can show "Queued — waiting for Claude to start" vs
  // "Claude is generating your workflow…" instead of a single generic spinner.
  if (status.status === 'pending' || status.status === 'running') {
    const elapsedMs = status.startedAt
      ? Date.now() - status.startedAt
      : status.createdAt ? Date.now() - status.createdAt : 0
    const phase: 'queued' | 'generating' = status.status === 'pending' ? 'queued' : 'generating'
    const phaseLabel = phase === 'queued'
      ? 'Queued — waiting for Claude to start'
      : `Claude is generating your workflow… (${Math.round(elapsedMs / 1000)}s)`
    return Response.json({
      async:     true,
      jobId:     body.jobId,
      status:    status.status,
      phase,
      phaseLabel,
      elapsedMs,
    })
  }

  // Done (success OR job-level error). Either way we run finalise — when
  // status.text is empty/absent, finalise falls back to the deterministic
  // scaffold so the user gets paste-ready JSON.
  const capabilityIds = body.request.availableCapabilities?.length
    ? body.request.availableCapabilities
    : AGENT_CAPABILITIES.map(c => c.id)

  const finalised = await finaliseGeneration({
    aiText:         status.text || null,
    body:           body.request,
    clerkUserId,
    capabilityIds,
    fallbackReason: status.jobError,
  })

  return Response.json({ async: false, ...finalised })
}
