/**
 * Rate limiting — Upstash Redis when configured, in-memory fallback otherwise.
 *
 * Required env vars (add to Doppler for production):
 *   UPSTASH_REDIS_REST_URL   — from Upstash console → Database → REST API
 *   UPSTASH_REDIS_REST_TOKEN — from Upstash console → Database → REST API
 *
 * Usage:
 *   const result = await rateLimit(req, { limit: 20, window: '1 m' })
 *   if (!result.success) return rateLimitResponse(result)
 */

import { NextRequest, NextResponse } from 'next/server'

// ── Types ─────────────────────────────────────────────────────────────────────
export interface RateLimitResult {
  success: boolean
  limit: number
  remaining: number
  reset: number // unix ms
}

// ── In-memory fallback (resets on cold start) ─────────────────────────────────
const store = new Map<string, { count: number; reset: number }>()

function inMemoryLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now > entry.reset) {
    store.set(key, { count: 1, reset: now + windowMs })
    return { success: true, limit, remaining: limit - 1, reset: now + windowMs }
  }

  entry.count++
  const remaining = Math.max(0, limit - entry.count)
  return { success: entry.count <= limit, limit, remaining, reset: entry.reset }
}

// ── Parse window string ('1 m', '60 s', '1 h', '1 d') ────────────────────────
function parseWindowMs(window: string): number {
  const [n, unit] = window.trim().split(/\s+/)
  const num = parseInt(n, 10)
  switch (unit?.[0]) {
    case 's': return num * 1000
    case 'm': return num * 60_000
    case 'h': return num * 3_600_000
    case 'd': return num * 86_400_000
    default:  return num * 60_000
  }
}

// ── Get identifier from request (IP address) ─────────────────────────────────
function getIdentifier(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

// ── Main rate limit function ──────────────────────────────────────────────────
export async function rateLimit(
  req: NextRequest,
  options: { limit?: number; window?: string; prefix?: string } = {},
): Promise<RateLimitResult> {
  const { limit = 30, window = '1 m', prefix = 'rl' } = options
  const windowMs = parseWindowMs(window)
  const ip = getIdentifier(req)
  const key = `${prefix}:${ip}`

  // Upstash Redis path
  const redisUrl   = process.env.UPSTASH_REDIS_REST_URL
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN

  if (redisUrl && redisToken) {
    try {
      // Use Upstash fixed-window algorithm via REST API (no SDK import needed at runtime)
      const windowSec = Math.ceil(windowMs / 1000)
      const pipeline = [
        ['INCR', key],
        ['EXPIRE', key, windowSec, 'NX'],
      ]

      const res = await fetch(`${redisUrl}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${redisToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pipeline),
      })

      if (res.ok) {
        const data = await res.json() as Array<{ result: number }>
        const count = data[0]?.result ?? 1
        const remaining = Math.max(0, limit - count)
        const reset = Date.now() + windowMs
        return { success: count <= limit, limit, remaining, reset }
      }
    } catch {
      // Fall through to in-memory on Upstash error
    }
  }

  return inMemoryLimit(key, limit, windowMs)
}

// ── Helper: build a 429 response with standard headers ────────────────────────
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests', retryAfter: Math.ceil((result.reset - Date.now()) / 1000) },
    {
      status: 429,
      headers: {
        'X-RateLimit-Limit':     String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset':     String(result.reset),
        'Retry-After':           String(Math.ceil((result.reset - Date.now()) / 1000)),
      },
    },
  )
}

// ── Helper: add rate limit headers to any response ────────────────────────────
export function addRateLimitHeaders(res: NextResponse, result: RateLimitResult): NextResponse {
  res.headers.set('X-RateLimit-Limit',     String(result.limit))
  res.headers.set('X-RateLimit-Remaining', String(result.remaining))
  res.headers.set('X-RateLimit-Reset',     String(result.reset))
  return res
}
