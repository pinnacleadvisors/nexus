/**
 * Shared response types for /api/dashboard/fleet.
 *
 * Extracted to its own file so the client-side <FleetOverview> can import
 * the type without pulling the server-only auth / supabase code from the
 * route file into the client bundle.
 */

import type { BusinessRow } from '@/lib/business/types'

export interface FleetBusinessMetrics {
  spend24h:         number
  revenue24h:       number
  netDelta24h:      number
  pendingApprovals: number
  lastActivityIso:  string | null
}

export type FleetBusiness = BusinessRow & { metrics: FleetBusinessMetrics }
