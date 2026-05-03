'use client'

/**
 * Tiny "failures" badge for Mission Control. Polls /api/health/cron and
 * /api/runs?phase=… (status=failed/blocked) every 30s; renders a single
 * "X failures · view" pill linking to /manage-platform when count > 0.
 *
 * Hidden when everything is green so it doesn't add UI noise on a healthy
 * day.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

const POLL_MS = 30_000

interface CronJob { isStale: boolean; isFailing: boolean }
interface CronResp { jobs: CronJob[] }

export default function FailureBadge() {
  const [count, setCount] = useState<number>(0)

  async function load() {
    try {
      const res = await fetch('/api/health/cron', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as CronResp
      const failed = data.jobs.filter(j => j.isFailing || j.isStale).length
      setCount(failed)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    load()
    const id = setInterval(load, POLL_MS)
    return () => clearInterval(id)
  }, [])

  if (count === 0) return null

  return (
    <Link
      href="/manage-platform"
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{
        backgroundColor: '#2a1116',
        color:           '#ff7a90',
        border:          '1px solid #ff4d6d44',
      }}
      title="Open /manage-platform Health panel"
    >
      <AlertTriangle size={11} />
      {count} {count === 1 ? 'failure' : 'failures'} · view
    </Link>
  )
}
