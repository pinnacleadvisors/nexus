'use client'

/**
 * FixtureModeBadge — R11 of the UX consultation.
 *
 * Persistent badge in the top bar that surfaces when fixture mode is ON
 * so the operator can never accidentally confuse a synthetic Composio
 * response for a real one. Hidden when fixture mode is off.
 *
 * Pull-only — fetches GET /api/dev/fixtures/active once on mount + every
 * 5 minutes. Click navigates to /settings → Access to flip the toggle.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FlaskConical } from 'lucide-react'

interface ActiveBody {
  ok:       boolean
  enabled?: boolean
  degraded?: boolean
}

const REFRESH_MS = 5 * 60_000

export default function FixtureModeBadge() {
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchState = async () => {
      try {
        const r = await fetch('/api/dev/fixtures/active', { cache: 'no-store' })
        const b = await r.json() as ActiveBody
        if (!cancelled) setEnabled(Boolean(b.ok && b.enabled))
      } catch {
        if (!cancelled) setEnabled(false)
      }
    }
    void fetchState()
    const id = setInterval(fetchState, REFRESH_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  // Hide when off OR while loading. Operator only sees this when it
  // matters (fixture mode is ON), so they can't miss it.
  if (enabled !== true) return null

  return (
    <Link
      href="/settings?tab=access"
      title="Fixture mode is ON — executeBusinessAction returns canned responses + /settings/accounts overlays synthetic rows. Click to manage."
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium tracking-wider transition hover:scale-[1.02]"
      style={{
        background: 'linear-gradient(135deg, rgba(168,85,247,0.20), rgba(168,85,247,0.06))',
        border:     '1px solid rgba(168,85,247,0.40)',
        color:      '#c4b5fd',
        boxShadow:  '0 0 8px rgba(168,85,247,0.20)',
      }}
    >
      <FlaskConical className="h-3 w-3" />
      <span className="uppercase">Fixture mode</span>
    </Link>
  )
}
