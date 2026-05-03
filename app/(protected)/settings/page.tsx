'use client'

/**
 * Platform Settings — four tabs covering everything that *isn't* a feature.
 * Replaces the previous "Manage Platform" sidebar slot (which is actually the
 * dev console — kept at /manage-platform under Toolbox, see /tools).
 *
 * Tabs:
 *   AI         — provider chain, cost cap, gateway health
 *   Alerts     — thresholds + Slack/email destinations (delegates to AlertsPanel)
 *   Access     — ALLOWED_USER_IDS audit + audit log link
 *   Businesses — separate page at /settings/businesses (CRUD over business_operators)
 *
 * Active tab is read from `?tab=` so deep-links and refreshes preserve state.
 * The Businesses tab navigates to its own URL because the CRUD UI deserves a
 * dedicated route; the same `<SettingsTabs />` bar renders there with that tab
 * highlighted, so navigation stays consistent in both directions.
 */

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Settings as SettingsIcon, ExternalLink } from 'lucide-react'
import AlertsPanel from '@/components/dashboard/AlertsPanel'
import GatewayStatusPill from '@/components/dashboard/GatewayStatusPill'
import TodaySpendWidget from '@/components/dashboard/TodaySpendWidget'
import SettingsTabs, { type SettingsTabId } from '@/components/settings/SettingsTabs'

type ContentTabId = Exclude<SettingsTabId, 'businesses'>

interface GatewayStatus {
  provider:       'gateway' | 'openclaw' | 'api' | 'none'
  gatewayUrl?:    string
  gatewayHealthy: boolean
  loggedIn?:      boolean
  queueDepth?:    number
}

function resolveTab(value: string | null): ContentTabId {
  if (value === 'alerts' || value === 'access') return value
  return 'ai'
}

function SettingsContent() {
  const searchParams = useSearchParams()
  const tab = resolveTab(searchParams?.get('tab') ?? null)

  return (
    <>
      <SettingsTabs activeTab={tab} />
      {tab === 'ai'     && <AiTab />}
      {tab === 'alerts' && <AlertsTab />}
      {tab === 'access' && <AccessTab />}
    </>
  )
}

export default function SettingsPage() {
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

        <Suspense fallback={<SettingsTabs activeTab="ai" />}>
          <SettingsContent />
        </Suspense>
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
