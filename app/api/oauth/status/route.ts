import { NextRequest, NextResponse } from 'next/server'
import { OAUTH_PROVIDERS } from '@/lib/oauth-providers'
import type { OAuthConnection } from '@/lib/types'

/** GET /api/oauth/status — returns which providers are connected */
export async function GET(req: NextRequest) {
  const connections: OAuthConnection[] = []

  for (const provider of OAUTH_PROVIDERS) {
    const meta = req.cookies.get(`oauth_meta_${provider.id}`)
    if (meta) {
      try {
        const { connectedAt } = JSON.parse(meta.value)
        connections.push({ provider: provider.id, connectedAt })
      } catch {
        // Malformed cookie — skip
      }
    }
  }

  return NextResponse.json({ connections })
}
