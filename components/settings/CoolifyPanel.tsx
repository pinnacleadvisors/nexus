'use client'

/**
 * CoolifyPanel — kill-switch + recent-activity surface for the Coolify MCP
 * (PR #191). Rendered below AccountList on /settings/accounts when:
 *   - the viewer is the platform owner (`isPlatformOwner`), AND
 *   - the page is on the Default (no-business) scope (Coolify is platform-wide)
 *
 * Two things the operator can do from here:
 *   1. See what platform-copilot has been doing in Coolify (last ~25 rows)
 *   2. Hit the Disconnect button to revoke access immediately — the MCP
 *      polls the kill switch on every call so the next agent turn fails
 *      fast with a clear "operator revoked" error.
 */

import { useEffect, useState } from 'react'
import { Loader2, Shield, ShieldOff, Activity, ExternalLink, X, AlertTriangle, CheckCircle2 } from 'lucide-react'

interface AuditRow {
  id:            string
  action:        string
  target_uuid:   string | null
  args_redacted: Record<string, unknown>
  result:        'success' | 'error' | 'rate_limited' | 'protected_uuid' | 'kill_switch'
  error_message: string | null
  duration_ms:   number | null
  created_at:    string
}

interface State {
  status:      'active' | 'revoked'
  rate_limits: { per_minute: { used: number; max: number }; per_hour: { used: number; max: number } }
  audit:       AuditRow[]
}

interface Props {
  /** 'admin' or 'business:<slug>'. Passed straight to the API so the
   *  activity feed + rate-limit counts are scope-narrowed. The kill
   *  switch is a global singleton (one big "off" button for everything),
   *  not per-scope. */
  scope: 'admin' | `business:${string}`
}

export default function CoolifyPanel({ scope }: Props) {
  const [state, setState] = useState<State | null>(null)
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    try {
      const res = await fetch(`/api/settings/coolify?scope=${encodeURIComponent(scope)}`, { cache: 'no-store' })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? `HTTP ${res.status}`)
        return
      }
      const j = (await res.json()) as { ok: true; status: 'active' | 'revoked'; rate_limits: State['rate_limits']; audit: AuditRow[] }
      setState({ status: j.status, rate_limits: j.rate_limits, audit: j.audit })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error')
    }
  }

  // Re-fetch on scope change (operator switched business in the dropdown).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload() }, [scope])
  // Light polling so the audit feed stays current while the operator is
  // watching for the agent's recent activity. 8s is gentle on the route.
  useEffect(() => {
    const t = setInterval(() => { if (!busy) void reload() }, 8_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, scope])

  async function toggle(revoke: boolean, reason?: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/coolify', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ revoke, ...(reason ? { reason } : {}) }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? `HTTP ${res.status}`)
        return
      }
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error')
    } finally {
      setBusy(false)
    }
  }

  if (!state) {
    return (
      <div
        className="mt-4 rounded-2xl p-4 text-sm flex items-center gap-2"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: '#9090b0' }}
      >
        <Loader2 size={14} className="animate-spin" /> Loading Coolify panel…
      </div>
    )
  }

  const revoked = state.status === 'revoked'

  return (
    <div
      className="mt-6 rounded-2xl p-5"
      style={{
        background:           revoked ? 'linear-gradient(135deg, rgba(239,68,68,0.06), rgba(255,255,255,0.02))' : 'linear-gradient(135deg, rgba(108,99,255,0.06), rgba(255,255,255,0.02))',
        border:               revoked ? '1px solid rgba(239,68,68,0.25)' : '1px solid rgba(108,99,255,0.20)',
        backdropFilter:       'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: revoked ? 'rgba(239,68,68,0.10)' : 'rgba(108,99,255,0.10)', border: revoked ? '1px solid rgba(239,68,68,0.30)' : '1px solid rgba(108,99,255,0.20)' }}
        >
          {revoked ? <ShieldOff size={16} style={{ color: '#fca5a5' }} /> : <Shield size={16} style={{ color: '#a8a3ff' }} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
            Coolify agent access
            <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider" style={{ background: scope === 'admin' ? 'rgba(108,99,255,0.15)' : 'rgba(99,180,255,0.15)', color: scope === 'admin' ? '#a8a3ff' : '#7eb6ff', border: scope === 'admin' ? '1px solid rgba(108,99,255,0.30)' : '1px solid rgba(99,180,255,0.30)' }}>
              {scope === 'admin' ? 'Admin scope' : `business:${scope.slice('business:'.length)}`}
            </span>
            <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider" style={{ background: revoked ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)', color: revoked ? '#fca5a5' : '#86efac', border: revoked ? '1px solid rgba(239,68,68,0.30)' : '1px solid rgba(34,197,94,0.30)' }}>
              {revoked ? 'Globally revoked' : 'Active'}
            </span>
          </div>
          <p className="text-xs mt-1" style={{ color: '#9090b0' }}>
            {scope === 'admin'
              ? <>Platform-copilot at <span className="font-mono">/manage-platform</span> can call any Coolify app (subject to <span className="font-mono">PROTECTED_UUIDS</span> on writes). Activity feed below is filtered to admin-scope only.</>
              : <>Business-copilot at <span className="font-mono">/businesses/{scope.slice('business:'.length)}/chat</span> can only call apps tagged for this business — name <span className="font-mono">nexus-business-{scope.slice('business:'.length)}-*</span> OR <span className="font-mono">custom_labels</span> with <span className="font-mono">nexus.business.slug={scope.slice('business:'.length)}</span>. Other businesses&apos; apps are structurally invisible.</>}
            {' '}Reads fire freely; writes require chat-level approval-request blocks. Disconnect is GLOBAL — revoking here disables access at every scope. See <a href="https://github.com/pinnacleadvisors/nexus/blob/main/.claude/agents/platform-copilot.md" target="_blank" rel="noopener" className="underline" style={{ color: '#a8a3ff' }}>platform-copilot.md <ExternalLink size={9} className="inline" /></a>.
          </p>
        </div>
        <button
          onClick={() => void toggle(!revoked, revoked ? undefined : 'manual disconnect from /settings/accounts')}
          disabled={busy}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
          style={revoked
            ? { background: 'linear-gradient(135deg, rgba(34,197,94,0.30), rgba(34,197,94,0.10))', border: '1px solid rgba(34,197,94,0.30)', color: '#e8e8f0' }
            : { background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}
        >
          {revoked ? <><CheckCircle2 size={12} /> Re-enable</> : <><X size={12} /> Disconnect</>}
        </button>
      </div>

      {/* Rate limit usage */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <UsageBar label="Writes / min" used={state.rate_limits.per_minute.used} max={state.rate_limits.per_minute.max} />
        <UsageBar label="Writes / hour" used={state.rate_limits.per_hour.used} max={state.rate_limits.per_hour.max} />
      </div>

      {/* Recent activity */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="px-3 py-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider" style={{ color: '#a8a3ff', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <Activity size={10} /> Recent activity ({state.audit.length})
        </div>
        {state.audit.length === 0 ? (
          <div className="px-3 py-4 text-xs text-center" style={{ color: '#55556a' }}>
            No Coolify calls yet — the agent will populate this list as it acts.
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
            {state.audit.map(row => <AuditRowItem key={row.id} row={row} />)}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 text-xs flex items-center gap-1.5" style={{ color: '#fca5a5' }}>
          <AlertTriangle size={12} /> {error}
        </div>
      )}
    </div>
  )
}

function UsageBar({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0
  const tone = pct >= 85 ? '#ef4444' : pct >= 60 ? '#fbbf24' : '#22c55e'
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(0,0,0,0.14)', border: '1px solid rgba(255,255,255,0.04)' }}>
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: '#9090b0' }}>{label}</span>
        <span className="font-mono text-[11px]" style={{ color: tone }}>{used}/{max}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: tone, transition: 'width 200ms' }} />
      </div>
    </div>
  )
}

function AuditRowItem({ row }: { row: AuditRow }) {
  const tone =
    row.result === 'success'         ? '#86efac' :
    row.result === 'error'           ? '#fca5a5' :
    row.result === 'rate_limited'    ? '#fbbf24' :
    row.result === 'protected_uuid'  ? '#fbbf24' :
                                       '#fca5a5'
  return (
    <div className="px-3 py-2 text-xs font-mono flex items-start gap-2">
      <span className="shrink-0 w-2 h-2 rounded-full mt-1.5" style={{ background: tone }} />
      <div className="flex-1 min-w-0">
        <div style={{ color: '#e8e8f0' }}>
          {row.action.replace(/^coolify_/, '')}
          {row.target_uuid && <span className="opacity-50"> · {row.target_uuid.slice(0, 8)}</span>}
        </div>
        {row.error_message && (
          <div className="mt-0.5 text-[10px]" style={{ color: '#fca5a5' }}>{row.error_message.slice(0, 200)}</div>
        )}
      </div>
      <div className="shrink-0 text-[10px] opacity-60" style={{ color: '#9090b0' }}>
        {humanize(row.created_at)}
        {row.duration_ms != null && <span className="ml-1 opacity-70">· {row.duration_ms}ms</span>}
      </div>
    </div>
  )
}

function humanize(iso: string): string {
  const ms  = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(ms / 1000)
  if (sec < 60)        return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60)        return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr  < 24)        return `${hr}h ago`
  const d  = Math.floor(hr / 24)
  return `${d}d ago`
}
