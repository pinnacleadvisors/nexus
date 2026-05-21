'use client'

/**
 * ProviderPreferencesPanel — subscription tier + execution mode dropdowns.
 *
 * Renders inside an AiProviderCard, persists to /api/provider-prefs which
 * upserts a `name='preferences'` row on user_secrets with JSONB metadata
 * (migration 045). The values feed intelligent routing decisions — execution
 * mode 'node-pty' is metadata today (Task G2 in
 * task_plan-claude-headless-cost-recovery.md wires the actual execution).
 *
 * Auto-detect of subscription tier is intentionally NOT implemented in this
 * PR — the upstream platforms don't expose plan tier via API/MCP, so the
 * toggle is manual. A follow-up will derive a hint from gateway_turns weekly
 * limit hits once token persistence (PR #241) is healthy.
 */

import { useEffect, useState } from 'react'
import { Check, Loader2, Sliders, AlertCircle } from 'lucide-react'

interface PrefsOptions {
  subscription_tier: readonly string[]
  execution_mode:    readonly string[]
}

interface Prefs {
  subscription_tier?: string
  execution_mode?:    string
}

export default function ProviderPreferencesPanel({
  providerId, providerName,
}: {
  providerId:   'anthropic' | 'openai'
  providerName: string
}) {
  const [prefs,   setPrefs]   = useState<Prefs>({})
  const [options, setOptions] = useState<PrefsOptions | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState<'tier' | 'mode' | null>(null)
  const [saved,   setSaved]   = useState<'tier' | 'mode' | null>(null)
  const [err,     setErr]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/provider-prefs?provider=${providerId}`)
        if (!res.ok) throw new Error(`load failed: ${res.status}`)
        const json = await res.json() as { prefs: Prefs; options: PrefsOptions }
        if (!cancelled) {
          setPrefs(json.prefs)
          setOptions(json.options)
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'load failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [providerId])

  async function save(field: 'subscription_tier' | 'execution_mode', value: string) {
    const which: 'tier' | 'mode' = field === 'subscription_tier' ? 'tier' : 'mode'
    setSaving(which); setErr(null); setSaved(null)
    try {
      const res = await fetch('/api/provider-prefs', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ provider: providerId, [field]: value }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(j.error ?? `save failed: ${res.status}`)
      }
      const json = await res.json() as { prefs: Prefs }
      setPrefs(json.prefs)
      setSaved(which)
      setTimeout(() => setSaved(null), 2000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed')
    } finally {
      setSaving(null)
    }
  }

  if (loading || !options) {
    return (
      <div className="flex items-center gap-2 text-[11px] pt-1" style={{ color: '#9090b0' }}>
        <Loader2 size={11} className="animate-spin" /> Loading preferences…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 pt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider"
        style={{ color: '#9090b0' }}>
        <Sliders size={10} />
        <span>Routing preferences</span>
      </div>

      <PrefDropdown
        id={`${providerId}-tier`}
        label={`${providerName} plan`}
        value={prefs.subscription_tier ?? ''}
        options={options.subscription_tier}
        placeholder="Select tier…"
        busy={saving === 'tier'}
        saved={saved === 'tier'}
        onChange={(v) => void save('subscription_tier', v)}
      />
      <PrefDropdown
        id={`${providerId}-mode`}
        label="Execution mode"
        value={prefs.execution_mode ?? ''}
        options={options.execution_mode}
        placeholder="Select mode…"
        busy={saving === 'mode'}
        saved={saved === 'mode'}
        onChange={(v) => void save('execution_mode', v)}
      />

      <p className="text-[10px] leading-relaxed" style={{ color: '#55556a' }}>
        Manual toggle. Auto-detect lands once gateway_turns has token data.
        Execution mode <code className="font-mono">node-pty</code> is metadata
        today — wired by Task G2 of the cost-recovery plan.
      </p>

      {err && (
        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: '#f87171' }}>
          <AlertCircle size={11} /> {err}
        </div>
      )}
    </div>
  )
}

function PrefDropdown({
  id, label, value, options, placeholder, busy, saved, onChange,
}: {
  id:          string
  label:       string
  value:       string
  options:     readonly string[]
  placeholder: string
  busy:        boolean
  saved:       boolean
  onChange:    (v: string) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={id} className="text-[11px] shrink-0" style={{ color: '#c0c0d0' }}>
        {label}
      </label>
      <div className="flex items-center gap-1.5 flex-1 max-w-[60%]">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={busy}
          className="flex-1 px-2 py-1 text-[11px] rounded font-mono"
          style={{
            background:   'rgba(255,255,255,0.04)',
            border:       '1px solid rgba(255,255,255,0.10)',
            color:        '#e8e8f0',
            outline:      'none',
          }}
        >
          <option value="" disabled>{placeholder}</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <span className="w-3 h-3 inline-flex items-center justify-center">
          {busy  && <Loader2 size={11} className="animate-spin" style={{ color: '#9090b0' }} />}
          {saved && <Check   size={11} style={{ color: '#4ade80' }} />}
        </span>
      </div>
    </div>
  )
}
