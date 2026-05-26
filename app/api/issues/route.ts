/**
 * /api/issues
 *
 * POST — operator-reports-an-issue endpoint. Inserts a new `issues` row
 *        with status_category='triage' so the next triage cron / dispatch
 *        picks it up, then optionally dispatches to the engineering-lead
 *        agent for immediate routing when `dispatch=true`.
 *
 * Today the trigger path is manual (the form submits dispatch=true). Future
 * work can swap to an Inngest event handler watching for triage inserts.
 *
 * Body:
 *   {
 *     business_slug: string  // required — must be a business the operator owns
 *     title:         string  // required, ≤ 200 chars
 *     body?:         string  // optional, ≤ 5000 chars
 *     dispatch?:     boolean // default true — fire engineering-lead immediately
 *   }
 *
 * Returns 200 always (retry-storm rule).
 *   { ok: true,  id: string,  dispatched: boolean }
 *   { ok: false, error: '<reason>' }
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'
import { insertIssue } from '@/lib/issues/insert'

export const runtime    = 'nodejs'
export const maxDuration = 15

interface PostBody {
  business_slug?: unknown
  title?:         unknown
  body?:          unknown
  dispatch?:      unknown
}

const MAX_TITLE = 200
const MAX_BODY  = 5_000

export async function POST(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 30, window: '1 m', prefix: 'issues:post' },
  })
  if ('response' in g) return g.response

  let body: PostBody
  try { body = (await req.json()) as PostBody }
  catch { return NextResponse.json({ ok: false, error: 'invalid_json' }) }

  const slug   = typeof body.business_slug === 'string' ? body.business_slug.trim() : ''
  const title  = typeof body.title === 'string'         ? body.title.trim()         : ''
  const issueBody = typeof body.body === 'string'        ? body.body.trim()          : ''
  const wantsDispatch = body.dispatch !== false  // default true

  if (!slug || !/^[a-z0-9-]{1,60}$/.test(slug)) {
    return NextResponse.json({ ok: false, error: 'invalid_business_slug' })
  }
  if (!title) return NextResponse.json({ ok: false, error: 'missing_title' })
  if (title.length > MAX_TITLE) {
    return NextResponse.json({ ok: false, error: 'title_too_long', maxLen: MAX_TITLE })
  }
  if (issueBody.length > MAX_BODY) {
    return NextResponse.json({ ok: false, error: 'body_too_long', maxLen: MAX_BODY })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  // Verify the business belongs to the caller before letting them file
  // issues against it.
  try {
    const owner = await (db.from('business_operators' as never) as unknown as {
      select: (c: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: { user_id: string } | null; error: { message: string } | null }>
        }
      }
    }).select('user_id').eq('slug', slug).maybeSingle()
    if (owner.error)                       return NextResponse.json({ ok: false, error: 'query_failed' })
    if (!owner.data)                       return NextResponse.json({ ok: false, error: 'not_found' })
    if (owner.data.user_id !== g.userId)   return NextResponse.json({ ok: false, error: 'forbidden' })
  } catch (err) {
    console.warn('[/api/issues] ownership check failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'query_failed' })
  }

  // Insert as triage so it shows up in the next triage sweep + flags the
  // engineering-lead's classifier. Operator-reported issues have no
  // assignee yet — engineering-lead routes to the right role.
  const ins = await insertIssue(db, {
    business_slug:   slug,
    title,
    body:            issueBody || null,
    status_category: 'triage',
    status:          'Triage',
    assignee_user:   g.userId,  // reporter; engineering-lead will reassign
  })
  if (ins.error) {
    return NextResponse.json({ ok: false, error: 'insert_failed', detail: ins.error.message })
  }
  if (!ins.id) {
    // Migration 048 not applied — fail-soft.
    return NextResponse.json({ ok: false, error: 'issues_table_missing' })
  }

  // Optional immediate dispatch to engineering-lead. Fire-and-forget — we
  // return the issue id whether or not the dispatch succeeded; the row is
  // persisted either way and a cron / retry can pick it up later.
  let dispatched = false
  if (wantsDispatch) {
    try {
      const origin    = new URL(req.url).origin
      const dispatchRes = await fetch(`${origin}/api/claude-session/dispatch`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: req.headers.get('cookie') ?? '',
        },
        body: JSON.stringify({
          agentSlug:    'engineering-lead',
          capabilityId: 'consultant',
          issueId:      ins.id,
          businessSlug: slug,
          inputs: {
            task:        `Triage operator-reported issue: ${title}`,
            description: issueBody || undefined,
            tools:       ['Read', 'Grep', 'Edit', 'Bash'],
          },
        }),
        signal: AbortSignal.timeout(8_000),
      })
      dispatched = dispatchRes.ok
    } catch (err) {
      console.warn('[/api/issues] dispatch failed (non-fatal):', err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({ ok: true, id: ins.id, dispatched })
}
