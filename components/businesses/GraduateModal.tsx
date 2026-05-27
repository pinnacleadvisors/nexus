'use client'

/**
 * GraduateModal — operator confirms sim → real-money flip with a
 * pre-flight checklist visible before they hit Confirm.
 *
 * Flow:
 *   1. Operator clicks "Graduate to production" on /businesses/[slug]
 *   2. Modal opens; useEffect fetches GET /api/businesses/<slug>/graduate
 *      → preflight checklist + ready flag
 *   3. Operator reads each check; clicks Confirm when all green
 *      (button disabled when not ready unless they toggle "force")
 *   4. POST /api/businesses/<slug>/graduate → flips simulation=false +
 *      audit log entry
 *   5. Modal closes, router.refresh() so the sim badge disappears
 */

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, AlertCircle, Loader2, X, Zap } from 'lucide-react'

interface CheckResult { name: string; ok: boolean; hint: string }
interface PreflightBody {
  ok:       boolean
  ready?:   boolean
  checks?:  CheckResult[]
  error?:   string
}

interface ProvisionResult {
  ok:      boolean
  skipped: 'lean_mode' | 'coolify_unconfigured' | 'opted_out' | null
  uuid?:   string
  fqdn?:   string
  error?:  string
  detail?: string
}

interface GraduateResp {
  ok:                boolean
  graduated?:        boolean
  already_graduated?: boolean
  error?:            string
  provision?:        ProvisionResult
}

export default function GraduateModal({ slug, onClose }: { slug: string; onClose: () => void }) {
  const router = useRouter()
  const [preflight, setPreflight] = useState<PreflightBody | null>(null)
  const [force, setForce]         = useState(false)
  const [autoProvision, setAutoProvision] = useState(true)
  const [pending, startTx]        = useTransition()
  const [error, setError]         = useState<string | null>(null)
  // After confirm: show the provision step result inline before closing
  // so operator sees "Container created at <fqdn>" or any failure.
  const [provResult, setProvResult] = useState<ProvisionResult | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res  = await fetch(`/api/businesses/${slug}/graduate`, { cache: 'no-store' })
        const body = await res.json() as PreflightBody
        if (!cancelled) setPreflight(body)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'preflight failed')
      }
    })()
    return () => { cancelled = true }
  }, [slug])

  const confirm = () => {
    setError(null)
    setProvResult(null)
    startTx(async () => {
      const url  = `/api/businesses/${slug}/graduate${force ? '?force=1' : ''}`
      const res  = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ auto_provision: autoProvision }),
      })
      const body = await res.json() as GraduateResp
      if (!body.ok) {
        setError(body.error ?? 'graduation failed')
        return
      }
      // Surface the provision step result before closing — gives operator
      // a moment to see the fqdn / error before the modal disappears.
      if (body.provision) setProvResult(body.provision)
      // Auto-close after a brief pause if provision succeeded OR was
      // intentionally skipped. Operator dismisses manually on failure.
      const shouldAutoClose = !body.provision
        || body.provision.ok
        || body.provision.skipped !== null
      if (shouldAutoClose) {
        setTimeout(() => {
          router.refresh()
          onClose()
        }, body.provision?.ok ? 1500 : 100)
      } else {
        // Provision failed — keep modal open so operator reads the error.
        router.refresh()
      }
    })
  }

  const ready = Boolean(preflight?.ready)
  const checks = preflight?.checks ?? []
  const passedCount = checks.filter(c => c.ok).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 p-4 backdrop-blur-sm">
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-6">
        <button onClick={onClose} className="absolute right-4 top-4 text-zinc-500 transition hover:text-zinc-200" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
        <header className="mb-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-zinc-100">
            <Zap className="h-5 w-5 text-violet-400" />
            Graduate to production
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Flips <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs">simulation</code> from <code className="text-violet-300">true</code> to <code className="text-emerald-300">false</code>.
            After this, the cost-guard short-circuit stops applying, Composio money-moving verbs (Stripe payouts, refunds, transfers)
            stop refusing, and real spend counts against your daily cap. The flip takes effect within ~60 s (cache TTL).
          </p>
        </header>

        {!preflight ? (
          <div className="flex items-center gap-2 py-8 text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Running pre-flight checks…
          </div>
        ) : preflight.error ? (
          <p className="rounded-lg border border-rose-700/40 bg-rose-500/10 p-4 text-sm text-rose-200">⚠︎ {preflight.error}</p>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="text-zinc-300">Pre-flight: <span className={ready ? 'text-emerald-300' : 'text-amber-300'}>{passedCount} / {checks.length} passing</span></span>
              {!ready && (
                <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={force}
                    onChange={e => setForce(e.target.checked)}
                    className="h-3.5 w-3.5 accent-rose-500"
                  />
                  Override (force ignore failing checks)
                </label>
              )}
            </div>

            <ul className="mb-4 space-y-2">
              {checks.map(c => (
                <li key={c.name} className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                  {c.ok
                    ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400" />
                    : <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />}
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-zinc-300">{c.name}</div>
                    <div className="mt-0.5 text-xs text-zinc-500">{c.hint}</div>
                  </div>
                </li>
              ))}
            </ul>

            {/* Auto-provision opt-in. Default ON so the operator's "automate
                setting up docker in coolify" ask works out of the box. Flip
                off to graduate the row without spinning up infra (e.g. in
                lean mode where the shared gateway is used). */}
            <label className="mb-3 flex cursor-pointer items-start gap-2 rounded-lg border border-violet-700/30 bg-violet-950/20 p-3 text-xs">
              <input
                type="checkbox"
                checked={autoProvision}
                onChange={e => setAutoProvision(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-violet-500"
              />
              <span className="flex-1">
                <span className="font-medium text-violet-200">Auto-provision Coolify container after flip</span>
                <span className="mt-0.5 block text-violet-300/70">
                  Creates a per-business Docker app on Coolify (~30–45 s on first deploy). Skipped automatically in lean mode or when Coolify isn&apos;t configured server-side. Uncheck if you want to provision manually via <code className="font-mono">/api/businesses/{slug}/provision</code> later.
                </span>
              </span>
            </label>

            {provResult && (
              <div className="mb-3 rounded-lg border p-3 text-xs"
                style={{
                  background: provResult.ok ? 'rgba(34,197,94,0.10)' : provResult.skipped ? 'rgba(255,255,255,0.04)' : 'rgba(239,68,68,0.10)',
                  borderColor: provResult.ok ? 'rgba(34,197,94,0.30)' : provResult.skipped ? 'rgba(255,255,255,0.10)' : 'rgba(239,68,68,0.30)',
                  color: provResult.ok ? '#86efac' : provResult.skipped ? '#9090b0' : '#fca5a5',
                }}>
                {provResult.ok && provResult.fqdn && (
                  <span>✓ Provisioned. Coolify app at <code className="font-mono">{provResult.fqdn}</code>. Container is created but NOT started — click Start in Coolify to activate.</span>
                )}
                {provResult.ok && !provResult.fqdn && <span>✓ Provisioned.</span>}
                {provResult.skipped === 'lean_mode'             && <span>⊘ Auto-provision skipped: lean mode is active. Graduated business uses the shared gateway.</span>}
                {provResult.skipped === 'coolify_unconfigured' && <span>⊘ Auto-provision skipped: Coolify isn&apos;t configured server-side. Set COOLIFY_KVM4_URL + COOLIFY_KVM4_API_TOKEN in Doppler.</span>}
                {provResult.skipped === 'opted_out'             && <span>⊘ Auto-provision skipped per your checkbox. POST /api/businesses/{slug}/provision when ready.</span>}
                {!provResult.ok && !provResult.skipped && (
                  <span>⚠ Graduate succeeded but auto-provision failed: <code className="font-mono">{provResult.error}</code>{provResult.detail ? <> · <span className="text-zinc-400">{provResult.detail}</span></> : null}. Retry via <code className="font-mono">/api/businesses/{slug}/provision</code>.</span>
                )}
              </div>
            )}

            {error && <p className="mb-3 text-sm text-rose-400">⚠︎ {error}</p>}

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="rounded-lg border border-zinc-700 bg-zinc-800/40 px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800/70">
                Cancel
              </button>
              <button
                onClick={confirm}
                disabled={pending || (!ready && !force)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Confirm — graduate to production
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
