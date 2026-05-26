'use client'

/**
 * RunNowButton — one-click "tick this business now" trigger on
 * /businesses/[slug]. Dispatches the business-operator agent against the
 * current slug via POST /api/businesses/[slug]/tick.
 *
 * Why this exists: before this button shipped the operator had to open
 * /manage-platform chat + type "tick the inkbound business" + wait. This
 * button is 1 click + a toast. Combined with the simulation framework
 * (PR #356) it makes the platform genuinely interactive — you watch sim
 * businesses tick on demand, observe what they emit, approve.
 */

import { useState } from 'react'
import { Play, Loader2, Check, AlertTriangle, ExternalLink } from 'lucide-react'
import Link from 'next/link'

interface Props {
  slug: string
  /** Whether this business is in simulation mode. Visible in the button tooltip + label. */
  simulation?: boolean
}

interface TickResp {
  ok:          boolean
  sessionId?:  string | null
  dispatched?: boolean
  simulation?: boolean
  error?:      string
}

export default function RunNowButton({ slug, simulation }: Props) {
  const [state, setState] = useState<'idle' | 'running' | 'success' | 'error'>('idle')
  const [result, setResult] = useState<TickResp | null>(null)

  async function trigger(): Promise<void> {
    setState('running')
    setResult(null)
    try {
      const res = await fetch(`/api/businesses/${encodeURIComponent(slug)}/tick`, {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({}),
        signal:  AbortSignal.timeout(25_000),
      })
      const j = (await res.json().catch(() => ({}))) as TickResp
      setResult(j)
      setState(j.ok ? 'success' : 'error')
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : 'fetch_failed' })
      setState('error')
    }
  }

  const label = simulation ? 'Tick simulation' : 'Run now'
  const title = simulation
    ? 'Dispatch business-operator against this simulation. Cost-guard short-circuits real spend.'
    : 'Dispatch business-operator against this business right now (in addition to the daily cron).'

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={trigger}
        disabled={state === 'running'}
        title={title}
        className="inline-flex items-center gap-1.5 rounded-lg border border-violet-700/40 bg-violet-500/10 px-3 py-2 text-sm text-violet-200 transition hover:bg-violet-500/15 disabled:opacity-50"
      >
        {state === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        {label}
      </button>

      {state === 'success' && result?.dispatched && (
        <div className="inline-flex items-center gap-1 text-xs text-emerald-400">
          <Check className="h-3 w-3" />
          Dispatched
          {result.sessionId && (
            <Link
              href={`/manage-platform?session=${encodeURIComponent(result.sessionId)}`}
              className="ml-1 inline-flex items-center gap-0.5 underline"
              title="Open the dispatched chat session"
            >
              View session <ExternalLink className="h-2.5 w-2.5" />
            </Link>
          )}
        </div>
      )}

      {state === 'error' && (
        <div className="inline-flex max-w-[24rem] items-center gap-1 text-xs text-rose-400">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="truncate">Tick failed: {result?.error ?? 'unknown'}</span>
        </div>
      )}
    </div>
  )
}
