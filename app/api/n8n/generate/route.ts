/**
 * POST /api/n8n/generate
 *
 * Generates a valid n8n v1 workflow using Claude as the architect. Two flows:
 *   - workflowType: 'build'    — one-shot pipeline that stands the project up
 *   - workflowType: 'maintain' — recurring pipeline that runs after launch
 *
 * Two execution paths:
 *   1. Async via gateway (PREFERRED)  — `enqueueGatewayJob` returns a jobId in
 *      <1s; the client polls `/api/n8n/generate/status` until done. No Vercel
 *      timeout pressure because the heavy lifting runs on the self-hosted
 *      Claude Code gateway (Hostinger+Coolify, plan-billed).
 *   2. Sync fallback (gateway unavailable) — `tryGateway` (55s) → API key
 *      generateText (60s) → deterministic scaffold. Capped at maxDuration.
 *
 * Body:
 *   { description, businessContext?, templateId?, projectId?, ideaId?,
 *     workflowType?, availableCapabilities?, steps?, tools?, howItMakesMoney?,
 *     runId? }
 *
 * Response (sync path):
 *   { workflow, workflowType, checklist, explanation, importUrl?, importedId?,
 *     importError?, gapAnalysis, automation?, fallbackUsed, fallbackReason?,
 *     aiRaw? }
 *
 * Response (async path):
 *   { async: true, jobId, gatewayConfigured: true, status: 'pending' }
 *   Client must POST to /api/n8n/generate/status with { jobId, request } to poll.
 */

import { NextRequest } from 'next/server'
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { tryGateway } from '@/lib/claw/llm'
import { resolveClaudeCodeConfig } from '@/lib/claw/business-client'
import { isGatewayHealthy } from '@/lib/claw/health'
import { enqueueGatewayJob } from '@/lib/claw/gateway-jobs'
import { auth } from '@clerk/nextjs/server'
import { audit } from '@/lib/audit'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { getTemplate } from '@/lib/n8n/templates'
import { AGENT_CAPABILITIES } from '@/lib/agent-capabilities'
import { buildSystemPrompt, buildUserPrompt } from '@/lib/n8n/prompts'
import { finaliseGeneration, type GenerateBody } from '@/lib/n8n/finalize'

export const maxDuration = 300
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 5, window: '1 m', prefix: 'n8n-gen' })
  if (!rl.success) return rateLimitResponse(rl)

  const body = await req.json() as GenerateBody

  if (!body.description?.trim()) {
    return Response.json({ error: 'description is required' }, { status: 400 })
  }

  const workflowType = body.workflowType ?? 'build'
  const { userId: clerkUserId } = await auth().catch(() => ({ userId: null }))
  const capabilityIds = body.availableCapabilities?.length
    ? body.availableCapabilities
    : AGENT_CAPABILITIES.map(c => c.id)

  const baseTemplate = body.templateId ? getTemplate(body.templateId) : undefined
  const systemPrompt = buildSystemPrompt(workflowType, capabilityIds)
  const userPrompt   = buildUserPrompt({
    description:             body.description.trim(),
    workflowType,
    businessContext:         body.businessContext,
    baseTemplateName:        baseTemplate?.name,
    baseTemplateDescription: baseTemplate?.description,
  })

  audit(req, {
    action:     'n8n.generate',
    resource:   'workflow',
    resourceId: workflowType,
    metadata:   { description: body.description.slice(0, 100), workflowType },
  })

  // ── Path 1: async via gateway ──────────────────────────────────────────
  // Try this FIRST. The gateway runs the heavy CLI generation without any
  // Vercel-side timeout pressure; we just enqueue and hand the client a
  // jobId. The client polls /api/n8n/generate/status to pick up the result.
  if (clerkUserId) {
    const cfg = await resolveClaudeCodeConfig(clerkUserId)
    if (cfg && await isGatewayHealthy(cfg.gatewayUrl)) {
      const enq = await enqueueGatewayJob({
        gatewayUrl:  cfg.gatewayUrl,
        bearerToken: cfg.bearerToken,
        userId:      clerkUserId,
        sessionTag:  'n8n-generate',
        message:     `${systemPrompt}\n\n---\n\n${userPrompt}`,
        timeoutMs:   10_000,
      })
      if (enq.ok && enq.jobId) {
        return Response.json({
          async:             true,
          jobId:             enq.jobId,
          gatewayConfigured: true,
          status:            'pending',
          workflowType,
        })
      }
      console.warn('[n8n/generate] gateway enqueue failed, falling back to sync:',
        enq.error ?? `http ${enq.http}`)
    }
  }

  // ── Path 2: sync fallback ──────────────────────────────────────────────
  // Gateway is down / not configured / enqueue failed. Run the AI inline
  // within the Vercel function's maxDuration window. If that also fails,
  // finaliseGeneration emits a deterministic scaffold so the user always
  // gets paste-ready JSON.
  let aiText = ''
  let fallbackReason: string | undefined

  if (clerkUserId) {
    const gw = await tryGateway({
      userId:     clerkUserId,
      system:     systemPrompt,
      prompt:     userPrompt,
      sessionTag: 'n8n-generate',
      timeoutMs:  55_000,
    })
    if (gw.ok) aiText = gw.text
  }
  if (!aiText && process.env.ANTHROPIC_API_KEY) {
    try {
      const ac    = new AbortController()
      const timer = setTimeout(() => ac.abort(), 60_000)
      try {
        const result = await generateText({
          model:           anthropic('claude-sonnet-4-6'),
          system:          systemPrompt,
          messages:        [{ role: 'user', content: userPrompt }],
          maxOutputTokens: 2000,
          abortSignal:     ac.signal,
        })
        aiText = result.text
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      fallbackReason = err instanceof Error ? err.message : 'AI generation failed'
      console.error('[n8n/generate] AI call failed:', err)
    }
  }
  if (!aiText) fallbackReason = fallbackReason ?? 'No Claude provider available'

  const finalised = await finaliseGeneration({
    aiText:         aiText || null,
    body,
    clerkUserId,
    capabilityIds,
    fallbackReason,
  })

  return Response.json(finalised)
}
