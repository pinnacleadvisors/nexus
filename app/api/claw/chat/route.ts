import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const TIMEOUT_MS = 30_000 // chat responses can take longer than webhook fire-and-forget

// ── In-memory rate limiter (per IP, resets on cold start) ────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60_000

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT) return false
  entry.count++
  return true
}

// ── Config resolution: env vars > cookie ─────────────────────────────────────
function resolveConfig(req: NextRequest): { gatewayUrl: string; token: string } | null {
  // Environment variables take priority — set these on the deployment platform
  const envUrl = process.env.OPENCLAW_GATEWAY_URL
  const envToken = process.env.OPENCLAW_BEARER_TOKEN
  if (envUrl && envToken) return { gatewayUrl: envUrl, token: envToken }

  // Fall back to the user-saved HTTP-only cookie (configured via /tools/claw UI)
  const cookie = req.cookies.get('nexus_claw_cfg')
  if (!cookie) return null
  try {
    const { gatewayUrl, hookToken } = JSON.parse(cookie.value) as Record<string, string>
    if (gatewayUrl && hookToken) return { gatewayUrl, token: hookToken }
  } catch {
    return null
  }
  return null
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many requests — try again in a minute.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    )
  }

  const cfg = resolveConfig(req)
  if (!cfg) {
    return NextResponse.json(
      {
        error:
          'OpenClaw not configured. Set OPENCLAW_GATEWAY_URL + OPENCLAW_BEARER_TOKEN environment variables, or save your gateway config on the OpenClaw settings page.',
      },
      { status: 401 },
    )
  }

  let prompt: string
  let sessionId: string
  try {
    const body = await req.json()
    prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : 'main'
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!prompt) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }

  const url = `${cfg.gatewayUrl.replace(/\/$/, '')}/api/sessions/${encodeURIComponent(sessionId)}/messages`

  let response: Response
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify({ role: 'user', content: prompt }),
      signal: controller.signal,
    })
    clearTimeout(timer)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error'
    const isTimeout = msg.includes('abort') || msg.includes('timeout')
    return NextResponse.json(
      { error: isTimeout ? 'Request timed out — is your OpenClaw instance reachable?' : msg },
      { status: 502 },
    )
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return NextResponse.json(
      { error: `Gateway returned ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}` },
      { status: response.status === 401 ? 401 : 502 },
    )
  }

  const data = await response.json()
  return NextResponse.json(data)
}
