'use client'

/**
 * WelcomeTourModal — R8 of the UX consultation.
 *
 * 3-card guided tour shown to the operator on first /dashboard visit
 * when they have zero businesses AND haven't dismissed the tour. The
 * three cards explain:
 *   1. What Nexus does (autonomous business management)
 *   2. Simulation-first → graduate-to-prod chain
 *   3. Fixture mode (test without OAuth)
 *
 * Persistence: `localStorage[nexus:welcome-tour-completed]`. Operator
 * can replay via the floating "?" button (not in this PR — V2).
 *
 * Auto-shows only when (a) the page renders, (b) there are 0 businesses,
 * and (c) the localStorage flag isn't set. The parent /dashboard passes
 * `hasBusinesses` so the modal can decide.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles, Rocket, FlaskConical, ArrowRight, X } from 'lucide-react'

const STORAGE_KEY = 'nexus:welcome-tour-completed'

interface FleetResponse {
  ok?:         boolean
  businesses?: Array<{ slug: string }>
}

/** Self-detect business count via /api/dashboard/fleet. The dashboard
 *  parent doesn't currently surface this count synchronously, and the
 *  modal needs it to decide whether to show — so we fetch lightweight. */
export default function WelcomeTourModal() {
  const [step, setStep]       = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false
    void (async () => {
      // Skip if already dismissed
      try {
        const done = window.localStorage.getItem(STORAGE_KEY)
        if (done) return
      } catch { /* swallow */ }
      // Probe business count
      try {
        const r = await fetch('/api/dashboard/fleet', { cache: 'no-store' })
        const b = await r.json() as FleetResponse
        if (cancelled) return
        const count = (b.businesses ?? []).length
        if (count === 0) setVisible(true)
      } catch { /* swallow — don't pop the modal on a failed probe */ }
    })()
    return () => { cancelled = true }
  }, [])

  const dismiss = () => {
    setVisible(false)
    if (typeof window === 'undefined') return
    try { window.localStorage.setItem(STORAGE_KEY, new Date().toISOString()) } catch { /* swallow */ }
  }

  const next = () => {
    if (step < 2) {
      setStep(s => s + 1)
    } else {
      dismiss()
    }
  }

  if (!visible) return null

  const slides = [
    {
      icon:  Sparkles,
      title: 'Welcome to Nexus',
      body:  'An autonomous-business operating system. You declare a goal ("ship a SaaS in the bookkeeping niche"); the platform spawns agents that build, market, and maintain the business. Your job is to approve high-stakes calls + watch the KPIs.',
      cta:   'Next',
    },
    {
      icon:  Rocket,
      title: 'Simulation first, real money later',
      body:  'Every new business starts as a simulation — fake customers, fake spend, real agent behaviour. When the preflight checklist greens (smoke run + KPI targets + connectors), you graduate to real-money mode in one click. No surprise charges. No accidental Stripe payouts.',
      cta:   'Next',
    },
    {
      icon:  FlaskConical,
      title: 'Fixture mode — test without OAuthing anything',
      body:  'Flip the "Dev fixture harness" toggle at /settings → Access and the platform overlays synthetic platform connections (Stripe / Gmail / Slack / etc.) on every business. Chat with agents, watch them dispatch, see the canned responses — without ever connecting a real account. Perfect for the first hour.',
      cta:   "Let's go",
    },
  ]

  const slide = slides[step]
  const Icon = slide.icon

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm p-4">
      <div
        className="relative max-w-md w-full rounded-2xl border p-6"
        style={{
          background:  'linear-gradient(135deg, rgba(108,99,255,0.10), rgba(13,13,20,0.95))',
          borderColor: 'rgba(108,99,255,0.30)',
          boxShadow:   '0 20px 40px -10px rgba(108,99,255,0.30), 0 0 60px rgba(108,99,255,0.10)',
        }}
      >
        <button
          type="button"
          onClick={dismiss}
          className="absolute right-3 top-3 rounded-md p-1 text-zinc-500 transition hover:bg-zinc-800/60 hover:text-zinc-200"
          aria-label="Dismiss welcome tour"
        >
          <X className="h-4 w-4" />
        </button>

        <div
          className="mb-4 mx-auto h-12 w-12 rounded-xl flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, rgba(108,99,255,0.40), rgba(108,99,255,0.10))',
            border:     '1px solid rgba(108,99,255,0.40)',
          }}
        >
          <Icon className="h-6 w-6" style={{ color: '#c4b5fd' }} />
        </div>

        <h2 className="text-center text-lg font-semibold mb-2" style={{ color: '#e8e8f0' }}>
          {slide.title}
        </h2>
        <p className="text-center text-sm leading-relaxed mb-5" style={{ color: '#9090b0' }}>
          {slide.body}
        </p>

        {/* Progress dots */}
        <div className="flex justify-center gap-1.5 mb-5">
          {slides.map((_, i) => (
            <span
              key={i}
              className="h-1.5 rounded-full transition-all"
              style={{
                width:      i === step ? 24 : 6,
                background: i === step ? '#a8a3ff' : '#3f3f56',
              }}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-lg border border-zinc-700 bg-zinc-800/40 px-3 py-2 text-xs text-zinc-300 transition hover:bg-zinc-800/70"
          >
            Skip
          </button>
          {step < 2 ? (
            <button
              type="button"
              onClick={next}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition"
              style={{
                background: 'rgba(108,99,255,0.30)',
                border:     '1px solid rgba(108,99,255,0.50)',
                color:      '#c4b5fd',
              }}
            >
              {slide.cta}
              <ArrowRight className="h-3 w-3" />
            </button>
          ) : (
            <Link
              href="/businesses/new"
              onClick={dismiss}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition"
              style={{
                background: 'rgba(108,99,255,0.30)',
                border:     '1px solid rgba(108,99,255,0.50)',
                color:      '#c4b5fd',
              }}
            >
              {slide.cta}
              <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
