/**
 * /audit — Bloomberg-terminal platform-activity view.
 *
 * Owner-only (ALLOWED_USER_IDS gate). A multi-pane terminal over existing
 * activity tables — agents, crons, skills, tool/MCP calls, gateway turns,
 * approvals, heartbeats, errors. Each pane streams (Supabase Realtime,
 * Group B) or polls an existing endpoint; this server shell pre-fetches the
 * default table panes so the operator sees data on first paint.
 *
 * Reuses existing tables only (no new infra). See task_plan-bloomberg-audit.md
 * + lib/audit/sources.ts for the source→table mapping.
 */

import { redirect } from 'next/navigation'
import { resolveUserIdSafe } from '@/lib/auth/resolve-user'
import AuditTerminal from '@/components/audit/AuditTerminal'
import { DEFAULT_TAB_IDS, getSource } from '@/lib/audit/sources'
import { fetchAuditRows } from './actions'
import type { AuditRecord } from '@/lib/audit/types'
import { ShieldCheck } from 'lucide-react'

export const dynamic = 'force-dynamic'

function isOwner(userId: string): boolean {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw?.trim()) return true
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean)).has(userId)
}

export default async function AuditPage() {
  // resolveUserIdSafe() guards against auth() throwing when the Clerk
  // middleware context is missing (proxy.ts) — otherwise this owner-only page
  // 500s instead of bouncing. redirect() is OUTSIDE the helper so
  // NEXT_REDIRECT propagates.
  const userId = await resolveUserIdSafe()
  if (!userId)          redirect('/')
  if (!isOwner(userId)) redirect('/dashboard')

  // Pre-fetch default panes backed by a table (agents, errors). Poll-backed
  // defaults (crons) hydrate client-side. Failures degrade to an empty pane.
  const tableDefaults = DEFAULT_TAB_IDS.filter(id => getSource(id)?.table)
  const results = await Promise.all(tableDefaults.map(id => fetchAuditRows(id)))
  const initialData: Record<string, AuditRecord[]> = {}
  tableDefaults.forEach((id, i) => { initialData[id] = results[i].ok ? results[i].rows : [] })

  return (
    <div className="min-h-full px-4 py-5 md:px-6" style={{ backgroundColor: '#050508' }}>
      <header className="mb-4 flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-zinc-400" />
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: '#e8e8f0' }}>Audit terminal</h1>
          <p className="text-sm" style={{ color: '#9090b0' }}>
            Every stream of platform activity in one place. Add panes, filter, freeze to review.
          </p>
        </div>
      </header>

      <AuditTerminal initialData={initialData} />
    </div>
  )
}
