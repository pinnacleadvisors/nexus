import { NextRequest, NextResponse } from 'next/server'
import { getProvider } from '@/lib/oauth-providers'

export const runtime = 'nodejs'

const TOKEN_ENDPOINTS: Record<string, string> = {
  google: 'https://oauth2.googleapis.com/token',
  github: 'https://github.com/login/oauth/access_token',
  slack: 'https://slack.com/api/oauth.v2.access',
  notion: 'https://api.notion.com/v1/oauth/token',
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider: providerId } = await context.params
  const provider = getProvider(providerId)
  const { searchParams } = new URL(req.url)

  const redirectBase = new URL('/tools/claw', req.url)

  if (!provider) {
    redirectBase.searchParams.set('oauth_error', 'Unknown provider')
    return NextResponse.redirect(redirectBase.toString())
  }

  // CSRF: verify state param matches cookie
  const state = searchParams.get('state')
  const storedState = req.cookies.get(`oauth_state_${providerId}`)?.value
  if (!state || state !== storedState) {
    redirectBase.searchParams.set('oauth_error', 'Invalid state — possible CSRF attempt')
    const res = NextResponse.redirect(redirectBase.toString())
    res.cookies.delete(`oauth_state_${providerId}`)
    return res
  }

  const code = searchParams.get('code')
  if (!code) {
    redirectBase.searchParams.set('oauth_error', searchParams.get('error') ?? 'Access denied')
    const res = NextResponse.redirect(redirectBase.toString())
    res.cookies.delete(`oauth_state_${providerId}`)
    return res
  }

  // Exchange authorization code for access token
  const clientId = process.env[provider.envClientId] ?? ''
  const clientSecret = process.env[`${provider.envClientId.replace('CLIENT_ID', 'CLIENT_SECRET')}`] ?? ''
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
  const redirectUri = `${appUrl}/api/oauth/callback/${providerId}`

  try {
    const tokenRes = await fetch(TOKEN_ENDPOINTS[providerId], {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(providerId === 'notion'
          ? { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` }
          : {}),
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    const tokenData = await tokenRes.json()
    const accessToken: string =
      tokenData.access_token ?? tokenData.authed_user?.access_token ?? ''

    if (!accessToken) {
      throw new Error(tokenData.error_description ?? tokenData.error ?? 'No access token returned')
    }

    // Store access token in HTTP-only cookie (never exposed to client JS)
    redirectBase.searchParams.set('oauth_connected', providerId)
    const res = NextResponse.redirect(redirectBase.toString())

    res.cookies.set(`oauth_token_${providerId}`, accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
      maxAge: 60 * 60 * 24 * 60, // 60 days
    })
    // Store connection metadata (non-sensitive) in a readable cookie for the UI
    res.cookies.set(
      `oauth_meta_${providerId}`,
      JSON.stringify({ connectedAt: new Date().toISOString() }),
      {
        httpOnly: false, // UI needs to read this
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        path: '/',
        maxAge: 60 * 60 * 24 * 60,
      },
    )
    res.cookies.delete(`oauth_state_${providerId}`)
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Token exchange failed'
    redirectBase.searchParams.set('oauth_error', msg)
    const res = NextResponse.redirect(redirectBase.toString())
    res.cookies.delete(`oauth_state_${providerId}`)
    return res
  }
}
