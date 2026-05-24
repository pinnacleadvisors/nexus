/**
 * lib/runs/failure-clusters.ts — read-only helper that finds recurring
 * failure patterns in `run_events`.
 *
 * Life-Harness pattern (arXiv 2605.22166): "failure-to-intervention
 * conversion" — automatically distill recurring trajectory failures into
 * reusable interventions, rather than waiting for human feedback. Today
 * `workflow-optimizer` only reads `workflow_feedback` rows (human-flagged).
 * This helper extends that surface — it scans `run_events` for failure-
 * class events (`phase.fail`, `phase.block`, `review.rejected`, plus
 * `dispatch.completed` with `payload.ok=false`), groups them by a stable
 * signature, and returns clusters sorted by frequency.
 *
 * The cron at `/api/cron/optimizer-scan-failures` calls this helper daily,
 * picks the highest-frequency unresolved cluster, and dispatches
 * workflow-optimizer with the cluster brief. Operator still approves the
 * resulting `edit-plan` via the existing chat flow.
 *
 * NEVER MUTATES. Pure read. Safe to call from any route.
 */

import { createServerClient } from '@/lib/supabase'

export interface FailureCluster {
  /** Stable signature — same for every event in the cluster. */
  signature:     string
  /** The kind of failure (`phase.fail` / `review.rejected` / etc.). */
  kind:          string
  /** One-line description suitable for an agent brief. */
  summary:       string
  /** How many events landed in this cluster within the lookback window. */
  count:         number
  /** Optional business partition (NULL for admin-scope failures). */
  business_slug: string | null
  /** Sample event IDs for the brief (up to 3). */
  sample_event_ids: string[]
  /** Most-recent occurrence — used to sort "stale clusters" out. */
  last_seen_at:  string
  /** First-seen — distinguishes "happened 50× today" vs "happened weekly for a year". */
  first_seen_at: string
}

export interface ClusterOptions {
  /** Lookback window. Default = 7 days. */
  lookbackDays?:    number
  /** Minimum count to surface a cluster. Default = 5. */
  minFrequency?:    number
  /** Maximum clusters returned. Default = 20. */
  maxClusters?:     number
  /** Scope filter — null = all clusters, 'admin' or 'business:<slug>' = filtered. */
  scope?:           string | null
}

/**
 * Returns failure clusters sorted by frequency descending.
 *
 * Why this clustering signature: (kind, business_slug, error_signature).
 * - `kind` distinguishes `phase.fail` from `review.rejected` (different fixes).
 * - `business_slug` keeps per-business issues separate from platform-wide ones.
 * - `error_signature` is extracted from `payload.error` / `payload.reason` /
 *   `payload.signal` via a normaliser that strips ids, paths, and timestamps
 *   so "rate-limited from openai" lands in the same bucket as "rate-limited
 *   from openai (request_id=abc123)".
 */
export async function findFailureClusters(opts: ClusterOptions = {}): Promise<FailureCluster[]> {
  const lookbackDays  = opts.lookbackDays ?? 7
  const minFrequency  = opts.minFrequency ?? 5
  const maxClusters   = opts.maxClusters  ?? 20
  const scope         = opts.scope        ?? null

  const db = createServerClient()
  if (!db) return []

  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString()

  // Pull every failure-kind event in the window. We don't push the kind
  // filter into Supabase via `.in()` — the kind column doesn't index well
  // for OR-of-equals at our volume yet, and 7-day reads are cheap.
  const FAILURE_KINDS = ['phase.fail', 'phase.block', 'review.rejected', 'dispatch.completed']

  interface Row {
    id:         string
    kind:       string
    payload:    Record<string, unknown>
    created_at: string
    run_id:     string
  }

  const res = await (db.from('run_events' as never) as unknown as {
    select: (c: string) => {
      in:    (c: string, vals: string[]) => {
        gte:   (c: string, v: string) => {
          order: (c: string, opts: { ascending: boolean }) => {
            limit: (n: number) => Promise<{ data: Row[] | null; error: { message: string } | null }>
          }
        }
      }
    }
  })
    .select('id, kind, payload, created_at, run_id')
    .in('kind', FAILURE_KINDS)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5000)

  if (res.error || !res.data) {
    console.warn('[failure-clusters] read error:', res.error?.message)
    return []
  }

  const groups = new Map<string, {
    kind:          string
    business_slug: string | null
    signature:     string
    rows:          Row[]
  }>()

  for (const row of res.data) {
    // Skip dispatch.completed events that succeeded — only `ok:false` is
    // a failure here.
    if (row.kind === 'dispatch.completed' && row.payload?.ok !== false) continue

    const business_slug = (row.payload?.business_slug as string | undefined) ?? null
    const signature     = signatureOf(row.kind, row.payload)
    if (scope === 'admin'    && business_slug !== null)               continue
    if (scope && scope.startsWith('business:') && business_slug !== scope.slice('business:'.length)) continue

    const key = `${row.kind}|${business_slug ?? '_'}|${signature}`
    let g = groups.get(key)
    if (!g) {
      g = { kind: row.kind, business_slug, signature, rows: [] }
      groups.set(key, g)
    }
    g.rows.push(row)
  }

  const clusters: FailureCluster[] = []
  for (const g of groups.values()) {
    if (g.rows.length < minFrequency) continue
    // rows are sorted desc by created_at — first is most recent.
    const first = g.rows[0]
    const last  = g.rows[g.rows.length - 1]
    clusters.push({
      signature:        g.signature,
      kind:             g.kind,
      summary:          summarise(g.kind, g.signature, g.business_slug, g.rows.length),
      count:            g.rows.length,
      business_slug:    g.business_slug,
      sample_event_ids: g.rows.slice(0, 3).map(r => r.id),
      last_seen_at:     first.created_at,
      first_seen_at:    last.created_at,
    })
  }

  clusters.sort((a, b) => b.count - a.count)
  return clusters.slice(0, maxClusters)
}

/**
 * Normalise a failure payload into a stable signature.
 *
 * The signature strips:
 * - UUIDs / object IDs (replaced with `<id>`)
 * - File paths beyond the first 2 segments (replaced with `…`)
 * - ISO timestamps (replaced with `<ts>`)
 * - Numeric tokens that aren't HTTP status codes (replaced with `<n>`)
 *
 * So "fetch failed at 2026-05-24T08:00:00.123Z for /api/businesses/foo-123/provision"
 * collapses to "fetch failed at <ts> for /api/businesses/…".
 */
function signatureOf(kind: string, payload: Record<string, unknown>): string {
  const rawCandidates: Array<string | undefined> = [
    payload?.error    as string | undefined,
    payload?.reason   as string | undefined,
    payload?.signal   as string | undefined,
    payload?.message  as string | undefined,
  ]
  const raw = rawCandidates.find(s => typeof s === 'string' && s.length > 0)
  if (!raw) return `${kind}:<no-payload-detail>`

  let s = raw
  // UUIDs
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
  // ISO timestamps
  s = s.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g, '<ts>')
  // long path segments past the first 2 (collapse to `…`)
  s = s.replace(/(\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)\/[^\s)]+/g, '$1/…')
  // Numeric IDs (>= 4 digits, not HTTP statuses 100-599)
  s = s.replace(/\b\d{6,}\b/g, '<n>')
  // Truncate
  return s.slice(0, 200).trim()
}

function summarise(kind: string, signature: string, business: string | null, count: number): string {
  const scope = business ? ` in ${business}` : ' (admin-scope)'
  return `${count}× ${kind}${scope}: ${signature}`
}
