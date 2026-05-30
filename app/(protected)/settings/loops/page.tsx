/**
 * /settings/loops — the Loops list.
 *
 * Operator declares + inspects Loops here. Owner-only: guards auth() via
 * resolveUserIdSafe() (never calls auth() unguarded — see lib/auth/resolve-user.ts).
 */

import { redirect } from 'next/navigation'
import { Repeat } from 'lucide-react'
import { resolveUserIdSafe } from '@/lib/auth/resolve-user'
import SettingsTabs from '@/components/settings/SettingsTabs'
import LoopsList from '@/components/loops/LoopsList'
import { pageBgStyle } from '@/components/loops/shared'

export const dynamic = 'force-dynamic'

export default async function LoopsPage() {
  const userId = await resolveUserIdSafe()
  if (!userId) redirect('/sign-in')

  return (
    <div className="p-6 min-h-full" style={pageBgStyle}>
      <div className="max-w-5xl mx-auto">
        <div className="mb-5 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
            style={{ background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.06))', border: '1px solid rgba(108,99,255,0.20)', boxShadow: '0 1px 0 0 rgba(255,255,255,0.06) inset' }}>
            <Repeat size={18} style={{ color: '#a8a3ff' }} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold" style={{ color: '#e8e8f0' }}>Loops</h1>
            <p className="text-sm mt-1 max-w-2xl" style={{ color: '#9090b0' }}>
              Operator-configurable iteration framework. Declare an end-outcome + a delegated agent; the platform runs the loop within your cost / iteration / time caps.
            </p>
          </div>
        </div>

        <SettingsTabs activeTab="loops" />
        <LoopsList />
      </div>
    </div>
  )
}
