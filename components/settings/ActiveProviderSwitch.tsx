'use client'

/**
 * ActiveProviderSwitch — operator picks which LLM provider chat + dispatch
 * routes through. Lives at the top of /settings → AI Providers above the
 * connection cards.
 *
 * Backed by ai_provider_active (migration 083) so flips persist without a
 * redeploy. On click:
 *   1. Optimistically updates the visible selection
 *   2. PATCH /api/llm-provider/active
 *   3. On success — keeps the new selection + shows "Saved Xs ago"
 *   4. On error  — reverts + shows the error inline
 *
 * Falls back to the Doppler LLM_PROVIDER env when no DB row exists. The
 * "from" badge tells the operator which source is currently winning.
 */

import { useEffect, useState } from 'react'
import { Cpu, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

type Provider = 'claude' | 'openrouter' | 'mimo' | 'ollama'

interface ActiveResponse {
  ok:          boolean
  provider:    Provider
  model:       string | null
  reason:      string | null
  source:      'db' | 'env' | 'default'
  envProvider: string | null
}

interface ProviderOption {
  id:    Provider
  label: string
  desc:  string
  ready: boolean    // false = adapter is a stub (mimo/ollama before activation)
}

const OPTIONS: ProviderOption[] = [
  { id: 'claude',     label: 'Claude',     desc: 'Anthropic via the self-hosted gateway. Plan-billed via Claude Max.', ready: true },
  { id: 'openrouter', label: 'OpenRouter', desc: '300+ models via one router. Per-token billed. Needs OPENROUTER_API_KEY.', ready: true },
  { id: 'mimo',       label: 'Mimo 2.5',   desc: 'Mimo Pro. Activate the adapter in lib/llm/providers/mimo.ts first.',  ready: false },
  { id: 'ollama',     label: 'Ollama',     desc: 'Self-hosted local model. Needs OLLAMA_BASE_URL set.',                  ready: false },
]

export default function ActiveProviderSwitch() {
  const [loading,  setLoading]  = useState(true)
  const [active,   setActive]   = useState<ActiveResponse | null>(null)
  const [busy,     setBusy]     = useState<Provider | null>(null)
  const [savedAt,  setSavedAt]  = useState<number | null>(null)
  const [err,      setErr]      = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/llm-provider/active')
        const json = await res.json() as ActiveResponse
        if (!cancelled) setActive(json)
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'load failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  async function flip(provider: Provider) {
    if (busy || !active) return
    setBusy(provider)
    setErr(null)
    const previous = active.provider
    // Optimistic update
    setActive({ ...active, provider, source: 'db' })
    try {
      const res = await fetch('/api/llm-provider/active', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, reason: `picked via /settings at ${new Date().toISOString()}` }),
      })
      const json = await res.json() as { ok: boolean; error?: string; hint?: string }
      if (!json.ok) {
        setActive({ ...active, provider: previous })
        setErr(json.hint ?? json.error ?? 'flip failed')
        return
      }
      setSavedAt(Date.now())
    } catch (e) {
      setActive({ ...active, provider: previous })
      setErr(e instanceof Error ? e.message : 'flip failed')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-2xl text-sm"
        style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))', border: '1px solid rgba(255,255,255,0.06)', color: '#9090b0' }}>
        <Loader2 size={14} className="animate-spin" /> Loading active provider…
      </div>
    )
  }
  if (!active) return null

  return (
    <div className="rounded-2xl border border-violet-500/20 bg-violet-950/10 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Cpu size={14} className="text-violet-300" />
          <h3 className="text-[12px] font-medium uppercase tracking-wider text-violet-200">Active LLM provider</h3>
          <span className="text-[10px] font-mono uppercase tracking-wider"
            style={{ color: active.source === 'db' ? '#a8a3ff' : active.source === 'env' ? '#fbbf24' : '#9090b0' }}
            title={active.source === 'db' ? 'Set from this UI (overrides Doppler)' :
                   active.source === 'env' ? 'Falling back to Doppler LLM_PROVIDER env' :
                                              'No setting — default claude'}>
            · {active.source}
          </span>
        </div>
        {savedAt && (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300">
            <CheckCircle2 size={10} /> Saved
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-zinc-400">
        Chat fallback, qa-runner fix-attempts, skill-trainer, and other AI-SDK callers route through the picked provider. Flip takes effect within ~30 s (cache TTL). Claude Code gateway dispatches stay on the gateway regardless — this only switches the AI-SDK path.
      </p>
      {err && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-950/30 px-3 py-2 text-[11px] text-red-200">
          <AlertCircle size={12} className="mt-0.5 shrink-0" /> {err}
        </div>
      )}
      {active.envProvider && active.source !== 'env' && (
        <p className="mt-2 text-[10px] text-zinc-500">
          Doppler env says <code className="font-mono text-zinc-400">{active.envProvider}</code> — your UI pick overrides until you reset.
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {OPTIONS.map(opt => {
          const picked = active.provider === opt.id
          const isBusy = busy === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => flip(opt.id)}
              disabled={isBusy || picked}
              title={opt.desc + (opt.ready ? '' : ' ⚠ Adapter is a stub until activated.')}
              className="group relative rounded-lg p-3 text-left transition-all disabled:cursor-default"
              style={{
                background: picked ? 'linear-gradient(135deg, rgba(139,92,246,0.20), rgba(139,92,246,0.06))'
                                   : 'rgba(255,255,255,0.02)',
                border:     picked ? '1px solid rgba(139,92,246,0.40)' : '1px solid rgba(255,255,255,0.08)',
                opacity:    isBusy ? 0.5 : 1,
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium" style={{ color: picked ? '#e0d4ff' : '#e8e8f0' }}>{opt.label}</span>
                {picked && <CheckCircle2 size={12} className="text-violet-300" />}
                {isBusy && <Loader2 size={12} className="animate-spin text-violet-300" />}
              </div>
              <p className="mt-1 text-[10px] text-zinc-500">{opt.desc}</p>
              {!opt.ready && (
                <span className="mt-1 inline-block text-[9px] font-mono uppercase tracking-wider text-amber-400">
                  stub — activate first
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
