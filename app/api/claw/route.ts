import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const CONFIG_COOKIE = 'nexus_claw_cfg'
const TIMEOUT_MS = 15_000

// ── In-memory rate limiter (per IP, resets on cold start) ────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 30        // max requests
const RATE_WINDOW_MS = 60_000 // per minute

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
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Rate limiting
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many requests — try again in a minute.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    )
  }

  // Read config from server-side cookie (token never exposed to client)
  const configCookie = req.cookies.get(CONFIG_COOKIE)
  if (!configCookie) {
    return NextResponse.json(
      { error: 'OpenClaw not configured. Save your gateway URL and hook token first.' },
      { status: 401 },
    )
  }

  let gatewayUrl: string
  let hookToken: string
  try {
    ;({ gatewayUrl, hookToken } = JSON.parse(configCookie.value))
  } catch {
    return NextResponse.json({ error: 'Corrupt config cookie — please reconnect.' }, { status: 400 })
  }

  const { action, payload } = await req.json()
  if (action !== 'wake' && action !== 'agent') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const endpoint = action === 'wake' ? '/hooks/wake' : '/hooks/agent'
  const url = `${gatewayUrl.replace(/\/$/, '')}${endpoint}`
  const bodyStr = JSON.stringify(payload)

  // Sign the outbound request body with the hook token as HMAC secret
  const signature = await signPayload(bodyStr, hookToken)

  let response: Response
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${hookToken}`,
        'X-Nexus-Signature': `sha256=${signature}`,
        'X-Nexus-Timestamp': Date.now().toString(),
      },
      body: bodyStr,
      signal: controller.signal,
    })
    clearTimeout(timer)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error'
    const isTimeout = msg.includes('abort') || msg.includes('timeout')
    return NextResponse.json(
      { error: isTimeout ? 'Request timed out — is your MyClaw instance reachable?' : msg },
      { status: 502 },
    )
  }

  if (response.ok) return NextResponse.json({ ok: true, status: response.status })

  return NextResponse.json(
    { error: `OpenClaw returned ${response.status}` },
    { status: response.status === 401 ? 401 : 502 },
  )
}
