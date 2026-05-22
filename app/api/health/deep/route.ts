/**
 * GET /api/health/deep
 *
 * Owner-only deep liveness probe. Parallel per-provider checks for the four
 * upstreams the platform can't run without:
 *
 *   - claude_gateway  — self-hosted Claude Code (services/claude-gateway/)
 *   - codex_gateway   — self-hosted Codex CLI (services/codex-gateway/, ADR 002)
 *   - supabase        — service-role read against `tasks`
 *   - redis           — Upstash Redis PING (also backs lib/ratelimit.ts)
 *
 * Designed for two callers:
 *   1. Humans investigating production issues — one curl gives provider-level
 *      latency + error in a single JSON blob.
 *   2. The future codex-debug-loop agent (task_plan-codex-debug-loop.md Phase 2)
 *      — short-circuits a dispatch when an upstream is degraded.
 *
 * Retry-storm safe: returns HTTP **200 even when individual checks fail** —
 * the per-check `ok` flag carries the signal. A 5xx here would cause auto-
 * retrying monitors (Vercel cron, future loop) to hammer the upstream that
 * just told us it's degraded.
 *
 * Each check has a 5s timeout via AbortSignal; the overall handler caps at
 * 10s via Promise.race so a hung check can't block the response.
 *
 * Auth: Clerk + ALLOWED_USER_IDS — mirrors /api/health/db. Rate-limited at
 * 6 req/min to prevent a stuck monitor from amplifying load.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'

export const runtime  = 'nodejs'
export const dynamic  = 'force-dynamic'
export const maxDuration = 15

const PER_CHECK_TIMEOUT_MS = 5_000
const OVERALL_TIMEOUT_MS   = 10_000

type CheckId = 'claude_gateway' | 'codex_gateway' | 'supabase' | 'redis'

interface CheckResult {
  ok:           boolean
  latency_ms:   number
  error?:       string
  skipped?:     string
}

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

async function timeit<T extends Omit<CheckResult, 'latency_ms'>>(fn: () => Promise<T>): Promise<CheckResult> {
  const t0 = Date.now()
  try {
    const res = await fn()
    return { ...res, latency_ms: Date.now() - t0 }
  } catch (err) {
    return {
      ok:         false,
      latency_ms: Date.now() - t0,
      error:      err instanceof Error ? err.message : String(err),
    }
  }
}

async function probeGateway(url: string | undefined, label: string): Promise<CheckResult> {
  if (!url) return { ok: true, latency_ms: 0, skipped: `${label} env var unset` }
  return timeit(async () => {
    const target = `${url.replace(/\/$/, '')}/health`
    const res = await fetch(target, {
      method: 'GET',
      signal: AbortSignal.timeout(PER_CHECK_TIMEOUT_MS),
      headers: { 'User-Agent': 'nexus-health-deep/1' },
    })
    if (!res.ok) {
      return { ok: false, error: `${target} returned HTTP ${res.status}` }
    }
    return { ok: true }
  })
}

async function probeSupabase(): Promise<CheckResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return { ok: true, latency_ms: 0, skipped: 'supabase env vars unset' }
  return timeit(async () => {
    const client = createClient(url, key, { auth: { persistSession: false } })
    // Race the query against an explicit timeout — the supabase-js client
    // does not expose AbortSignal on .select(), so we wrap the call.
    const query = client.from('tasks').select('id').limit(1)
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`supabase probe exceeded ${PER_CHECK_TIMEOUT_MS}ms`)), PER_CHECK_TIMEOUT_MS),
    )
    const res = await Promise.race([query, timeout])
    if (res.error) return { ok: false, error: res.error.message }
    return { ok: true }
  })
}

async function probeRedis(): Promise<CheckResult> {
  const url   = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return { ok: true, latency_ms: 0, skipped: 'redis env vars unset' }
  return timeit(async () => {
    const res = await fetch(`${url.replace(/\/$/, '')}/ping`, {
      method:  'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal:  AbortSignal.timeout(PER_CHECK_TIMEOUT_MS),
    })
    if (!res.ok) {
      return { ok: false, error: `upstash returned HTTP ${res.status}` }
    }
    const body = await res.json().catch(() => null) as { result?: string } | null
    if (body?.result !== 'PONG') {
      return { ok: false, error: `unexpected PING reply: ${JSON.stringify(body)}` }
    }
    return { ok: true }
  })
}

export async function GET(req: NextRequest) {
  // Auth — owner only.
  const session = await auth()
  if (!session.userId) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  if (!isOwner(session.userId)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  const rl = await rateLimit(req, { limit: 6, window: '1 m', prefix: 'health:deep', identifier: session.userId })
  if (!rl.success) return rateLimitResponse(rl)

  const t0 = Date.now()

  // Run all checks in parallel; cap the whole batch at OVERALL_TIMEOUT_MS so a
  // hung probe can't blow past the handler timeout. allSettled ensures one
  // slow check never starves the others; the outer race adds the hard ceiling.
  const allChecks: Promise<Record<CheckId, CheckResult>> = (async () => {
    const [claude, codex, supabase, redis] = await Promise.all([
      probeGateway(process.env.CLAUDE_CODE_GATEWAY_URL, 'CLAUDE_CODE_GATEWAY_URL'),
      probeGateway(process.env.CODEX_GATEWAY_URL,       'CODEX_GATEWAY_URL'),
      probeSupabase(),
      probeRedis(),
    ])
    return { claude_gateway: claude, codex_gateway: codex, supabase, redis }
  })()

  const overallTimeout: Promise<Record<CheckId, CheckResult>> = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`overall health probe exceeded ${OVERALL_TIMEOUT_MS}ms`)), OVERALL_TIMEOUT_MS),
  )

  let checks: Record<CheckId, CheckResult>
  try {
    checks = await Promise.race([allChecks, overallTimeout])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const failed: CheckResult = { ok: false, latency_ms: OVERALL_TIMEOUT_MS, error: message }
    checks = {
      claude_gateway: failed,
      codex_gateway:  failed,
      supabase:       failed,
      redis:          failed,
    }
  }

  const liveChecks = Object.values(checks).filter(c => !c.skipped)
  const ok = liveChecks.length > 0 && liveChecks.every(c => c.ok)

  // ALWAYS 200 — per-check `ok` is the failure signal. See file header.
  return NextResponse.json({
    ok,
    checks,
    duration_ms: Date.now() - t0,
    fetched_at:  new Date().toISOString(),
  })
}
