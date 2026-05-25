/**
 * /admin-triggers — operator dashboard for owner-only manual triggers.
 *
 * v12 renamed `app/api/cron/<owner-only>` → `app/api/admin-trigger/` because
 * cron-job.org doesn't call them. v13 puts a UI on top so the operator can
 * invoke each one without curl. Owner-only (ALLOWED_USER_IDS) enforced at
 * the route level — this page just renders the buttons.
 */

import { Wrench } from 'lucide-react'
import AdminTriggersClient from '@/components/admin-triggers/AdminTriggersClient'

export const dynamic = 'force-dynamic'

export default function AdminTriggersPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-5">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
             style={{
               background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(245,158,11,0.06))',
               border:     '1px solid rgba(108,99,255,0.30)',
               boxShadow:  '0 1px 0 0 rgba(255,255,255,0.06) inset',
             }}>
          <Wrench size={18} style={{ color: '#a5b4fc' }} />
        </div>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: '#e8e8f0' }}>Admin triggers</h1>
          <p className="text-xs mt-0.5" style={{ color: '#9090b0' }}>
            Manual triggers for sweeps + rebuilds that are NOT registered with cron-job.org. Owner-only.
          </p>
        </div>
      </header>
      <AdminTriggersClient />
    </div>
  )
}
