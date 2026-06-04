import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

// Clerk-authed JSON proxy to the local Paperclip orchestration server.
// /api/workforce/<x> -> <PAPERCLIP_API_BASE>/api/<x>. Owner-only. Paperclip
// stays loopback-only on the Mac; Nexus is the single authenticated entry point.
// See task_plan-lean-nexus-pivot.md + workforce-lab/README.md.

export const runtime = 'nodejs'
export const maxDuration = 30

const BASE = (process.env.PAPERCLIP_API_BASE ?? 'http://host.docker.internal:3100').replace(/\/$/, '')

function isOwner(userId: string): boolean {
  const raw = process.env.ALLOWED_USER_IDS?.trim()
  if (!raw) return true
  return raw.split(',').map((s) => s.trim()).filter(Boolean).includes(userId)
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  if (!isOwner(userId)) return NextResponse.json({ ok: false, error: 'owner only' }, { status: 403 })

  const { path } = await ctx.params
  const upstream = `${BASE}/api/${(path ?? []).join('/')}${req.nextUrl.search}`

  const init: RequestInit = {
    method: req.method,
    headers: { 'content-type': req.headers.get('content-type') ?? 'application/json' },
    signal: AbortSignal.timeout(20_000),
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') init.body = await req.text()

  try {
    const res = await fetch(upstream, init)
    const buf = await res.arrayBuffer()
    return new NextResponse(buf, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    })
  } catch (e) {
    // User-facing surface (not an auto-retried service) — surface a soft error.
    return NextResponse.json(
      { ok: false, error: 'paperclip unreachable', detail: (e as Error).message },
      { status: 200 },
    )
  }
}

export const GET = handle
export const POST = handle
export const PATCH = handle
export const PUT = handle
export const DELETE = handle
