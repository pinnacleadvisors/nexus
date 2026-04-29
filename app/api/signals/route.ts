/**
 * /api/signals
 *
 * GET    /api/signals                      → list signals for the current user
 * GET    /api/signals?id=<uuid>            → one signal + its evaluations
 * GET    /api/signals?status=<status>      → filtered list
 * POST   /api/signals { kind, title, body?, url? }
 * PATCH  /api/signals { id, status?, decidedReason? }
 *
 * Owner is authenticated through guardRequest. RLS on the table also enforces
 * user_id matching, so a stray service-role call still cannot leak rows.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { audit } from '@/lib/audit'
import {
  createSignal,
  getSignalWithEvaluations,
  listSignals,
  updateSignal,
  type UpdateSignalInput,
} from '@/lib/signals/client'
import type {
  CreateSignalInput,
  SignalKind,
  SignalStatus,
} from '@/lib/signals/types'

export const runtime = 'nodejs'

const VALID_KINDS:    SignalKind[]   = ['idea', 'link', 'error', 'question']
const VALID_STATUSES: SignalStatus[] = ['new', 'triaging', 'accepted', 'rejected', 'implemented', 'deferred']

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 60, window: '1 m', prefix: 'signals:list' },
  })
  if ('response' in g) return g.response

  const id = req.nextUrl.searchParams.get('id')
  if (id) {
    const signal = await getSignalWithEvaluations(id)
    if (!signal || signal.userId !== g.userId) {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    return NextResponse.json({ signal })
  }

  const statusParam = req.nextUrl.searchParams.get('status')
  const status = statusParam && (VALID_STATUSES as string[]).includes(statusParam)
    ? statusParam as SignalStatus
    : undefined

  const limitRaw = Number(req.nextUrl.searchParams.get('limit') ?? '200')
  const limit    = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 500) : 200

  const signals = await listSignals(g.userId, { status, limit })
  return NextResponse.json({ signals })
}

// ── POST ─────────────────────────────────────────────────────────────────────
interface PostBody {
  kind:  SignalKind
  title: string
  body?: string
  url?:  string
}

function isValidUrl(u: string): boolean {
  try {
    const parsed = new URL(u)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 30, window: '1 m', prefix: 'signals:create' },
  })
  if ('response' in g) return g.response

  const body = await req.json().catch(() => ({})) as Partial<PostBody>

  if (!body.kind || !(VALID_KINDS as string[]).includes(body.kind)) {
    return NextResponse.json({ error: `kind must be one of ${VALID_KINDS.join(', ')}` }, { status: 400 })
  }
  const title = (body.title ?? '').trim()
  if (!title) {
    return NextResponse.json({ error: 'title required' }, { status: 400 })
  }
  if (title.length > 200) {
    return NextResponse.json({ error: 'title too long (max 200 chars)' }, { status: 400 })
  }
  const text = (body.body ?? '').trim()
  if (text.length > 10_000) {
    return NextResponse.json({ error: 'body too long (max 10,000 chars)' }, { status: 400 })
  }
  let url: string | undefined
  if (typeof body.url === 'string' && body.url.trim()) {
    if (!isValidUrl(body.url.trim())) {
      return NextResponse.json({ error: 'url must be http(s)' }, { status: 400 })
    }
    url = body.url.trim()
  }

  const input: CreateSignalInput = { kind: body.kind, title, body: text, url }
  const signal = await createSignal(g.userId, input)
  if (!signal) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })

  audit(req, {
    action:     'signal.create',
    resource:   'signal',
    resourceId: signal.id,
    userId:     g.userId,
    metadata:   { kind: signal.kind, hasUrl: Boolean(signal.url) },
  })

  return NextResponse.json({ signal }, { status: 201 })
}

// ── PATCH ────────────────────────────────────────────────────────────────────
interface PatchBody {
  id:             string
  status?:        SignalStatus
  decidedReason?: string
}

export async function PATCH(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 30, window: '1 m', prefix: 'signals:update' },
  })
  if ('response' in g) return g.response

  const body = await req.json().catch(() => ({})) as Partial<PatchBody>
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Owner check before mutation — service-role client bypasses RLS otherwise.
  const existing = await getSignalWithEvaluations(body.id)
  if (!existing || existing.userId !== g.userId) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const patch: UpdateSignalInput = {}
  if (body.status) {
    if (!(VALID_STATUSES as string[]).includes(body.status)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 })
    }
    patch.status = body.status
    // When the owner manually flips to a terminal status, stamp decided_at.
    if (['accepted', 'rejected', 'implemented', 'deferred'].includes(body.status)) {
      patch.decidedAt = new Date().toISOString()
    }
  }
  if (typeof body.decidedReason === 'string') {
    patch.decidedReason = body.decidedReason.trim().slice(0, 2_000)
  }

  const updated = await updateSignal(body.id, patch)
  if (!updated) return NextResponse.json({ error: 'update failed' }, { status: 500 })

  audit(req, {
    action:     'signal.update',
    resource:   'signal',
    resourceId: updated.id,
    userId:     g.userId,
    metadata:   { status: updated.status },
  })

  return NextResponse.json({ signal: updated })
}
