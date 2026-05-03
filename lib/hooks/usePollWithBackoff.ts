'use client'

/**
 * usePollWithBackoff — polling hook with exponential backoff on failure.
 *
 * Replaces the bare `setInterval(fetcher, N)` pattern that hammered failing
 * endpoints at constant cadence. The audit at docs/RETRY_STORM_AUDIT.md
 * caught this on /tools/claw/status (8s interval) and /dashboard/org (15s).
 *
 * Behavior:
 *   - Calls `fetcher` immediately on mount.
 *   - On success: schedules the next call after `intervalMs`.
 *   - On failure: schedules the next call after `intervalMs * 2^failures`,
 *     capped at `maxIntervalMs`. Resets to `intervalMs` after the next success.
 *   - Stops entirely after `maxConsecutiveFailures` and surfaces the error
 *     so the UI can show "Polling paused — click Retry".
 *   - Cleans up its timer on unmount.
 */

import { useEffect, useRef, useState, useCallback } from 'react'

interface PollOptions {
  intervalMs:               number
  maxIntervalMs?:           number
  maxConsecutiveFailures?:  number
  enabled?:                 boolean
}

export interface PollState {
  consecutiveFailures: number
  paused:              boolean
  lastError:           string | null
  /** Manually trigger a fetch — resets failures + un-pauses. */
  retry: () => void
}

export function usePollWithBackoff(
  fetcher: () => Promise<void>,
  opts: PollOptions,
): PollState {
  const {
    intervalMs,
    maxIntervalMs            = 60_000,
    maxConsecutiveFailures   = 5,
    enabled                  = true,
  } = opts

  const [consecutiveFailures, setFailures] = useState(0)
  const [paused, setPaused]                = useState(false)
  const [lastError, setLastError]          = useState<string | null>(null)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Refs avoid re-running the effect when state changes; we want the loop to
  // keep its identity for the lifetime of the component.
  const failuresRef = useRef(0)
  const pausedRef   = useRef(false)
  const enabledRef  = useRef(enabled)
  enabledRef.current = enabled

  const tick = useCallback(async () => {
    if (pausedRef.current || !enabledRef.current) return
    try {
      await fetcher()
      failuresRef.current = 0
      setFailures(0)
      setLastError(null)
      timerRef.current = setTimeout(tick, intervalMs)
    } catch (err) {
      failuresRef.current += 1
      setFailures(failuresRef.current)
      const message = err instanceof Error ? err.message : 'fetch failed'
      setLastError(message)
      if (failuresRef.current >= maxConsecutiveFailures) {
        pausedRef.current = true
        setPaused(true)
        return
      }
      // Exponential backoff capped at maxIntervalMs.
      const delay = Math.min(intervalMs * 2 ** failuresRef.current, maxIntervalMs)
      timerRef.current = setTimeout(tick, delay)
    }
  }, [fetcher, intervalMs, maxIntervalMs, maxConsecutiveFailures])

  const retry = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    failuresRef.current = 0
    pausedRef.current   = false
    setFailures(0)
    setPaused(false)
    setLastError(null)
    void tick()
  }, [tick])

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) clearTimeout(timerRef.current)
      return
    }
    void tick()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [enabled, tick])

  return { consecutiveFailures, paused, lastError, retry }
}
