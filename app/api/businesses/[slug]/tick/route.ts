/**
 * POST /api/businesses/[slug]/tick
 *
 * One-shot dispatch of the business-operator agent against this business.
 * The cron path (/api/cron/business-operator) does the same thing on a
 * schedule; this route gives the operator a "run now" trigger from the UI.
 *
 * Body:
 *   {
 *     prompt?:    string   // optional override of the standard tick brief
 *     dryRun?:    boolean  // when true, skip the actual dispatch and just
 *                          // return the brief that would be sent. Default false.
 *   }
 *
 * Returns 200 always (retry-storm rule — the run-now button on the UI
 * shouldn't 5xx because the operator will retry-spam it on failure).
 *   { ok: true,  sessionId: string, dispatched: boolean, dryRun?: boolean }
 *   { ok: false, error: '<reason>' }
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'

export const runtime    = 'nodejs'
export const maxDuration = 30

interface RouteCtx { params: Promise<{ slug: string }> }

/**
 * Resolve the canonical internal base URL for same-origin fetches.
 * Used instead of `new URL(req.url).origin` so CodeQL js/request-forgery
 * sees a server-controlled string (Doppler-set NEXUS_BASE_URL) rather than
 * a request-header-derived one.
 */
function resolveInternalBaseUrl(): string {
  const env = process.env.NEXUS_BASE_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  const vercel = process.env.VERCEL_URL?.trim()
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
  return `http://localhost:${process.env.PORT?.trim() || '3000'}`
}

interface TickBody {
  prompt?: unknown
  dryRun?: unknown
}

const DEFAULT_PROMPT = (slug: string, name: string, simulation: boolean): string => {
  const simNote = simulation
    ? '\n\nThis is a SIMULATION business — every money-moving / customer-facing verb is blocked by the cost-guard. Draft work freely; the operator graduates the business by flipping `simulation=false` when ready.'
    : ''
  return [
    `Tick the business "${name}" (slug: ${slug}).`,
    '',
    'Read the latest experiment_metrics + pending operator_tasks + open issues, then emit 3-7 actions for today.',
    'Group them by department where helpful. Surface anything that needs operator approval as an approval-request block.',
    `Honor every existing approval gate. ${simNote}`,
  ].join('\n')
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 30, window: '1 m', prefix: 'business:tick' },
  })
  if ('response' in g) return g.response

  const { slug } = await ctx.params
  if (!slug || !/^[a-z0-9-]{1,60}$/.test(slug)) {
    return NextResponse.json({ ok: false, error: 'invalid_slug' })
  }

  let body: TickBody
  try { body = (await req.json().catch(() => ({}))) as TickBody }
  catch { body = {} }

  const dryRun         = body.dryRun === true
  const customPrompt   = typeof body.prompt === 'string' ? body.prompt.trim() : ''

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  // Ownership + read business row for prompt context.
  let biz: { user_id: string; name: string; simulation?: boolean } | null = null
  try {
    const res = await (db.from('business_operators' as never) as unknown as {
      select: (c: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: { user_id: string; name: string; simulation?: boolean } | null; error: { message: string } | null }>
        }
      }
    }).select('user_id, name, simulation').eq('slug', slug).maybeSingle()
    if (res.error)  return NextResponse.json({ ok: false, error: 'query_failed' })
    if (!res.data)  return NextResponse.json({ ok: false, error: 'not_found' })
    if (res.data.user_id !== g.userId) {
      return NextResponse.json({ ok: false, error: 'forbidden' })
    }
    biz = res.data
  } catch (err) {
    console.warn('[/api/businesses/:slug/tick] business lookup failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, error: 'query_failed' })
  }

  const prompt = customPrompt.length > 0
    ? customPrompt
    : DEFAULT_PROMPT(slug, biz.name, Boolean(biz.simulation))

  if (dryRun) {
    return NextResponse.json({
      ok:         true,
      dryRun:     true,
      sessionId:  null,
      dispatched: false,
      prompt,
      simulation: Boolean(biz.simulation),
    })
  }

  // Fire the dispatch. Same-origin, cookie-authed so the dispatch sees the
  // operator's session (its rate-limit + ALLOWED_USER_IDS gates apply on
  // top of ours). Base URL resolved from NEXUS_BASE_URL env (Doppler-set,
  // server-side, never user-influenced) to satisfy CodeQL js/request-forgery.
  try {
    const base = resolveInternalBaseUrl()
    const dispatchRes = await fetch(`${base}/api/claude-session/dispatch`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie:         req.headers.get('cookie') ?? '',
      },
      body: JSON.stringify({
        agentSlug:    'business-operator',
        capabilityId: 'consultant',
        businessSlug: slug,
        inputs: {
          task:        `One-shot tick from operator UI`,
          description: prompt,
          tools:       ['Read', 'Grep', 'Edit', 'Bash'],
        },
      }),
      signal: AbortSignal.timeout(20_000),
    })
    const dispatchBody = await dispatchRes.json().catch(() => ({})) as {
      ok?:        boolean
      sessionId?: string
      error?:     string
      detail?:    string
      hint?:      string
    }

    // Bubble the upstream error verbatim instead of swallowing into
    // 'dispatch_failed'. The 2026-05-27 incident class: chat reported
    // "dispatch_failed" but the real cause (cost-guard tripped / kill-switch
    // active / gateway 502 / auth.json corrupt) was hidden one layer down.
    // The dispatch route's structured `{error, detail, hint}` shape carries
    // the actionable hint — surface it to the UI so the operator doesn't
    // need to read server logs to find the actual failure.
    if (!dispatchBody.ok) {
      const hint = dispatchBody.hint
        ?? (dispatchRes.status === 401 ? 'unauthorized — re-sign in and retry'
           : dispatchRes.status === 429 ? 'rate-limited — slow down or check cost-guard'
           : dispatchRes.status === 503 ? 'gateway unavailable — check /manage-platform → Health'
           : `dispatch route returned HTTP ${dispatchRes.status}`)
      console.warn('[/api/businesses/:slug/tick] dispatch returned not-ok:', JSON.stringify({
        status: dispatchRes.status,
        error:  dispatchBody.error,
        detail: dispatchBody.detail,
      }))
      return NextResponse.json({
        ok:         false,
        sessionId:  dispatchBody.sessionId ?? null,
        dispatched: false,
        simulation: Boolean(biz.simulation),
        error:      dispatchBody.error ?? `dispatch_returned_${dispatchRes.status}`,
        detail:     dispatchBody.detail ?? undefined,
        hint,
        upstreamStatus: dispatchRes.status,
      })
    }

    return NextResponse.json({
      ok:         true,
      sessionId:  dispatchBody.sessionId ?? null,
      dispatched: true,
      simulation: Boolean(biz.simulation),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[/api/businesses/:slug/tick] dispatch failed:', msg)
    // Specific hint for the most common 'caught exception' shapes the
    // operator hits — network timeout vs JSON parse vs DNS fail. Better
    // than a flat 'dispatch_failed' for diagnosis from the UI.
    const hint = msg.includes('aborted') || msg.includes('timeout')
      ? 'request timed out — claude gateway might be cold-starting; retry once'
      : msg.includes('fetch failed')
        ? 'network error reaching internal dispatch route — check NEXUS_BASE_URL'
        : 'dispatch threw — see server logs for stack'
    return NextResponse.json({
      ok:     false,
      error:  'dispatch_failed',
      detail: msg.slice(0, 200),
      hint,
    })
  }
}
