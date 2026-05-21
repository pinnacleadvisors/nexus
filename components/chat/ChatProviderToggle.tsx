'use client'

/**
 * ChatProviderToggle — Phase 0 stub from task_plan-model-agnostic-chat.md.
 *
 * A small pill the operator clicks to flip a single chat conversation between:
 *   - 'claude'  → existing async-job path; typed blocks (iteration-plan,
 *                 approval-request, edit-plan, etc.) render normally.
 *   - 'codex'   → synchronous /api/.../chat dispatch through codex-gateway.
 *                 Cheaper (subscription-billed), but typed blocks emit
 *                 inconsistently. UI explicitly warns of this.
 *
 * Per-session-scope choice persisted in localStorage under a caller-supplied
 * key so the operator's preference survives reloads but doesn't bleed
 * between platform-chat and per-business chats.
 *
 * Throwaway by design — Task M9 replaces this with a real provider router
 * once the schema-first emission (M1-M7) makes Codex output render with the
 * same fidelity as Claude.
 */

import { useEffect, useState } from 'react'
import { Cpu, Sparkles } from 'lucide-react'

export type ChatProvider = 'claude' | 'codex'

/** Read the persisted choice from localStorage. Returns 'claude' on miss
 *  (default) or when localStorage is unavailable (SSR). */
export function readChatProvider(storageKey: string): ChatProvider {
  if (typeof window === 'undefined') return 'claude'
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw === 'codex' ? 'codex' : 'claude'
  } catch {
    return 'claude'
  }
}

export default function ChatProviderToggle({
  storageKey, onChange,
}: {
  storageKey: string
  /** Fires AFTER localStorage is updated so the parent can sync its state. */
  onChange?:  (next: ChatProvider) => void
}) {
  const [provider, setProvider] = useState<ChatProvider>('claude')

  useEffect(() => {
    setProvider(readChatProvider(storageKey))
  }, [storageKey])

  function flip() {
    const next: ChatProvider = provider === 'claude' ? 'codex' : 'claude'
    setProvider(next)
    try { window.localStorage.setItem(storageKey, next) } catch { /* ignore quota */ }
    onChange?.(next)
  }

  const isCodex = provider === 'codex'
  return (
    <button
      type="button"
      onClick={flip}
      title={isCodex
        ? 'Codex — cheaper (subscription-billed) but typed blocks may not render. Click to switch back to Claude.'
        : 'Claude — full typed-block rendering. Click to switch to Codex (cheaper).'
      }
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] transition-colors"
      style={{
        background: isCodex
          ? 'rgba(16,163,127,0.10)'
          : 'rgba(108,99,255,0.10)',
        border: isCodex
          ? '1px solid rgba(16,163,127,0.22)'
          : '1px solid rgba(108,99,255,0.22)',
        color: isCodex ? '#34d399' : '#a8a3ff',
      }}
    >
      {isCodex ? <Cpu size={10} /> : <Sparkles size={10} />}
      <span>{isCodex ? 'Codex (cheap)' : 'Claude (full)'}</span>
    </button>
  )
}
