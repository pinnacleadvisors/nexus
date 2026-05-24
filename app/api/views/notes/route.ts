/**
 * GET  /api/views/notes?scope=<scope>
 * PUT  /api/views/notes      — body: { scope, body, expected_updated_at? }
 *
 * Backs the Notes panel in the chat Views dropdown. Single markdown blob
 * per (user_id, scope); see lib/views/notes.ts + migration 056. Optimistic-
 * concurrency: PUT with `expected_updated_at` returns conflict (200 + ok:false)
 * if the DB row's timestamp has advanced — the UI shows a "stale, reload?"
 * banner with discard / overwrite buttons. PUT without `expected_updated_at`
 * force-writes (initial save OR operator-confirmed overwrite).
 *
 * Retry-storm safe: writes ALWAYS return 200; the `ok` flag carries the signal.
 * A 5xx would cause the debounced autosave to hammer the DB on a transient
 * error.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { getNote, putNote } from '@/lib/views/notes'
import { isBusinessSlug } from '@/lib/claw/business-client'

export const runtime     = 'nodejs'
export const maxDuration = 10

function validScope(s: string | null | undefined): s is string {
  if (!s) return false
  if (s === 'admin') return true
  if (s.startsWith('business:')) return isBusinessSlug(s.slice('business:'.length))
  return false
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 120, window: '1 m', prefix: 'views:notes:get' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const scope = new URL(req.url).searchParams.get('scope')
  if (!validScope(scope)) {
    return NextResponse.json({ ok: false, error: 'invalid scope' }, { status: 400 })
  }

  const note = await getNote(session.userId, scope)
  // Always return 200 — null body means "no notes yet", not an error.
  return NextResponse.json({
    ok:   true,
    note: note ? { body: note.body, updated_at: note.updated_at } : null,
  })
}

interface PutBody {
  scope?:               string
  body?:                string
  expected_updated_at?: string | null
}

export async function PUT(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 120, window: '1 m', prefix: 'views:notes:put' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let payload: PutBody
  try {
    payload = (await req.json()) as PutBody
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  if (!validScope(payload.scope)) {
    return NextResponse.json({ ok: false, error: 'invalid scope' }, { status: 400 })
  }
  if (typeof payload.body !== 'string') {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })
  }
  // Cap the body at 256 KB — markdown scratchpad, not a wiki engine. Larger
  // payloads point at a UI bug (paste-the-whole-codebase) rather than legit
  // operator scratch.
  if (payload.body.length > 256 * 1024) {
    return NextResponse.json({ ok: false, error: 'body too large (max 256 KB)' }, { status: 413 })
  }

  const verdict = await putNote(
    session.userId,
    payload.scope,
    payload.body,
    payload.expected_updated_at ?? null,
  )

  if (verdict.ok) {
    return NextResponse.json({
      ok:   true,
      note: { body: verdict.note.body, updated_at: verdict.note.updated_at },
    })
  }

  // Conflict — 200 + ok:false so the autosave loop doesn't retry-storm.
  if (verdict.conflict) {
    return NextResponse.json({
      ok:       false,
      conflict: true,
      current:  { body: verdict.current.body, updated_at: verdict.current.updated_at },
    })
  }

  // Hard write error — also 200 + ok:false (retry-storm rule). The UI shows
  // a "save failed, retry?" banner. Sentry / log_events captures the cause.
  return NextResponse.json({ ok: false, conflict: false, error: verdict.error })
}
