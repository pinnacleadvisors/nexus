'use client'

/**
 * Tiny inline SVG sparkline for benchmark drift history (PR #376).
 * Renders the last N drift_pct values; baseline (0%) is the horizontal
 * mid-line; positive drift trends up, negative trends down.
 *
 * Null values (bootstrap rows) are skipped — the line continues without
 * a gap so the operator sees a continuous trend.
 *
 * Colour: zinc by default; when ANY recent value exceeds the
 * `dangerThreshold` (the benchmark's drift_threshold_pct), the colour
 * shifts to rose to make recent regressions visually obvious.
 */

interface Props {
  values:          Array<number | null>
  dangerThreshold: number
  width?:          number
  height?:         number
}

export default function Sparkline({ values, dangerThreshold, width = 100, height = 24 }: Props) {
  const cleaned = values.filter((v): v is number => v !== null)
  if (cleaned.length < 2) {
    return <span className="text-[10px] text-zinc-500">(not enough data)</span>
  }

  const maxAbs   = Math.max(dangerThreshold * 1.5, ...cleaned.map(v => Math.abs(v)))
  const danger   = cleaned.some(v => Math.abs(v) > dangerThreshold)
  const strokeC  = danger ? '#fb7185' : '#a1a1aa'   // rose-400 / zinc-400

  const points = cleaned.map((v, i) => {
    const x = (i / (cleaned.length - 1)) * (width - 2) + 1
    const y = height / 2 - (v / maxAbs) * (height / 2 - 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  // Baseline at 0%
  const midY = height / 2

  return (
    <svg width={width} height={height} className="inline-block align-middle" aria-label="Drift history sparkline">
      <line x1="0" y1={midY} x2={width} y2={midY} stroke="#3f3f46" strokeWidth="0.5" strokeDasharray="2 2" />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={strokeC}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Last-point marker so the operator's eye lands on "today" */}
      <circle cx={points[points.length - 1].split(',')[0]} cy={points[points.length - 1].split(',')[1]} r="2" fill={strokeC} />
    </svg>
  )
}
