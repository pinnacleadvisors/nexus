import Link from 'next/link'
import type { KpiCard } from '@/lib/types'
import { TrendingUp, TrendingDown, Info, Sparkles, Clock } from 'lucide-react'

const COLOR_MAP = {
  default: { value: '#e8e8f0', delta: '' },
  green: { value: '#22c55e', delta: '' },
  red: { value: '#ef4444', delta: '' },
  purple: { value: '#6c63ff', delta: '' },
}

// R10 — Performance signal freshness indicator. Format an ISO timestamp
// into a "Nm ago" / "Nh ago" / "Nd ago" string. Returns null when missing
// or unparseable so the card just omits the subtitle (instead of e.g.
// "Updated 56 years ago" for new accounts).
function formatRelative(iso?: string): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  const ageMs = Date.now() - t
  if (ageMs < 0) return 'just now'
  const sec = Math.floor(ageMs / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

// >24h stale → amber border + amber clock icon.
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000
function isStale(iso?: string): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return Number.isFinite(t) && (Date.now() - t) > STALE_THRESHOLD_MS
}

interface Props {
  cards: KpiCard[]
}

// Strip currency / percent / unit suffixes ("$0", "0%", "0 / 0", "0M") and
// return true only when the underlying number is zero. We use this to detect
// a fresh-account dashboard so we can swap out the demoralising-zero CTA.
function valueIsZero(value: string): boolean {
  const numeric = value.replace(/[^0-9.-]/g, '').trim()
  if (numeric === '' || numeric === '-' || numeric === '.') return false
  const n = Number(numeric)
  return Number.isFinite(n) && n === 0
}

export default function KpiGrid({ cards }: Props) {
  // Fresh-account heuristic: every card's value parses to zero. Show a single
  // soft CTA banner above the grid that points the user at /idea so they have
  // something concrete to do, instead of staring at six "0"s and assuming the
  // platform is broken.
  const allZero = cards.length > 0 && cards.every(c => valueIsZero(c.value))

  return (
    <div className="space-y-3">
      {allZero && (
        <Link
          href="/idea"
          className="flex items-center gap-3 rounded-xl px-4 py-3 transition-colors"
          style={{
            backgroundColor: 'rgba(108,99,255,0.08)',
            border: '1px solid rgba(108,99,255,0.3)',
          }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(108,99,255,0.16)' }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(108,99,255,0.08)' }}
        >
          <Sparkles size={16} style={{ color: '#6c63ff' }} />
          <div className="flex-1">
            <p className="text-sm font-medium" style={{ color: '#e8e8f0' }}>
              Looks like a fresh account
            </p>
            <p className="text-xs" style={{ color: '#9090b0' }}>
              These numbers stay at zero until the platform runs something. Pick an idea to get started →
            </p>
          </div>
        </Link>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {cards.map(card => {
          const colors = COLOR_MAP[card.color ?? 'default']
          const deltaPositive = (card.delta ?? 0) >= 0
          const freshLabel = formatRelative(card.updated_at)
          const stale = isStale(card.updated_at)
          return (
            <div
              key={card.label}
              className="rounded-xl p-4"
              style={{
                backgroundColor: '#12121e',
                // Amber border when the underlying signal is >24h old —
                // visually-loud cue so the operator doesn't read stale
                // numbers as live numbers. R10 of UX consult.
                border: stale ? '1px solid #f59e0b66' : '1px solid #24243e',
              }}
            >
              <div className="flex items-center gap-1.5 mb-2">
                <p className="text-xs font-medium" style={{ color: '#9090b0' }}>
                  {card.label}
                </p>
                {card.description && (
                  <span title={card.description}>
                    <Info
                      size={11}
                      style={{ color: '#55556a', cursor: 'help' }}
                      aria-label={card.description}
                    />
                  </span>
                )}
              </div>
              <p className="text-2xl font-bold mb-2" style={{ color: colors.value }}>
                {card.value}
              </p>
              {card.delta !== undefined && (
                <div className="flex items-center gap-1">
                  {deltaPositive ? (
                    <TrendingUp size={12} style={{ color: '#22c55e' }} />
                  ) : (
                    <TrendingDown size={12} style={{ color: '#ef4444' }} />
                  )}
                  <span
                    className="text-xs font-medium"
                    style={{ color: deltaPositive ? '#22c55e' : '#ef4444' }}
                  >
                    {deltaPositive ? '+' : ''}{card.delta}%
                  </span>
                  <span className="text-xs" style={{ color: '#55556a' }}>
                    vs last month
                  </span>
                </div>
              )}
              {freshLabel && (
                <div className="flex items-center gap-1 mt-2" title={`Source last updated ${card.updated_at ?? ''}`}>
                  <Clock size={9} style={{ color: stale ? '#f59e0b' : '#55556a' }} />
                  <span className="text-[10px]" style={{ color: stale ? '#f59e0b' : '#55556a' }}>
                    {freshLabel}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
