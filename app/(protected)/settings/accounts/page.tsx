/**
 * /settings/accounts — Composio-brokered OAuth connections.
 *
 * Liquid-glass control surface. Resolves the user's businesses server-side
 * and hands them to a Client-side <BusinessSwitcher /> dropdown so the
 * operator can scope the page to a workspace without hand-editing the URL.
 *
 * Optional ?businessSlug=<slug> still drives the underlying fetches — the
 * switcher is a UI on top of that contract, not a replacement for it.
 *
 * For the connected list / provider grid / API-key paste form see
 * components/settings/AccountList.tsx.
 */

import { Suspense } from 'react'
import { auth } from '@clerk/nextjs/server'
import { Loader2, Settings as SettingsIcon } from 'lucide-react'
import SettingsTabs from '@/components/settings/SettingsTabs'
import AccountList from '@/components/settings/AccountList'
import BusinessSwitcher from '@/components/settings/BusinessSwitcher'
import CoolifyPanel from '@/components/settings/CoolifyPanel'
import { ADMIN_SCOPE } from '@/lib/claw/business-client'
import { listBusinessesForUser } from '@/lib/business/db'
import type { BusinessRow } from '@/lib/business/types'

// Owner-only — the Admin scope picker only renders for users in ALLOWED_USER_IDS.
// When the env var is unset (single-user mode), every authenticated user is the
// owner. Mirrors the proxy.ts owner gate.
function isPlatformOwner(userId: string): boolean {
  const raw = process.env.ALLOWED_USER_IDS?.trim()
  if (!raw) return true
  return raw.split(',').map(s => s.trim()).filter(Boolean).includes(userId)
}

export const dynamic = 'force-dynamic'

export default async function AccountsSettingsPage(props: { searchParams: Promise<{ businessSlug?: string }> }) {
  const { businessSlug } = await props.searchParams

  // Server-side: resolve the user's businesses for the switcher. If the
  // session is missing (shouldn't happen behind the protected layout) we
  // gracefully fall back to an empty list — the switcher renders "Default"
  // only and AccountList still works.
  let businesses: BusinessRow[] = []
  let showAdmin = false
  try {
    const { userId } = await auth()
    if (userId) {
      businesses = await listBusinessesForUser(userId)
      showAdmin  = isPlatformOwner(userId)
    }
  } catch {
    businesses = []
  }

  const selectedSlug = businessSlug ?? null
  const selectedBiz  = selectedSlug ? businesses.find(b => b.slug === selectedSlug) ?? null : null

  return (
    <div
      className="p-6 min-h-full"
      style={{
        // Subtle ambient gradient under the dark base — the liquid-glass
        // panes pull a hint of it through their backdrop blur.
        backgroundColor: '#050508',
        backgroundImage:
          'radial-gradient(1200px 600px at 10% -10%, rgba(108,99,255,0.10), transparent 60%), ' +
          'radial-gradient(900px 500px at 100% 100%, rgba(108,99,255,0.06), transparent 60%)',
      }}
    >
      <div className="max-w-5xl mx-auto">
        {/* Heading */}
        <div className="mb-5 flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
            style={{
              background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.06))',
              border:     '1px solid rgba(108,99,255,0.20)',
              boxShadow:  '0 1px 0 0 rgba(255,255,255,0.06) inset',
            }}
          >
            <SettingsIcon size={18} style={{ color: '#a8a3ff' }} />
          </div>
          <div className="min-w-0">
            <h1
              className="text-xl font-semibold"
              style={{ color: '#e8e8f0' }}
            >
              Connected Accounts
            </h1>
            <p className="text-sm mt-1 max-w-2xl" style={{ color: '#9090b0' }}>
              OAuth connections brokered through Composio (tokens live in Composio) and direct API-key platforms (key encrypted in DB with{' '}
              <code className="font-mono" style={{ color: '#a8a3ff' }}>ENCRYPTION_KEY</code>). Pick a business below to scope all reads and writes.
            </p>
          </div>
        </div>

        <SettingsTabs activeTab="accounts" />

        {/* Liquid-glass control bar — switcher LEFT, summary chip RIGHT.
            position:relative + z-index lifts the bar (and its absolute-positioned
            dropdown) above the AccountList siblings, which create their own
            stacking contexts via backdrop-filter and would otherwise paint on top. */}
        <div
          className="relative mb-5 p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4"
          style={{
            zIndex:               50,
            background:           'linear-gradient(135deg, rgba(108,99,255,0.06), rgba(255,255,255,0.02))',
            backdropFilter:       'blur(28px) saturate(180%)',
            WebkitBackdropFilter: 'blur(28px) saturate(180%)',
            border:               '1px solid rgba(255,255,255,0.10)',
            borderRadius:         '18px',
            boxShadow:
              '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 24px 48px -24px rgba(0,0,0,0.5)',
          }}
        >
          <BusinessSwitcher businesses={businesses} selectedSlug={selectedSlug} showAdmin={showAdmin} />
          <div className="flex-1 flex items-center justify-end gap-2 min-w-0">
            <ScopeChip selectedSlug={selectedSlug} selectedName={selectedBiz?.name ?? null} />
          </div>
        </div>

        <Suspense
          fallback={
            <div
              className="flex items-center gap-2 text-sm px-4 py-3"
              style={{
                color:                '#9090b0',
                background:           'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
                backdropFilter:       'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border:               '1px solid rgba(255,255,255,0.06)',
                borderRadius:         '14px',
              }}
            >
              <Loader2 size={14} className="animate-spin" /> Loading connections…
            </div>
          }
        >
          <AccountList businessSlug={selectedSlug} />
        </Suspense>

        {/* Coolify panel — owner-only, scope-aware (PR #193).
            - Admin scope         → full power (every app), admin activity feed
            - Business scope      → filtered to that business's apps + audit
            - Default/Shared      → hidden (Coolify isn't a shared-token resource) */}
        {showAdmin && selectedSlug === ADMIN_SCOPE && <CoolifyPanel scope="admin" />}
        {showAdmin && selectedSlug && selectedSlug !== ADMIN_SCOPE && selectedBiz && (
          <CoolifyPanel scope={`business:${selectedBiz.slug}` as `business:${string}`} />
        )}
      </div>
    </div>
  )
}

function ScopeChip({ selectedSlug, selectedName }: { selectedSlug: string | null; selectedName: string | null }) {
  const label = selectedSlug ? (selectedName ?? selectedSlug) : 'Default scope'
  const slug  = selectedSlug ?? 'shared'
  return (
    <div
      className="hidden sm:flex items-center gap-2 px-3 py-1.5 text-[11px]"
      style={{
        background:   'rgba(255,255,255,0.04)',
        border:       '1px solid rgba(255,255,255,0.08)',
        borderRadius: '999px',
        color:        '#9090b0',
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{
          background: selectedSlug ? '#a8a3ff' : '#9090b0',
          boxShadow:  selectedSlug ? '0 0 8px rgba(168,163,255,0.6)' : undefined,
        }}
      />
      <span style={{ color: '#e8e8f0' }}>{label}</span>
      <span className="font-mono" style={{ color: '#55556a' }}>·</span>
      <span className="font-mono uppercase tracking-wider">{slug}</span>
    </div>
  )
}
