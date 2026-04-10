import { NextRequest, NextResponse } from 'next/server'

const COOKIE_NAME = 'nexus_claw_cfg'
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 90, // 90 days
}

/** POST /api/claw/config — save gateway URL + hook token in an HTTP-only cookie */
export async function POST(req: NextRequest) {
  const { gatewayUrl, hookToken } = await req.json()
  if (!gatewayUrl || !hookToken) {
    return NextResponse.json({ error: 'gatewayUrl and hookToken are required' }, { status: 400 })
  }

  const payload = JSON.stringify({ gatewayUrl: gatewayUrl.trim(), hookToken: hookToken.trim() })
  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE_NAME, payload, COOKIE_OPTS)
  return res
}

/** GET /api/claw/config — returns whether a config exists (never returns the token) */
export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(COOKIE_NAME)
  if (!cookie) return NextResponse.json({ configured: false })
  try {
    const { gatewayUrl } = JSON.parse(cookie.value)
    return NextResponse.json({ configured: true, gatewayUrl })
  } catch {
    return NextResponse.json({ configured: false })
  }
}

/** DELETE /api/claw/config — remove the stored config */
export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(COOKIE_NAME)
  return res
}
