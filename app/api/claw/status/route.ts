/**
 * GET /api/claw/status?session=<id>
 *
 * Proxies a status request to the OpenClaw gateway and returns:
 *  - configured: boolean
 *  - online: boolean
 *  - sessions: ClawSession[]  (from gateway or synthetic fallback)
 *  - currentTask?: string
 */
import { NextRequest, NextResponse } from 'next/server'
import type { ClawSession } from '@/lib/types'

export const runtime = 'nodejs'

function resolveConfig(req: NextRequest): { gatewayUrl: string; token: string } | null {
  const envUrl   = process.env.OPENCLAW_GATEWAY_URL
  const envToken = process.env.OPENCLAW_BEARER_TOKEN
  if (envUrl && envToken) return { gatewayUrl: envUrl, token: envToken }

  const cookie = req.cookies.get('nexus_claw_cfg')
  if (!cookie) return null
  try {
    const { gatewayUrl, hookToken } = JSON.parse(cookie.value) as Record<string, string>
    if (gatewayUrl && hookToken) return { gatewayUrl, token: hookToken }
  } catch { /* fall through */ }
  return null
}

const FALLBACK_SESSIONS: ClawSession[] = [
  { id: 'main',          name: 'Main Agent',    status: 'idle' },
  { id: 'nexus-phase-1', name: 'Phase 1 Agent', status: 'idle' },
  { id: 'nexus-phase-2', name: 'Phase 2 Agent', status: 'idle' },
  { id: 'nexus-phase-3', name: 'Phase 3 Agent', status: 'idle' },
]

export async function GET(req: NextRequest) {
  const cfg = resolveConfig(req)
  if (!cfg) return NextResponse.json({ configured: false, online: false, sessions: [] })

  const sessionId = req.nextUrl.searchParams.get('session') ?? 'main'
  const base      = cfg.gatewayUrl.replace(/\/$/, '')

  try {
    // Try fetching session list from gateway
    const listRes = await fetch(`${base}/api/sessions`, {
      headers:{ Authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(8_000),
    })

    if (!listRes.ok) {
      return NextResponse.json({
        configured: true,
        online: false,
        sessions: FALLBACK_SESSIONS,
        error: `Gateway ${listRes.status}`,
      })
    }

    const raw = await listRes.json() as { sessions?: ClawSession[] } | ClawSession[]
    const sessions: ClawSession[] = Array.isArray(raw)
      ? raw
      : (raw.sessions ?? FALLBACK_SESSIONS)

    // Try fetching current session status
    let currentTask: string | undefined
    let sessionStatus = 'idle'
    try {
      const statRes = await fetch(`${base}/api/sessions/${encodeURIComponent(sessionId)}/status`, {
        headers: { Authorization: `Bearer ${cfg.token}` },
        signal: AbortSignal.timeout(5_000),
      })
      if (statRes.ok) {
        const stat = await statRes.json() as { status?: string; currentTask?: string }
        currentTask  = stat.currentTask
        sessionStatus = stat.status ?? 'idle'
      }
    } catch { /* gateway may not support status endpoint yet */ }

    return NextResponse.json({
      configured: true,
      online:     true,
      sessions,
      sessionId,
      sessionStatus,
      currentTask,
    })
  } catch {
    return NextResponse.json({
      configured: true,
      online:     false,
      sessions:   FALLBACK_SESSIONS,
      error:      'Gateway unreachable',
    })
  }
}
