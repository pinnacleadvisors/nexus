'use client'

/**
 * Tiny indicator showing which Claude provider is currently active.
 * Polls `/api/gateway-status` every 30 s. Lives on every protected page
 * (mounted from the sidebar / mission control header) so the operator
 * always sees at-a-glance whether traffic is plan-billed (Max) or
 * token-billed (API).
 *
 *   green  Claude Code gateway healthy + claude CLI logged in (FREE)
 *   amber  Gateway healthy but claude not logged in OR fallback to OpenClaw
 *   red    Falling back to ANTHROPIC_API_KEY (token-billed)
 *   grey   Nothing configured
 */

import { useEffect, useState } from 'react'
import { Server, ZapOff, AlertTriangle, CircleDot } from 'lucide-react'

interface Status {
  provider:       'gateway' | 'openclaw' | 'api' | 'none'
  gatewayHealthy: boolean
  loggedIn?:      boolean
  queueDepth?:    number
  spentUsd:       number
  capUsd:         number
}

const POLL_MS = 30_000

export default function GatewayStatusPill() {
  const [status, setStatus] = useState<Status | null>(null)

  useEffect(() => {
    let cancelled = false
    async function tick() {
      try {
        const res = await fetch('/api/gateway-status', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json() as Status
        if (!cancelled) setStatus(json)
      } catch { /* keep last status */ }
    }
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (!status) return null

  const { color, label, Icon } = computeAppearance(status)

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{
        backgroundColor: color.bg,
        color:           color.fg,
        border:          `1px solid ${color.border}`,
      }}
      title={detailedTooltip(status)}
    >
      <Icon size={11} />
      <span>{label}</span>
      {status.queueDepth !== undefined && status.queueDepth > 0 && (
        <span style={{ opacity: 0.7 }}>· q{status.queueDepth}</span>
      )}
    </div>
  )
}

function computeAppearance(s: Status): {
  color: { bg: string; fg: string; border: string }
  label: string
  Icon:  typeof Server
} {
  if (s.provider === 'gateway' && s.gatewayHealthy && s.loggedIn) {
    return {
      color: { bg: '#0d2e1a', fg: '#4ade80', border: '#22c55e44' },
      label: 'Max (free)',
      Icon:  Server,
    }
  }
  if (s.provider === 'gateway' && s.gatewayHealthy && !s.loggedIn) {
    return {
      color: { bg: '#2a1f0d', fg: '#f59e0b', border: '#f59e0b44' },
      label: 'CLI not logged in',
      Icon:  AlertTriangle,
    }
  }
  if (s.provider === 'openclaw') {
    return {
      color: { bg: '#2a1f0d', fg: '#f59e0b', border: '#f59e0b44' },
      label: 'OpenClaw (fallback)',
      Icon:  CircleDot,
    }
  }
  if (s.provider === 'api') {
    return {
      color: { bg: '#2a1116', fg: '#ff7a90', border: '#ff4d6d44' },
      label: 'API (paying)',
      Icon:  ZapOff,
    }
  }
  return {
    color: { bg: '#1a1a2e', fg: '#9090b0', border: '#24243e' },
    label: 'No AI configured',
    Icon:  ZapOff,
  }
}

function detailedTooltip(s: Status): string {
  const lines: string[] = []
  switch (s.provider) {
    case 'gateway':
      lines.push(s.loggedIn
        ? 'Self-hosted Claude Code on Hostinger+Coolify. Plan-billed against your Max subscription — free at the per-call level.'
        : 'Gateway reachable but the claude CLI inside the container is NOT logged in. Run `docker exec -it $CT claude login`.'
      )
      break
    case 'openclaw':
      lines.push('Falling back to OpenClaw / MyClaw. Subscription-billed.')
      break
    case 'api':
      lines.push('Falling back to ANTHROPIC_API_KEY. Token-billed — every call costs money.')
      break
    case 'none':
      lines.push('No AI provider configured. Set CLAUDE_CODE_GATEWAY_URL or ANTHROPIC_API_KEY in Doppler.')
      break
  }
  if (s.queueDepth !== undefined) lines.push(`Queue depth: ${s.queueDepth}`)
  lines.push(`Today: $${s.spentUsd.toFixed(2)} / $${s.capUsd.toFixed(2)}`)
  return lines.join('\n')
}
