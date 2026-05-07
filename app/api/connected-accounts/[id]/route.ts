/**
 * DELETE /api/connected-accounts/:id
 *
 * Revoke a connection. Marks the row `status='revoked'` and tells Composio to
 * drop its stored OAuth tokens. Idempotent — calling again on a revoked row
 * is a no-op.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { createServerClient } from '@/lib/supabase'
import { disconnectAccount, ComposioError } from '@/lib/composio/client'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'connected-accounts:delete' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await context.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  const db = createServerClient()
  if (!db) return NextResponse.json({ error: 'database not configured' }, { status: 503 })

  type Row = { composio_account_id: string; user_id: string; platform: string; status: string }
  const { data, error } = await (db.from('connected_accounts' as never) as unknown as {
    select: (cols: string) => { eq: (c: string, v: string) => { single: () => Promise<{ data: Row | null; error: { message: string } | null }> } }
  }).select('composio_account_id, user_id, platform, status').eq('id', id).single()

  if (error || !data) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (data.user_id !== session.userId) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (data.status !== 'active') return NextResponse.json({ ok: true, alreadyRevoked: true })

  // Best-effort Composio disconnect first — if it 404s we still mark revoked locally.
  let composioError: string | null = null
  try {
    await disconnectAccount(data.composio_account_id)
  } catch (err) {
    if (err instanceof ComposioError && err.status !== 404) {
      composioError = err.message
    } else if (err instanceof Error) {
      composioError = err.message
    }
  }

  const update = await (db.from('connected_accounts' as never) as unknown as {
    update: (patch: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> }
  }).update({ status: 'revoked' }).eq('id', id)

  if (update.error) return NextResponse.json({ error: update.error.message }, { status: 500 })

  audit(req, {
    action:     'connected_accounts.disconnect',
    resource:   'composio_connection',
    resourceId: id,
    userId:     session.userId,
    metadata:   { platform: data.platform, composioError },
  })

  return NextResponse.json({ ok: true, composioError })
}
