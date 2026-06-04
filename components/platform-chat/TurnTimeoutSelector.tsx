'use client'

/**
 * Per-turn timeout selector — Phase 1 of task_plan-mobile-copilot.md.
 *
 * Lets the operator pick how long the gateway should allow this turn to run
 * before killing the spawned Claude CLI. The chip sits in the chat composer
 * footer next to ChatProviderToggle / ContextIndicator.
 *
 * Wire shape:
 *   ┌─ UI ────────────────────────────────────────────────────────────────┐
 *   │  ┌─ <TurnTimeoutSelector> ─┐                                         │
 *   │  │  reads/writes localStorage; returns ms (null = "no limit")        │
 *   │  └────┬────────────────────┘                                         │
 *   │       │                                                              │
 *   │   send(...) body.requestTimeoutMs                                    │
 *   └───────┼──────────────────────────────────────────────────────────────┘
 *           │
 *   ┌─ POST /api/(platform|business)-chat ─┐
 *   │  PlatformChatBody.requestTimeoutMs   │
 *   │     ↓                                │
 *   │  enqueueGatewayJob({ requestTimeoutMs })
 *   │     ↓                                │
 *   │  JSON.stringify body                 │
 *   └──────┼───────────────────────────────┘
 *          │
 *   ┌─ gateway POST /api/jobs ─────────────┐
 *   │  messageBodySchema.parse(...)        │
 *   │  effectiveTimeoutMs(...)             │ ← clamps to env REQUEST_MAX_MS
 *   │     ↓                                │
 *   │  runClaude({ timeoutMs })            │
 *   └──────────────────────────────────────┘
 *
 * The gateway is the source of truth for the upper bound (REQUEST_TIMEOUT_MS
 * env var). Picking a higher preset here just means "ask for the cap"; the
 * server silently clamps.
 *
 * Default = 5 minutes — matches the operator's mental model of the current
 * cap. "No limit" omits the field entirely so the gateway uses its env cap.
 */

import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'

export interface TurnTimeoutPreset {
  label: string
  ms:    number | null  // null = omit field, use gateway env cap
}

export const TURN_TIMEOUT_PRESETS: readonly TurnTimeoutPreset[] = [
  { label: '5m',       ms:  5 * 60 * 1000 },
  { label: '15m',      ms: 15 * 60 * 1000 },
  { label: '30m',      ms: 30 * 60 * 1000 },
  { label: '60m',      ms: 60 * 60 * 1000 },
  { label: 'No limit', ms: null },
] as const

export const DEFAULT_TURN_TIMEOUT_MS: number | null = TURN_TIMEOUT_PRESETS[0].ms

/**
 * Hook — persists the operator's last pick in localStorage so it carries
 * across page reloads. Returns the current value and a setter that updates
 * both state and storage atomically. Storage value is `'null'` for the
 * "No limit" option and a numeric string otherwise.
 */
export function useTurnTimeoutMs(storageKey: string): {
  value:    number | null
  setValue: (v: number | null) => void
} {
  const [value, setValue] = useState<number | null>(DEFAULT_TURN_TIMEOUT_MS)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw === null) return
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate persisted turn-timeout from localStorage on mount
      if (raw === 'null') { setValue(null); return }
      const n = Number(raw)
      if (Number.isFinite(n) && n > 0) {
        // Only accept values that match a known preset — otherwise reset.
        const match = TURN_TIMEOUT_PRESETS.find(p => p.ms === n)
        if (match) setValue(match.ms)
      }
    } catch { /* localStorage unavailable — ignore */ }
  }, [storageKey])

  function update(v: number | null) {
    setValue(v)
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(storageKey, v === null ? 'null' : String(v))
    } catch { /* ignore */ }
  }

  return { value, setValue: update }
}

export function TurnTimeoutSelector({
  value,
  onChange,
}: {
  value:    number | null
  onChange: (v: number | null) => void
}) {
  const [open, setOpen] = useState(false)
  const current = TURN_TIMEOUT_PRESETS.find(p => p.ms === value) ?? TURN_TIMEOUT_PRESETS[0]

  // Close on outside click. Cheap implementation — listens once while open,
  // removes when closed. No global state, no portal.
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as HTMLElement | null
      if (t && t.closest('[data-turn-timeout-selector]')) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className="relative" data-turn-timeout-selector>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={`Per-turn timeout: ${current.label}. The gateway clamps to its env cap REQUEST_TIMEOUT_MS. Pick a longer preset for codex-delegate / Playwright runs.`}
        aria-label={`Turn timeout: ${current.label}. Click to change.`}
        className="inline-flex items-center gap-1 px-2 py-1 min-h-[28px] rounded text-[11px] hover:opacity-100 opacity-80 transition-opacity"
        style={{
          background: 'rgba(108,99,255,0.10)',
          border:     '1px solid rgba(108,99,255,0.20)',
          color:      '#a8a3ff',
        }}
      >
        <Clock size={11} />
        <span className="font-mono">{current.label}</span>
      </button>
      {open && (
        <div
          className="absolute bottom-full right-0 mb-1 rounded-lg overflow-hidden z-20"
          style={{
            background:           'rgba(20,20,30,0.96)',
            border:               '1px solid rgba(255,255,255,0.10)',
            backdropFilter:       'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            minWidth:             '120px',
            boxShadow:            '0 10px 32px rgba(0,0,0,0.4)',
          }}
        >
          {TURN_TIMEOUT_PRESETS.map(p => {
            const active = p.ms === current.ms
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => { onChange(p.ms); setOpen(false) }}
                className="w-full text-left px-3 py-2 min-h-[40px] text-[12px] hover:bg-white/5 font-mono transition-colors"
                style={{ color: active ? '#a8a3ff' : '#9090b0' }}
              >
                {p.label}
                {active && <span className="float-right opacity-60">✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
