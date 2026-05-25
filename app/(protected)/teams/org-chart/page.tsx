/**
 * /teams/org-chart — visual org-chart view of every team across every business.
 *
 * Part 4 of task_plan-departments-and-ecosystems.md, v1. Renders a tree
 * grouped by business, where each team can be reassigned a parent (drag-
 * to-target replaced by an explicit "set parent" picker in v1 — drag-drop
 * lands later if the operator asks).
 *
 * Custom departments live next to the 7 starters; both render the same.
 */

import { auth } from '@clerk/nextjs/server'
import { GitBranch } from 'lucide-react'
import Link from 'next/link'
import { listBusinessesForUser } from '@/lib/business/db'
import type { BusinessRow } from '@/lib/business/types'
import OrgChartClient from '@/components/teams/OrgChartClient'

export const dynamic = 'force-dynamic'

export default async function OrgChartPage() {
  let businesses: BusinessRow[] = []
  try {
    const { userId } = await auth()
    if (userId) businesses = await listBusinessesForUser(userId)
  } catch { /* empty */ }

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-5">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
             style={{
               background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(245,158,11,0.06))',
               border:     '1px solid rgba(108,99,255,0.30)',
               boxShadow:  '0 1px 0 0 rgba(255,255,255,0.06) inset',
             }}>
          <GitBranch size={18} style={{ color: '#a8a3ff' }} />
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-semibold" style={{ color: '#e8e8f0' }}>Org chart</h1>
          <p className="text-xs mt-0.5" style={{ color: '#9090b0' }}>
            Reassign reporting lines across the 7 starter departments + any custom ones.
          </p>
        </div>
        <Link href="/teams" className="text-[11px] px-2.5 py-1.5 rounded-lg"
              style={{ color: '#e8e8f0', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          ← Back to spawn view
        </Link>
      </header>

      <OrgChartClient businesses={businesses} />
    </div>
  )
}
