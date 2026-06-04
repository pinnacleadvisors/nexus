import { NextRequest, NextResponse } from 'next/server'
import { authenticateOps } from '@/lib/auth/ops-auth'
import { sendDiscordNotification } from '@/lib/notifications/discord'

// Owner-only: fire a test Discord notification to confirm NEXUS_DISCORD_WEBHOOK_URL works.
// POST /api/health/discord-test  (bearer NEXUS_OPS_TOKEN or owner Clerk session)

export const runtime = 'nodejs'
export const maxDuration = 15

export async function POST(req: NextRequest) {
  const auth = await authenticateOps(req)
  if ('response' in auth) return auth.response

  const result = await sendDiscordNotification(auth.userId, {
    title: 'Nexus → Discord test',
    body: 'If you can read this, the Discord alert channel is wired correctly. 🔔',
    link_href: '/inbox',
    severity: 'info',
  })

  return NextResponse.json({ ok: result.ok, result }, { status: 200 })
}
