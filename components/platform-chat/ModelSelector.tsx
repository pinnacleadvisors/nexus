'use client'

/**
 * Per-turn model selector — Phase 1 of task_plan-collaborative-chat.md.
 *
 * Operator picks the model for THIS turn. Default falls back to the
 * operator's saved preference per chat surface (localStorage), then to
 * the registry default in `lib/chat/models.ts`.
 *
 * The value is forwarded via the dispatch body as `modelOverride`. The
 * gateway adds `--model <id>` to the spawned `claude` CLI. For codex-direct
 * the route uses a different dispatch path entirely (see ChatProviderToggle —
 * which this selector will eventually subsume in a Phase 2 follow-up).
 *
 * Sits in the composer footer alongside TurnTimeoutSelector + ModeSelector.
 * Mirrors the TurnTimeoutSelector shape for visual consistency.
 */

import { useEffect, useState } from 'react'
import { Cpu } from 'lucide-react'
import { AVAILABLE_MODELS, DEFAULT_MODEL_ID, getModelById, type ChatModel } from '@/lib/chat/models'

export function useChatModel(storageKey: string): {
  value:    string
  setValue: (v: string) => void
} {
  const [value, setValue] = useState<string>(DEFAULT_MODEL_ID)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(storageKey)
      // Accept any saved id — the dropdown only writes valid ids, and the list
      // may now include models auto-discovered beyond AVAILABLE_MODELS. The
      // gateway validates the actual --model id and errors clearly if bad.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe: localStorage can only be read post-mount; a lazy initializer would hydration-mismatch the rendered chip.
      if (raw) setValue(raw)
    } catch { /* localStorage unavailable */ }
  }, [storageKey])

  function update(v: string) {
    setValue(v)
    if (typeof window === 'undefined') return
    try { window.localStorage.setItem(storageKey, v) } catch { /* ignore */ }
  }

  return { value, setValue: update }
}

export function ModelSelector({
  value,
  onChange,
}: {
  value:    string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  // Start from the static whitelist, then hydrate with /api/models/available
  // which merges newer Claude models discovered from the Anthropic models API
  // (so a fresh release appears without a code edit). Static stays the fallback.
  const [models, setModels] = useState<readonly ChatModel[]>(AVAILABLE_MODELS)
  useEffect(() => {
    let cancelled = false
    fetch('/api/models/available', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((j: { models?: ChatModel[] } | null) => { if (!cancelled && j?.models?.length) setModels(j.models) })
      .catch(() => { /* keep static fallback */ })
    return () => { cancelled = true }
  }, [])
  const current = models.find(m => m.id === value) ?? getModelById(value)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as HTMLElement | null
      if (t && t.closest('[data-model-selector]')) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className="relative" data-model-selector>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={`Model: ${current.label}${current.hint ? ` — ${current.hint}` : ''}`}
        aria-label={`Model: ${current.label}. Click to change.`}
        className="inline-flex items-center gap-1 px-2 py-1 min-h-[28px] rounded text-[11px] hover:opacity-100 opacity-80 transition-opacity"
        style={{
          background: 'rgba(108,99,255,0.10)',
          border:     '1px solid rgba(108,99,255,0.20)',
          color:      '#a8a3ff',
        }}
      >
        <Cpu size={11} />
        {/* Phase 2D — hide label at < sm to keep composer chips in one row.
            Icon + tap-to-open is enough; operator sees the current pick
            in the dropdown's checkmark when they open it. */}
        <span className="font-mono hidden sm:inline">{current.label}</span>
      </button>
      {open && (
        <div
          className="absolute bottom-full right-0 mb-1 rounded-lg overflow-hidden z-20"
          style={{
            background:           'rgba(20,20,30,0.96)',
            border:               '1px solid rgba(255,255,255,0.10)',
            backdropFilter:       'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            minWidth:             '260px',
            boxShadow:            '0 10px 32px rgba(0,0,0,0.4)',
          }}
        >
          {models.map(m => {
            const active = m.id === current.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => { onChange(m.id); setOpen(false) }}
                className="w-full text-left px-3 py-2.5 min-h-[44px] text-[12px] hover:bg-white/5 transition-colors block"
                style={{ color: active ? '#a8a3ff' : '#9090b0' }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono">{m.label}</span>
                  {active && <span className="opacity-60">✓</span>}
                </div>
                {m.hint && (
                  <div className="text-[10.5px] mt-0.5 leading-snug" style={{ color: '#7a7a90' }}>{m.hint}</div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export type { ChatModel }
