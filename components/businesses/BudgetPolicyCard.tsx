import { Shield } from 'lucide-react'

export interface BudgetPolicy {
  label:    string
  cap_usd:  number | null
  scope:    'user-day' | 'business-day' | 'agent-day'
}

interface Props {
  policies: BudgetPolicy[]
}

/**
 * Display the cost-guard policies in effect (USER_DAILY_USD_LIMIT,
 * USER_BUSINESS_DAILY_USD_LIMIT, AGENT_BUDGET_USD_DAY_*). Pure config-display
 * — values come from process.env on the server side, passed in as props.
 *
 * Mirrors Paperclip's BudgetPolicyCard (audit §7). Paperclip has a richer
 * budget_policies table; Nexus today uses env vars for these caps, so this
 * card renders the env-derived view. A future Phase 5 migration could
 * promote these to a table if needed.
 */
export default function BudgetPolicyCard({ policies }: Props) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <header className="mb-3 flex items-center gap-2">
        <Shield className="h-4 w-4 text-zinc-400" />
        <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-300">Budget policies</h3>
      </header>

      {policies.length === 0 ? (
        <p className="text-xs italic text-zinc-500">No policies configured — set USER_DAILY_USD_LIMIT and friends in Doppler.</p>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {policies.map(p => (
            <li key={`${p.scope}:${p.label}`} className="flex items-center justify-between gap-2">
              <span className="truncate text-zinc-400">{p.label}</span>
              <span className="font-mono text-zinc-300">
                {p.cap_usd === null ? <span className="italic text-zinc-600">unset</span> : `$${p.cap_usd.toFixed(2)}/day`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
