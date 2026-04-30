/**
 * Vercel log search helpers backed by the `log_events` Supabase table.
 *
 * Two consumers:
 *   1. `attachLogsToBrief()` — called by the qa-runner orchestrator on a smoke
 *      failure. Returns a markdown slice of the last 30 s of server logs so
 *      the gateway-spawned agent sees server-side context alongside the
 *      browser trace. Zero tool calls — embed once, fix in one shot.
 *   2. `searchLogs()` — exposed (later) as a managed-agent tool so the
 *      `nexus-tester` / `workflow-optimizer` agents can pull historical
 *      slices on demand.
 *
 * Service-role client only. RLS on `log_events` denies everything else.
 *
 * Pairs with the migration in `supabase/migrations/022_log_events.sql` and
 * the drain endpoint in `app/api/vercel/log-drain/route.ts`.
 */

import { createServerClient } from '@/lib/supabase'

export interface LogEvent {
  id:            string
  deployment_id: string | null
  request_id:    string | null
  route:         string | null
  level:         string | null
  status:        number | null
  duration_ms:   number | null
  message:       string
  raw_url:       string | null
  created_at:    string
}

export interface SearchLogsOpts {
  /** Match on a single Vercel request id (per-invocation). */
  requestId?: string
  /** ISO timestamp lower bound (`gte created_at`). */
  since?:     string | Date
  /** ISO timestamp upper bound (`lte created_at`). */
  until?:     string | Date
  /** Filter by level — usually `error` / `warn`. */
  level?:     string | string[]
  /** Filter by route prefix, e.g. `/api/runs`. */
  route?:     string
  /** Filter by deployment id (post-deploy slices). */
  deploymentId?: string
  /** Default 200, hard cap 1000 to keep payloads bounded. */
  limit?:     number
}

const DEFAULT_LIMIT = 200
const HARD_LIMIT    = 1_000

/**
 * Generic search over `log_events`. All filters are optional; most-recent-first.
 * Returns an empty array when Supabase isn't configured (lets dev environments
 * compile without the drain wired up).
 */
// Minimal builder shape that mirrors what we use here. Keeps the cast tight
// and self-documenting — touch only when the query shape changes.
interface LogQueryBuilder {
  select:   (cols: string) => LogQueryBuilder
  order:    (col: string, opts: { ascending: boolean }) => LogQueryBuilder
  limit:    (n: number) => LogQueryBuilder
  eq:       (col: string, value: string) => LogQueryBuilder
  in:       (col: string, values: string[]) => LogQueryBuilder
  like:     (col: string, pattern: string) => LogQueryBuilder
  gte:      (col: string, value: string) => LogQueryBuilder
  lte:      (col: string, value: string) => LogQueryBuilder
  then:     <R>(onfulfilled: (v: { data: LogEvent[] | null; error: { message: string } | null }) => R) => Promise<R>
}

export async function searchLogs(opts: SearchLogsOpts = {}): Promise<LogEvent[]> {
  const supabase = createServerClient()
  if (!supabase) return []

  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), HARD_LIMIT)
  // Cast past the typed client until `npm run gen:types` picks up migration 022.
  let query = (supabase.from('log_events' as never) as unknown as LogQueryBuilder)
    .select('id,deployment_id,request_id,route,level,status,duration_ms,message,raw_url,created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (opts.requestId) {
    query = query.eq('request_id', opts.requestId)
  }
  if (opts.deploymentId) {
    query = query.eq('deployment_id', opts.deploymentId)
  }
  if (opts.route) {
    // Prefix match — covers both `/api/runs` exact and `/api/runs/:id` family.
    query = query.like('route', `${opts.route}%`)
  }
  if (opts.level) {
    if (Array.isArray(opts.level)) {
      query = query.in('level', opts.level)
    } else {
      query = query.eq('level', opts.level)
    }
  }
  if (opts.since) {
    query = query.gte('created_at', toIso(opts.since))
  }
  if (opts.until) {
    query = query.lte('created_at', toIso(opts.until))
  }

  const { data, error } = await query
  if (error) {
    console.warn('[lib/logs/vercel] searchLogs failed:', error.message)
    return []
  }
  return data ?? []
}

export interface AttachLogsOpts {
  /** Anchor request id — pulls the exact invocation + a window around it. */
  requestId?:    string
  /** Time window in seconds anchored to `now` (or to `at` when supplied). */
  windowSeconds?: number
  /** Anchor timestamp — defaults to now. Use the smoke-failure `Date.now()`. */
  at?:           Date | string
  /** Optional deployment id to scope the window to a specific deploy. */
  deploymentId?: string
  /** Cap the embedded slice (default 80 lines — fits in one dispatch brief). */
  maxLines?:     number
}

/**
 * Render a markdown slice suitable for embedding in a gateway dispatch brief.
 * Returns an empty string when no logs are found — callers can `if (slice)`
 * before adding a section so empty briefs stay clean.
 */
export async function attachLogsToBrief(opts: AttachLogsOpts = {}): Promise<string> {
  const window = Math.max(opts.windowSeconds ?? 30, 1)
  const anchor = opts.at ? new Date(toIso(opts.at)) : new Date()
  const since  = new Date(anchor.getTime() - window * 1000).toISOString()
  const until  = anchor.toISOString()

  const events = await searchLogs({
    requestId:    opts.requestId,
    since,
    until,
    deploymentId: opts.deploymentId,
    limit:        opts.maxLines ?? 80,
  })
  if (events.length === 0) return ''

  // Group errors first, then warnings, then everything else by time. Keeps
  // the brief skim-friendly when the agent has 80 lines to digest.
  const ranked = [...events].sort((a, b) => {
    const score = (e: LogEvent) => (e.level === 'error' ? 0 : e.level === 'warn' ? 1 : 2)
    const s = score(a) - score(b)
    if (s !== 0) return s
    return a.created_at < b.created_at ? -1 : 1
  })

  const lines = ranked.map(e => {
    const ts    = new Date(e.created_at).toISOString().slice(11, 23) // HH:MM:SS.mmm
    const lvl   = (e.level ?? 'log').toUpperCase().padEnd(5)
    const route = e.route ? ` ${e.route}` : ''
    const status = e.status ? ` [${e.status}]` : ''
    const dur    = e.duration_ms != null ? ` ${e.duration_ms}ms` : ''
    const reqId  = e.request_id ? ` req=${e.request_id.slice(0, 8)}` : ''
    return `${ts} ${lvl}${route}${status}${dur}${reqId} ${e.message.slice(0, 240)}`
  })

  const header = [
    `## Vercel server logs (${since} → ${until})`,
    opts.requestId ? `Anchor request: \`${opts.requestId}\`` : null,
    opts.deploymentId ? `Deployment: \`${opts.deploymentId}\`` : null,
    `${events.length} line${events.length === 1 ? '' : 's'} (errors first):`,
  ].filter(Boolean).join('\n')

  return `${header}\n\n\`\`\`\n${lines.join('\n')}\n\`\`\``
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
