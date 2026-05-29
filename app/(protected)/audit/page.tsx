/**
 * /audit — append-only tool-call audit viewer.
 *
 * Server component. Owner-only (ALLOWED_USER_IDS gate). Lists the most
 * recent 200 rows from tool_call_audit (migration 058), filterable by agent
 * slug / MCP server / business slug / result status via URL params.
 *
 * Companion to:
 *   - lib/audit/tool-call.ts (writer)
 *   - services/mcp-* (callers — each MCP wrapper records on every tool call)
 *
 * Part of task_plan-platform-expansion.md (Task E4).
 */

import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase'
import { ShieldCheck } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface AuditRow {
  id:             string
  ts:             string
  agent_slug:     string | null
  scope:          string | null
  user_id:        string | null
  mcp_server:     string
  tool_name:      string
  args_redacted:  Record<string, unknown> | null
  result_status:  string | null
  result_excerpt: string | null
  business_slug:  string | null
  approval_id:    string | null
  latency_ms:     number | null
}

const ROW_LIMIT = 200

function isOwner(userId: string): boolean {
  const raw = process.env.ALLOWED_USER_IDS
  if (!raw?.trim()) return true
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean)).has(userId)
}

async function fetchAudit(filters: {
  agent?:    string
  mcp?:      string
  business?: string
  status?:   string
}): Promise<AuditRow[]> {
  const db = createServerClient()
  if (!db) return []
  type Chain = {
    eq:    (c: string, v: string) => Chain
    order: (col: string, opts: { ascending: boolean }) => Chain
    limit: (n: number) => Promise<{ data: unknown; error: { message: string } | null }>
  }
  let chain = (db as unknown as {
    from: (t: string) => { select: (cols: string) => Chain }
  }).from('tool_call_audit')
    .select('id,ts,agent_slug,scope,user_id,mcp_server,tool_name,args_redacted,result_status,result_excerpt,business_slug,approval_id,latency_ms') as Chain

  if (filters.agent)    chain = chain.eq('agent_slug',    filters.agent)
  if (filters.mcp)      chain = chain.eq('mcp_server',    filters.mcp)
  if (filters.business) chain = chain.eq('business_slug', filters.business)
  if (filters.status)   chain = chain.eq('result_status', filters.status)

  const res = await chain.order('ts', { ascending: false }).limit(ROW_LIMIT)
  return ((res.data ?? []) as AuditRow[]) || []
}

interface PageProps {
  searchParams: Promise<{ agent?: string; mcp?: string; business?: string; status?: string }>
}

function statusBadge(status: string | null): { color: string; label: string } {
  switch (status) {
    case 'ok':                return { color: 'bg-emerald-900/40 text-emerald-300', label: 'ok' }
    case 'error':             return { color: 'bg-red-900/40 text-red-300',         label: 'error' }
    case 'requires_approval': return { color: 'bg-amber-900/40 text-amber-300',     label: 'needs approval' }
    case 'denied':            return { color: 'bg-zinc-800 text-zinc-400',          label: 'denied' }
    case 'rate_limited':      return { color: 'bg-orange-900/40 text-orange-300',   label: 'rate limited' }
    case 'kill_switch':       return { color: 'bg-red-900/60 text-red-200',         label: 'kill switch' }
    default:                  return { color: 'bg-zinc-800 text-zinc-400',          label: status ?? '—' }
  }
}

export default async function AuditPage({ searchParams }: PageProps) {
  // auth() can THROW (not just return null) when Clerk's middleware context
  // isn't established — half-configured keys, a transient Clerk outage, or
  // the proxy.ts pass-through path (see proxy.ts:102). An unguarded call
  // then 500s the page. Capture userId in a try/catch, then redirect
  // OUTSIDE the try (redirect() throws NEXT_REDIRECT, which must propagate).
  let userId: string | null = null
  try {
    const session = await auth()
    userId = session.userId
  } catch {
    userId = null
  }
  if (!userId)            redirect('/')
  if (!isOwner(userId))   redirect('/dashboard')

  const params = await searchParams
  const filters = {
    agent:    (params.agent    || '').trim() || undefined,
    mcp:      (params.mcp      || '').trim() || undefined,
    business: (params.business || '').trim() || undefined,
    status:   (params.status   || '').trim() || undefined,
  }
  const rows = await fetchAudit(filters)

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <header className="mb-6 flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-zinc-400" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit</h1>
          <p className="text-sm text-zinc-400">
            Last {rows.length} of up to {ROW_LIMIT} tool calls. Append-only — rows are never edited or deleted.
          </p>
        </div>
      </header>

      <form method="get" className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        <input name="agent"    defaultValue={filters.agent    ?? ''} placeholder="agent slug"    className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-zinc-200 placeholder:text-zinc-600" />
        <input name="mcp"      defaultValue={filters.mcp      ?? ''} placeholder="mcp server"    className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-zinc-200 placeholder:text-zinc-600" />
        <input name="business" defaultValue={filters.business ?? ''} placeholder="business slug" className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-zinc-200 placeholder:text-zinc-600" />
        <input name="status"   defaultValue={filters.status   ?? ''} placeholder="ok | error …"  className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-zinc-200 placeholder:text-zinc-600" />
        <button type="submit" className="rounded-md bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-500">Filter</button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center">
          <p className="text-zinc-400">No audit rows match. Apply migration 058 if you expected rows; otherwise an agent must invoke a tool first.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full divide-y divide-zinc-800 text-sm">
            <thead className="bg-zinc-900/60 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Agent</th>
                <th className="px-3 py-2 text-left">MCP / Tool</th>
                <th className="px-3 py-2 text-left">Business</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 bg-zinc-950/30">
              {rows.map(r => {
                const sb = statusBadge(r.result_status)
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-2 text-zinc-400">{new Date(r.ts).toLocaleString()}</td>
                    <td className="px-3 py-2 text-zinc-200">{r.agent_slug ?? '—'}</td>
                    <td className="px-3 py-2"><span className="text-zinc-400">{r.mcp_server}</span><span className="text-zinc-600"> / </span><span className="text-zinc-200">{r.tool_name}</span></td>
                    <td className="px-3 py-2 text-zinc-400">{r.business_slug ?? '—'}</td>
                    <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs ${sb.color}`}>{sb.label}</span></td>
                    <td className="px-3 py-2 text-zinc-500">{r.latency_ms ? `${r.latency_ms}ms` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
