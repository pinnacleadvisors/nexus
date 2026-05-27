/**
 * lib/digest/build-weekly.ts — operator weekly digest builder.
 *
 * R6 of the UX consultation. Aggregates per-business state for the
 * past 7 days into a single dense digest the operator reads Sunday
 * morning instead of drilling into each business.
 *
 * Contract:
 *   - Pure read. Never mutates.
 *   - Inputs: userId (operator), nowMs (optional override for tests)
 *   - Output: { markdown_body, html_body, summary_obj } so the caller
 *     can email it via Resend, persist as a memory atom, or render
 *     inline on /dashboard.
 *
 * The same data also flows into the R5 CoachingCard via
 * lib/coaching/insights.ts — the digest is the week-long view; the
 * coach is the moment-in-time view.
 */

import { createServerClient } from '@/lib/supabase'

interface BusinessRow {
  slug:       string
  name:       string
  niche:      string | null
  simulation: boolean | null
}

interface MetricRow {
  business_slug: string
  kind:          string
  payload:       { usd?: number } | null
  ts:            string
}

interface ApprovalRow {
  business_slug: string
  status:        string
  decided_at:    string | null
  created_at:    string
}

export interface BusinessWeekSummary {
  slug:             string
  name:             string
  niche:            string | null
  simulation:       boolean
  spend_usd:        number
  revenue_usd:      number
  net_usd:          number
  approvals_total:  number
  approvals_pending: number
  approvals_decided: number
  signups:          number
  content_published: number
  /** Single-sentence operator-readable summary. */
  one_liner:        string
}

export interface WeeklyDigest {
  generated_at_iso:  string
  week_start_iso:    string
  week_end_iso:      string
  business_count:    number
  businesses:        BusinessWeekSummary[]
  fleet_totals: {
    spend_usd:    number
    revenue_usd:  number
    net_usd:      number
    approvals:    number
    graduations:  number
    signups:      number
  }
  top_wins:    string[]
  top_risks:   string[]
  markdown_body: string
  html_body:     string
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export async function buildWeeklyDigest(
  userId: string,
  nowMs: number = Date.now(),
): Promise<WeeklyDigest> {
  const weekStart = new Date(nowMs - WEEK_MS)
  const weekEnd   = new Date(nowMs)

  const empty: WeeklyDigest = {
    generated_at_iso: new Date(nowMs).toISOString(),
    week_start_iso:   weekStart.toISOString(),
    week_end_iso:     weekEnd.toISOString(),
    business_count:   0,
    businesses:       [],
    fleet_totals:     { spend_usd: 0, revenue_usd: 0, net_usd: 0, approvals: 0, graduations: 0, signups: 0 },
    top_wins:         [],
    top_risks:        [],
    markdown_body:    '',
    html_body:        '',
  }

  const db = createServerClient()
  if (!db) return empty

  // Load businesses owned by the operator.
  let businesses: BusinessRow[] = []
  try {
    const r = await (db.from('business_operators' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => Promise<{ data: BusinessRow[] | null }> }
    }).select('slug, name, niche, simulation').eq('user_id', userId)
    businesses = r.data ?? []
  } catch { /* swallow */ }

  if (businesses.length === 0) return empty
  const slugs = businesses.map(b => b.slug)

  // Per-business metrics over the past week.
  const [metricsRes, approvalsRes, gradsRes] = await Promise.allSettled([
    (db.from('experiment_metrics' as never) as unknown as {
      select: (c: string) => { in: (c: string, v: string[]) => { gte: (c: string, v: string) => Promise<{ data: MetricRow[] | null }> } }
    }).select('business_slug, kind, payload, ts').in('business_slug', slugs).gte('ts', weekStart.toISOString()),
    (db.from('approvals' as never) as unknown as {
      select: (c: string) => { in: (c: string, v: string[]) => { gte: (c: string, v: string) => Promise<{ data: ApprovalRow[] | null }> } }
    }).select('business_slug, status, decided_at, created_at').in('business_slug', slugs).gte('created_at', weekStart.toISOString()),
    // simulation_graduated_at within the window = a graduation event
    (db.from('business_operators' as never) as unknown as {
      select: (c: string) => { in: (c: string, v: string[]) => { gte: (c: string, v: string) => Promise<{ data: Array<{ slug: string; simulation_graduated_at: string | null }> | null }> } }
    }).select('slug, simulation_graduated_at').in('slug', slugs).gte('simulation_graduated_at', weekStart.toISOString()),
  ])

  const metricsByBiz = new Map<string, MetricRow[]>()
  if (metricsRes.status === 'fulfilled') {
    for (const r of metricsRes.value.data ?? []) {
      const arr = metricsByBiz.get(r.business_slug) ?? []
      arr.push(r)
      metricsByBiz.set(r.business_slug, arr)
    }
  }

  const approvalsByBiz = new Map<string, ApprovalRow[]>()
  if (approvalsRes.status === 'fulfilled') {
    for (const r of approvalsRes.value.data ?? []) {
      const arr = approvalsByBiz.get(r.business_slug) ?? []
      arr.push(r)
      approvalsByBiz.set(r.business_slug, arr)
    }
  }

  const graduations = gradsRes.status === 'fulfilled'
    ? (gradsRes.value.data ?? []).filter(r => r.simulation_graduated_at).length
    : 0

  const sumUsd = (rows: MetricRow[], kind: string) =>
    rows.filter(r => r.kind === kind).reduce((s, r) => s + (r.payload?.usd ?? 0), 0)
  const count = (rows: MetricRow[], kind: string) =>
    rows.filter(r => r.kind === kind).length

  // Build per-business summaries
  const summaries: BusinessWeekSummary[] = businesses.map(b => {
    const m = metricsByBiz.get(b.slug) ?? []
    const a = approvalsByBiz.get(b.slug) ?? []
    const spend = sumUsd(m, 'cash_spend')
    const revenue = sumUsd(m, 'revenue')
    const approvalsTotal = a.length
    const approvalsPending = a.filter(x => x.status === 'pending').length
    const approvalsDecided = approvalsTotal - approvalsPending
    const signups = count(m, 'signup')
    const content = count(m, 'content_published')

    const one_liner = (() => {
      const parts: string[] = []
      if (revenue > 0) parts.push(`$${revenue.toFixed(2)} revenue`)
      if (spend > 0) parts.push(`$${spend.toFixed(2)} spend`)
      if (signups > 0) parts.push(`${signups} signups`)
      if (content > 0) parts.push(`${content} content published`)
      if (approvalsPending > 0) parts.push(`${approvalsPending} approvals pending`)
      if (parts.length === 0) return 'Quiet week — no activity recorded.'
      return parts.join(' · ')
    })()

    return {
      slug:                b.slug,
      name:                b.name,
      niche:               b.niche,
      simulation:          Boolean(b.simulation),
      spend_usd:           spend,
      revenue_usd:         revenue,
      net_usd:             revenue - spend,
      approvals_total:     approvalsTotal,
      approvals_pending:   approvalsPending,
      approvals_decided:   approvalsDecided,
      signups,
      content_published:   content,
      one_liner,
    }
  })

  // Fleet totals
  const totals = summaries.reduce((acc, s) => ({
    spend_usd:    acc.spend_usd   + s.spend_usd,
    revenue_usd:  acc.revenue_usd + s.revenue_usd,
    net_usd:      acc.net_usd     + s.net_usd,
    approvals:    acc.approvals   + s.approvals_total,
    graduations:  graduations,
    signups:      acc.signups     + s.signups,
  }), { spend_usd: 0, revenue_usd: 0, net_usd: 0, approvals: 0, graduations: 0, signups: 0 })

  // Top wins: businesses with positive net + revenue this week
  const wins = summaries
    .filter(s => s.revenue_usd > 0 || s.signups > 0 || s.content_published > 0)
    .sort((a, b) => b.net_usd - a.net_usd)
    .slice(0, 3)
    .map(s => `**${s.name}** — ${s.one_liner}`)

  // Top risks: businesses with cost-no-revenue + lots of pending approvals
  const risks = summaries
    .filter(s => (s.spend_usd > 5 && s.revenue_usd === 0) || s.approvals_pending >= 3)
    .sort((a, b) => b.spend_usd - a.spend_usd)
    .slice(0, 3)
    .map(s => {
      const reasons = []
      if (s.spend_usd > 5 && s.revenue_usd === 0) reasons.push(`$${s.spend_usd.toFixed(2)} burned, $0 revenue`)
      if (s.approvals_pending >= 3) reasons.push(`${s.approvals_pending} pending approvals`)
      return `**${s.name}** — ${reasons.join(' · ')}`
    })

  const markdown = renderMarkdown(summaries, totals, wins, risks, weekStart, weekEnd)
  const html     = markdownToHtml(markdown)

  return {
    generated_at_iso: new Date(nowMs).toISOString(),
    week_start_iso:   weekStart.toISOString(),
    week_end_iso:     weekEnd.toISOString(),
    business_count:   businesses.length,
    businesses:       summaries,
    fleet_totals:     totals,
    top_wins:         wins,
    top_risks:        risks,
    markdown_body:    markdown,
    html_body:        html,
  }
}

function fmtUSD(n: number): string { return `$${n.toFixed(2)}` }

function renderMarkdown(
  summaries: BusinessWeekSummary[],
  totals:    WeeklyDigest['fleet_totals'],
  wins:      string[],
  risks:     string[],
  weekStart: Date,
  weekEnd:   Date,
): string {
  const dateRange = `${weekStart.toISOString().slice(0, 10)} → ${weekEnd.toISOString().slice(0, 10)}`
  const lines: string[] = []
  lines.push(`# Nexus weekly digest — ${dateRange}`)
  lines.push('')
  lines.push(`Across ${summaries.length} business${summaries.length === 1 ? '' : 'es'}:`)
  lines.push('')
  lines.push(`- Spend: **${fmtUSD(totals.spend_usd)}**`)
  lines.push(`- Revenue: **${fmtUSD(totals.revenue_usd)}**`)
  lines.push(`- Net: **${fmtUSD(totals.net_usd)}** ${totals.net_usd >= 0 ? '✅' : '⚠️'}`)
  lines.push(`- Signups: **${totals.signups}**`)
  lines.push(`- Approvals (created): **${totals.approvals}**`)
  lines.push(`- Graduations: **${totals.graduations}**`)
  lines.push('')

  if (wins.length > 0) {
    lines.push('## 🎉 Top wins')
    lines.push('')
    wins.forEach(w => lines.push(`- ${w}`))
    lines.push('')
  }

  if (risks.length > 0) {
    lines.push('## ⚠️ Top risks')
    lines.push('')
    risks.forEach(r => lines.push(`- ${r}`))
    lines.push('')
  }

  lines.push('## Per-business')
  lines.push('')
  for (const s of summaries) {
    const simBadge = s.simulation ? ' _(sim)_' : ''
    lines.push(`### ${s.name}${simBadge}`)
    if (s.niche) lines.push(`*${s.niche}*`)
    lines.push('')
    lines.push(s.one_liner)
    lines.push('')
  }
  lines.push('---')
  lines.push('')
  lines.push('Visit /dashboard for the live view.')

  return lines.join('\n')
}

/** Tiny markdown → HTML converter — handles only the headings, bold,
 *  italic, ul, and paragraph breaks we emit. Avoids a 100KB npm dep. */
function markdownToHtml(md: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = md.split('\n')
  const out: string[] = []
  let inList = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') {
      if (inList) { out.push('</ul>'); inList = false }
      continue
    }
    if (trimmed === '---') { out.push('<hr>'); continue }
    if (trimmed.startsWith('# ')) { out.push(`<h1>${inline(trimmed.slice(2))}</h1>`); continue }
    if (trimmed.startsWith('## ')) { out.push(`<h2>${inline(trimmed.slice(3))}</h2>`); continue }
    if (trimmed.startsWith('### ')) { out.push(`<h3>${inline(trimmed.slice(4))}</h3>`); continue }
    if (trimmed.startsWith('- ')) {
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${inline(trimmed.slice(2))}</li>`)
      continue
    }
    out.push(`<p>${inline(trimmed)}</p>`)
  }
  if (inList) out.push('</ul>')

  function inline(s: string): string {
    return escape(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
  }

  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;color:#1a1a2e;max-width:640px;margin:0 auto;padding:24px;">${out.join('\n')}</body></html>`
}
