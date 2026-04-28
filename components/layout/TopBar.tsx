'use client'

/**
 * Slim top-bar that sits above the page content on every protected route.
 * Currently just hosts the gateway-status pill so the operator always
 * sees which provider is active — Mission Control adds richer widgets
 * inside its own page body.
 */

import GatewayStatusPill from '@/components/dashboard/GatewayStatusPill'

export default function TopBar() {
  return (
    <div
      className="flex items-center justify-end gap-3 px-4 py-2 border-b shrink-0"
      style={{ backgroundColor: '#0d0d14', borderColor: '#24243e' }}
    >
      <GatewayStatusPill />
    </div>
  )
}
