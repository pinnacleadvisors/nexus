'use client'

/**
 * Slim top-bar that sits above the page content on every protected route.
 * Hosts the gateway-status pill + the fixture-mode badge (R11) so the
 * operator always sees which provider is active AND whether they're
 * looking at synthetic data.
 */

import GatewayStatusPill from '@/components/dashboard/GatewayStatusPill'
import FixtureModeBadge  from '@/components/layout/FixtureModeBadge'

export default function TopBar() {
  return (
    <div
      className="flex items-center justify-end gap-3 px-4 py-2 border-b shrink-0"
      style={{ backgroundColor: '#0d0d14', borderColor: '#24243e' }}
    >
      <FixtureModeBadge />
      <GatewayStatusPill />
    </div>
  )
}
