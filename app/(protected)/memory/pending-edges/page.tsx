/**
 * /memory/pending-edges — operator inbox for LLM-extracted memory edges.
 *
 * Migration 065 + the v4 edge-extraction cron land mol_edge rows with
 * pending_approval=true. This page surfaces them, sorted by confidence
 * desc, with approve/reject buttons. Approved edges become canonical;
 * rejected edges stay in the table (with decision='reject') for audit.
 *
 * v5 — single scope (55bedf46-nexus) hard-coded since the platform is
 * single-tenant today. When per-business scopes come online, add a
 * scope picker.
 */

import { GitMerge } from 'lucide-react'
import { auth } from '@clerk/nextjs/server'
import { listBusinessesForUser } from '@/lib/business/db'
import type { BusinessRow } from '@/lib/business/types'
import PendingEdgesClient from '@/components/memory/PendingEdgesClient'

export const dynamic = 'force-dynamic'

const NEXUS_SCOPE_ID = '55bedf46-nexus'

export default async function PendingEdgesPage() {
  let businesses: BusinessRow[] = []
  try {
    const { userId } = await auth()
    if (userId) businesses = await listBusinessesForUser(userId)
  } catch { /* empty list is fine — only admin scope renders */ }
  return PendingEdgesPageInner({ businesses })
}

function PendingEdgesPageInner({ businesses }: { businesses: BusinessRow[] }) {
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 space-y-5">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
             style={{
               background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(245,158,11,0.06))',
               border:     '1px solid rgba(108,99,255,0.30)',
               boxShadow:  '0 1px 0 0 rgba(255,255,255,0.06) inset',
             }}>
          <GitMerge size={18} style={{ color: '#a8a3ff' }} />
        </div>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: '#e8e8f0' }}>Pending memory edges</h1>
          <p className="text-xs mt-0.5" style={{ color: '#9090b0' }}>
            LLM-extracted edges await approval before joining the canonical graph.
            Higher-confidence edges first.
          </p>
        </div>
      </header>

      <PendingEdgesClient defaultScope={NEXUS_SCOPE_ID} businesses={businesses} />
    </div>
  )
}
