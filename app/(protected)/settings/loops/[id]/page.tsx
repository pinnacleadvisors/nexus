/**
 * /settings/loops/[id] — Loop dashboard (iteration log + cost + controls).
 * Owner-only (resolveUserIdSafe).
 */

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { resolveUserIdSafe } from '@/lib/auth/resolve-user'
import SettingsTabs from '@/components/settings/SettingsTabs'
import LoopDashboard from '@/components/loops/LoopDashboard'
import { pageBgStyle } from '@/components/loops/shared'

export const dynamic = 'force-dynamic'

export default async function LoopDetailPage(props: { params: Promise<{ id: string }> }) {
  const userId = await resolveUserIdSafe()
  if (!userId) redirect('/sign-in')
  const { id } = await props.params

  return (
    <div className="p-6 min-h-full" style={pageBgStyle}>
      <div className="max-w-5xl mx-auto">
        <Link href="/settings/loops" className="inline-flex items-center gap-1.5 text-[13px] mb-4" style={{ color: '#9090b0' }}>
          <ArrowLeft size={14} /> All loops
        </Link>
        <SettingsTabs activeTab="loops" />
        <LoopDashboard loopId={id} />
      </div>
    </div>
  )
}
