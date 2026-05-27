'use client'

/**
 * FixtureModeSwitch — per-operator toggle for the dev fixture harness.
 *
 * Mounted at /settings → Access tab. When the operator flips this on:
 *   - `executeBusinessAction()` returns canned responses for every
 *     (platform, action) pair registered in lib/fixtures/actions.ts.
 *   - The Settings → Accounts page overlays synthetic rows for every
 *     platform in lib/fixtures/connected-accounts.ts.
 *   - Smoke runs, chat dispatches, graduate flows all succeed end-to-end
 *     without a single real OAuth account.
 *
 * The toggle is optimistic — UI flips immediately, PATCH fires in the
 * background. On error, the toggle reverts + an inline message surfaces.
 *
 * Coverage stats (X platforms / Y verbs) come back with the GET so the
 * operator sees what fixture mode will cover before flipping it on.
 */

import { useEffect, useState } from 'react'
import { FlaskConical, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'

interface ActiveBody {
  ok:        boolean
  enabled?:  boolean
  coverage?: {
    platforms:        number
    action_platforms: number
    action_verbs:     number
  }
  platforms?: Array<{ platform: string; display_name: string }>
  error?:    string
  degraded?: boolean
  hint?:     string
}

export default function FixtureModeSwitch() {
  const [body,    setBody]    = useState<ActiveBody | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch('/api/dev/fixtures/active', { cache: 'no-store' })
        const b = await r.json() as ActiveBody
        if (!cancelled) setBody(b)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'load failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const flip = async (next: boolean) => {
    if (pending) return
    setPending(true)
    setError(null)
    // Optimistic — flip the UI first, revert on error.
    const prev = body
    setBody(prev ? { ...prev, enabled: next } : prev)
    try {
      const r = await fetch('/api/dev/fixtures/active', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ enabled: next, reason: next ? 'manual toggle on' : 'manual toggle off' }),
      })
      const b = await r.json() as ActiveBody
      if (!b.ok) {
        setError(b.hint ? `${b.error}: ${b.hint}` : (b.error ?? 'toggle failed'))
        setBody(prev)
      } else {
        // Pull fresh state so coverage stats stay accurate.
        const r2 = await fetch('/api/dev/fixtures/active', { cache: 'no-store' })
        const b2 = await r2.json() as ActiveBody
        setBody(b2)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network error')
      setBody(prev)
    } finally {
      setPending(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 rounded-xl border" style={{ backgroundColor: '#0d0d14', borderColor: '#24243e', color: '#9090b0' }}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading fixture-mode state…
      </div>
    )
  }

  const enabled = Boolean(body?.enabled)
  const cov     = body?.coverage

  return (
    <div className="p-4 rounded-xl border" style={{ backgroundColor: '#0d0d14', borderColor: '#24243e' }}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 h-9 w-9 flex-shrink-0 rounded-lg flex items-center justify-center"
             style={{ background: enabled ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.04)', border: '1px solid rgba(168,85,247,0.30)' }}>
          <FlaskConical size={16} style={{ color: enabled ? '#c4b5fd' : '#9090b0' }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
              Dev fixture harness {enabled && <span className="ml-1.5 text-xs font-normal" style={{ color: '#c4b5fd' }}>· ON</span>}
            </h2>
            <button
              onClick={() => flip(!enabled)}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
              style={{
                background:  enabled ? 'rgba(239,68,68,0.15)'  : 'rgba(168,85,247,0.15)',
                border:      `1px solid ${enabled ? 'rgba(239,68,68,0.40)' : 'rgba(168,85,247,0.40)'}`,
                color:       enabled ? '#fca5a5' : '#c4b5fd',
              }}
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {enabled ? 'Turn fixture mode OFF' : 'Turn fixture mode ON'}
            </button>
          </div>
          <p className="mt-1 text-xs" style={{ color: '#9090b0' }}>
            When ON: <code className="font-mono" style={{ color: '#a8a3ff' }}>executeBusinessAction</code> returns canned responses without calling Composio, and <Link href="/settings/accounts" /> overlays synthetic rows for every fixture platform. Lets you exercise the full create-business → graduate → chat → smoke flow without a single real OAuth connection. Toggle off and the platform reverts to real connections instantly (next call picks up the new value within ~30 s).
          </p>
          {cov && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded px-1.5 py-0.5" style={{ background: 'rgba(255,255,255,0.04)', color: '#a8a3ff' }}>
                {cov.platforms} fixture platforms
              </span>
              <span className="rounded px-1.5 py-0.5" style={{ background: 'rgba(255,255,255,0.04)', color: '#a8a3ff' }}>
                {cov.action_verbs} canned action responses
              </span>
              {body?.platforms && body.platforms.length > 0 && (
                <span className="text-[10px]" style={{ color: '#7070a0' }}>
                  · {body.platforms.slice(0, 6).map(p => p.platform).join(', ')}{body.platforms.length > 6 ? `, +${body.platforms.length - 6} more` : ''}
                </span>
              )}
            </div>
          )}
          {error && (
            <p className="mt-2 text-xs flex items-start gap-1.5" style={{ color: '#fca5a5' }}>
              <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </p>
          )}
          {enabled && !error && (
            <p className="mt-2 text-xs flex items-start gap-1.5" style={{ color: '#86efac' }}>
              <CheckCircle2 size={12} className="mt-0.5 flex-shrink-0" />
              <span>Fixture mode active. Real OAuth + paid Composio calls are bypassed for THIS operator.</span>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/** Tiny in-file link helper to keep this component dependency-free of
 *  next/link import noise. Always use the platform's Link in V2 — this
 *  is just to keep V1 simple and avoid an import for one usage. */
function Link({ href }: { href: string }): React.JSX.Element {
  return (
    <a href={href} className="underline" style={{ color: '#a8a3ff' }}>
      /settings/accounts
    </a>
  )
}
