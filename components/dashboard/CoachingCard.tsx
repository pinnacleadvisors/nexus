'use client'

/**
 * CoachingCard — R5 of the UX consultation. Renders coaching insights
 * the business-copilot generated from platform state (KPIs, smoke
 * runs, connectors, spend, fixture-mode age, etc.).
 *
 * Lives at the top of /dashboard so the operator sees actionable
 * suggestions before drilling into per-business detail. Each insight
 * has a primary CTA button linking to the surface that resolves it.
 *
 * Hides itself when there are zero insights (don't add chrome when
 * nothing's actionable).
 *
 * Operator can dismiss individual insights — persisted in localStorage
 * keyed by `insight.id`. Auto-resurfaces if the underlying condition
 * still holds 24h later (id is stable but the dismiss-stamp expires).
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Sparkles, AlertTriangle, Info, Lightbulb, ArrowRight, X, Loader2 } from 'lucide-react'

type Severity = 'info' | 'suggestion' | 'warning'

interface CoachingInsight {
  id:           string
  kind:         string
  severity:     Severity
  title:        string
  body:         string
  action_label: string
  action_href:  string
  business_slug: string | null
}

interface CoachingResponse {
  ok:            boolean
  insights?:     CoachingInsight[]
  generated_at?: string
  error?:        string
}

const DISMISS_KEY     = 'nexus:coaching:dismissed-v1'
const DISMISS_TTL_MS  = 24 * 60 * 60 * 1000

const SEVERITY_ICON: Record<Severity, typeof AlertTriangle> = {
  warning:    AlertTriangle,
  suggestion: Lightbulb,
  info:       Info,
}

const SEVERITY_COLOR: Record<Severity, { bg: string; border: string; fg: string }> = {
  warning:    { bg: 'rgba(239,68,68,0.06)',   border: 'rgba(239,68,68,0.30)',   fg: '#f87171' },
  suggestion: { bg: 'rgba(245,158,11,0.06)',  border: 'rgba(245,158,11,0.30)',  fg: '#fbbf24' },
  info:       { bg: 'rgba(108,99,255,0.06)',  border: 'rgba(108,99,255,0.30)',  fg: '#a8a3ff' },
}

interface DismissMap { [id: string]: number }

function readDismissed(): DismissMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as DismissMap
    // Expire entries past TTL so a still-true condition resurfaces.
    const now = Date.now()
    const out: DismissMap = {}
    for (const [id, ts] of Object.entries(parsed)) {
      if (now - ts < DISMISS_TTL_MS) out[id] = ts
    }
    return out
  } catch { return {} }
}

function writeDismissed(map: DismissMap) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(DISMISS_KEY, JSON.stringify(map)) } catch { /* quota */ }
}

export default function CoachingCard() {
  const [insights, setInsights] = useState<CoachingInsight[]>([])
  const [loading, setLoading]   = useState(true)
  const [dismissed, setDismissed] = useState<DismissMap>({})

  useEffect(() => {
    setDismissed(readDismissed())
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch('/api/dashboard/coaching', { cache: 'no-store' })
        const b = await r.json() as CoachingResponse
        if (!cancelled) setInsights(b.insights ?? [])
      } catch { /* swallow */ }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  const visible = useMemo(
    () => insights.filter(i => !(i.id in dismissed)),
    [insights, dismissed],
  )

  const dismiss = (id: string) => {
    const next = { ...dismissed, [id]: Date.now() }
    setDismissed(next)
    writeDismissed(next)
  }

  if (loading) {
    // Empty placeholder — don't reserve space for content that might not exist.
    return null
  }

  if (visible.length === 0) {
    // No insights or all dismissed — hide entirely.
    return null
  }

  return (
    <div
      className="rounded-xl border p-4 sm:p-5"
      style={{
        background:           'linear-gradient(135deg, rgba(108,99,255,0.06), rgba(255,255,255,0.02))',
        backdropFilter:       'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border:               '1px solid rgba(108,99,255,0.20)',
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#e8e8f0' }}>
          <Sparkles className="h-4 w-4" style={{ color: '#a8a3ff' }} />
          Coach
          <span className="rounded-full bg-zinc-800/60 px-1.5 py-0.5 text-[10px] text-zinc-400">{visible.length}</span>
        </h2>
        <span className="text-[10px] text-zinc-500">
          Suggestions from your platform state. Dismiss any — they resurface after 24h if still true.
        </span>
      </div>

      <ul className="space-y-2">
        {visible.slice(0, 6).map(insight => {
          const Icon  = SEVERITY_ICON[insight.severity]
          const color = SEVERITY_COLOR[insight.severity]
          return (
            <li
              key={insight.id}
              className="rounded-lg border p-3"
              style={{ background: color.bg, borderColor: color.border }}
            >
              <div className="flex items-start gap-2.5">
                <Icon className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: color.fg }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-medium" style={{ color: '#e8e8f0' }}>{insight.title}</span>
                    <div className="flex items-center gap-1.5">
                      <Link
                        href={insight.action_href}
                        className="inline-flex items-center gap-0.5 text-[11px] font-medium hover:underline"
                        style={{ color: color.fg }}
                      >
                        {insight.action_label} <ArrowRight className="h-3 w-3" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => dismiss(insight.id)}
                        aria-label="Dismiss insight"
                        className="rounded p-0.5 text-zinc-500 transition hover:bg-zinc-800/60 hover:text-zinc-200"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed" style={{ color: '#9090b0' }}>{insight.body}</p>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {visible.length > 6 && (
        <p className="mt-2 text-[10px] text-zinc-500 text-center">
          + {visible.length - 6} more — dismiss above to see them.
        </p>
      )}
    </div>
  )
}
