'use client'

/**
 * ChatProviderToggle — DEPRECATED 2026-05-24. No longer rendered in
 * PlatformChat / BusinessChat — the model dropdown ([`ModelSelector`](../platform-chat/ModelSelector.tsx))
 * now handles claude/codex routing via the selected model's `provider`
 * field in [`lib/chat/models.ts`](../../lib/chat/models.ts). Pick "Codex 5.5"
 * to route through codex-direct; any Claude model routes through claude-gateway.
 *
 * The component is kept here only because external embeds / older sessions
 * may still import it for compatibility. Safe to delete once any remaining
 * imports are migrated.
 *
 * Original purpose (historical):
 *   - 'claude'  → existing async-job path; typed blocks (iteration-plan,
 *                 approval-request, edit-plan, etc.) render normally.
 *   - 'codex'   → synchronous /api/.../chat dispatch through codex-gateway.
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
  const [mounted,  setMounted]  = useState(false)
  const [provider, setProvider] = useState<ChatProvider>('claude')

  // Hydration-safe initial state. SSR renders nothing (we don't know what
  // localStorage holds yet), the client mounts, reads the persisted value,
  // and only THEN renders the pill. Without this guard, React #418
  // (hydration mismatch) fires whenever the persisted value isn't 'claude'
  // because SSR HTML differs from client HTML on first paint.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate persisted provider after mount to avoid SSR hydration mismatch
    setProvider(readChatProvider(storageKey))
    setMounted(true)
  }, [storageKey])

  function flip() {
    const next: ChatProvider = provider === 'claude' ? 'codex' : 'claude'
    setProvider(next)
    try { window.localStorage.setItem(storageKey, next) } catch { /* ignore quota */ }
    onChange?.(next)
  }

  if (!mounted) {
    // Skeleton with stable width so the input footer doesn't reflow on hydrate.
    return <span aria-hidden="true" style={{ display: 'inline-block', width: 88, height: 16 }} />
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
