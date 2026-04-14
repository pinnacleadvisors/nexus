/**
 * lib/org/mock-data.ts
 * Rich seed data for Phase 16 Organisation Chart.
 * Used when Supabase is not configured.
 */

import type { OrgAgent, AgentAction, OrgTree, OrgStats, Swimlane } from './types'

const NOW   = new Date().toISOString()
const HOUR  = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()

// ── Mock actions ──────────────────────────────────────────────────────────────
function makeActions(agentId: string, items: Array<[string, string, number]>): AgentAction[] {
  return items.map(([action, description, tokensUsed], i) => ({
    id:          `act-${agentId}-${i}`,
    agent_id:    agentId,
    action,
    description,
    tokens_used: tokensUsed,
    created_at:  HOUR(i * 0.5),
  }))
}

// ── Flat agent list ───────────────────────────────────────────────────────────
export const MOCK_AGENTS: OrgAgent[] = [
  // L0 — User
  {
    id: 'agent-user',
    user_id: 'user_root',
    name: 'You',
    role: 'Platform Owner',
    layer: 0,
    status: 'running',
    parent_agent_id: null,
    swarm_id: null,
    business_id: null,
    project_id: null,
    model: 'human',
    current_task: 'Reviewing agent outputs on Board',
    tasks_completed: 147,
    tokens_used: 0,
    cost_usd: 0,
    last_active_at: NOW,
    created_at: HOUR(720),
    recent_actions: makeActions('agent-user', [
      ['approved', 'Approved market research report for SaaS tool', 0],
      ['rejected', 'Rejected blog post — tone too formal', 0],
      ['redirected', 'Redirected SEO task to specialist agent', 0],
    ]),
  },

  // L1 — Strategic Queens
  {
    id: 'agent-sq-01',
    user_id: 'user_root',
    name: 'Athena',
    role: 'Strategic Queen — Business Development',
    layer: 1,
    status: 'running',
    parent_agent_id: 'agent-user',
    swarm_id: 'swarm-alpha',
    business_id: 'biz-saas-001',
    project_id: null,
    model: 'claude-opus-4-6',
    current_task: 'Decomposing Q2 growth plan into tactical phases',
    tasks_completed: 23,
    tokens_used: 184_200,
    cost_usd: 2.76,
    last_active_at: HOUR(0.1),
    created_at: HOUR(48),
    recent_actions: makeActions('agent-sq-01', [
      ['plan_created', 'Created 5-phase Q2 growth plan', 4800],
      ['spawned', 'Spawned Tactical Queen: Marketing', 0],
      ['spawned', 'Spawned Tactical Queen: Engineering', 0],
      ['milestone_set', 'Set milestone: Launch v2.0 by end of month', 1200],
      ['context_saved', 'Saved strategic context to memory store', 350],
    ]),
  },
  {
    id: 'agent-sq-02',
    user_id: 'user_root',
    name: 'Zeus',
    role: 'Strategic Queen — Operations',
    layer: 1,
    status: 'idle',
    parent_agent_id: 'agent-user',
    swarm_id: 'swarm-beta',
    business_id: 'biz-ecomm-002',
    project_id: null,
    model: 'claude-opus-4-6',
    current_task: null,
    tasks_completed: 11,
    tokens_used: 96_400,
    cost_usd: 1.45,
    last_active_at: HOUR(3),
    created_at: HOUR(72),
    recent_actions: makeActions('agent-sq-02', [
      ['plan_created', 'Mapped e-commerce fulfilment pipeline', 3200],
      ['report_filed', 'Weekly operations review delivered', 2100],
    ]),
  },

  // L2 — Tactical Queens
  {
    id: 'agent-tq-01',
    user_id: 'user_root',
    name: 'Hermes',
    role: 'Tactical Queen — Marketing',
    layer: 2,
    status: 'running',
    parent_agent_id: 'agent-sq-01',
    swarm_id: 'swarm-alpha',
    business_id: 'biz-saas-001',
    project_id: 'proj-launch-001',
    model: 'claude-sonnet-4-6',
    current_task: 'Coordinating SEO and content agents for launch campaign',
    tasks_completed: 18,
    tokens_used: 52_800,
    cost_usd: 0.40,
    last_active_at: HOUR(0.2),
    created_at: HOUR(24),
    recent_actions: makeActions('agent-tq-01', [
      ['assigned', 'Assigned 3 blog posts to Content Specialist', 0],
      ['assigned', 'Assigned keyword research to SEO Specialist', 0],
      ['reviewed', 'Reviewed and approved social media calendar', 1800],
    ]),
  },
  {
    id: 'agent-tq-02',
    user_id: 'user_root',
    name: 'Hephaestus',
    role: 'Tactical Queen — Engineering',
    layer: 2,
    status: 'running',
    parent_agent_id: 'agent-sq-01',
    swarm_id: 'swarm-alpha',
    business_id: 'biz-saas-001',
    project_id: 'proj-launch-001',
    model: 'claude-sonnet-4-6',
    current_task: 'Assigning API integration tasks to coder agents',
    tasks_completed: 31,
    tokens_used: 78_300,
    cost_usd: 0.59,
    last_active_at: HOUR(0.3),
    created_at: HOUR(24),
    recent_actions: makeActions('agent-tq-02', [
      ['assigned', 'Assigned Stripe webhook implementation to Coder', 0],
      ['assigned', 'Assigned auth flow review to Code Reviewer', 0],
      ['spawned', 'Spawned Coder Specialist for payment integration', 0],
    ]),
  },
  {
    id: 'agent-tq-03',
    user_id: 'user_root',
    name: 'Demeter',
    role: 'Tactical Queen — Content',
    layer: 2,
    status: 'idle',
    parent_agent_id: 'agent-sq-02',
    swarm_id: 'swarm-beta',
    business_id: 'biz-ecomm-002',
    project_id: 'proj-ecomm-content',
    model: 'claude-sonnet-4-6',
    current_task: null,
    tasks_completed: 9,
    tokens_used: 28_900,
    cost_usd: 0.22,
    last_active_at: HOUR(5),
    created_at: HOUR(48),
    recent_actions: makeActions('agent-tq-03', [
      ['batch_assigned', 'Assigned product description batch (50 items)', 0],
      ['completed', 'Content calendar for April submitted for review', 2200],
    ]),
  },

  // L3 — Specialist Agents
  {
    id: 'agent-sp-01',
    user_id: 'user_root',
    name: 'Scribe',
    role: 'Content Specialist',
    layer: 3,
    status: 'running',
    parent_agent_id: 'agent-tq-01',
    swarm_id: 'swarm-alpha',
    business_id: 'biz-saas-001',
    project_id: 'proj-launch-001',
    model: 'claude-sonnet-4-6',
    current_task: 'Writing blog post: "10 Ways AI Agents Save 40+ Hours/Week"',
    tasks_completed: 14,
    tokens_used: 38_400,
    cost_usd: 0.29,
    last_active_at: HOUR(0.05),
    created_at: HOUR(8),
    recent_actions: makeActions('agent-sp-01', [
      ['draft_created', 'Blog post draft: "Why Automation Beats Hiring" (1,800 words)', 2400],
      ['library_hit', 'Retrieved growth copywriter template from library (saved 800 tokens)', 0],
      ['notion_saved', 'Saved draft to Nexus memory store', 0],
    ]),
  },
  {
    id: 'agent-sp-02',
    user_id: 'user_root',
    name: 'Ranker',
    role: 'SEO Specialist',
    layer: 3,
    status: 'completed',
    parent_agent_id: 'agent-tq-01',
    swarm_id: 'swarm-alpha',
    business_id: 'biz-saas-001',
    project_id: 'proj-launch-001',
    model: 'claude-sonnet-4-6',
    current_task: null,
    tasks_completed: 7,
    tokens_used: 19_200,
    cost_usd: 0.14,
    last_active_at: HOUR(1),
    created_at: HOUR(8),
    recent_actions: makeActions('agent-sp-02', [
      ['research_complete', 'Keyword cluster map (120 keywords, 8 clusters) delivered', 3100],
      ['web_search', 'Tavily search: competitor backlink analysis', 450],
      ['board_card', 'Created Board card: "SEO audit — Review"', 0],
    ]),
  },
  {
    id: 'agent-sp-03',
    user_id: 'user_root',
    name: 'Coder',
    role: 'Full-Stack Coder',
    layer: 3,
    status: 'running',
    parent_agent_id: 'agent-tq-02',
    swarm_id: 'swarm-alpha',
    business_id: 'biz-saas-001',
    project_id: 'proj-launch-001',
    model: 'claude-sonnet-4-6',
    current_task: 'Implementing Stripe webhook handler (POST /api/webhooks/stripe)',
    tasks_completed: 22,
    tokens_used: 61_800,
    cost_usd: 0.46,
    last_active_at: HOUR(0.08),
    created_at: HOUR(8),
    recent_actions: makeActions('agent-sp-03', [
      ['library_hit', 'Fetched Clerk JWT snippet from library (saved 350 tokens)', 0],
      ['code_written', 'Stripe webhook route drafted (87 lines TypeScript)', 1800],
      ['tsc_check', 'TypeScript check: 0 errors', 0],
    ]),
  },
  {
    id: 'agent-sp-04',
    user_id: 'user_root',
    name: 'Auditor',
    role: 'Code Reviewer',
    layer: 3,
    status: 'idle',
    parent_agent_id: 'agent-tq-02',
    swarm_id: 'swarm-alpha',
    business_id: 'biz-saas-001',
    project_id: 'proj-launch-001',
    model: 'claude-sonnet-4-6',
    current_task: null,
    tasks_completed: 18,
    tokens_used: 32_500,
    cost_usd: 0.24,
    last_active_at: HOUR(2),
    created_at: HOUR(8),
    recent_actions: makeActions('agent-sp-04', [
      ['review_complete', 'Auth flow reviewed — 3 issues flagged', 2200],
      ['library_saved', 'Saved rate-limiter snippet to library', 0],
    ]),
  },
  {
    id: 'agent-sp-05',
    user_id: 'user_root',
    name: 'Analyst',
    role: 'Market Research Analyst',
    layer: 3,
    status: 'error',
    parent_agent_id: 'agent-sq-02',
    swarm_id: 'swarm-beta',
    business_id: 'biz-ecomm-002',
    project_id: 'proj-ecomm-content',
    model: 'claude-sonnet-4-6',
    current_task: 'Competitor pricing analysis — failed: Tavily quota exceeded',
    tasks_completed: 5,
    tokens_used: 12_700,
    cost_usd: 0.10,
    last_active_at: HOUR(4),
    created_at: HOUR(12),
    recent_actions: makeActions('agent-sp-05', [
      ['error', 'Tavily API quota exceeded — research halted', 0],
      ['retry', 'Retry #1 failed (same quota error)', 0],
      ['board_card', 'Created error card: "Analyst quota failure — Review"', 0],
    ]),
  },

  // L4 — Background Workers
  {
    id: 'agent-w-01',
    user_id: 'user_root',
    name: 'Scheduler',
    role: 'Inngest Cron Worker',
    layer: 4,
    status: 'running',
    parent_agent_id: 'agent-sq-01',
    swarm_id: null,
    business_id: null,
    project_id: null,
    model: 'claude-haiku-4-5-20251001',
    current_task: 'Running weekly stack health check (npm audit + tsc)',
    tasks_completed: 84,
    tokens_used: 8_400,
    cost_usd: 0.02,
    last_active_at: HOUR(0.01),
    created_at: HOUR(168),
    recent_actions: makeActions('agent-w-01', [
      ['cron_fired', 'Weekly audit cron triggered', 0],
      ['npm_audit', 'npm audit: 1 high severity found', 200],
      ['board_card', 'Created Board card: "Security advisory — review"', 0],
    ]),
  },
  {
    id: 'agent-w-02',
    user_id: 'user_root',
    name: 'Notifier',
    role: 'Webhook Dispatcher',
    layer: 4,
    status: 'idle',
    parent_agent_id: 'agent-tq-02',
    swarm_id: 'swarm-alpha',
    business_id: 'biz-saas-001',
    project_id: null,
    model: 'claude-haiku-4-5-20251001',
    current_task: null,
    tasks_completed: 211,
    tokens_used: 4_200,
    cost_usd: 0.01,
    last_active_at: HOUR(0.5),
    created_at: HOUR(168),
    recent_actions: makeActions('agent-w-02', [
      ['webhook_sent', 'Board card status change dispatched to n8n', 0],
      ['email_sent', 'Resend: "Agent completed task" notification sent', 0],
    ]),
  },
]

// ── Build tree ────────────────────────────────────────────────────────────────
export function buildMockTree(): OrgTree {
  const byId: Record<string, OrgAgent> = {}
  for (const a of MOCK_AGENTS) byId[a.id] = { ...a, children: [] }

  // Wire children
  for (const a of MOCK_AGENTS) {
    if (a.parent_agent_id && byId[a.parent_agent_id]) {
      byId[a.parent_agent_id].children!.push(byId[a.id])
    }
  }

  const root = byId['agent-user']

  const byLayer = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 } as Record<0|1|2|3|4, number>
  const byStatus = { idle: 0, running: 0, error: 0, completed: 0, terminated: 0 } as Record<string, number>
  let totalTokens = 0
  let totalCost   = 0

  for (const a of MOCK_AGENTS) {
    byLayer[a.layer]++
    byStatus[a.status]++
    totalTokens += a.tokens_used
    totalCost   += a.cost_usd
  }

  const swarms = [...new Set(MOCK_AGENTS.map(a => a.swarm_id).filter(Boolean))] as string[]

  const stats: OrgStats = {
    total:        MOCK_AGENTS.length,
    byLayer,
    byStatus,
    totalTokens,
    totalCost,
    activeSwarms: swarms.filter(s =>
      MOCK_AGENTS.some(a => a.swarm_id === s && a.status === 'running'),
    ).length,
  }

  return { root, agents: MOCK_AGENTS, byId, swarms, stats }
}

// ── Swimlanes ─────────────────────────────────────────────────────────────────
export function buildMockSwimlanes(): Swimlane[] {
  const map: Record<string, Swimlane> = {
    'biz-saas-001':     { id: 'biz-saas-001',     label: 'SaaS Platform',     agents: [] },
    'biz-ecomm-002':    { id: 'biz-ecomm-002',     label: 'E-commerce Store',  agents: [] },
    'unassigned':       { id: 'unassigned',         label: 'Platform / Global', agents: [] },
  }

  for (const a of MOCK_AGENTS) {
    const key = a.business_id ?? 'unassigned'
    if (!map[key]) map[key] = { id: key, label: key, agents: [] }
    map[key].agents.push(a)
  }

  return Object.values(map).filter(s => s.agents.length > 0)
}
