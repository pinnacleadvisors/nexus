import { AlertTriangle } from 'lucide-react'

export interface BudgetIncident {
  ts:         string                     // ISO timestamp
  scope:      'user' | 'business' | 'agent'
  spent_usd:  number
  cap_usd:    number
  reason:     string                      // e.g. 'budget_exhausted', 'kill_switch'
}

interface Props {
  incidents: BudgetIncident[]
}

/**
 * Recent budget incidents — kill_switch_check rows from experiment_metrics
 * where payload.kill = true, mapped through. Parent page fetches + maps the
 * payload shape to BudgetIncident; this component is pure display.
 *
 * Mirrors Paperclip's BudgetIncidentCard. Empty state is the healthy state
 * (no incidents recorded), so the layout doesn't shout "broken" when nothing
 * has gone wrong.
 */
export default function BudgetIncidentCard({ incidents }: Props) {
  const recent = incidents.slice(0, 8)

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <header className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-zinc-400" />
        <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-300">Budget incidents</h3>
      </header>

      {recent.length === 0 ? (
        <p className="text-xs italic text-zinc-500">No incidents recorded.</p>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {recent.map((i, idx) => (
            <li key={`${i.ts}-${idx}`} className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-zinc-300">{i.reason}</span>
                  <time className="flex-shrink-0 text-zinc-600" dateTime={i.ts}>
                    {new Date(i.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </time>
                </div>
                <p className="text-zinc-500">
                  {i.scope} · ${i.spent_usd.toFixed(2)} / ${i.cap_usd.toFixed(2)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
