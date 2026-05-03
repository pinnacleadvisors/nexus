/**
 * Process-local circuit breaker.
 *
 * Use case: an upstream service (Claude gateway, Tavily, GitHub) starts
 * failing intermittently. Each call to the failing service costs a real
 * dollar (LLM tokens, search quota) or a real second (function-second budget).
 * Without a breaker, every retry path keeps re-probing the broken service.
 *
 * Pattern:
 *   1. Each named breaker tracks consecutive failures and a "tripped-until" timestamp.
 *   2. On N consecutive failures (default 3), the breaker trips for cooldownMs (default 30s).
 *   3. While tripped, `shouldAttempt(name)` returns false — callers skip the call entirely
 *      and return whatever fallback they have.
 *   4. The first call after cooldown is allowed through (half-open). Success resets the
 *      failure counter; another failure re-trips for a longer cooldown.
 *
 * Cache lives at module level → reset on every Vercel cold start (every deploy),
 * which is the right interval for self-healing.
 */

interface BreakerState {
  consecutiveFailures: number
  trippedUntil:        number
  lastError?:          string
}

const STATE = new Map<string, BreakerState>()

interface BreakerOptions {
  /** Trip after this many consecutive failures. Default 3. */
  threshold?:    number
  /** Cooldown in ms before a half-open attempt is allowed. Default 30000. */
  cooldownMs?:   number
}

function getState(name: string): BreakerState {
  let s = STATE.get(name)
  if (!s) {
    s = { consecutiveFailures: 0, trippedUntil: 0 }
    STATE.set(name, s)
  }
  return s
}

/**
 * Returns false when the breaker is tripped — callers should skip the call
 * and use whatever fallback they have. Returns true to attempt the call.
 */
export function shouldAttempt(name: string): boolean {
  const s = getState(name)
  return Date.now() >= s.trippedUntil
}

/**
 * Record that the call succeeded. Resets the consecutive-failure counter.
 */
export function recordSuccess(name: string): void {
  const s = getState(name)
  s.consecutiveFailures = 0
  s.trippedUntil = 0
  s.lastError = undefined
}

/**
 * Record that the call failed. May trip the breaker.
 */
export function recordFailure(name: string, err?: unknown, opts: BreakerOptions = {}): void {
  const threshold  = opts.threshold  ?? 3
  const cooldownMs = opts.cooldownMs ?? 30_000
  const s = getState(name)
  s.consecutiveFailures += 1
  s.lastError = err instanceof Error ? err.message : err ? String(err) : undefined
  if (s.consecutiveFailures >= threshold) {
    s.trippedUntil = Date.now() + cooldownMs
    console.warn(
      `[circuit-breaker:${name}] tripped after ${s.consecutiveFailures} failures — cooldown ${Math.round(cooldownMs / 1000)}s. Last error:`,
      s.lastError ?? '(none)',
    )
  }
}

/**
 * Convenience wrapper — attempts the call only if the breaker is closed,
 * otherwise returns the fallback. Records success/failure automatically.
 */
export async function withBreaker<T>(
  name: string,
  call: () => Promise<T>,
  fallback: T,
  opts: BreakerOptions = {},
): Promise<T> {
  if (!shouldAttempt(name)) return fallback
  try {
    const result = await call()
    recordSuccess(name)
    return result
  } catch (err) {
    recordFailure(name, err, opts)
    return fallback
  }
}

/**
 * Diagnostic — returns the current state for the Health panel.
 */
export function getBreakerStates(): Array<{ name: string; tripped: boolean; failures: number; lastError?: string }> {
  const now = Date.now()
  return Array.from(STATE.entries()).map(([name, s]) => ({
    name,
    tripped:   now < s.trippedUntil,
    failures:  s.consecutiveFailures,
    lastError: s.lastError,
  }))
}
