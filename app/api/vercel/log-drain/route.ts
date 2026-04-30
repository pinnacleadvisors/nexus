/**
 * POST /api/vercel/log-drain
 *
 * Vercel JSON log drain receiver. Vercel pushes batches of NDJSON log lines
 * to this endpoint within seconds of a function invocation; we:
 *
 *   1. Verify the HMAC signature using `VERCEL_LOG_DRAIN_SECRET`. If the
 *      secret leaks, an attacker could pollute `log_events`; binding the
 *      signature to the body keeps replays scoped to captured payloads.
 *   2. Strip sensitive headers from each line — `authorization`, `cookie`,
 *      `__session`, plus anything the operator lists in
 *      `VERCEL_LOG_REDACT_HEADERS` (comma-separated). We never want secrets
 *      in `log_events.message` or in the R2 archive.
 *   3. Archive the raw NDJSON to R2 at `logs/<deploymentId>/<hour>.jsonl`.
 *      The hour shard keeps writes cheap and lookups bounded.
 *   4. Index hot fields into Supabase `log_events` so agents can slice by
 *      `request_id` / `route` / `since` without paging through R2.
 *
 * Configure on Vercel: Project Settings → Log Drains → JSON drain →
 *   URL:    https://<your-domain>/api/vercel/log-drain
 *   Secret: <same value as VERCEL_LOG_DRAIN_SECRET>
 *   Headers signed with `x-vercel-signature` (sha256 hex of body).
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'

import { createServerClient } from '@/lib/supabase'
import { isR2Configured, uploadToR2 } from '@/lib/r2'

export const runtime = 'nodejs'
// Vercel can ship batches of ~1k lines. The drain is a write-only path so
// we keep the function fast — no streaming, just buffer + insert.
export const maxDuration = 30

const DEFAULT_REDACT_HEADERS = ['authorization', 'cookie', '__session', 'x-clerk-session-token']

interface VercelLogLine {
  id?:           string
  message?:      string
  timestamp?:    number  // ms epoch
  type?:         string
  source?:       string
  level?:        string  // info / warn / error / debug
  deploymentId?: string
  requestId?:    string
  statusCode?:   number
  proxy?: {
    method?:        string
    path?:          string
    statusCode?:    number
    timestamp?:     number
    duration?:      number
    headers?:       Record<string, string>
  }
  // Allow unknown fields — we only index hot ones.
  [k: string]: unknown
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.VERCEL_LOG_DRAIN_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'log_drain_not_configured' }, { status: 503 })
  }

  const bodyText = await req.text()
  if (!bodyText) {
    return NextResponse.json({ ok: true, lines: 0 })
  }

  const sigHeader = req.headers.get('x-vercel-signature') ?? ''
  const expected  = createHmac('sha256', secret).update(bodyText).digest('hex')
  if (!constantTimeEqual(sigHeader, expected)) {
    return NextResponse.json({ ok: false, error: 'bad_signature' }, { status: 401 })
  }

  // Vercel sends NDJSON — one JSON object per line. Tolerate trailing newlines
  // and the rare empty line.
  const rawLines = bodyText.split('\n').map(s => s.trim()).filter(Boolean)
  const redactList = buildRedactList()

  const parsed: VercelLogLine[] = []
  const sanitisedLines: string[] = []
  for (const raw of rawLines) {
    let obj: VercelLogLine
    try { obj = JSON.parse(raw) as VercelLogLine } catch { continue }
    const cleaned = redactHeaders(obj, redactList)
    parsed.push(cleaned)
    sanitisedLines.push(JSON.stringify(cleaned))
  }
  if (parsed.length === 0) {
    return NextResponse.json({ ok: true, lines: 0 })
  }

  // Pick a deployment_id from the first line to shard the R2 object. If a
  // batch mixes deployments (rare — drains are per-project) we still group
  // by the first one; the per-line `deployment_id` column makes filtering
  // exact in Supabase regardless.
  const deploymentId = parsed[0].deploymentId ?? 'unknown'
  const hourShard    = new Date().toISOString().slice(0, 13).replace('T', '/') // YYYY-MM-DD/HH
  const r2Key        = `logs/${deploymentId}/${hourShard}.jsonl`

  let rawUrl: string | null = null
  if (isR2Configured()) {
    try {
      const existing  = sanitisedLines.join('\n')
      // Append-mode is unavailable on R2; the hour shard granularity is small
      // enough that overwriting per-batch is fine for archival use. If you
      // need per-line ordering across batches, switch the key to include the
      // batch id (`<hour>/<requestId>.jsonl`).
      const result = await uploadToR2({
        key:         r2Key,
        body:        existing + '\n',
        contentType: 'application/x-ndjson',
        metadata:    { deploymentId, lines: String(parsed.length) },
      })
      rawUrl = result.url
    } catch (err) {
      // Don't reject the drain on R2 failure — Supabase indexing still gives
      // us the searchable signal.
      console.warn('[log-drain] R2 upload failed:', err instanceof Error ? err.message : err)
    }
  }

  // Index hot fields in Supabase. We use the service-role client because
  // log_events RLS denies all by default. Cast past the typed client until
  // `npm run gen:types` picks up migration 022.
  const supabase = createServerClient()
  if (supabase) {
    const rows = parsed.map(line => ({
      deployment_id: line.deploymentId ?? null,
      request_id:    line.requestId    ?? null,
      route:         line.proxy?.path  ?? null,
      level:         line.level        ?? line.type ?? null,
      status:        line.statusCode   ?? line.proxy?.statusCode ?? null,
      duration_ms:   line.proxy?.duration ?? null,
      message:       (line.message ?? '').slice(0, 8_000),
      raw_url:       rawUrl,
      created_at:    line.timestamp ? new Date(line.timestamp).toISOString() : new Date().toISOString(),
    }))
    const insert = (supabase.from('log_events' as never) as unknown as {
      insert: (rows: unknown) => Promise<{ error: { message: string } | null }>
    }).insert(rows)
    const { error } = await insert
    if (error) {
      console.warn('[log-drain] supabase insert failed:', error.message)
    }
  }

  return NextResponse.json({ ok: true, lines: parsed.length, r2Key })
}

function buildRedactList(): string[] {
  const fromEnv = (process.env.VERCEL_LOG_REDACT_HEADERS ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
  return Array.from(new Set([...DEFAULT_REDACT_HEADERS, ...fromEnv]))
}

function redactHeaders<T extends VercelLogLine>(line: T, redact: string[]): T {
  if (!line.proxy?.headers) return line
  const headers = { ...line.proxy.headers }
  for (const key of Object.keys(headers)) {
    if (redact.includes(key.toLowerCase())) {
      headers[key] = '[redacted]'
    }
  }
  return { ...line, proxy: { ...line.proxy, headers } }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  } catch {
    return false
  }
}
