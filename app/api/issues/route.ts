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
import { dispatchPlatformDev } from '@/lib/platform-dev/dispatch'

export const runtime    = 'nodejs'
export const maxDuration = 15

/**
 * Resolve the canonical internal base URL for same-origin fetches.
 *
 * Used in place of `new URL(req.url).origin` to satisfy CodeQL's
 * js/request-forgery rule — req.url's origin technically depends on the
 * Host header which is user-influenced. NEXUS_BASE_URL is set in Doppler
 * (server-side) and never derived from incoming request data.
 *
 * Resolution order:
 *   1. process.env.NEXUS_BASE_URL  (production — set in Doppler)
 *   2. process.env.VERCEL_URL      (preview deploys, prefix with https://)
 *   3. http://localhost:<PORT>     (dev fallback)
 */
function resolveInternalBaseUrl(): string {
  const env = process.env.NEXUS_BASE_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
  return `http://localhost:${process.env.PORT?.trim() || '3000'}`
}

interface PostBody {
  business_slug?: unknown
  title?:         unknown
  body?:          unknown
  dispatch?:      unknown
  dev_team?:      unknown   // when true, routes to platform-dev-loop (autonomous draft-PR agent)
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
  const wantsDevTeam  = body.dev_team === true           // route to platform-dev-loop (autonomous)
  const wantsDispatch = !wantsDevTeam && body.dispatch !== false  // legacy engineering-lead path

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

  // Insert as triage. Routing depends on `dev_team` flag:
  //   - default (engineering-lead path): assignee_user = reporter; the
  //     engineering-lead agent triages + reassigns to the right role
  //   - dev_team=true: assignee_agent = 'platform-dev'; the issue is
  //     queued for the autonomous platform-dev-loop agent which opens
  //     a draft PR end-to-end
  // The single-assignee constraint (migration 048) means we set ONE.
  const ins = await insertIssue(db, {
    business_slug:   slug,
    title,
    body:            issueBody || null,
    status_category: 'triage',
    status:          'Triage',
    ...(wantsDevTeam
      ? { assignee_agent: 'platform-dev' }
      : { assignee_user:  g.userId }),
  })
  if (ins.error) {
    return NextResponse.json({ ok: false, error: 'insert_failed', detail: ins.error.message })
  }
  if (!ins.id) {
    // Migration 048 not applied — fail-soft.
    return NextResponse.json({ ok: false, error: 'issues_table_missing' })
  }

  // Routing — three paths:
  //   1. dev_team=true  → autonomous platform-dev-loop (opens draft PR)
  //   2. dispatch=true  → engineering-lead triage (legacy default)
  //   3. otherwise      → file silently for later
  let dispatched: boolean = false
  let routedTo: 'engineering-lead' | 'platform-dev-loop' | null = null
  if (wantsDevTeam) {
    routedTo = 'platform-dev-loop'
    try {
      const out = await dispatchPlatformDev({
        issueId:      ins.id,
        title,
        description:  issueBody || null,
        businessSlug: slug,
        userId:       g.userId,
        cookie:       req.headers.get('cookie') ?? undefined,
      })
      dispatched = out.ok
      if (!out.ok) {
        console.warn('[/api/issues] platform-dev-loop dispatch failed (non-fatal):', out.error)
      }
    } catch (err) {
      console.warn('[/api/issues] platform-dev-loop dispatch threw:', err instanceof Error ? err.message : err)
    }
  } else if (wantsDispatch) {
    routedTo = 'engineering-lead'
    try {
      // SSRF-safe: resolve the dispatch URL from env, NOT from req.url.
      // CodeQL js/request-forgery flagged the prior `new URL(req.url).origin`
      // path because Host header is user-controllable in theory. NEXUS_BASE_URL
      // is set in Doppler and never sourced from the request. Falls back to
      // localhost only in dev — production must set NEXUS_BASE_URL.
      const base       = resolveInternalBaseUrl()
      const dispatchRes = await fetch(`${base}/api/claude-session/dispatch`, {
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

  return NextResponse.json({ ok: true, id: ins.id, dispatched, routed_to: routedTo })
}
