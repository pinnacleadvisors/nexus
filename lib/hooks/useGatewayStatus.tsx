'use client'

/**
 * useGatewayStatus — one poll for /api/gateway-status, many consumers.
 *
 * Before this hook the spend chip + today's-spend widget each owned their
 * own `setInterval(fetch, 30_000)`. Two components mounted on /dashboard =
 * two pollers. The audit at docs/audits/2026-05-16-platform-audit.md
 * caught 11 GETs on a single /settings page load. Fix: single Provider at
 * protected-layout level using usePollWithBackoff (per AGENTS.md retry-
 * storm checklist), every component reads the cached status via context.
 *
 * Consumers should treat `null` as "no status yet OR provider not mounted"
 * and render their loading/empty state.
 */

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { usePollWithBackoff } from './usePollWithBackoff'

export interface GatewayStatus {
  provider:       'gateway' | 'openclaw' | 'api' | 'none'
  gatewayUrl?:    string
  gatewayHealthy: boolean
  loggedIn?:      boolean
  queueDepth?:    number
  spentUsd:       number
  capUsd:         number
  scope?:         'user' | 'business'
}

const Ctx = createContext<GatewayStatus | null>(null)

// 30s matches the prior raw-setInterval cadence. Exponential backoff
// (usePollWithBackoff) protects the endpoint when it fails — defaults are
// fine: cap at 60s, pause after 5 consecutive failures.
const POLL_MS = 30_000

export function GatewayStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<GatewayStatus | null>(null)

  const fetcher = useCallback(async () => {
    // 15 s timeout — gateway-status reads from Coolify + Doppler and should
    // never take this long. Hung fetches would block the polling loop and
    // amplify cost under retry (AGENTS.md retry-storm checklist).
    const res = await fetch('/api/gateway-status', {
      cache:  'no-store',
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`gateway-status HTTP ${res.status}`)
    const json = (await res.json()) as GatewayStatus
    setStatus(json)
  }, [])

  usePollWithBackoff(fetcher, { intervalMs: POLL_MS })

  return <Ctx.Provider value={status}>{children}</Ctx.Provider>
}

/**
 * Hook returning the latest gateway status, or null if the provider isn't
 * mounted yet OR the first fetch hasn't returned. Handle null gracefully.
 */
export function useGatewayStatus(): GatewayStatus | null {
  return useContext(Ctx)
}
