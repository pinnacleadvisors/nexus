'use client'

/**
 * PlatformHealthWidget — single-glance "is the platform alive?" card.
 *
 * Mounted at the top of /dashboard so the operator's first eye-touch
 * answers the question they actually have: "is anything broken right
 * now?" Backed by the existing GET /api/health/deep — no new infra,
 * just a UI surface for data we already have.
 *
 * Surfaces per-upstream status (claude_gateway, codex_gateway, supabase,
 * redis) plus a summary chip. Pull-only — the operator clicks "Refresh"
 * to re-probe; we don't auto-poll because the underlying route fires
 * real HTTP calls to each upstream and we don't want to add traffic on
 * a page that's already heavy.
 *
 * Mobile-first — chips wrap at 375px. Tap a chip to see the latency +
 * error inline; nothing nested in a modal.
 */

import { useEffect, useState } from 'react'
import { CheckCircle2, AlertCircle, Loader2, RefreshCw, Pause } from 'lucide-react'

type CheckId = 'claude_gateway' | 'codex_gateway' | 'supabase' | 'redis'

interface CheckResult {
  ok:         boolean
  latency_ms: number
  error?:     string
  skipped?:   string
}

interface HealthBody {
  ok:          boolean
  checks?:     Record<CheckId, CheckResult>
  duration_ms?: number
  fetched_at?: string
  error?:      string
}

const LABEL: Record<CheckId, string> = {
  claude_gateway: 'Claude gateway',
  codex_gateway:  'Codex gateway',
  supabase:       'Supabase',
  redis:          'Redis',
}

export default function PlatformHealthWidget() {
  const [body,    setBody]    = useState<HealthBody | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [openId,  setOpenId]  = useState<CheckId | null>(null)

  const fetchHealth = async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/health/deep', { cache: 'no-store' })
      const b = await r.json() as HealthBody
      setBody(b)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void fetchHealth() }, [])

  const overall = body?.ok
  const checks  = body?.checks
  const ids     = (checks ? Object.keys(checks) : []) as CheckId[]
  const fetched = body?.fetched_at ? new Date(body.fetched_at).toLocaleTimeString() : null

  return (
    <div
      className="rounded-xl border p-4"
      style={{ backgroundColor: '#0d0d14', borderColor: '#24243e' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: '#e8e8f0' }}>
            Platform health
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: '#9090b0' }} />}
            {!loading && overall === true  && <CheckCircle2 className="h-4 w-4" style={{ color: '#4ade80' }} />}
            {!loading && overall === false && <AlertCircle  className="h-4 w-4" style={{ color: '#fbbf24' }} />}
          </h2>
          <p className="text-[11px] mt-0.5" style={{ color: '#9090b0' }}>
            {error
              ? <span style={{ color: '#fca5a5' }}>⚠ {error}</span>
              : loading
                ? 'Probing upstreams…'
                : fetched
                  ? <>Last checked {fetched}{body?.duration_ms ? <> · <span className="font-mono">{body.duration_ms}ms</span></> : null}</>
                  : 'No reading yet.'}
          </p>
        </div>
        <button
          onClick={fetchHealth}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition disabled:opacity-50"
          style={{ background: 'rgba(168,163,255,0.10)', border: '1px solid rgba(168,163,255,0.22)', color: '#a8a3ff' }}
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh
        </button>
      </div>

      {checks && ids.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {ids.map(id => {
            const c = checks[id]
            const isOpen = openId === id
            const dot = c.skipped
              ? '#9090b0'                          // grey — env var unset
              : c.ok
                ? '#4ade80'                        // green — healthy
                : '#f87171'                        // red — failing
            return (
              <button
                key={id}
                onClick={() => setOpenId(isOpen ? null : id)}
                className="rounded-lg border px-2.5 py-1.5 text-left transition"
                style={{
                  background:  isOpen ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
                  borderColor: isOpen ? 'rgba(168,163,255,0.30)' : 'rgba(255,255,255,0.10)',
                  minWidth:    '7.5rem',
                }}
              >
                <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: '#e8e8f0' }}>
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: dot, boxShadow: `0 0 6px ${dot}88` }} />
                  {LABEL[id]}
                  {c.skipped && <Pause className="h-3 w-3" style={{ color: '#9090b0' }} />}
                </div>
                <div className="text-[10px] mt-0.5 font-mono" style={{ color: '#9090b0' }}>
                  {c.skipped ? 'skipped' : c.ok ? `${c.latency_ms}ms` : 'down'}
                </div>
                {isOpen && (c.skipped || c.error) && (
                  <div className="text-[10px] mt-1.5 max-w-[14rem] break-words" style={{ color: c.error ? '#fca5a5' : '#9090b0' }}>
                    {c.skipped ?? c.error}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}

      {!loading && !error && !checks && (
        <p className="text-[11px] mt-2" style={{ color: '#9090b0' }}>
          No health data returned. Click Refresh to re-probe.
        </p>
      )}
    </div>
  )
}
