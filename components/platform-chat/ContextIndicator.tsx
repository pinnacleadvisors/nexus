'use client'

/**
 * ContextIndicator — bottom-right pill showing the chat's context usage,
 * modeled after Claude Code Desktop's bottom-right indicator.
 *
 * Renders:
 *   [Claude Opus]  12% / 200k
 *   ^ model         ^ % of input budget used  ^ context-window total
 *
 * Colors:
 *   < 60% → muted purple (normal)
 *   60-85% → amber (heads-up)
 *   > 85% → red (close to refusal)
 *
 * Driven by the `usage` field the chat enqueue routes return on every
 * successful turn (see lib/chat/context-window.ts computeUsage()).
 */

import { Cpu } from 'lucide-react'

export interface ContextUsageView {
  tokensUsed:     number
  inputBudget:    number
  contextTokens:  number
  inputUsedPct:   number
  contextUsedPct: number
  model:          string
}

interface Props {
  usage: ContextUsageView | null
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return n.toString()
}

export default function ContextIndicator({ usage }: Props) {
  if (!usage) {
    // No turn yet — render the model name only.
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded-full"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: '#55556a' }}
        title="No turn yet — model + context window will surface after the first send."
      >
        <Cpu size={9} />
        <span>idle</span>
      </span>
    )
  }
  const pct = usage.inputUsedPct
  const tone = pct >= 85
    ? { fg: '#fca5a5', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.30)' }
    : pct >= 60
      ? { fg: '#fbbf24', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.30)' }
      : { fg: '#a8a3ff', bg: 'rgba(108,99,255,0.06)', border: 'rgba(108,99,255,0.18)' }
  const title = [
    usage.model,
    `${usage.tokensUsed.toLocaleString()} tokens used (${pct.toFixed(1)}% of ${usage.inputBudget.toLocaleString()} input budget)`,
    `Full context window: ${usage.contextTokens.toLocaleString()} (${usage.contextUsedPct.toFixed(1)}% used)`,
  ].join('\n')
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded-full"
      style={{ background: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg }}
      title={title}
    >
      <Cpu size={9} />
      <span>{usage.model}</span>
      <span style={{ opacity: 0.55 }}>·</span>
      <span>{pct.toFixed(0)}%</span>
      <span style={{ opacity: 0.55 }}>· {formatTokens(usage.tokensUsed)}/{formatTokens(usage.contextTokens)}</span>
    </span>
  )
}
