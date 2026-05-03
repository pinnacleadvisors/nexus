'use client'

/**
 * Error boundary for every page under app/(protected)/.
 *
 * Without this, an unhandled throw in a client component (e.g. board's
 * cardsToColumns crashing on undefined input — see Sentry issue
 * 08b0af12d55d) takes down the whole shell, leaving the user with a blank
 * screen and no obvious way to recover.
 *
 * The boundary catches the throw, shows a small recoverable card with the
 * error message, and offers a Reset button (re-mounts the route segment) and
 * a Reload button (full page refresh).
 *
 * Sentry's Next.js SDK auto-reports errors caught here via its router-level
 * instrumentation, so we don't need to call `Sentry.captureException(error)`
 * manually — the SDK already saw the throw before this boundary rendered.
 */

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react'

interface Props {
  error: Error & { digest?: string }
  reset: () => void
}

export default function ProtectedErrorBoundary({ error, reset }: Props) {
  useEffect(() => {
    // Best-effort console line for local debugging. Sentry already has it.
    console.error('[(protected)/error] caught:', error)
  }, [error])

  return (
    <div className="min-h-full flex items-center justify-center p-8" style={{ backgroundColor: '#050508' }}>
      <div
        className="rounded-2xl border max-w-xl w-full p-6 space-y-4"
        style={{ backgroundColor: '#0d0d14', borderColor: '#ef444444' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center w-10 h-10 rounded-lg"
            style={{ backgroundColor: '#1a0d0d', border: '1px solid #ef444433' }}
          >
            <AlertTriangle size={18} style={{ color: '#ef4444' }} />
          </div>
          <div>
            <h1 className="text-base font-semibold" style={{ color: '#e8e8f0' }}>
              This page hit an error
            </h1>
            <p className="text-xs mt-0.5" style={{ color: '#9090b0' }}>
              The rest of the app still works — try the buttons below or pick a different page from the sidebar.
            </p>
          </div>
        </div>

        <pre
          className="text-xs font-mono p-3 rounded overflow-x-auto whitespace-pre-wrap"
          style={{ backgroundColor: '#12121e', color: '#c08080', border: '1px solid #1a1a2e' }}
        >
          {error.message || 'Unknown error'}
          {error.digest ? `\n\nDigest: ${error.digest}` : ''}
        </pre>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => reset()}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            style={{ backgroundColor: '#6c63ff', color: '#fff' }}
          >
            <RotateCcw size={13} />
            Try again
          </button>
          <button
            onClick={() => { if (typeof window !== 'undefined') window.location.reload() }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors"
            style={{ color: '#9090b0', backgroundColor: 'transparent', border: '1px solid #24243e' }}
          >
            <RefreshCw size={13} />
            Reload page
          </button>
          <a
            href="/api/health/db"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors"
            style={{ color: '#9090b0', backgroundColor: 'transparent', border: '1px solid #24243e' }}
          >
            Check DB health
          </a>
        </div>

        <p className="text-xs" style={{ color: '#55556a' }}>
          If you keep seeing this, run <code>vercel logs --follow</code> for the underlying error and check{' '}
          <a href="/manage-platform" style={{ color: '#6c63ff' }}>/manage-platform</a> → Health for cron / Supabase status.
        </p>
      </div>
    </div>
  )
}
