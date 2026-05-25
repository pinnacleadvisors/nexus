/**
 * /teams — admin dashboard for spawning + viewing departments per business.
 *
 * Server component: resolves the operator's businesses and hands them to
 * the Client TeamsClient for the actual UI. v1 surfaces:
 *   - Per-business team list
 *   - "Spawn department" picker
 *   - Ecosystem binding overview (which video adapter, which design adapter, etc.)
 *
 * See task_plan-departments-and-ecosystems.md for the architectural overlay.
 */

import { auth } from '@clerk/nextjs/server'
import { Users } from 'lucide-react'
import { listBusinessesForUser } from '@/lib/business/db'
import type { BusinessRow } from '@/lib/business/types'
import TeamsClient from '@/components/teams/TeamsClient'

export const dynamic = 'force-dynamic'

export default async function TeamsPage() {
  let businesses: BusinessRow[] = []
  try {
    const { userId } = await auth()
    if (userId) businesses = await listBusinessesForUser(userId)
  } catch {
    // Leave businesses empty — the client component shows an "add a
    // business first" guidance card.
  }

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-5">
      <header className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.06))',
            border:     '1px solid rgba(108,99,255,0.30)',
            boxShadow:  '0 1px 0 0 rgba(255,255,255,0.06) inset',
          }}
        >
          <Users size={18} style={{ color: '#a8a3ff' }} />
        </div>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: '#e8e8f0' }}>Teams</h1>
          <p className="text-xs mt-0.5" style={{ color: '#9090b0' }}>
            Spawn departments per business. Each department binds to swappable ecosystem adapters.
          </p>
        </div>
      </header>

      <TeamsClient businesses={businesses} />
    </div>
  )
}
