/**
 * GET /api/run-events
 *
 * Read-only window into `run_events`. Powers Mission Control's
 * HeartbeatTimeline ("last 24h activity") strip in BentoMissionControl —
 * which has been silent since the dashboard shipped because this endpoint
 * never existed. The table has been around since the run-controller A6
 * migrations; only the API surface was missing.
 *
 * Query params:
 *   runId        (optional) — filter by run id
 *   kind         (optional, csv) — filter by event kind
 *   since        (optional) — ISO; created_at ≥ since
 *   until        (optional) — ISO; created_at < until
 *   limit        (optional, default 200, max 1000)
 *
 * Returns 200 always (retry-storm rule).
 *   { ok: true,  rows: RunEventRow[] }
 *   { ok: false, error: 'supabase_unconfigured' | 'query_failed', rows: [] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

interface RunEventRow {
  id?:            string
  run_id?:        string | null
  kind?:          string
  payload?:       unknown
  created_at?:    string
}

/**
 * Shape the heartbeat consumes (BentoMissionControl → HeartbeatTimeline read
 * `event_type` + `business_slug`). We emit BOTH the original run_events fields
 * AND these aliases so the timeline renders + any other reader still works.
 */
interface ActivityRow {
  id:            string
  run_id:        string | null
  kind:          string
  payload:       unknown
  event_type:    string
  business_slug: string | null
  created_at:    string
}

export async function GET(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 120, window: '1 m', prefix: 'run-events' },
  })
  if ('response' in g) return g.response

  const db = createServerClient()
  if (!db) {
    return NextResponse.json({ ok: false, error: 'supabase_unconfigured', rows: [] })
  }

  const params     = req.nextUrl.searchParams
  const runId      = params.get('runId')
  const kindParam  = params.get('kind')
  const since      = params.get('since')
  const until      = params.get('until')
  const limitRaw   = parseInt(params.get('limit') ?? '200', 10)
  const limit      = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 200

  // run_events: untyped shim because the table predates the latest
  // Supabase types regeneration. Same pattern lib/chat/system-prompt-business.ts
  // uses.
  type Query = {
    eq:    (c: string, v: string) => Query
    in:    (c: string, vs: string[]) => Query
    gte:   (c: string, v: string) => Query
    lt:    (c: string, v: string) => Query
    order: (c: string, o: { ascending: boolean }) => Query
    limit: (n: number) => Query
    then:  Promise<{ data: unknown; error: unknown }>['then']
  }
  let q: Query = ((db as unknown as {
    from: (t: string) => { select: (c: string) => Query }
  }).from('run_events')).select('id,run_id,kind,payload,created_at')

  if (runId) q = q.eq('run_id', runId)
  if (kindParam) {
    const kinds = kindParam.split(',').map(s => s.trim()).filter(Boolean)
    q = kinds.length === 1 ? q.eq('kind', kinds[0]) : q.in('kind', kinds)
  }
  if (since) q = q.gte('created_at', since)
  if (until) q = q.lt('created_at',  until)

  q = q.order('created_at', { ascending: false }).limit(limit)

  let runRows: RunEventRow[] = []
  try {
    const res = (await q) as { data: RunEventRow[] | null; error: unknown }
    if (res.error) console.warn('[/api/run-events] run_events query error:', res.error)
    else runRows = res.data ?? []
  } catch (err) {
    console.error('[/api/run-events] run_events query failed:', err)
  }

  // run_events → consumed shape (event_type aliases kind; run_events has no
  // business_slug so it's null here).
  const activity: ActivityRow[] = runRows.map(r => ({
    id:            r.id ?? `run-${r.created_at ?? ''}`,
    run_id:        r.run_id ?? null,
    kind:          r.kind ?? 'event',
    payload:       r.payload ?? null,
    event_type:    r.kind ?? 'event',
    business_slug: null,
    created_at:    r.created_at ?? new Date().toISOString(),
  }))

  // Merge the operator's recent CHAT turns so platform-copilot + business-copilot
  // conversations show up as activity — they write `gateway_turns`, NOT
  // run_events (which only the Run lifecycle populates). Best-effort: a failure
  // here must never blank the timeline. session_tag encodes the surface
  // ('platform-chat' | 'business-chat-<slug>' | 'bug-hunt-…').
  try {
    const chatSince = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const gq: Query = ((db as unknown as {
      from: (t: string) => { select: (c: string) => Query }
    }).from('gateway_turns'))
      .select('id,session_tag,model,created_at')
      .eq('user_id', g.userId)
      .gte('created_at', chatSince)
      .order('created_at', { ascending: false })
      .limit(limit)
    const gres = (await gq) as {
      data: Array<{ id?: string; session_tag?: string | null; model?: string | null; created_at?: string }> | null
      error: unknown
    }
    for (const t of gres.data ?? []) {
      if (!t.created_at) continue
      const tag  = t.session_tag ?? ''
      const slug = tag.startsWith('business-chat-') ? tag.slice('business-chat-'.length) : null
      activity.push({
        id:            t.id ?? `chat-${t.created_at}`,
        run_id:        null,
        kind:          'chat-turn',
        payload:       { model: t.model ?? null, session_tag: t.session_tag ?? null },
        event_type:    'chat-turn',
        business_slug: slug,
        created_at:    t.created_at,
      })
    }
  } catch (err) {
    console.warn('[/api/run-events] gateway_turns merge failed:', err)
  }

  activity.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  return NextResponse.json({ ok: true, rows: activity.slice(0, limit) })
}
