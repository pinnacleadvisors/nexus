/**
 * /cron-health — operator dashboard of all Nexus crons on cron-job.org.
 *
 * Catches the "26 failed executions before auto-disable email" class —
 * the dashboard sorts failures + disabled to the top so the operator
 * sees them on the first glance, and surfaces last + next execution per
 * cron.
 */

import { Activity } from 'lucide-react'
import CronHealthClient from '@/components/cron-health/CronHealthClient'

export const dynamic = 'force-dynamic'

export default function CronHealthPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-5">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
             style={{
               background: 'linear-gradient(135deg, rgba(245,158,11,0.30), rgba(108,99,255,0.06))',
               border:     '1px solid rgba(245,158,11,0.30)',
               boxShadow:  '0 1px 0 0 rgba(255,255,255,0.06) inset',
             }}>
          <Activity size={18} style={{ color: '#fbbf24' }} />
        </div>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: '#e8e8f0' }}>Cron health</h1>
          <p className="text-xs mt-0.5" style={{ color: '#9090b0' }}>
            Live status of every Nexus cron on cron-job.org. Disabled + failing jobs surface first.
          </p>
        </div>
      </header>
      <CronHealthClient />
    </div>
  )
}
