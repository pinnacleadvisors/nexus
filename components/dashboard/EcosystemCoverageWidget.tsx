'use client'

/**
 * EcosystemCoverageWidget — "what can the platform actually do right now?"
 *
 * Sits next to PlatformHealthWidget on /dashboard. Health answers "is anything
 * broken"; coverage answers "which capabilities are wired vs dark". Backed by
 * GET /api/ecosystems/health (owner-only) — the registry's countAvailableByKind
 * + per-kind adapter list. Pull-only (Refresh), no auto-poll. Mobile-first:
 * chips wrap at 375px; tap a chip to see that kind's adapters inline.
 */

import { useEffect, useState } from 'react'
import { CheckCircle2, AlertCircle, Loader2, RefreshCw } from 'lucide-react'

interface AdapterInfo { name: string; label: string; available: boolean; verbs: string[] }
interface KindRow {
  kind:       string
  registered: number
  wired:      number
  dark:       boolean        // registered but none configured
  uncovered:  boolean        // no adapter at all
  adapters:   AdapterInfo[]
}
interface CoverageBody {
  ok:      boolean
  totals?: { kinds: number; kinds_uncovered: number; kinds_dark: number; adapters_registered: number; adapters_wired: number }
  kinds?:  KindRow[]
  error?:  string
}

export default function EcosystemCoverageWidget() {
  const [body,    setBody]    = useState<CoverageBody | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [openKind, setOpenKind] = useState<string | null>(null)

  const fetchCoverage = async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/ecosystems/health', { cache: 'no-store' })
      const b = await r.json() as CoverageBody
      setBody(b)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void fetchCoverage() }, [])

  const totals = body?.totals
  const kinds  = body?.kinds ?? []
  const allWired = totals ? totals.kinds_dark === 0 && totals.kinds_uncovered === 0 : undefined

  return (
    <div className="rounded-xl border p-4" style={{ backgroundColor: '#0d0d14', borderColor: '#24243e' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: '#e8e8f0' }}>
            Capability coverage
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: '#9090b0' }} />}
            {!loading && allWired === true  && <CheckCircle2 className="h-4 w-4" style={{ color: '#4ade80' }} />}
            {!loading && allWired === false && <AlertCircle  className="h-4 w-4" style={{ color: '#fbbf24' }} />}
          </h2>
          <p className="text-[11px] mt-0.5" style={{ color: '#9090b0' }}>
            {error
              ? <span style={{ color: '#fca5a5' }}>⚠ {error}</span>
              : loading
                ? 'Reading the adapter registry…'
                : totals
                  ? <><span className="font-mono">{totals.adapters_wired}/{totals.adapters_registered}</span> adapters configured · {totals.kinds} capability kinds{totals.kinds_dark > 0 ? <> · <span style={{ color: '#fca5a5' }}>{totals.kinds_dark} dark</span></> : null}</>
                  : 'No reading yet.'}
          </p>
        </div>
        <button
          onClick={fetchCoverage}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition disabled:opacity-50"
          style={{ background: 'rgba(168,163,255,0.10)', border: '1px solid rgba(168,163,255,0.22)', color: '#a8a3ff' }}
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh
        </button>
      </div>

      {kinds.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {kinds.map(k => {
            const isOpen = openKind === k.kind
            // green = at least one adapter configured; amber = registered but none
            // configured (dark); grey = no adapter at all (should not happen).
            const dot = k.uncovered ? '#9090b0' : k.wired > 0 ? '#4ade80' : '#fbbf24'
            return (
              <button
                key={k.kind}
                onClick={() => setOpenKind(isOpen ? null : k.kind)}
                className="rounded-lg border px-2.5 py-1.5 text-left transition"
                style={{
                  background:  isOpen ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
                  borderColor: isOpen ? 'rgba(168,163,255,0.30)' : 'rgba(255,255,255,0.10)',
                  minWidth:    '6.5rem',
                }}
              >
                <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: '#e8e8f0' }}>
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: dot, boxShadow: `0 0 6px ${dot}88` }} />
                  {k.kind}
                </div>
                <div className="text-[10px] mt-0.5 font-mono" style={{ color: '#9090b0' }}>
                  {k.uncovered ? 'no adapter' : `${k.wired}/${k.registered} wired`}
                </div>
                {isOpen && k.adapters.length > 0 && (
                  <div className="text-[10px] mt-1.5 max-w-[14rem] space-y-0.5">
                    {k.adapters.map(a => (
                      <div key={a.name} className="flex items-center gap-1.5" style={{ color: a.available ? '#c8e6c9' : '#9090b0' }}>
                        <span className="inline-block h-1 w-1 rounded-full" style={{ background: a.available ? '#4ade80' : '#6b6b85' }} />
                        <span className="break-words">{a.label}</span>
                        {!a.available && <span style={{ color: '#6b6b85' }}>(unconfigured)</span>}
                      </div>
                    ))}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}

      {!loading && !error && kinds.length === 0 && (
        <p className="text-[11px] mt-2" style={{ color: '#9090b0' }}>
          No coverage data returned. Click Refresh to re-read the registry.
        </p>
      )}
    </div>
  )
}
