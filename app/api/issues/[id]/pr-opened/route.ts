/**
 * POST /api/issues/:id/pr-opened — callback from the platform-dev-loop
 * agent when it finishes a run. Authenticated via the nonce + bearer
 * token the dispatch helper generated.
 *
 * Body: { status: 'in-review' | 'blocked' | 'failed', pr_url?, branch?, reason? }
 *
 * On success, the issue's metadata.pr_url + status_category move
 * forward, and the row updates_at timestamp bumps so the inbox /
 * dashboard surface refreshes.
 *
 * 200 always (retry-storm rule). The agent's caller doesn't need to
 * see 5xx — the agent only fires this once per issue at the END of
 * its run.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { verifyCallbackToken } from '@/lib/platform-dev/dispatch'

export const runtime = 'nodejs'
export const maxDuration = 15

interface RouteCtx { params: Promise<{ id: string }> }

interface CallbackBody {
  status?:    'in-review' | 'blocked' | 'failed'
  pr_url?:    string
  branch?:    string
  reason?:    string
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'invalid_id' })
  }

  // Verify the callback token. Nonce lives in the URL query; token in
  // the Authorization header so it never lands in server access logs
  // alongside the URL.
  const url   = new URL(req.url)
  const nonce = url.searchParams.get('nonce') ?? ''
  const auth  = req.headers.get('authorization') ?? ''
  const tok   = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!verifyCallbackToken(id, nonce, tok)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' })
  }

  const body   = await req.json().catch(() => ({})) as CallbackBody
  const status = body.status === 'in-review' || body.status === 'blocked' || body.status === 'failed'
    ? body.status
    : 'failed'

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  // Map agent status → issues.status_category. 'in-review' = the
  // operator's queue ("PR is open, look at it"); 'blocked' bounces
  // back to triage; 'failed' lands as 'started' so the cron retries
  // after the 24h cooldown.
  const statusCategory =
    status === 'in-review' ? 'started' :
    status === 'blocked'   ? 'triage'  :
    'started'   // failed → still 'started' so we can see something happened, but with metadata.failed=true

  const metadataPatch: Record<string, unknown> = {
    agent_status:      status,
    last_callback_at:  new Date().toISOString(),
    ...(body.pr_url && { pr_url: body.pr_url }),
    ...(body.branch && { branch: body.branch }),
    ...(body.reason && { reason: body.reason }),
    ...(status === 'failed' && { failed: true }),
  }

  // Read current metadata, merge, write back. Cheaper than jsonb_set
  // and TypeScript-friendly without typed migrations.
  const readRes = await (db.from('issues' as never) as unknown as {
    select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { metadata: Record<string, unknown> | null } | null }> } }
  }).select('metadata').eq('id', id).maybeSingle()
  const current = (readRes.data?.metadata ?? {}) as Record<string, unknown>
  const merged  = { ...current, ...metadataPatch }

  await (db.from('issues' as never) as unknown as {
    update: (r: unknown) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> }
  }).update({
    metadata:        merged,
    status_category: statusCategory,
    status:          status === 'in-review' ? 'In review' : status === 'blocked' ? 'Triage' : 'Failed',
    updated_at:      new Date().toISOString(),
  }).eq('id', id)

  return NextResponse.json({ ok: true })
}
