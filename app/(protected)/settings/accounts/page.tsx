/**
 * /settings/accounts — Composio-brokered OAuth connections.
 *
 * Lists current connections + provider grid. Optional ?businessSlug=<slug>
 * scopes the page to one business (the connect/list calls inherit the scope).
 *
 * For full implementation see components/settings/AccountList.tsx.
 */

import { Suspense } from 'react'
import Link from 'next/link'
import { Settings as SettingsIcon } from 'lucide-react'
import SettingsTabs from '@/components/settings/SettingsTabs'
import AccountList from '@/components/settings/AccountList'

export const dynamic = 'force-dynamic'

export default async function AccountsSettingsPage(props: { searchParams: Promise<{ businessSlug?: string }> }) {
  const { businessSlug } = await props.searchParams

  return (
    <div className="p-6 min-h-full" style={{ backgroundColor: '#050508' }}>
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-center gap-3">
          <SettingsIcon size={22} style={{ color: '#6c63ff' }} />
          <div>
            <h1 className="text-xl font-bold" style={{ color: '#e8e8f0' }}>
              Connected Accounts
            </h1>
            <p className="text-sm mt-0.5" style={{ color: '#9090b0' }}>
              OAuth connections brokered through Composio. Tokens never touch this database — they live in Composio. Scope to a business with{' '}
              <Link href="/settings/businesses" className="underline" style={{ color: '#6c63ff' }}>?businessSlug=&lt;slug&gt;</Link>.
            </p>
          </div>
        </div>

        <SettingsTabs activeTab="accounts" />

        <Suspense fallback={<div className="text-sm" style={{ color: '#9090b0' }}>Loading…</div>}>
          <AccountList businessSlug={businessSlug || null} />
        </Suspense>
      </div>
    </div>
  )
}
