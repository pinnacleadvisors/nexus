'use client'

/**
 * Per-turn permission mode selector — Phase 1 of task_plan-collaborative-chat.md.
 *
 * Three modes: ask (default) / plan / auto. Sits in the composer footer
 * next to TurnTimeoutSelector + ModelSelector. Mirrors the TurnTimeoutSelector
 * component shape for consistency.
 *
 * The mode is forwarded via the chat dispatch body → claude-gateway → spawned
 * agent's `NEXUS_CHAT_MODE` env var. The agent's spec (platform-copilot.md,
 * business-copilot.md) reads it and branches behaviour. The gateway is a
 * transport; the semantics live in the agent.
 *
 * Operator decision (PR #285 Q2): autonomous agents like business-operator
 * are "always auto" — the dropdown shouldn't render in those chat surfaces.
 * Parent components gate by passing `surfaceSupportsModes`.
 */

import { useEffect, useState } from 'react'
import { Shield } from 'lucide-react'
import { AVAILABLE_MODES, DEFAULT_MODE, type ChatMode, getModeOption } from '@/lib/chat/modes'

/**
 * Hook — persists the operator's last pick in localStorage so it carries
 * across page reloads + chat sessions. Returns the current value and a
 * setter that updates both state and storage atomically.
 */
export function useChatMode(storageKey: string): {
  value:    ChatMode
  setValue: (v: ChatMode) => void
} {
  const [value, setValue] = useState<ChatMode>(DEFAULT_MODE)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (!raw) return
      const match = AVAILABLE_MODES.find(m => m.id === raw)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate persisted mode from localStorage on mount
      if (match) setValue(match.id)
    } catch { /* localStorage unavailable */ }
  }, [storageKey])

  function update(v: ChatMode) {
    setValue(v)
    if (typeof window === 'undefined') return
    try { window.localStorage.setItem(storageKey, v) } catch { /* ignore */ }
  }

  return { value, setValue: update }
}

export function ModeSelector({
  value,
  onChange,
}: {
  value:    ChatMode
  onChange: (v: ChatMode) => void
}) {
  const [open, setOpen] = useState(false)
  const current = getModeOption(value)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as HTMLElement | null
      if (t && t.closest('[data-mode-selector]')) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // Visual cue per mode — match operator mental model: ask=neutral, plan=cyan, auto=amber
  const accentColor =
      current.id === 'plan' ? 'rgba(56,189,248,0.55)' :    // cyan
      current.id === 'auto' ? 'rgba(245,158,11,0.55)' :    // amber
                              'rgba(108,99,255,0.55)'      // violet

  return (
    <div className="relative" data-mode-selector>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={`Mode: ${current.label} — ${current.hint}`}
        aria-label={`Permission mode: ${current.label}. Click to change.`}
        className="inline-flex items-center gap-1 px-2 py-1 min-h-[28px] rounded text-[11px] hover:opacity-100 opacity-80 transition-opacity"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border:     `1px solid ${accentColor}`,
          color:      '#e8e8f0',
        }}
      >
        <Shield size={11} />
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
            minWidth:             '260px',
            boxShadow:            '0 10px 32px rgba(0,0,0,0.4)',
          }}
        >
          {AVAILABLE_MODES.map(m => {
            const active = m.id === current.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => { onChange(m.id); setOpen(false) }}
                className="w-full text-left px-3 py-2.5 min-h-[44px] text-[12px] hover:bg-white/5 transition-colors block"
                style={{ color: active ? '#e8e8f0' : '#9090b0' }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono">{m.label}</span>
                  {active && <span className="opacity-60">✓</span>}
                </div>
                <div className="text-[10.5px] mt-0.5 leading-snug" style={{ color: '#7a7a90' }}>{m.hint}</div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
