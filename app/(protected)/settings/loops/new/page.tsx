/**
 * /settings/loops/new — declare a new Loop. Owner-only (resolveUserIdSafe).
 */

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Repeat } from 'lucide-react'
import { resolveUserIdSafe } from '@/lib/auth/resolve-user'
import SettingsTabs from '@/components/settings/SettingsTabs'
import LoopForm from '@/components/loops/LoopForm'
import { pageBgStyle } from '@/components/loops/shared'

export const dynamic = 'force-dynamic'

export default async function NewLoopPage() {
  const userId = await resolveUserIdSafe()
  if (!userId) redirect('/sign-in')

  return (
    <div className="p-6 min-h-full" style={pageBgStyle}>
      <div className="max-w-3xl mx-auto">
        <Link href="/settings/loops" className="inline-flex items-center gap-1.5 text-[13px] mb-4" style={{ color: '#9090b0' }}>
          <ArrowLeft size={14} /> All loops
        </Link>
        <div className="mb-5 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
            style={{ background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.06))', border: '1px solid rgba(108,99,255,0.20)' }}>
            <Repeat size={18} style={{ color: '#a8a3ff' }} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold" style={{ color: '#e8e8f0' }}>New Loop</h1>
            <p className="text-sm mt-1" style={{ color: '#9090b0' }}>The platform runs the loop within these bounds. Creating it doesn’t start it — you start the first iteration from the dashboard.</p>
          </div>
        </div>

        <SettingsTabs activeTab="loops" />
        <LoopForm />
      </div>
    </div>
  )
}
