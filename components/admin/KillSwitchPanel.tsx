'use client'

/**
 * KillSwitchPanel — Mission Control Kit Pack 02 toggle UI.
 *
 * Shows the six kill switches as toggles. Owner-only (server enforces it
 * via ALLOWED_USER_IDS in /api/kill-switches/route.ts). A flip propagates
 * within ~60 s thanks to the cache TTL in lib/kill-switches.ts.
 *
 * Embedded as a "Switches" tab on /manage-platform.
 */

import { useEffect, useState } from 'react'
import { Loader2, ShieldAlert, ShieldCheck, RefreshCw } from 'lucide-react'

interface SwitchRow {
  key:         string
  enabled:     boolean
  description: string
  updatedAt:   string
  updatedBy:   string | null
}

const KEY_LABELS: Record<string, string> = {
  llm_dispatch:        'LLM Dispatch',
  auto_assign:         'Auto-Assign',
  scheduler:           'Scheduler',
  dashboard_mutations: 'Dashboard Mutations',
  slack_warroom:       'Slack War-Room',
  swarm_consensus:     'Swarm Consensus',
}

export default function KillSwitchPanel() {
  const [switches, setSwitches] = useState<SwitchRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/kill-switches')
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setError(data.error ?? `failed (${res.status})`)
        setSwitches([])
        return
      }
      const data = await res.json() as { switches: SwitchRow[] }
      setSwitches(data.switches ?? [])
    } catch (err) {
      setError((err as Error).message)
      setSwitches([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function toggle(key: string, enabled: boolean) {
    setPending(key)
    try {
      const res = await fetch('/api/kill-switches', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ key, enabled }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setError(data.error ?? `failed (${res.status})`)
        return
      }
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2" style={{ color: '#e8e8f0' }}>
            <ShieldAlert size={16} style={{ color: '#f59e0b' }} />
            Kill switches
          </h2>
          <p className="text-xs mt-1" style={{ color: '#6c6c88' }}>
            Hot-reloadable feature gates. A flip propagates in ~60 seconds.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs disabled:opacity-50"
          style={{ color: '#9090b0', backgroundColor: '#12121e', border: '1px solid #24243e' }}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg px-4 py-3 text-sm flex items-center gap-2"
          style={{ backgroundColor: '#1a0d0d', border: '1px solid #ef444444', color: '#c08080' }}>
          {error}
        </div>
      )}

      {loading && !switches && (
        <div className="flex items-center gap-2 text-sm" style={{ color: '#6c6c88' }}>
          <Loader2 size={14} className="animate-spin" /> Loading switches…
        </div>
      )}

      {switches && (
        <div className="space-y-2">
          {switches.map(sw => {
            const isPending = pending === sw.key
            const label = KEY_LABELS[sw.key] ?? sw.key
            return (
              <div
                key={sw.key}
                className="rounded-lg border p-4 flex items-start justify-between gap-4"
                style={{ backgroundColor: '#0d0d14', borderColor: sw.enabled ? '#24243e' : '#ef444444' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {sw.enabled
                      ? <ShieldCheck size={14} style={{ color: '#22c55e' }} />
                      : <ShieldAlert size={14} style={{ color: '#ef4444' }} />}
                    <span className="font-medium text-sm" style={{ color: '#e8e8f0' }}>{label}</span>
                    <code className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: '#12121e', color: '#6c63ff' }}>
                      {sw.key}
                    </code>
                  </div>
                  <p className="text-xs mt-1.5" style={{ color: '#9090b0' }}>{sw.description}</p>
                  <p className="text-xs mt-1" style={{ color: '#55556a' }}>
                    Last updated {new Date(sw.updatedAt).toLocaleString()}
                    {sw.updatedBy ? ` by ${sw.updatedBy.slice(0, 14)}…` : ''}
                  </p>
                </div>

                <button
                  onClick={() => toggle(sw.key, !sw.enabled)}
                  disabled={isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 disabled:opacity-50"
                  style={sw.enabled
                    ? { backgroundColor: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e44' }
                    : { backgroundColor: '#ef444422', color: '#ef4444', border: '1px solid #ef444444' }}
                >
                  {isPending
                    ? <Loader2 size={12} className="animate-spin" />
                    : sw.enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
