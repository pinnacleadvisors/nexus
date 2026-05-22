'use client'

import Link from 'next/link'
import { Building2, AlertCircle, ArrowUpRight } from 'lucide-react'

interface Props {
  slug:             string
  name:             string
  niche:            string
  status:           string
  mission:          string | null
  spent30dUsd:      number
  pendingApprovals: number
}

export default function CompanyTile({
  slug, name, niche, status, mission, spent30dUsd, pendingApprovals,
}: Props) {
  const statusColor =
    status === 'active'   ? 'bg-emerald-500/10 text-emerald-400' :
    status === 'paused'   ? 'bg-amber-500/10 text-amber-400'     :
    status === 'archived' ? 'bg-zinc-500/10 text-zinc-400'       :
                            'bg-zinc-500/10 text-zinc-400'

  return (
    <Link
      href={`/companies/${slug}`}
      className="group block rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 transition hover:border-zinc-700 hover:bg-zinc-900/60"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-zinc-400" />
          <h2 className="text-lg font-medium tracking-tight">{name}</h2>
        </div>
        <ArrowUpRight className="h-4 w-4 text-zinc-500 transition group-hover:text-zinc-300" />
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 ${statusColor}`}>{status}</span>
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
  )
}
