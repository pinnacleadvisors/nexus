'use client'

/**
 * Platform Settings — three tabs covering everything that *isn't* a feature.
 * Replaces the previous "Manage Platform" sidebar slot (which is actually the
 * dev console — kept at /manage-platform under Toolbox, see /tools).
 *
 * Tabs:
 *   AI         — provider chain, cost cap, gateway health
 *   Alerts     — thresholds + Slack/email destinations (delegates to AlertsPanel)
 *   Access     — ALLOWED_USER_IDS audit + audit log link
 *
 * Rather than duplicating logic, each tab embeds existing components or links
 * to existing routes. Goal: one place to find every knob, without a 1005-line
 * file.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Settings as SettingsIcon, Server, Bell, Shield, ExternalLink } from 'lucide-react'
import AlertsPanel from '@/components/dashboard/AlertsPanel'
import GatewayStatusPill from '@/components/dashboard/GatewayStatusPill'
import TodaySpendWidget from '@/components/dashboard/TodaySpendWidget'

type TabId = 'ai' | 'alerts' | 'access'

const TABS: { id: TabId; label: string; icon: typeof Server }[] = [
  { id: 'ai',     label: 'AI providers', icon: Server },
  { id: 'alerts', label: 'Alerts',       icon: Bell },
  { id: 'access', label: 'Access',       icon: Shield },
]

interface GatewayStatus {
  provider:       'gateway' | 'openclaw' | 'api' | 'none'
  gatewayUrl?:    string
  gatewayHealthy: boolean
  loggedIn?:      boolean
  queueDepth?:    number
}

export default function SettingsPage() {
  const [tab, setTab] = useState<TabId>('ai')

  return (
    <div className="p-6 min-h-full" style={{ backgroundColor: '#050508' }}>
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-center gap-3">
          <SettingsIcon size={22} style={{ color: '#6c63ff' }} />
          <div>
            <h1 className="text-xl font-bold" style={{ color: '#e8e8f0' }}>
              Settings
            </h1>
            <p className="text-sm mt-0.5" style={{ color: '#9090b0' }}>
              Platform-level config. For development tasks, head to <Link href="/manage-platform" className="underline" style={{ color: '#6c63ff' }}>the dev console</Link>.
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 border-b" style={{ borderColor: '#24243e' }}>
          {TABS.map(t => {
            const Icon = t.icon
            const active = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors"
                style={{
                  borderColor: active ? '#6c63ff' : 'transparent',
                  color:       active ? '#e8e8f0' : '#9090b0',
                }}
              >
                <Icon size={14} />
                {t.label}
              </button>
            )
          })}
        </div>

        {tab === 'ai'     && <AiTab />}
        {tab === 'alerts' && <AlertsTab />}
        {tab === 'access' && <AccessTab />}
      </div>
    </div>
  )
}

function AiTab() {
  const [status, setStatus] = useState<GatewayStatus | null>(null)
  useEffect(() => {
    void fetch('/api/gateway-status').then(r => r.ok ? r.json() : null).then(setStatus).catch(() => {})
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold mb-2" style={{ color: '#e8e8f0' }}>
          Provider chain
        </h2>
        <p className="text-xs mb-3" style={{ color: '#9090b0' }}>
          Resolution order: Claude Code gateway → OpenClaw → ANTHROPIC_API_KEY. The pill below shows which one is active right now.
        </p>
        <GatewayStatusPill />
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-2" style={{ color: '#e8e8f0' }}>
          Today&apos;s spend
        </h2>
        <TodaySpendWidget />
      </div>

      <div
        className="p-4 rounded-xl border"
        style={{ backgroundColor: '#0d0d14', borderColor: '#24243e' }}
      >
        <h2 className="text-sm font-semibold mb-2" style={{ color: '#e8e8f0' }}>
          Configure
        </h2>
        <ul className="space-y-2 text-sm" style={{ color: '#c0c0d0' }}>
          <li className="flex items-center gap-2">
            <span style={{ color: '#55556a' }}>•</span>
            <span>OpenClaw config: </span>
            <Link href="/tools/claw" className="underline" style={{ color: '#6c63ff' }}>
              /tools/claw <ExternalLink size={11} className="inline" />
            </Link>
          </li>
          <li className="flex items-center gap-2">
            <span style={{ color: '#55556a' }}>•</span>
            <span>Gateway URL + bearer: set via Doppler (<code style={{ color: '#6c63ff' }}>CLAUDE_CODE_GATEWAY_URL</code>, <code style={{ color: '#6c63ff' }}>CLAUDE_CODE_BEARER_TOKEN</code>).</span>
          </li>
          <li className="flex items-center gap-2">
            <span style={{ color: '#55556a' }}>•</span>
            <span>Cost cap: Doppler <code style={{ color: '#6c63ff' }}>USER_DAILY_USD_LIMIT</code> (default $25).</span>
          </li>
        </ul>
        {status && (
          <div className="mt-3 pt-3 border-t text-xs" style={{ borderColor: '#24243e', color: '#55556a' }}>
            Provider: <span style={{ color: '#e8e8f0' }}>{status.provider}</span>
            {status.gatewayUrl && <> · URL: <span style={{ color: '#e8e8f0' }}>{status.gatewayUrl}</span></>}
            {status.queueDepth !== undefined && <> · Queue: <span style={{ color: '#e8e8f0' }}>{status.queueDepth}</span></>}
          </div>
        )}
      </div>
    </div>
  )
}

function AlertsTab() {
  return (
    <div>
      <p className="text-xs mb-3" style={{ color: '#9090b0' }}>
        Alert thresholds fire over Slack and email when daily cost, error rate, or other metrics cross the line.
      </p>
      <AlertsPanel />
    </div>
  )
}

function AccessTab() {
  return (
    <div className="space-y-4">
      <div
        className="p-4 rounded-xl border"
        style={{ backgroundColor: '#0d0d14', borderColor: '#24243e' }}
      >
        <h2 className="text-sm font-semibold mb-2" style={{ color: '#e8e8f0' }}>
          Allowlist (single-owner mode)
        </h2>
        <p className="text-xs" style={{ color: '#9090b0' }}>
          Set <code style={{ color: '#6c63ff' }}>ALLOWED_USER_IDS</code> in Doppler with a comma-separated list of Clerk user IDs. Any session not in this list is redirected to /sign-in. The same env var is also enforced on the Claude Code gateway container as an X-Nexus-User-Id check, so a leaked bearer cannot drain your Max plan from elsewhere.
        </p>
      </div>

      <div
        className="p-4 rounded-xl border"
        style={{ backgroundColor: '#0d0d14', borderColor: '#24243e' }}
      >
        <h2 className="text-sm font-semibold mb-2" style={{ color: '#e8e8f0' }}>
          Audit log
        </h2>
        <p className="text-xs mb-2" style={{ color: '#9090b0' }}>
          Every authenticated mutation lands in <code style={{ color: '#6c63ff' }}>audit_events</code> with userId, action, resource, and metadata. Inspect via:
        </p>
        <Link
          href="/api/audit"
          className="inline-flex items-center gap-1 text-sm underline"
          style={{ color: '#6c63ff' }}
        >
          /api/audit <ExternalLink size={12} />
        </Link>
      </div>
    </div>
  )
}
