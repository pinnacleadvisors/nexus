/**
 * Task G1 — Measure the cost regression on `claude -p` headless mode.
 *
 * Reads gateway_turns from the last 30 days and computes the hypothetical
 * API-rate cost that those dispatches would have incurred if Anthropic
 * billed `-p` at API rates (as the recent platform change implies).
 *
 * Output: docs/cost/claude-p-mode-cost-<YYYY-MM-DD>.md
 *
 * Run:  doppler run --project nexus --config dev -- npx tsx scripts/measure-dispatch-cost.ts
 *
 * Does not dispatch any new live Claude calls — pure historical analysis.
 * See task_plan-claude-headless-cost-recovery.md for the decision gate.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL                = process.env.NEXT_PUBLIC_SUPABASE_URL          ?? ''
const SUPABASE_SERVICE_ROLE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY         ?? ''
const CLAUDE_MAX_PLAN_USD         = Number(process.env.MAX_PLAN_USD_PER_MONTH    ?? '200')
const DECISION_GATE_MULTIPLIER    = Number(process.env.G1_DECISION_GATE          ?? '1.5')

const PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  // Anthropic — full API rates (no cache discount applied; this is the
  // worst-case if -p loses both subscription billing AND cache-read pricing).
  'opus':              { input: 15,  output: 75 },
  'claude-opus-4-7':   { input: 15,  output: 75 },
  'sonnet':            { input: 3,   output: 15 },
  'sonnet-4-6':        { input: 3,   output: 15 },
  'claude-sonnet-4-6': { input: 3,   output: 15 },
  'haiku':             { input: 0.8, output: 4 },
  'haiku-4-5':         { input: 0.8, output: 4 },
  'claude-haiku-4-5':  { input: 0.8, output: 4 },
  // OpenAI — included for completeness; Codex Pro stays on subscription.
  'gpt-5.5':           { input: 10,  output: 40 },
  'gpt-5.5-codex':     { input: 10,  output: 40 },
}

interface TurnRow {
  plan:          string
  model:         string | null
  session_tag:   string | null
  duration_ms:   number | null
  input_tokens:  number | null
  output_tokens: number | null
  created_at:    string
}

interface DispatchGroup {
  type:           string
  count:          number
  meanInTokens:   number
  meanOutTokens:  number
  totalInTokens:  number
  totalOutTokens: number
  meanDurationS:  number
  hypotheticalUsd: number
}

function dispatchTypeFromTag(tag: string | null): string {
  if (!tag) return 'unknown'
  const prefix = tag.split('-')[0]
  if (['platform', 'business', 'bug', 'solopreneur', 'codex', 'pdf', 'agent'].includes(prefix)) {
    if (prefix === 'platform' || prefix === 'business') return `${prefix}-chat`
    if (prefix === 'bug')                                 return 'bug-hunt'
    if (prefix === 'solopreneur')                         return 'solopreneur-loop'
    if (prefix === 'codex')                               return 'codex-maintainer'
    if (prefix === 'pdf')                                 return 'pdf-swarm'
    if (prefix === 'agent')                               return 'agent-dispatch'
  }
  return prefix
}

function hypotheticalCostUsd(turn: TurnRow): number {
  if (!turn.model) return 0
  const price = PRICING_PER_MTOK[turn.model.toLowerCase()] ?? PRICING_PER_MTOK['sonnet']
  const inTok  = turn.input_tokens  ?? 0
  const outTok = turn.output_tokens ?? 0
  return (inTok / 1_000_000) * price.input + (outTok / 1_000_000) * price.output
}

async function main(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(2)
  }
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const since = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString()

  const { data, error } = await db
    .from('gateway_turns')
    .select('plan,model,session_tag,duration_ms,input_tokens,output_tokens,created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Query failed:', error.message)
    process.exit(3)
  }
  const turns = (data ?? []) as TurnRow[]
  if (turns.length === 0) {
    console.error('No gateway_turns rows in the last 30 days — nothing to measure.')
    process.exit(4)
  }

  // Slice by plan first — only claude-max rows are affected by the -p regression.
  const claudeMax = turns.filter(t => t.plan === 'claude-max')
  const codexPro  = turns.filter(t => t.plan === 'codex-pro')
  const apiOnly   = turns.filter(t => t.plan === 'anthropic-api')

  const groups = new Map<string, TurnRow[]>()
  for (const t of claudeMax) {
    const k = dispatchTypeFromTag(t.session_tag)
    const arr = groups.get(k) ?? []
    arr.push(t)
    groups.set(k, arr)
  }

  const rows: DispatchGroup[] = []
  for (const [type, ts] of Array.from(groups.entries())) {
    const n = ts.length
    const totalIn  = ts.reduce((s, t) => s + (t.input_tokens  ?? 0), 0)
    const totalOut = ts.reduce((s, t) => s + (t.output_tokens ?? 0), 0)
    const meanDur  = ts.reduce((s, t) => s + (t.duration_ms ?? 0), 0) / n / 1000
    const hypo     = ts.reduce((s, t) => s + hypotheticalCostUsd(t), 0)
    rows.push({
      type,
      count:           n,
      meanInTokens:    Math.round(totalIn  / n),
      meanOutTokens:   Math.round(totalOut / n),
      totalInTokens:   totalIn,
      totalOutTokens:  totalOut,
      meanDurationS:   Math.round(meanDur * 10) / 10,
      hypotheticalUsd: Math.round(hypo * 100) / 100,
    })
  }
  rows.sort((a, b) => b.hypotheticalUsd - a.hypotheticalUsd)
  const totalHypothetical = rows.reduce((s, r) => s + r.hypotheticalUsd, 0)
  const monthlyProjected  = totalHypothetical // already 30-day window
  const verdict
    = monthlyProjected <= CLAUDE_MAX_PLAN_USD * DECISION_GATE_MULTIPLIER ? 'NO ACTION'
    : monthlyProjected <= CLAUDE_MAX_PLAN_USD * 3                        ? 'HYBRID'
    :                                                                     'MIGRATE'

  const today = new Date().toISOString().slice(0, 10)
  const outDir = join(process.cwd(), 'docs/cost')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `claude-p-mode-cost-${today}.md`)

  const md = `# Claude \`-p\` mode cost regression — measurement (${today})

Auto-generated by [scripts/measure-dispatch-cost.ts](../../scripts/measure-dispatch-cost.ts). Pure historical analysis of \`gateway_turns\` for the last 30 days — no live dispatches.

## Inputs

| Var | Value |
|---|---|
| Window | 30 days (since ${since.slice(0,10)}) |
| Claude Max plan baseline | $${CLAUDE_MAX_PLAN_USD}/month |
| Decision gate multiplier | ${DECISION_GATE_MULTIPLIER}× |
| Pricing source | API list price, no cache discount (worst case) |
| Total gateway_turns rows | ${turns.length} |
| └─ claude-max | ${claudeMax.length} |
| └─ codex-pro | ${codexPro.length} |
| └─ anthropic-api | ${apiOnly.length} |

## Hypothetical API-rate cost — claude-max plan dispatches, by type

If every \`-p\` dispatch billed at full API rates (no cache discount), the
last 30 days of activity would have cost:

| Dispatch type | Count | Mean in/out tokens | Mean duration | Hypothetical USD |
|---|---:|---:|---:|---:|
${rows.map(r => `| ${r.type} | ${r.count} | ${r.meanInTokens.toLocaleString()} / ${r.meanOutTokens.toLocaleString()} | ${r.meanDurationS}s | $${r.hypotheticalUsd.toFixed(2)} |`).join('\n')}
| **Total** | **${claudeMax.length}** | — | — | **$${monthlyProjected.toFixed(2)}** |

## Projected monthly burn vs Max plan

| Scenario | Monthly cost |
|---|---:|
| Claude Max 20x plan (subscription, current) | $${CLAUDE_MAX_PLAN_USD.toFixed(2)} |
| Hypothetical at API rates (no cache discount) | $${monthlyProjected.toFixed(2)} |
| Ratio | ${(monthlyProjected / CLAUDE_MAX_PLAN_USD).toFixed(2)}× |

## Verdict (auto-derived)

**${verdict}**

Decision table (env: \`G1_DECISION_GATE\` = ${DECISION_GATE_MULTIPLIER}):

- \`≤ ${DECISION_GATE_MULTIPLIER}× plan\` → **NO ACTION** (regression is small enough that PTY-mode's telemetry loss isn't worth it)
- \`${DECISION_GATE_MULTIPLIER}× – 3× plan\` → **HYBRID** (route high-volume autonomous loops through PTY, keep \`-p\` for chat copilots)
- \`> 3× plan\` → **MIGRATE** (urgent — start Task G2 immediately)

## Caveats

1. **API-rate assumption is worst-case.** If Anthropic still honors the 90% cache-read discount on \`-p\`, real cost is lower. To refine, re-run with cache discount applied (subtract 90% from input cost on cache-hit tokens — \`gateway_turns\` doesn't currently capture cache_read_input_tokens separately, so we use total input as the upper bound).
2. **30-day window may include outlier days.** Bug-hunt sessions, swarm dispatches, and one-off audits inflate the tail. The "mean duration" column gives a sanity check.
3. **codex-pro + anthropic-api rows are excluded from the projection.** Only claude-max-plan rows are affected by the \`-p\` regression. The ${codexPro.length} codex-pro rows and ${apiOnly.length} anthropic-api rows are reported above for context.
4. **Future volume may not match past volume.** If the workforce-intelligence work in \`task_plan-workforce-intelligence.md\` increases dispatch frequency, scale this projection accordingly.

## Next step

See \`task_plan-claude-headless-cost-recovery.md\`. If verdict is \`NO ACTION\`, close that plan and proceed with the workforce-intelligence work. Otherwise, request operator approval for Task G2 (\`node-pty\` prototype).
`

  writeFileSync(outPath, md)
  console.log(`Report written: ${outPath}`)
  console.log(`Verdict: ${verdict}  (monthly projected $${monthlyProjected.toFixed(2)} vs plan $${CLAUDE_MAX_PLAN_USD})`)
}

main().catch(e => {
  console.error('measure-dispatch-cost failed:', e)
  process.exit(1)
})
