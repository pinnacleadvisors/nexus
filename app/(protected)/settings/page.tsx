'use client'

/**
 * Platform Settings — four tabs covering everything that *isn't* a feature.
 * Replaces the previous "Manage Platform" sidebar slot (which is actually the
 * dev console — kept at /manage-platform as its own sidebar entry).
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

import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Settings as SettingsIcon, ExternalLink } from 'lucide-react'
import AlertsPanel from '@/components/dashboard/AlertsPanel'
import TodaySpendWidget from '@/components/dashboard/TodaySpendWidget'
import SettingsTabs, { type SettingsTabId } from '@/components/settings/SettingsTabs'
import AiProviderList from '@/components/settings/AiProviderList'
import SkillsList from '@/components/settings/SkillsList'

type ContentTabId = Exclude<SettingsTabId, 'businesses' | 'accounts' | 'agents'>

function resolveTab(value: string | null): ContentTabId {
  if (value === 'alerts' || value === 'access' || value === 'skills') return value
  return 'ai'
}

function SettingsContent() {
  const searchParams = useSearchParams()
  const tab = resolveTab(searchParams?.get('tab') ?? null)

  return (
    <>
      <SettingsTabs activeTab={tab} />
      {tab === 'ai'     && <AiTab />}
      {tab === 'skills' && <SkillsTab />}
      {tab === 'alerts' && <AlertsTab />}
      {tab === 'access' && <AccessTab />}
    </>
  )
}

export default function SettingsPage() {
  return (
    <div
      className="p-6 min-h-full"
      style={{
        backgroundColor: '#050508',
        backgroundImage:
          'radial-gradient(1200px 600px at 10% -10%, rgba(108,99,255,0.10), transparent 60%), ' +
          'radial-gradient(900px 500px at 100% 100%, rgba(108,99,255,0.06), transparent 60%)',
      }}
    >
      <div className="max-w-5xl mx-auto">
        <div className="mb-5 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
            style={{
              background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.06))',
              border:     '1px solid rgba(108,99,255,0.20)',
              boxShadow:  '0 1px 0 0 rgba(255,255,255,0.06) inset',
            }}>
            <SettingsIcon size={18} style={{ color: '#a8a3ff' }} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold" style={{ color: '#e8e8f0' }}>Settings</h1>
            <p className="text-sm mt-1 max-w-2xl" style={{ color: '#9090b0' }}>
              Platform config. Dev tasks live in <Link href="/manage-platform" className="underline" style={{ color: '#a8a3ff' }}>the dev console</Link>.
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
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[10px] font-mono uppercase tracking-[0.18em] mb-2.5 flex items-center gap-2" style={{ color: '#9090b0' }}>
          <span>Today&apos;s spend</span>
          <span className="flex-1 h-px" style={{ background: 'linear-gradient(to right, rgba(255,255,255,0.08), transparent)' }} />
        </h2>
        <TodaySpendWidget />
      </div>
      <AiProviderList businessSlug={null} />
    </div>
  )
}

function SkillsTab() {
  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed max-w-2xl" style={{ color: '#9090b0' }}>
        Skills are reusable capabilities Claude Code can invoke as <code className="font-mono" style={{ color: '#a8a3ff' }}>/&lt;slug&gt;</code>. Each lives at <code className="font-mono" style={{ color: '#a8a3ff' }}>.claude/skills/&lt;name&gt;/SKILL.md</code>. Hand-curated skills land as <strong>verified</strong>; <code className="font-mono" style={{ color: '#a8a3ff' }}>skill-trainer</code> auto-generated ones land as <strong>draft</strong> until promoted.
      </p>
      <SkillsList />
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
