'use client'

import Link from 'next/link'
import { Briefcase, AlertCircle, MessageSquare } from 'lucide-react'

interface Props {
  slug:             string
  name:             string
  niche:            string
  status:           string
  mission:          string | null
  spent30dUsd:      number
  pendingApprovals: number
  /** When true, this business is running under the RD-Agent simulation harness — cost-guard short-circuits real spend + UI surfaces a 🧪 sim badge. */
  simulation?:      boolean
}

/**
 * Business tile — one card per business on /businesses. Was CompanyTile when
 * the route lived at /companies; renamed in the 2026-05-22 merge of
 * /companies → /businesses. Tile body links to /businesses/<slug> (overview);
 * a secondary "Open chat" button goes straight to /businesses/<slug>/chat so
 * the chat-first day-to-day workflow keeps its 1-click access.
 */
export default function BusinessTile({
  slug, name, niche, status, mission, spent30dUsd, pendingApprovals, simulation,
}: Props) {
  const statusColor =
    status === 'active'   ? 'bg-emerald-500/10 text-emerald-400' :
    status === 'paused'   ? 'bg-amber-500/10 text-amber-400'     :
    status === 'archived' ? 'bg-zinc-500/10 text-zinc-400'       :
                            'bg-zinc-500/10 text-zinc-400'

  return (
    <div className="group rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 transition hover:border-zinc-700 hover:bg-zinc-900/60">
      <Link href={`/businesses/${slug}`} className="block">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-zinc-400" />
            <h2 className="text-lg font-medium tracking-tight">{name}</h2>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 ${statusColor}`}>{status}</span>
          {simulation && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 font-mono uppercase tracking-wider text-[10px] text-violet-300"
              title="Simulation — real spend is blocked, customer emails are reserved-domain stubs. Cost-guard short-circuits any money-moving verb."
            >
              🧪 sim
            </span>
          )}
          <span className="text-zinc-500">{niche}</span>
        </div>

        {mission ? (
          <p className="mt-3 line-clamp-2 text-sm text-zinc-400">{mission}</p>
        ) : (
          <p className="mt-3 text-sm italic text-zinc-600">No mission set.</p>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-500">30d spend</dt>
            <dd className="mt-1 font-mono text-zinc-200">${spent30dUsd.toFixed(2)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-zinc-500">Pending</dt>
            <dd className="mt-1 flex items-center gap-1">
              {pendingApprovals > 0 && <AlertCircle className="h-3.5 w-3.5 text-amber-400" />}
              <span className={pendingApprovals > 0 ? 'text-amber-400' : 'text-zinc-500'}>
                {pendingApprovals} approval{pendingApprovals === 1 ? '' : 's'}
              </span>
            </dd>
          </div>
        </dl>
      </Link>

      <div className="mt-4 border-t border-zinc-800 pt-3">
        <Link
          href={`/businesses/${slug}/chat`}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/40 px-2.5 py-1.5 text-xs text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800/70"
        >
          <MessageSquare className="h-3.5 w-3.5" /> Open chat
        </Link>
      </div>
    </div>
  )
}
