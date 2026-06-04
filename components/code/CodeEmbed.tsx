'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, Loader2, PlugZap, RefreshCw } from 'lucide-react'

const CARD = { backgroundColor: '#0d0d14', borderColor: '#24243e' } as const

type Status = 'checking' | 'up' | 'down'

/**
 * Embeds claudecodeui, but degrades gracefully when it isn't reachable (the
 * common case until it's deployed behind the tunnel — the bare iframe otherwise
 * renders blank or a browser DNS-error page). On mount we probe the embed URL
 * with a no-cors fetch: it resolves (opaque) when the server answers and rejects
 * on DNS/connection failure, which lets us distinguish "up" from "not connected"
 * without needing CORS. See docs/runbooks/claudecodeui-setup.md.
 */
export default function CodeEmbed({ url }: { url: string }) {
  const [status, setStatus] = useState<Status>('checking')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 6000)
    fetch(url, { mode: 'no-cors', signal: ctrl.signal })
      .then(() => { if (!cancelled) setStatus('up') })
      .catch(() => { if (!cancelled) setStatus('down') })
      .finally(() => clearTimeout(timer))
    return () => { cancelled = true; ctrl.abort(); clearTimeout(timer) }
  }, [url, attempt])

  if (status === 'up') {
    return (
      <div className="rounded-xl border overflow-hidden" style={{ ...CARD, height: '72vh' }}>
        <iframe src={url} title="claudecodeui" className="w-full h-full" style={{ border: 0 }} />
      </div>
    )
  }

  return (
    <div className="rounded-xl border flex flex-col items-center justify-center text-center gap-3 px-6 py-10" style={{ ...CARD, minHeight: '40vh' }}>
      {status === 'checking' ? (
        <>
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#8a8aa0' }} />
          <p className="text-sm" style={{ color: '#8a8aa0' }}>Connecting to claudecodeui…</p>
        </>
      ) : (
        <>
          <PlugZap className="w-7 h-7" style={{ color: '#6c63ff' }} />
          <h2 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>Nexus Code isn’t connected yet</h2>
          <p className="text-xs max-w-md" style={{ color: '#8a8aa0' }}>
            The claudecodeui engine isn’t reachable at <code className="px-1 rounded" style={{ backgroundColor: '#1a1a2e' }}>{url}</code>.
            Deploy it behind the tunnel (or set <code className="px-1 rounded" style={{ backgroundColor: '#1a1a2e' }}>CODE_EMBED_URL</code>), then retry.
            See <span style={{ color: '#a8a8c0' }}>docs/runbooks/claudecodeui-setup.md</span>. The governance rail above works regardless.
          </p>
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={() => { setStatus('checking'); setAttempt((a) => a + 1) }}
              className="text-xs flex items-center gap-1 px-3 py-1.5 rounded-md border"
              style={CARD}
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-xs flex items-center gap-1 px-3 py-1.5 rounded-md border"
              style={CARD}
            >
              <ExternalLink className="w-3 h-3" /> Open in new tab
            </a>
          </div>
        </>
      )}
    </div>
  )
}
