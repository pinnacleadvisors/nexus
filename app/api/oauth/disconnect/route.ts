import { NextRequest, NextResponse } from 'next/server'
import { getProvider } from '@/lib/oauth-providers'
import { audit } from '@/lib/audit'

/** DELETE /api/oauth/disconnect?provider=google — revoke and clear a provider connection */
export async function DELETE(req: NextRequest) {
  const providerId = new URL(req.url).searchParams.get('provider')
  const provider = providerId ? getProvider(providerId) : null

  if (!provider) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  }

  audit(req, { action: 'oauth.disconnect', resource: 'oauth', resourceId: providerId ?? undefined })

  const res = NextResponse.json({ ok: true })
  res.cookies.delete(`oauth_token_${providerId}`)
  res.cookies.delete(`oauth_meta_${providerId}`)
  return res
}
