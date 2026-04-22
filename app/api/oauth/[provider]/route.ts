import { NextRequest, NextResponse } from 'next/server'
import { getProvider } from '@/lib/oauth-providers'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  // B12 — per-IP rate limit. OAuth init is public so it cannot key on userId.
  // 30/min per IP is generous for legit users; enough to blunt provider enumeration.
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'oauth:init' })
  if (!rl.success) return rateLimitResponse(rl)

  const { provider: providerId } = await context.params
  const provider = getProvider(providerId)

  if (!provider) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  }

  const clientId = process.env[provider.envClientId]
  if (!clientId) {
    return NextResponse.redirect(
      new URL(
        `/tools/claw?oauth_error=${encodeURIComponent(`${provider.name} OAuth not configured — add ${provider.envClientId} to environment variables`)}`,
        req.url,
      ),
    )
  }

  // Generate a cryptographically random state for CSRF protection
  const state = crypto.randomUUID()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
  const redirectUri = `${appUrl}/api/oauth/callback/${providerId}`

  const authUrl = new URL(provider.authUrl)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('state', state)
  if (provider.scopes.length > 0) {
    authUrl.searchParams.set('scope', provider.scopes.join(' '))
  }
  // Notion requires owner=user
  if (providerId === 'notion') {
    authUrl.searchParams.set('owner', 'user')
  }

  const res = NextResponse.redirect(authUrl.toString())
  // Store state in HTTP-only cookie for CSRF verification on callback
  res.cookies.set(`oauth_state_${providerId}`, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 600, // 10 minutes — expires after the OAuth round-trip
  })
  return res
}
