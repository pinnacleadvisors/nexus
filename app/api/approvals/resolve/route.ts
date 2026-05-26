/**
 * POST /api/approvals/resolve
 *
 * Marks a chat-emitted approval as resolved by writing an `APPROVAL [<id>]:`
 * user message into the same session. The next read of /api/approvals/fleet
 * sees the reply via the existing isResolved walk and the approval drops
 * out of the inbox.
 *
 * Why: operators often resolve approvals out-of-band — shipping the fix
 * via a PR directly, approving over Slack inline buttons, or executing
 * the action manually. None of those paths write back into chat, so the
 * fleet inbox showed stale "pending" approvals indefinitely (the 2026-05-23
 * codex-bearer rename approval was stuck for 3+ days despite the fix
 * shipping in commit a38b752).
 *
 * This route gives the operator a Mark-resolved button that uses the
 * existing resolution mechanism (chat-text APPROVAL pattern). No new
 * tables, no new isResolved semantics to maintain.
 *
 * Body:
 *   {
 *     session_id:   string  // chat_sessions.id
 *     approval_id:  string  // approval_request.approval_id
 *     note?:        string  // freeform — appended after the APPROVAL token
 *   }
 *
 * Response:
 *   200 { ok: true,  message_id: string }   — APPROVAL message inserted
 *   200 { ok: false, error: 'forbidden' }   — session doesn't belong to caller
 *   200 { ok: false, error: 'not_found' }   — session_id not found
 *   200 { ok: false, error: '...' }         — other transient failures
 *
 * Always 200 — same retry-storm rule as /api/approvals.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

interface ResolveBody {
  session_id?:  unknown
  approval_id?: unknown
  note?:        unknown
}

function sanitizeNote(input: unknown, maxLen = 200): string | undefined {
  if (typeof input !== 'string') return undefined
  const trimmed = input.trim().replace(/[\r\n]+/g, ' ').slice(0, maxLen)
  return trimmed.length > 0 ? trimmed : undefined
}

export async function POST(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 30, window: '1 m', prefix: 'approvals:resolve' },
  })
  if ('response' in g) return g.response

  let body: ResolveBody
  try {
    body = (await req.json()) as ResolveBody
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' })
  }

  const sessionId  = typeof body.session_id  === 'string' ? body.session_id  : ''
  const approvalId = typeof body.approval_id === 'string' ? body.approval_id : ''
  if (!sessionId || !approvalId) {
    return NextResponse.json({ ok: false, error: 'missing_fields' })
  }
  // approval_id should be reasonably short and slug-shaped — prevents
  // someone from injecting a long string into chat content.
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(approvalId)) {
    return NextResponse.json({ ok: false, error: 'invalid_approval_id' })
  }
  const note = sanitizeNote(body.note)

  const db = createServerClient()
  if (!db) {
    return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })
  }

  // Verify the session belongs to the caller before writing anything. Without
  // this an operator could mark an approval resolved in a session they don't
  // own (the fleet aggregator is per-user, but the route's input isn't).
  try {
    const sess = await (db.from('chat_sessions' as never) as unknown as {
      select: (c: string) => {
        eq: (c: string, v: string) => {
          maybeSingle: () => Promise<{
            data: { id: string; user_id: string } | null
            error: { message: string } | null
          }>
        }
      }
    }).select('id, user_id').eq('id', sessionId).maybeSingle()
    if (sess.error) {
      return NextResponse.json({ ok: false, error: 'query_failed' })
    }
    if (!sess.data) {
      return NextResponse.json({ ok: false, error: 'not_found' })
    }
    if (sess.data.user_id !== g.userId) {
      return NextResponse.json({ ok: false, error: 'forbidden' })
    }
  } catch (err) {
    console.warn('[/api/approvals/resolve] session lookup failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'query_failed' })
  }

  // Build the resolution message in the exact format isResolved expects:
  //   APPROVAL [<approval_id>]: marked-resolved-from-inbox [— note]
  const content =
    `APPROVAL [${approvalId}]: marked-resolved-from-inbox` +
    (note ? ` — ${note}` : '')

  try {
    const ins = await (db.from('chat_messages' as never) as unknown as {
      insert: (rec: unknown) => {
        select: (c: string) => {
          maybeSingle: () => Promise<{
            data: { id: string } | null
            error: { message: string } | null
          }>
        }
      }
    }).insert({
      session_id: sessionId,
      role:       'user',
      content,
      metadata:   { resolved_from_inbox: true, approval_id: approvalId },
    }).select('id').maybeSingle()

    if (ins.error) {
      console.warn('[/api/approvals/resolve] insert failed:', ins.error.message)
      return NextResponse.json({ ok: false, error: 'insert_failed' })
    }
    return NextResponse.json({ ok: true, message_id: ins.data?.id ?? null })
  } catch (err) {
    console.warn('[/api/approvals/resolve] insert exception:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'insert_failed' })
  }
}
