/**
 * HeartbeatTimeline — horizontal timeline of agent fires from run_events.
 *
 * Phase 2 Task E. Pure-display component; parent fetches the event rows.
 *
 * Renders the last N events as colored ticks along a 24h horizontal axis.
 * Hover any tick → tooltip with event_type + business_slug + timestamp.
 * Empty state when no events.
 *
 * Mounted on /agents/[slug] (filtered to one agent's events) and intended
 * for the bento dashboard (Task F) with cross-agent events.
 */

interface EventRow {
  id:            string
  run_id?:       string | null
  business_slug: string | null
  event_type:    string
  payload?:      Record<string, unknown> | null
  created_at:    string
}

interface Props {
  events:    EventRow[]
  agentSlug?: string
  /** Window in hours to plot. Defaults to 24. */
  hours?:    number
}

const TICK_COLORS = [
  '#7c75ff', // violet
  '#10b981', // emerald
  '#f59e0b', // amber
  '#06b6d4', // cyan
  '#ef4444', // rose — reserved for errors
]

function colorFor(eventType: string): string {
  if (/error|fail|timeout|kill/i.test(eventType)) return TICK_COLORS[4]!
  // Stable hash of the type → palette index 0–3 (skipping rose)
  let h = 0
  for (let i = 0; i < eventType.length; i++) h = ((h << 5) - h) + eventType.charCodeAt(i)
  return TICK_COLORS[Math.abs(h) % 4]!
}

function shortRelative(iso: string): string {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (sec < 60)    return `${sec}s ago`
  if (sec < 3600)  return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

export default function HeartbeatTimeline({ events, agentSlug, hours = 24 }: Props) {
  const windowMs = hours * 60 * 60 * 1000
  // eslint-disable-next-line react-hooks/purity -- pre-existing render-time value; refactor tracked separately
  const now      = Date.now()
  const since    = now - windowMs

  // Filter to events inside the window (events older than `hours` are dropped).
  const inWindow = events.filter(e => new Date(e.created_at).getTime() >= since)

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-300">
          Heartbeat — last {hours}h
        </h2>
        <span className="font-mono text-[10px] text-zinc-500">{inWindow.length} fire{inWindow.length === 1 ? '' : 's'}</span>
      </div>

      {inWindow.length === 0 ? (
        <p className="text-xs italic text-zinc-500">
          No events in the last {hours}h{agentSlug ? ` for ${agentSlug}` : ''}.
        </p>
      ) : (
        <div className="relative h-12">
          {/* Axis */}
          <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-zinc-800" />
          {/* Hour-tick guides — every 6h */}
          {Array.from({ length: hours / 6 + 1 }).map((_, i) => {
            const pct = (i * 6 / hours) * 100
            return (
              <div key={i} className="absolute top-1/2 -translate-y-1/2" style={{ left: `${pct}%` }}>
                <div className="h-2 w-px bg-zinc-700" />
              </div>
            )
          })}

          {/* Event ticks */}
          {inWindow.map(e => {
            const t = new Date(e.created_at).getTime()
            const pct = ((t - since) / windowMs) * 100
            const color = colorFor(e.event_type)
            return (
              <div
                key={e.id}
                title={`${e.event_type}${e.business_slug ? ` · ${e.business_slug}` : ''} · ${shortRelative(e.created_at)}`}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-help"
                style={{ left: `${pct}%` }}
              >
                <div
                  className="h-3 w-3 rounded-full ring-2 ring-zinc-900/60 transition hover:scale-150"
                  style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}66` }}
                />
              </div>
            )
          })}

          {/* Time labels */}
          <span className="absolute bottom-0 left-0 font-mono text-[10px] text-zinc-600">-{hours}h</span>
          <span className="absolute bottom-0 right-0 font-mono text-[10px] text-zinc-600">now</span>
        </div>
      )}
    </section>
  )
}
