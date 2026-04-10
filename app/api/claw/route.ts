import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'

export const runtime = 'nodejs'

const CONFIG_COOKIE = 'nexus_claw_cfg'
const TIMEOUT_MS    = 20_000

// ── Daily dispatch cap (agent cost control) ───────────────────────────────────
const dispatchCounter = { count: 0, resetAt: Date.now() + 86_400_000 }

function checkDispatchCap(): { allowed: boolean; remaining: number } {
  const cap = parseInt(process.env.CLAW_DAILY_DISPATCH_CAP ?? '100')
  const now = Date.now()
  if (now > dispatchCounter.resetAt) {
    dispatchCounter.count  = 0
    dispatchCounter.resetAt = now + 86_400_000
  }
  if (dispatchCounter.count >= cap) return { allowed: false, remaining: 0 }
  dispatchCounter.count++
  return { allowed: true, remaining: cap - dispatchCounter.count }
}

// ── HMAC request signing ──────────────────────────────────────────────────────
async function signPayload(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return 'sha256=' + Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── Config resolution ─────────────────────────────────────────────────────────
function resolveConfig(req: NextRequest): { gatewayUrl: string; hookToken: string } | null {
  const envUrl   = process.env.OPENCLAW_GATEWAY_URL
  const envToken = process.env.OPENCLAW_BEARER_TOKEN
  if (envUrl && envToken) return { gatewayUrl: envUrl, hookToken: envToken }

  const cookie = req.cookies.get(CONFIG_COOKIE)
  if (!cookie) return null
  try {
    const { gatewayUrl, hookToken } = JSON.parse(cookie.value) as Record<string, string>
    if (gatewayUrl && hookToken) return { gatewayUrl, hookToken }
  } catch { /* fall through */ }
  return null
}

// ── Shared outbound fetch helper ──────────────────────────────────────────────
async function callGateway(
  url: string,
  bodyStr: string,
  hookToken: string,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const signature = await signPayload(bodyStr, hookToken)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type':     'application/json',
        'Authorization':    `Bearer ${hookToken}`,
        'X-Nexus-Signature': signature,
        'X-Nexus-Timestamp': Date.now().toString(),
      },
      body: bodyStr,
      signal: controller.signal,
    })
    clearTimeout(timer)
    let body: unknown
    try { body = await res.json() } catch { body = null }
    return { ok: res.ok, status: res.status, body }
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Per-IP rate limit (Upstash when configured, in-memory fallback)
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'claw' })
  if (!rl.success) return rateLimitResponse(rl)

  // Read config
  const cfg = resolveConfig(req)
  if (!cfg) {
    return NextResponse.json(
      { error: 'OpenClaw not configured. Save your gateway URL and hook token first.' },
      { status: 401 },
    )
  }
  const { gatewayUrl, hookToken } = cfg
  const base = gatewayUrl.replace(/\/$/, '')

  const { action, payload } = await req.json() as {
    action: string
    payload: Record<string, unknown>
  }

  // ── dispatch_phases: fire separate sessions per phase (multi-agent) ───────
  if (action === 'dispatch_phases') {
    type PhasePayload = {
      phase: number
      milestones: Array<{ title: string; description: string; targetDate?: string }>
      projectName: string
      projectId?: string
    }
    const phases = (payload.phases ?? []) as PhasePayload[]
    if (!phases.length) {
      return NextResponse.json({ error: 'No phases provided' }, { status: 400 })
    }

    // Check dispatch cap for the batch
    const capCheck = checkDispatchCap()
    if (!capCheck.allowed) {
      return NextResponse.json(
        { error: `Daily dispatch cap reached (${process.env.CLAW_DAILY_DISPATCH_CAP ?? 100}/day). Reset at midnight.` },
        { status: 429 },
      )
    }

    const results = await Promise.allSettled(
      phases.map(async (p) => {
        const sessionId = `nexus-phase-${p.phase}-${p.projectId ?? 'default'}`
        const milestoneList = p.milestones
          .map(m => `  • ${m.title}: ${m.description}${m.targetDate ? ` (target: ${m.targetDate})` : ''}`)
          .join('\n')
        const message = [
          `Phase ${p.phase} agent dispatched from Nexus.`,
          `Project: ${p.projectName}`,
          ``,
          `Your milestones for this phase:`,
          milestoneList,
          ``,
          `Execute these autonomously. When you complete an asset, POST to ${base}/hooks/complete with the asset URL and task details.`,
        ].join('\n')

        const url     = `${base}/api/sessions/${encodeURIComponent(sessionId)}/messages`
        const bodyStr = JSON.stringify({ role: 'user', content: message })
        const result  = await callGateway(url, bodyStr, hookToken)
        return { phase: p.phase, sessionId, ...result }
      }),
    )

    audit(req, {
      action: 'claw.dispatch_phases',
      resource: 'agent',
      metadata: { phaseCount: phases.length, projectName: phases[0]?.projectName },
    })
    return NextResponse.json({
      ok: true,
      phases: results.map((r, i) =>
        r.status === 'fulfilled'
          ? r.value
          : { phase: phases[i].phase, ok: false, error: 'dispatch_failed' },
      ),
    })
  }

  // ── code: dispatch a code-generation task to Claude Code CLI ─────────────
  if (action === 'code') {
    const capCheck = checkDispatchCap()
    if (!capCheck.allowed) {
      return NextResponse.json(
        { error: `Daily dispatch cap reached. Resets at midnight.` },
        { status: 429 },
      )
    }

    const url     = `${base}/hooks/code`
    const bodyStr = JSON.stringify(payload)
    try {
      const result = await callGateway(url, bodyStr, hookToken)
      if (result.ok) return NextResponse.json({ ok: true, remaining: capCheck.remaining })
      return NextResponse.json(
        { error: `OpenClaw returned ${result.status}` },
        { status: result.status === 401 ? 401 : 502 },
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error'
      const isTimeout = msg.includes('abort') || msg.includes('timeout')
      return NextResponse.json(
        { error: isTimeout ? 'Request timed out' : msg },
        { status: 502 },
      )
    }
  }

  // ── wake / agent: existing hook dispatch ──────────────────────────────────
  if (action !== 'wake' && action !== 'agent') {
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }

  // Apply dispatch cap to agent dispatches (not wake pings)
  if (action === 'agent') {
    const capCheck = checkDispatchCap()
    if (!capCheck.allowed) {
      return NextResponse.json(
        { error: `Daily dispatch cap reached. Resets at midnight.` },
        { status: 429 },
      )
    }
  }

  const endpoint = action === 'wake' ? '/hooks/wake' : '/hooks/agent'
  const url      = `${base}${endpoint}`
  const bodyStr  = JSON.stringify(payload)

  try {
    const result = await callGateway(url, bodyStr, hookToken)
    if (result.ok) return NextResponse.json({ ok: true, status: result.status })
    return NextResponse.json(
      { error: `OpenClaw returned ${result.status}` },
      { status: result.status === 401 ? 401 : 502 },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error'
    const isTimeout = msg.includes('abort') || msg.includes('timeout')
    return NextResponse.json(
      { error: isTimeout ? 'Request timed out — is your MyClaw instance reachable?' : msg },
      { status: 502 },
    )
  }
}

// ── GET — return current dispatch cap status ──────────────────────────────────
export async function GET() {
  const cap       = parseInt(process.env.CLAW_DAILY_DISPATCH_CAP ?? '100')
  const used      = dispatchCounter.count
  const remaining = Math.max(0, cap - used)
  const resetAt   = new Date(dispatchCounter.resetAt).toISOString()
  return NextResponse.json({ cap, used, remaining, resetAt })
}
