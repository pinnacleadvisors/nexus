/**
 * lib/swarm/Router.ts
 *
 * Q-Learning router: learns the optimal (agent, model) pair for each (taskType, complexity)
 * combination based on observed quality scores and token costs.
 *
 * Algorithm: ε-greedy bandit (γ=0, no future discounting — pure bandit problem)
 * Reward: result_quality / (tokens_used / 5000) — quality per normalised token unit
 *
 * Q-table persists in ReasoningBank between sessions.
 */

import type { AgentRole, Complexity, RouterAction, RouterStateKey, QEntry } from './types'
import { AGENT_REGISTRY, findAgentByTags } from './agents/registry'
import { getBestPattern, storePattern, hashText } from './ReasoningBank'
import { createServerClient } from '@/lib/supabase'

// ── Constants ─────────────────────────────────────────────────────────────────
const EPSILON       = 0.1   // exploration rate
const ALPHA         = 0.3   // learning rate
// C6 — exponential decay. Q-values age at a 14-day half-life so old successes
// don't dominate a rotating agent pool. `decayFactor(age)` is multiplied into
// the stored Q before the learning update so stale entries drift toward 0.5.
const HALF_LIFE_MS  = 14 * 86_400_000
function decayFactor(ageMs: number): number {
  if (ageMs <= 0) return 1
  return Math.pow(0.5, ageMs / HALF_LIFE_MS)
}
const HAIKU         = 'claude-haiku-4-5-20251001'
const SONNET        = 'claude-sonnet-4-6'
const OPUS          = 'claude-opus-4-6'

// ── Default Q-table priors (based on cost/quality reasoning) ──────────────────
// Higher = more likely to be chosen before any learning
const DEFAULT_PRIORS: Array<{ role: AgentRole; model: string; complexity: Complexity; prior: number }> = [
  { role: 'researcher',       model: SONNET, complexity: 'medium', prior: 0.7 },
  { role: 'analyst',          model: SONNET, complexity: 'medium', prior: 0.7 },
  { role: 'strategist',       model: OPUS,   complexity: 'high',   prior: 0.8 },
  { role: 'coder',            model: SONNET, complexity: 'high',   prior: 0.8 },
  { role: 'reviewer',         model: SONNET, complexity: 'medium', prior: 0.65 },
  { role: 'tester',           model: SONNET, complexity: 'medium', prior: 0.65 },
  { role: 'architect',        model: OPUS,   complexity: 'high',   prior: 0.85 },
  { role: 'security-auditor', model: SONNET, complexity: 'high',   prior: 0.8 },
  { role: 'marketer',         model: SONNET, complexity: 'medium', prior: 0.65 },
  { role: 'copywriter',       model: SONNET, complexity: 'medium', prior: 0.65 },
  { role: 'seo-specialist',   model: SONNET, complexity: 'medium', prior: 0.6 },
  { role: 'social-media',     model: HAIKU,  complexity: 'low',    prior: 0.7 },
  { role: 'email-specialist', model: HAIKU,  complexity: 'low',    prior: 0.7 },
  { role: 'designer',         model: HAIKU,  complexity: 'low',    prior: 0.65 },
  { role: 'data-analyst',     model: SONNET, complexity: 'medium', prior: 0.65 },
  { role: 'finance-analyst',  model: OPUS,   complexity: 'high',   prior: 0.85 },
  { role: 'legal-advisor',    model: OPUS,   complexity: 'high',   prior: 0.85 },
  { role: 'customer-support', model: HAIKU,  complexity: 'low',    prior: 0.7 },
  { role: 'devops',           model: SONNET, complexity: 'high',   prior: 0.75 },
  { role: 'product-manager',  model: SONNET, complexity: 'medium', prior: 0.7 },
  { role: 'qa-engineer',      model: HAIKU,  complexity: 'medium', prior: 0.65 },
  { role: 'brand-strategist', model: SONNET, complexity: 'high',   prior: 0.75 },
]

// ── In-memory Q-table ─────────────────────────────────────────────────────────
const Q_TABLE = new Map<string, Map<string, QEntry>>()

function stateKey(s: RouterStateKey): string {
  return `${s.taskType}:${s.complexity}`
}

function actionKey(a: RouterAction): string {
  return `${a.agentRole}:${a.model}`
}

function initState(key: string): Map<string, QEntry> {
  const actions = new Map<string, QEntry>()
  for (const prior of DEFAULT_PRIORS) {
    actions.set(`${prior.role}:${prior.model}`, { qValue: prior.prior, visitCount: 0 })
  }
  Q_TABLE.set(key, actions)
  return actions
}

// ── Complexity inference ──────────────────────────────────────────────────────
export function inferComplexity(description: string): Complexity {
  const d = description.toLowerCase()
  if (d.includes('strategy') || d.includes('architect') || d.includes('financial model') ||
      d.includes('legal') || d.includes('security audit') || d.includes('system design')) {
    return 'high'
  }
  if (d.includes('post') || d.includes('email') || d.includes('template') ||
      d.includes('brief') || d.includes('faq') || d.includes('simple')) {
    return 'low'
  }
  return 'medium'
}

// ── Route a task ──────────────────────────────────────────────────────────────
export async function routeTask(state: RouterStateKey, taskDescription: string): Promise<RouterAction> {
  // 1. Check ReasoningBank for a prior successful routing
  const pattern = await getBestPattern(state.taskType)
  if (pattern && pattern.resultQuality > 0.8 && Math.random() > EPSILON) {
    return { agentRole: pattern.agentRole, model: pattern.model }
  }

  const sKey = stateKey(state)
  const actions = Q_TABLE.get(sKey) ?? initState(sKey)

  // 2. ε-greedy: explore randomly or exploit best known action
  if (Math.random() < EPSILON) {
    // Explore: pick a random action biased toward task-relevant agents
    const tagMatch = findAgentByTags(state.taskType.split(/[\s_-]+/))
    const agent = tagMatch ?? AGENT_REGISTRY[Math.floor(Math.random() * AGENT_REGISTRY.length)]
    return { agentRole: agent.role, model: agent.preferredModel }
  }

  // 3. Exploit: pick action with highest Q-value
  let bestKey = ''
  let bestQ   = -Infinity
  for (const [aKey, entry] of actions.entries()) {
    if (entry.qValue > bestQ) { bestQ = entry.qValue; bestKey = aKey }
  }

  if (!bestKey) {
    // Fallback: tag-match from registry
    const tagMatch = findAgentByTags(state.taskType.split(/[\s_-]+/)) ?? AGENT_REGISTRY[0]
    return { agentRole: tagMatch.role, model: tagMatch.preferredModel }
  }

  const [role, model] = bestKey.split(':')
  return { agentRole: role as AgentRole, model }
}

// ── Update Q-table after task completion ──────────────────────────────────────
export async function updateRouter(
  state:         RouterStateKey,
  action:        RouterAction,
  resultQuality: number,
  tokensUsed:    number,
  durationMs:    number,
): Promise<void> {
  // Reward: quality / normalised token cost (tokens/5000)
  const tokenCost = Math.max(tokensUsed / 5000, 0.1)
  const reward    = resultQuality / tokenCost

  const sKey    = stateKey(state)
  const aKey    = actionKey(action)
  const actions = Q_TABLE.get(sKey) ?? initState(sKey)
  const entry   = actions.get(aKey) ?? { qValue: 0.5, visitCount: 0 }

  // C6 — decay the stored Q toward the 0.5 prior before applying this update.
  // Keeps stale signals from anchoring the bandit after a long idle period.
  const now = Date.now()
  const ageMs = entry.updatedAt ? now - entry.updatedAt : 0
  const decay  = decayFactor(ageMs)
  const decayed = 0.5 + (entry.qValue - 0.5) * decay

  // Q(s,a) ← Q(s,a) + α × (reward - Q(s,a))
  const newQ = decayed + ALPHA * (reward - decayed)
  actions.set(aKey, {
    qValue:     Math.min(1, Math.max(0, newQ)),
    visitCount: entry.visitCount + 1,
    updatedAt:  now,
  })

  // Persist to ReasoningBank
  await storePattern({
    taskType:      state.taskType,
    taskHash:      hashText(state.taskType + state.complexity),
    agentRole:     action.agentRole,
    model:         action.model,
    promptHash:    hashText(action.agentRole),
    resultQuality,
    tokensUsed,
    durationMs,
    approved:      resultQuality > 0.5,
  })
}

// ── Get routing stats for dashboard ──────────────────────────────────────────
export function getQTableStats(): { states: number; avgQValue: number } {
  let total = 0; let count = 0
  for (const actions of Q_TABLE.values()) {
    for (const entry of actions.values()) {
      total += entry.qValue; count++
    }
  }
  return { states: Q_TABLE.size, avgQValue: count ? total / count : 0 }
}

// ── C6 — Feed the router from observability metric samples ──────────────────
// Pulls recent per-agent samples out of Supabase and rolls them up into
// `updateRouter` calls so the bandit benefits from passive observation, not
// just live swarm completions. Called from the regression cron after its own
// sweep so we only hit the table once per day.

interface SampleRow {
  agent_slug: string
  kind:       string
  value:      number
  at:         string
}

export interface FeedResult {
  samplesConsidered: number
  routerUpdates:     number
}

export async function feedRouterFromMetricSamples(
  userId:      string,
  windowHours: number = 24,
): Promise<FeedResult> {
  const db = createServerClient()
  if (!db) return { samplesConsidered: 0, routerUpdates: 0 }

  const cutoff = new Date(Date.now() - windowHours * 3600_000).toISOString()

  const { data } = await (db.from('metric_samples' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        gte: (c: string, v: string) => Promise<{ data: SampleRow[] | null }>
      }
    }
  }).select('agent_slug,kind,value,at').eq('user_id', userId).gte('at', cutoff)

  const rows = data ?? []
  if (rows.length === 0) return { samplesConsidered: 0, routerUpdates: 0 }

  // Group: agent_slug → run-grouped buckets
  type Bucket = {
    inputTokens:  number
    outputTokens: number
    latencyMs:    number
    approved:     number      // 1 approved, 0 rejected, averaged later
    costUsd:      number
    count:        number
  }
  const byAgent = new Map<string, Bucket>()

  for (const r of rows) {
    let slot = byAgent.get(r.agent_slug)
    if (!slot) {
      slot = { inputTokens: 0, outputTokens: 0, latencyMs: 0, approved: 0, costUsd: 0, count: 0 }
      byAgent.set(r.agent_slug, slot)
    }
    if (r.kind === 'input_tokens')    slot.inputTokens  += r.value
    else if (r.kind === 'output_tokens') slot.outputTokens += r.value
    else if (r.kind === 'latency_ms')    slot.latencyMs   += r.value
    else if (r.kind === 'cost_usd')      slot.costUsd     += r.value
    else if (r.kind === 'review_outcome') {
      slot.approved += r.value
      slot.count    += 1
    }
  }

  let routerUpdates = 0
  for (const [slug, bucket] of byAgent) {
    if (bucket.count === 0) continue
    const approveRate = bucket.approved / bucket.count
    const tokensTotal = bucket.inputTokens + bucket.outputTokens
    // Infer (role, model) — slug already matches an AgentRole in the registry.
    const agent = AGENT_REGISTRY.find(a => a.role === slug)
    if (!agent) continue
    await updateRouter(
      { taskType: agent.role, complexity: agent.complexity },
      { agentRole: agent.role, model: agent.preferredModel },
      approveRate,
      Math.max(1, tokensTotal),
      Math.max(1, bucket.latencyMs),
    )
    routerUpdates += 1
  }

  return { samplesConsidered: rows.length, routerUpdates }
}
