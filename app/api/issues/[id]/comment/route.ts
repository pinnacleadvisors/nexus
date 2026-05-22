/**
 * POST /api/issues/[id]/comment
 *
 * Operator-only issue comment endpoint. Wires the CommentForm in
 * components/issues/IssueThread.tsx to migration 048's issue_comments table
 * via lib/issues/insert.ts insertIssueComment helper.
 *
 * Auth: Clerk + ALLOWED_USER_IDS. Comment is authored by the Clerk user_id
 * (not by an agent — agent-authored comments come from the dispatch path,
 * not this UI endpoint).
 *
 * Retry-storm safe: 200 + {ok: false} on infra issues.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import { insertIssueComment } from '@/lib/issues/insert'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getAllowedUserIds(): Set<string> | null {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw?.trim()) return null
  return new Set(raw.split(',').map(id => id.trim()).filter(Boolean))
}

function isOwner(userId: string): boolean {
  const allowed = getAllowedUserIds()
  if (!allowed) return true
  return allowed.has(userId)
}

interface Body { body: string }

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session.userId) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 })
  }
  if (!isOwner(session.userId)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const rl = await rateLimit(req, {
    limit:      60,
    window:     '1 m',
    prefix:     'issue:comment',
    identifier: session.userId,
  })
  if (!rl.success) return rateLimitResponse(rl)

  const { id } = await ctx.params
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  if (typeof body.body !== 'string' || body.body.trim().length === 0) {
    return NextResponse.json({ ok: false, error: 'empty_body' }, { status: 400 })
  }
  if (body.body.length > 20_000) {
    return NextResponse.json({ ok: false, error: 'body_too_long' }, { status: 400 })
  }

  const db = createServerClient()
  if (!db) {
    return NextResponse.json({ ok: false, error: 'database_unavailable' }, { status: 200 })
  }

  const res = await insertIssueComment(db, {
    issue_id:    id,
    body:        body.body.trim(),
    author_user: session.userId,
  })

  if (res.error) {
    return NextResponse.json({ ok: false, error: res.error.message }, { status: 200 })
  }
  if (!res.id) {
    // Helper returned {id:null, error:null} → table missing. Surface a
    // structured error so the UI can show "apply migration 048".
    return NextResponse.json({ ok: false, error: 'issue_comments_table_missing' }, { status: 200 })
  }

  return NextResponse.json({ ok: true, id: res.id })
}
