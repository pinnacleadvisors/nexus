import { CircleDollarSign } from 'lucide-react'

export interface BillerSpendRow {
  agent_slug:  string
  spent_usd:   number
  cap_usd:     number | null
}

interface Props {
  rows:        BillerSpendRow[]
  totalSpent:  number
  period:      'day' | 'week' | 'month'
}

/**
 * Per-agent spend breakdown for a business. Mirrors Paperclip's
 * BillerSpendCard (ui/src/components/BillerSpendCard.tsx — verified at audit
 * commit c91a06232625). Reads from lib/cost-guard.ts getAgentBudget() per
 * agent; aggregation happens server-side, this is pure display.
 *
 * Empty state (no rows) renders a hint pointing at experiment_metrics
 * payload.agent_slug — the dispatcher must tag every cash_spend row for
 * partitioning to work.
 */
export default function BillerSpendCard({ rows, totalSpent, period }: Props) {
  const periodLabel = period === 'day' ? '24h' : period === 'week' ? '7d' : '30d'

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <header className="mb-3 flex items-center gap-2">
        <CircleDollarSign className="h-4 w-4 text-zinc-400" />
        <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-300">
          Spend by agent ({periodLabel})
        </h3>
      </header>

      <div className="mb-3 font-mono text-2xl text-zinc-100">${totalSpent.toFixed(2)}</div>

      {rows.length === 0 ? (
        <p className="text-xs italic text-zinc-500">
          No spend recorded for this {periodLabel}. The dispatcher must tag every
          cash_spend row&apos;s payload with <code className="rounded bg-zinc-800/60 px-1">agent_slug</code> for
          partitioning.
        </p>
      ) : (
        <ul className="space-y-2 text-xs">
          {rows.map(r => {
            const pct = r.cap_usd ? Math.min(100, Math.round((r.spent_usd / r.cap_usd) * 100)) : null
            const barColor = pct === null ? '#6c63ff' : pct >= 90 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#10b981'
            return (
              <li key={r.agent_slug}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-zinc-300">{r.agent_slug}</span>
                  <span className="flex-shrink-0 font-mono text-zinc-400">
                    ${r.spent_usd.toFixed(2)}
                    {r.cap_usd !== null && <span className="text-zinc-600"> / ${r.cap_usd.toFixed(2)}</span>}
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full transition-all"
                    style={{
                      width:           pct === null ? '8%' : `${pct}%`,
                      backgroundColor: barColor,
                      opacity:         pct === null ? 0.3 : 1,
                    }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
