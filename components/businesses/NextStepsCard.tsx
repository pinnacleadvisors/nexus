'use client'

/**
 * NextStepsCard — guided checklist for fresh simulation businesses.
 *
 * Renders on /businesses/[slug] for businesses where the operator hasn't
 * yet exercised the full sim → graduate chain. Each row links to the
 * exact surface that advances the step.
 *
 * Visible when: business.simulation === true AND at least one step is
 * incomplete. Auto-hides once every step shows positive signal — no
 * dismiss button (an empty checklist already vanishes).
 *
 * Why client-side: the step signals (run count, chat history, connected
 * accounts) come from disparate endpoints that aren't cheaply joined
 * server-side. One fetch per step keeps the data fresh + the failure
 * mode per-step (a broken endpoint dims its own row, doesn't kill the
 * whole card).
 *
 * Fail-soft: any per-step error shows the step as "unknown" rather than
 * "incomplete". Operator clicks through anyway if curious.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, CheckCircle2, Circle, ArrowRight, FlaskConical } from 'lucide-react'

interface Step {
  id:       string
  label:    string
  hint:     string
  href:     string
  cta:      string
  done?:    boolean
  unknown?: boolean
}

export default function NextStepsCard({ slug, hasKpiTargets }: { slug: string; hasKpiTargets: boolean }) {
  const [loading, setLoading] = useState(true)
  const [steps,   setSteps]   = useState<Step[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Pull the 4 step signals in parallel. Each is fail-soft.
      //
      // The chat signal uses /chat/sessions (which has a GET handler) rather
      // than /chat?limit=1 (which is POST-only and 405s on GET) — the
      // existence of at least one session is the right "has the operator
      // engaged?" signal anyway.
      const [smokeRes, accountsRes, sessionsRes, preflightRes] = await Promise.allSettled([
        fetch(`/api/businesses/${slug}/simulate/smoke?id=`, { cache: 'no-store' })   // GET with empty id → latest smoke
          .then(r => r.json()) as Promise<{ ok: boolean; latest?: { id: string; status: string } | null }>,
        fetch(`/api/connected-accounts?businessSlug=${slug}`, { cache: 'no-store' })
          .then(r => r.json()) as Promise<{ accounts: Array<{ id: string; platform: string; isFixture?: boolean }> }>,
        fetch(`/api/businesses/${slug}/chat/sessions`, { cache: 'no-store' })
          .then(r => r.ok ? r.json() : { sessions: [] }) as Promise<{ sessions: Array<{ id: string }> }>,
        fetch(`/api/businesses/${slug}/graduate`, { cache: 'no-store' })
          .then(r => r.json()) as Promise<{ ok: boolean; ready?: boolean }>,
      ])
      if (cancelled) return

      const smokeDone = smokeRes.status === 'fulfilled' &&
        smokeRes.value?.latest?.status === 'done'
      const accountsAny = accountsRes.status === 'fulfilled' &&
        (accountsRes.value?.accounts ?? []).length > 0
      const accountsReal = accountsRes.status === 'fulfilled' &&
        (accountsRes.value?.accounts ?? []).some(a => !a.isFixture)
      const chatAny = sessionsRes.status === 'fulfilled' &&
        (sessionsRes.value?.sessions ?? []).length > 0
      const graduateReady = preflightRes.status === 'fulfilled' && preflightRes.value?.ready === true

      const next: Step[] = [
        {
          id:    'kpi',
          label: 'Set KPI targets',
          hint:  hasKpiTargets
            ? 'Targets recorded — the cost-guard knows when to call a pivot.'
            : 'Pivot-eligibility + auto-pause decisions read these. Set at least one (revenue_cents, signups, orders).',
          href:  `/businesses/${slug}/settings`,
          cta:   hasKpiTargets ? 'Edit targets →' : 'Add KPI targets →',
          done:  hasKpiTargets,
        },
        {
          id:    'connectors',
          label: 'Connect platforms (or use fixture mode)',
          hint:  accountsReal
            ? 'Real OAuth connection on file. Money-moving verbs work post-graduate.'
            : accountsAny
              ? 'Fixture-mode rows in place. Toggle off at /settings → Access when ready for real OAuth.'
              : 'Connect at least one (Stripe / Gmail / Slack / …) at /settings/accounts. Or flip /settings → Access → Dev fixture harness to overlay synthetic rows.',
          href:  '/settings/accounts',
          cta:   accountsAny ? 'View connections →' : 'Connect a platform →',
          done:  accountsAny,
          unknown: accountsRes.status === 'rejected',
        },
        {
          id:    'chat',
          label: 'Have a conversation with the business',
          hint:  chatAny
            ? 'Chat history started — the business knows you.'
            : 'Tell the copilot what you want this business to do. It reads your brand voice + KPIs and proposes the first cycle.',
          href:  `/businesses/${slug}/chat`,
          cta:   chatAny ? 'Open chat →' : 'Start chatting →',
          done:  chatAny,
          unknown: sessionsRes.status === 'rejected',
        },
        {
          id:    'smoke',
          label: 'Run a smoke through the hyperbolic chamber',
          hint:  smokeDone
            ? 'Last smoke completed cleanly. The chaos harness exercised your flow.'
            : 'Compresses 14 sim-days into ~10 minutes — proves the basic loop works before real customers arrive. No LLM spend with template voice.',
          href:  `/businesses/${slug}/simulate`,
          cta:   smokeDone ? 'Review run →' : 'Run smoke →',
          done:  smokeDone,
          unknown: smokeRes.status === 'rejected',
        },
        {
          id:    'graduate',
          label: 'Graduate to real-money mode',
          hint:  graduateReady
            ? 'Pre-flight is green. The Graduate button on the header flips simulation=false + auto-provisions Coolify.'
            : 'Once the rows above are green + at least one completed smoke is on file, the Graduate button enables. Until then, everything stays sim-only.',
          href:  `/businesses/${slug}`,
          cta:   graduateReady ? 'Graduate now →' : 'See preflight →',
          done:  false,                                // Never marked done — graduation flips simulation=false which hides this whole card
          unknown: preflightRes.status === 'rejected',
        },
      ]
      setSteps(next)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [slug, hasKpiTargets])

  // Hide entirely once every actionable step is done. The graduate step
  // never marks done (graduation removes the card by flipping simulation),
  // so we only hide when all OTHER steps are complete + graduate is ready.
  const allDone = steps.length > 0 && steps.slice(0, -1).every(s => s.done)
  const graduateReady = steps[steps.length - 1]?.cta?.startsWith('Graduate now')
  if (!loading && allDone && !graduateReady) return null

  return (
    <div
      className="rounded-xl border p-4 sm:p-5"
      style={{
        background:           'linear-gradient(135deg, rgba(108,99,255,0.06), rgba(255,255,255,0.02))',
        backdropFilter:       'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border:               '1px solid rgba(108,99,255,0.22)',
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <FlaskConical className="h-4 w-4" style={{ color: '#a8a3ff' }} />
        <h3 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
          Next steps for this simulation
        </h3>
        {loading && <Loader2 className="h-3 w-3 animate-spin" style={{ color: '#9090b0' }} />}
      </div>
      <p className="text-xs mb-3" style={{ color: '#9090b0' }}>
        Each row links to the exact surface that advances it. The card hides itself once you graduate to real-money mode.
      </p>
      <ul className="space-y-2">
        {steps.map(s => (
          <li
            key={s.id}
            className="rounded-lg border p-3 transition-colors"
            style={{
              background:  s.done ? 'rgba(34,197,94,0.05)' : 'rgba(255,255,255,0.02)',
              borderColor: s.done ? 'rgba(34,197,94,0.20)' : 'rgba(255,255,255,0.08)',
            }}
          >
            <div className="flex items-start gap-2.5">
              {s.done
                ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: '#4ade80' }} />
                : <Circle       className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: s.unknown ? '#9090b0' : '#a8a3ff' }} />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-medium" style={{ color: s.done ? '#86efac' : '#e8e8f0' }}>
                    {s.label}
                  </span>
                  <Link
                    href={s.href}
                    className="inline-flex items-center gap-0.5 text-[11px] underline-offset-2 hover:underline"
                    style={{ color: s.done ? '#86efac' : '#a8a3ff' }}
                  >
                    {s.cta} <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed" style={{ color: '#9090b0' }}>
                  {s.hint}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
