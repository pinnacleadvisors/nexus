/**
 * POST /api/webhooks/claw
 *
 * Receives task completion / asset creation events from the OpenClaw agent.
 * - Verifies HMAC-SHA256 signature (X-Nexus-Signature header)
 * - On task_completed / asset_created → creates a Kanban card in Review column
 * - Returns 200 immediately so the agent isn't blocked waiting for DB writes
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import type { ClawEvent } from '@/lib/types'
import { audit } from '@/lib/audit'

export const runtime = 'nodejs'

// ── HMAC verification ─────────────────────────────────────────────────────────
async function verifySignature(body: string, header: string, secret: string): Promise<boolean> {
  // header format: "sha256=<hex>"
  const expected = header.startsWith('sha256=') ? header : `sha256=${header}`

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const raw = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const computed = 'sha256=' + Array.from(new Uint8Array(raw))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  // Constant-time comparison
  if (computed.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

// ── Resolve the hook token used to verify inbound signatures ──────────────────
function resolveHookToken(req: NextRequest): string | null {
  // env var takes priority
  if (process.env.OPENCLAW_BEARER_TOKEN) return process.env.OPENCLAW_BEARER_TOKEN
  // fall back to cookie-stored config
  const cookie = req.cookies.get('nexus_claw_cfg')
  if (!cookie) return null
  try {
    const { hookToken } = JSON.parse(cookie.value) as { hookToken?: string }
    return hookToken ?? null
  } catch { return null }
}

export async function POST(req: NextRequest) {
  const bodyText = await req.text()

  // Signature verification (skip if no token is configured yet)
  const hookToken = resolveHookToken(req)
  if (hookToken) {
    const sigHeader = req.headers.get('x-nexus-signature')
      ?? req.headers.get('x-claw-signature')
      ?? ''
    if (!sigHeader) {
      return NextResponse.json({ error: 'Missing signature header' }, { status: 401 })
    }
    const valid = await verifySignature(bodyText, sigHeader, hookToken)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  // Parse event
  let event: ClawEvent
  try {
    event = JSON.parse(bodyText) as ClawEvent
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { type, payload } = event

  // ── Auto-create Kanban card in Review column ──────────────────────────────
  if (type === 'task_completed' || type === 'asset_created') {
    const db = createServerClient()
    if (db) {
      // Fire-and-forget — don't block the 200 response
      db.from('tasks')
        .insert({
          title:         String(payload.title ?? 'Agent Task Completed'),
          description:   String(payload.description ?? ''),
          column_id:     'review',
          assignee:      String(payload.agentName ?? 'OpenClaw'),
          priority:      'medium',
          asset_url:     payload.assetUrl    ? String(payload.assetUrl)    : null,
          project_id:    payload.projectId   ? String(payload.projectId)   : null,
          milestone_id:  payload.milestoneId ? String(payload.milestoneId) : null,
          // Lineage stamps — caller should pass these on the OpenClaw event
          // payload when known so the orphan sweeper can find these cards
          // when their idea/run is deleted.
          idea_id:       payload.ideaId       ? String(payload.ideaId)       : null,
          run_id:        payload.runId        ? String(payload.runId)        : null,
          business_slug: payload.businessSlug ? String(payload.businessSlug) : null,
        })
        .then(({ error }) => {
          if (error) console.error('[claw webhook] task insert failed:', error.message)
        })
    }
  }

  audit(req, {
    action: `claw.${type}`,
    resource: 'agent',
    resourceId: String(payload.agentName ?? event.sessionId ?? ''),
    metadata: {
      title:       payload.title,
      projectId:   payload.projectId,
      milestoneId: payload.milestoneId,
      assetUrl:    payload.assetUrl,
    },
  })

  return NextResponse.json({ ok: true, received: type })
}
