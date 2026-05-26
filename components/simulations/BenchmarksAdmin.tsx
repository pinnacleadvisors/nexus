'use client'

/**
 * Benchmarks admin table + create form. Drives the CRUD APIs at
 * /api/simulations/benchmarks{/[id], /[id]/reset-baseline, /[id]/run-now,
 * /[id]/history}.
 */

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Play, Plus, RotateCcw, Trash2, Power } from 'lucide-react'
import Sparkline from './Sparkline'

export interface BenchmarkRowView {
  id:                   string
  name:                 string
  business_slug:        string
  seed:                 string
  compress_days:        number
  wallclock_budget_sec: number
  approver_policy:      'permissive' | 'skeptical' | 'random'
  synthetic_voice:      'template' | 'llm'
  drift_threshold_pct:  number
  baseline_result:      Record<string, unknown> | null
  baseline_set_at:      string | null
  last_run_at:          string | null
  last_drift_pct:       number | null
  enabled:              boolean
  created_at:           string
}

interface SimBusiness {
  slug: string
  name: string
}

interface HistoryEntry { drift_pct: number | null; ran_at: string }

export default function BenchmarksAdmin({ initialRows, simBusinesses }: { initialRows: BenchmarkRowView[]; simBusinesses: SimBusiness[] }) {
  const router = useRouter()
  const [rows, setRows]     = useState(initialRows)
  const [pending, startTx]  = useTransition()
  const [error, setError]   = useState<string | null>(null)
  const [showForm, setShow] = useState(false)
  const [runningId, setRun] = useState<string | null>(null)
  // Per-benchmark drift history — fetched on mount + after each Run/Reset.
  const [history, setHistory] = useState<Record<string, HistoryEntry[]>>({})

  const fetchHistory = async (id: string) => {
    try {
      const res  = await fetch(`/api/simulations/benchmarks/${id}/history`, { cache: 'no-store' })
      const body = await res.json() as { ok: boolean; history?: HistoryEntry[] }
      if (body.ok && body.history) setHistory(prev => ({ ...prev, [id]: body.history! }))
    } catch { /* fail silent — sparkline just doesn't render */ }
  }

  // On mount, pull history for every benchmark in parallel
  useEffect(() => {
    rows.forEach(r => { void fetchHistory(r.id) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = async () => {
    try {
      const res  = await fetch('/api/simulations/benchmarks', { cache: 'no-store' })
      const body = await res.json() as { ok: boolean; rows?: BenchmarkRowView[]; error?: string }
      if (body.ok && body.rows) setRows(body.rows)
    } catch { /* fail silent — operator can click Refresh */ }
  }

  const toggle = (id: string, enabled: boolean) => {
    setError(null)
    startTx(async () => {
      const res = await fetch(`/api/simulations/benchmarks/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ enabled }),
      })
      const body = await res.json() as { ok: boolean; error?: string }
      if (!body.ok) setError(body.error ?? 'toggle failed')
      await refresh()
    })
  }

  const resetBaseline = (id: string) => {
    if (!confirm('Reset baseline? The next run becomes the new baseline. Use this after an intentional change.')) return
    setError(null)
    startTx(async () => {
      const res = await fetch(`/api/simulations/benchmarks/${id}/reset-baseline`, { method: 'POST' })
      const body = await res.json() as { ok: boolean; error?: string }
      if (!body.ok) setError(body.error ?? 'reset failed')
      await refresh()
    })
  }

  const runNow = (id: string) => {
    setError(null)
    setRun(id)
    startTx(async () => {
      const res = await fetch(`/api/simulations/benchmarks/${id}/run-now`, { method: 'POST' })
      const body = await res.json() as { ok: boolean; summary?: { drift_pct?: number; bootstrapped?: boolean }; error?: string }
      if (!body.ok) setError(body.error ?? 'run failed')
      setRun(null)
      await refresh()
      await fetchHistory(id)   // re-pull sparkline series after the new history row landed
      router.refresh()
    })
  }

  const remove = (id: string, name: string) => {
    if (!confirm(`Delete benchmark "${name}"? This will not delete the simulation runs it created.`)) return
    setError(null)
    startTx(async () => {
      const res = await fetch(`/api/simulations/benchmarks/${id}`, { method: 'DELETE' })
      const body = await res.json() as { ok: boolean; error?: string }
      if (!body.ok) setError(body.error ?? 'delete failed')
      await refresh()
    })
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-zinc-400">{rows.length} benchmark{rows.length === 1 ? '' : 's'} configured</div>
        <button
          onClick={() => setShow(s => !s)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-violet-500"
        >
          <Plus className="h-4 w-4" /> {showForm ? 'Cancel' : 'New benchmark'}
        </button>
      </div>

      {showForm && <CreateForm simBusinesses={simBusinesses} onCreated={async () => { setShow(false); await refresh(); router.refresh() }} pending={pending} startTx={startTx} setError={setError} />}

      {error && <p className="text-sm text-rose-400">⚠︎ {error}</p>}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-400">
          No benchmarks yet. Either click <b>New benchmark</b> above, or wait for the next 06:00 UTC cron tick —
          the cron self-bootstraps a default benchmark on its first run if none exist.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Business</th>
                <th className="px-3 py-2">Config</th>
                <th className="px-3 py-2">Baseline</th>
                <th className="px-3 py-2">Last run · drift</th>
                <th className="px-3 py-2">History</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {rows.map(r => {
                const drift = r.last_drift_pct
                const driftClass =
                  drift === null ? 'text-zinc-500' :
                  Math.abs(drift) > r.drift_threshold_pct ? 'text-rose-300' :
                  Math.abs(drift) > r.drift_threshold_pct / 2 ? 'text-amber-300' :
                  'text-emerald-300'
                return (
                  <tr key={r.id} className={`bg-zinc-950/40 ${r.enabled ? '' : 'opacity-60'}`}>
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs text-zinc-100">{r.name}</div>
                      <div className="font-mono text-[10px] text-zinc-500">seed: {r.seed.slice(0, 24)}{r.seed.length > 24 ? '…' : ''}</div>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-300">{r.business_slug}</td>
                    <td className="px-3 py-2 text-xs text-zinc-400">
                      {r.compress_days}d · {r.approver_policy}
                      {r.synthetic_voice === 'llm' && <span className="ml-1 rounded bg-violet-500/20 px-1 text-violet-200">llm</span>}
                      <div className="text-[10px] text-zinc-500">drift cap {r.drift_threshold_pct}%</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.baseline_set_at
                        ? <span className="text-emerald-300/80">set {new Date(r.baseline_set_at).toLocaleDateString()}</span>
                        : <span className="text-amber-300">(pending first run)</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className={driftClass}>{drift === null ? '—' : `${drift > 0 ? '+' : ''}${drift}%`}</div>
                      {r.last_run_at && <div className="text-[10px] text-zinc-500">{new Date(r.last_run_at).toLocaleString()}</div>}
                    </td>
                    <td className="px-3 py-2" title="Drift % over the last 30 runs. Red line = at least one recent value exceeded the threshold.">
                      <Sparkline
                        values={(history[r.id] ?? []).map(h => h.drift_pct)}
                        dangerThreshold={r.drift_threshold_pct}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button onClick={() => runNow(r.id)} disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-xs text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50" title="Run now">
                          {runningId === r.id && pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Run
                        </button>
                        <button onClick={() => resetBaseline(r.id)} disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-xs text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50" title="Reset baseline">
                          <RotateCcw className="h-3 w-3" /> Re-baseline
                        </button>
                        <button onClick={() => toggle(r.id, !r.enabled)} disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-xs text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50" title={r.enabled ? 'Disable' : 'Enable'}>
                          <Power className="h-3 w-3" /> {r.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button onClick={() => remove(r.id, r.name)} disabled={pending} className="inline-flex items-center gap-1 rounded-md border border-rose-700/50 bg-rose-500/10 px-2 py-1 text-xs text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-50" title="Delete">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function CreateForm({ simBusinesses, onCreated, pending, startTx, setError }: { simBusinesses: SimBusiness[]; onCreated: () => Promise<void>; pending: boolean; startTx: (cb: () => Promise<void>) => void; setError: (e: string | null) => void }) {
  const [name, setName]               = useState('')
  const [slug, setSlug]               = useState(simBusinesses[0]?.slug ?? '')
  const [compress, setCompress]       = useState(5)
  const [policy, setPolicy]           = useState<'permissive' | 'skeptical' | 'random'>('permissive')
  const [voice, setVoice]             = useState<'template' | 'llm'>('template')
  const [drift, setDrift]             = useState(5)

  const submit = () => {
    if (!name.trim() || !slug) {
      setError('Name + business required')
      return
    }
    setError(null)
    startTx(async () => {
      const res = await fetch('/api/simulations/benchmarks', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:                 name.trim(),
          business_slug:        slug,
          compress_days:        compress,
          wallclock_budget_sec: 600,
          approver_policy:      policy,
          synthetic_voice:      voice,
          drift_threshold_pct:  drift,
        }),
      })
      const body = await res.json() as { ok: boolean; error?: string }
      if (!body.ok) {
        setError(body.error ?? 'create failed')
        return
      }
      await onCreated()
    })
  }

  return (
    <div className="rounded-xl border border-violet-700/40 bg-violet-500/5 p-4">
      <h2 className="mb-3 text-sm font-semibold text-violet-200">New benchmark</h2>
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-zinc-400">Name</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="canonical-pdf-saas" className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-100" />
        </label>
        <label className="text-sm">
          <span className="text-zinc-400">Business</span>
          <select value={slug} onChange={e => setSlug(e.target.value)} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-100">
            {simBusinesses.length === 0 && <option value="">(no sim businesses)</option>}
            {simBusinesses.map(b => <option key={b.slug} value={b.slug}>{b.name} ({b.slug})</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-zinc-400">Sim days</span>
          <input type="number" value={compress} min={1} max={365} onChange={e => setCompress(Math.max(1, Math.min(365, Number(e.target.value))))} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-100" />
        </label>
        <label className="text-sm">
          <span className="text-zinc-400">Approver policy</span>
          <select value={policy} onChange={e => setPolicy(e.target.value as typeof policy)} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-100">
            <option value="permissive">Permissive</option>
            <option value="skeptical">Skeptical</option>
            <option value="random">Random</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="text-zinc-400">Voice</span>
          <select value={voice} onChange={e => setVoice(e.target.value as typeof voice)} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-100">
            <option value="template">Template ($0)</option>
            <option value="llm">LLM (~$0.02/run)</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="text-zinc-400">Drift threshold (%)</span>
          <input type="number" value={drift} min={0.1} max={100} step={0.1} onChange={e => setDrift(Math.max(0.1, Math.min(100, Number(e.target.value))))} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-100" />
        </label>
      </div>
      <button onClick={submit} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create
      </button>
    </div>
  )
}
