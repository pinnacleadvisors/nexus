/**
 * lib/swarm/Queen.ts
 *
 * Three queen types that orchestrate swarm execution:
 *
 * StrategicQueen — Decomposes the goal into phases and tasks using Claude Opus.
 * TacticalQueen  — Assigns the best specialist agent to each task via the Router.
 * AdaptiveQueen  — Monitors for drift and re-plans if the swarm diverges.
 */

import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { tryGateway } from '@/lib/claw/llm'
import type { AgentRole, ConsensusType, EventEmitter, SwarmEvent, SwarmPhase, SwarmTask } from './types'
import { routeTask, inferComplexity } from './Router'
import { buildSwarmContext, optimiseContext, buildCachedSystem, computeCacheStats } from './TokenOptimiser'
import { runConsensus } from './Consensus'
import { detectFastPathOp, tryFastPath } from './WasmFastPath'
import { updateRouter } from './Router'
import { AGENT_REGISTRY } from './agents/registry'
import { searchWebMulti, formatResultsAsContext } from '@/lib/tools/tavily'
import { retrieveGraphContext } from './GraphRetriever'
import { findSimilarPlans, formatPlanAsFewShot } from './PlanBank'
import { recordSamples } from '@/lib/observability'
import { estimateCostUsd } from './types'

// Roles that benefit from live web research
const RESEARCH_ROLES = new Set<AgentRole>(['researcher', 'analyst', 'strategist'])

const STRATEGIC_MODEL = 'claude-opus-4-6'
const TACTICAL_MODEL  = 'claude-sonnet-4-6'

// ── Swarm plan returned by StrategicQueen ─────────────────────────────────────
export interface SwarmPlan {
  summary:    string
  phases:     Array<{
    phase:    number
    title:    string
    rationale:string
    tasks:    Array<{
      title:       string
      description: string
      role:        AgentRole
      dependsOn?:  number[]  // indices of tasks in prior phases
    }>
  }>
}

// ── StrategicQueen ────────────────────────────────────────────────────────────
export async function strategicDecompose(
  goal:    string,
  context: string,
  emit:    EventEmitter,
  swarmId: string,
  opts:    { userId?: string } = {},
): Promise<SwarmPlan> {
  emit(evt(swarmId, 'status', { message: 'StrategicQueen: decomposing goal into phases…' }))

  // A7 — graph-keyed context retrieval. When the knowledge graph has relevant
  // atoms/entities/MOCs we prepend a compact preamble instead of relying solely
  // on the caller-supplied context blob. Cold starts fall back cleanly because
  // `hit=false` returns an empty text.
  const graph = await retrieveGraphContext(goal, 'strategist').catch(() => null)
  if (graph?.hit) {
    emit(evt(swarmId, 'graph_retrieved', {
      source:   'strategicDecompose',
      nodeIds:  graph.nodeIds,
      tokens:   graph.tokens,
    }))
  }
  const mergedContext = graph?.hit
    ? `${graph.text}\n\n---\n\n${context || ''}`.trim()
    : context

  // A8 — ReasoningBank feedforward. When we have a similar prior plan, show the
  // shortest one as a few-shot example so the Queen biases toward reuse rather
  // than redesigning from scratch. `opts.userId` is required for RLS scoping;
  // anonymous callers (legacy code paths) simply skip this step.
  let fewShotBlock = ''
  if (opts.userId) {
    const similar = await findSimilarPlans(opts.userId, goal, 3).catch(() => [])
    if (similar.length > 0) {
      // Pick the shortest plan so we stay within token budget
      const shortest = [...similar].sort((a, b) => a.taskCount - b.taskCount)[0]
      fewShotBlock = '\n\n' + formatPlanAsFewShot(shortest)
      emit(evt(swarmId, 'status', {
        message: `StrategicQueen: referencing prior plan (${shortest.taskCount} tasks, outcome ${shortest.outcomeScore.toFixed(2)})`,
      }))
    }
  }

  const agentRoles = AGENT_REGISTRY.map(a => `${a.role} (${a.name}): ${a.description}`).join('\n')

  // C3 — stable system block gets cache-tagged so repeat decompositions only
  // pay cache-read rates on the registry + instructions (~75% cheaper).
  const systemText = `You are a StrategicQueen AI orchestrator. Decompose the following goal into a multi-phase execution plan for a swarm of specialist AI agents.

## Available Specialist Agents
${agentRoles}

## Instructions
- Create 2–4 phases (earlier phases produce inputs for later phases)
- Each phase has 1–4 tasks
- Each task must be assigned to EXACTLY ONE agent role from the list above
- Tasks within the same phase can run in parallel
- Be specific and actionable — vague tasks produce poor results
- The final phase should synthesise outputs into a coherent deliverable

Respond with ONLY valid JSON (no markdown fences, no explanations outside JSON):
{
  "summary": "2-3 sentence description of the plan",
  "phases": [
    {
      "phase": 1,
      "title": "Phase title",
      "rationale": "Why this phase comes first",
      "tasks": [
        {
          "title": "Task title",
          "description": "Specific task description with clear success criteria (100-200 words)",
          "role": "exact-agent-role-from-list"
        }
      ]
    }
  ]
}`

  const userPrompt = `## Goal
${goal}

## Context
${mergedContext || 'No additional context provided.'}
${fewShotBlock}`

  // Plan-billed first (Claude Code gateway). Strategic decomposition is one
  // call per swarm and benefits the most from Max-plan billing — if it works,
  // we skip the prompt-cache benefit for this single call. Falls through to
  // API path on any failure.
  const optimisedUserPrompt = optimiseContext(userPrompt, 6000).text
  let text = ''
  if (opts.userId) {
    const gw = await tryGateway({
      userId:     opts.userId,
      system:     systemText,
      prompt:     optimisedUserPrompt,
      sessionTag: 'swarm-strategic',
      timeoutMs:  55_000,
    })
    if (gw.ok) text = gw.text
  }

  if (!text) {
    const result = await generateText({
      model:            anthropic(STRATEGIC_MODEL),
      messages: [
        buildCachedSystem(systemText),
        { role: 'user', content: optimisedUserPrompt },
      ],
      maxOutputTokens:  2000,
    })
    text = result.text
    const cache = computeCacheStats(result.usage)
    if (cache.cacheReadTokens > 0 || cache.cacheWriteTokens > 0) {
      emit(evt(swarmId, 'status', {
        message: `StrategicQueen cache: read=${cache.cacheReadTokens} write=${cache.cacheWriteTokens} ratio=${(cache.hitRatio * 100).toFixed(1)}%`,
      }))
    }
  }

  try {
    const plan = JSON.parse(text.replace(/```json\n?|```\n?/g, '').trim()) as SwarmPlan
    emit(evt(swarmId, 'plan', { summary: plan.summary, phaseCount: plan.phases.length }))
    return plan
  } catch (e) {
    // Fallback: single-phase single-task plan
    console.error('[StrategicQueen] parse failed:', e)
    return {
      summary: `Execute: ${goal}`,
      phases:  [{
        phase:     1,
        title:     'Execution',
        rationale: 'Direct execution of goal',
        tasks:     [{ title: goal.slice(0, 80), description: goal, role: 'researcher' }],
      }],
    }
  }
}

// ── TacticalQueen ─────────────────────────────────────────────────────────────
export async function tacticalAssign(
  tasks:         SwarmPlan['phases'][0]['tasks'],
  phase:         number,
  swarmId:       string,
): Promise<Array<{ title: string; description: string; role: AgentRole; model: string }>> {
  return Promise.all(tasks.map(async task => {
    const complexity = inferComplexity(task.description)
    const action = await routeTask(
      { taskType: task.role, complexity },
      task.description,
    )
    // Override: use declared role if router returns a different one
    const finalRole = task.role ?? action.agentRole
    const agent = AGENT_REGISTRY.find(a => a.role === finalRole)
    const finalModel = agent?.preferredModel ?? action.model
    return { ...task, role: finalRole, model: finalModel }
  }))
}

// ── Execute a single task ─────────────────────────────────────────────────────
async function executeTask(
  task:          { title: string; description: string; role: AgentRole; model: string },
  swarmContext:  string,
  swarmId:       string,
  taskId:        string,
  consensusType: ConsensusType,
  emit:          EventEmitter,
  /** C1 — attribution for metric_samples. When omitted, samples are skipped. */
  obs?:          { userId: string; runId?: string },
): Promise<{ result: string; tokensUsed: number; approved: boolean; votes: SwarmTask['votes'] }> {
  emit(evt(swarmId, 'task_start', { taskId, title: task.title, role: task.role, model: task.model }))

  const start = Date.now()

  // 1. Try WASM fast-path first
  const fastOp = detectFastPathOp(task.description)
  if (fastOp) {
    const fast = tryFastPath(fastOp, task.description)
    if (fast) {
      emit(evt(swarmId, 'task_end', { taskId, tokensUsed: 0, approved: true, source: 'fast-path' }))
      return { result: fast.result, tokensUsed: 0, approved: true, votes: [] }
    }
  }

  // 2. Find agent definition
  const agentDef = AGENT_REGISTRY.find(a => a.role === task.role)
  const systemPrompt = agentDef?.systemPrompt ?? `You are a specialist AI agent. Complete the following task thoroughly.`

  // 3. Tavily live web search for research-oriented roles
  let tavilyContext = ''
  if (RESEARCH_ROLES.has(task.role) && process.env.TAVILY_API_KEY) {
    const query = `${task.title} ${task.description}`.slice(0, 200)
    const results = await searchWebMulti([query], { maxResults: 4, maxTokens: 2500 }).catch(() => [])
    if (results.length > 0) tavilyContext = formatResultsAsContext(results)
  }

  // 4. Build task prompt with swarm context
  const taskPrompt = [
    tavilyContext ? `${tavilyContext}\n\n` : '',
    swarmContext ? `## Swarm Context\n${swarmContext}\n\n---\n\n` : '',
    `## Your Task\n**${task.title}**\n\n${task.description}`,
  ].join('')

  // C3 — cache the per-role system prompt. Same role → same bytes across every
  // task, so Anthropic prompt caching turns the system prefix into a cheap
  // cache-read after the first call.
  //
  // Q3 audit (task_plan-autonomous-qa.md): kept on the API path because the
  // Anthropic prompt-cache prefix here is meaningful (~30% of swarm token
  // spend). The gateway's CLI doesn't yet expose cache_creation/cache_read
  // counters, so migrating now would lose telemetry. Track as a follow-up.
  if (process.env.CLAUDE_MAX_ONLY === '1') {
    throw new Error('CLAUDE_MAX_ONLY=1 — Queen.ts per-task call not yet migrated; see task_plan-autonomous-qa.md Q3')
  }
  const { text, usage } = await generateText({
    model:           anthropic(task.model),
    messages: [
      buildCachedSystem(systemPrompt),
      { role: 'user', content: optimiseContext(taskPrompt, 8000).text },
    ],
    maxOutputTokens: agentDef?.maxTokens ?? 3000,
    temperature:     agentDef?.temperature ?? 0.4,
  })

  const tokensUsed = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)
  const durationMs = Date.now() - start

  // 4. Run consensus (gateway-aware when userId is in scope)
  const consensus = await runConsensus(
    `${task.title}: ${task.description}`,
    text,
    task.role,
    consensusType,
    obs?.userId,
  )

  // C1 — per-task observability. Fire-and-forget. `obs.userId` is the gate so
  // legacy callers that never passed attribution don't suddenly spam the table.
  if (obs?.userId) {
    const inTok    = usage?.inputTokens  ?? 0
    const outTok   = usage?.outputTokens ?? 0
    // C3 — pull cache stats from the canonical inputTokenDetails shape so
    // cache_hit_ratio reflects the new cacheable system prefix.
    const cache = computeCacheStats(usage)
    const cacheHitRatio = cache.hitRatio
    recordSamples([
      { userId: obs.userId, runId: obs.runId, agentSlug: task.role, kind: 'input_tokens',    value: inTok },
      { userId: obs.userId, runId: obs.runId, agentSlug: task.role, kind: 'output_tokens',   value: outTok },
      { userId: obs.userId, runId: obs.runId, agentSlug: task.role, kind: 'latency_ms',      value: durationMs },
      { userId: obs.userId, runId: obs.runId, agentSlug: task.role, kind: 'cache_hit_ratio', value: cacheHitRatio },
      { userId: obs.userId, runId: obs.runId, agentSlug: task.role, kind: 'cost_usd',        value: estimateCostUsd(task.model, inTok, outTok) },
      { userId: obs.userId, runId: obs.runId, agentSlug: task.role, kind: 'review_outcome',  value: consensus.approved ? 1 : 0 },
    ])
  }

  // 5. Update router with outcome
  await updateRouter(
    { taskType: task.role, complexity: inferComplexity(task.description) },
    { agentRole: task.role, model: task.model },
    consensus.approved ? consensus.confidence : consensus.confidence * 0.3,
    tokensUsed,
    durationMs,
  )

  emit(evt(swarmId, 'consensus', {
    taskId,
    approved:   consensus.approved,
    confidence: consensus.confidence,
    summary:    consensus.summary,
  }))

  emit(evt(swarmId, 'task_end', {
    taskId,
    tokensUsed,
    approved:   consensus.approved,
    durationMs,
  }))

  return {
    result:     text,
    tokensUsed,
    approved:   consensus.approved,
    votes:      consensus.votes,
  }
}

// ── AdaptiveQueen: drift check ────────────────────────────────────────────────
async function checkDrift(
  goal:          string,
  completedWork: string,
  swarmId:       string,
  emit:          EventEmitter,
  threshold      = 0.4,
): Promise<boolean> {
  // Lightweight drift check: ask Claude if completed work is still aligned.
  // Q3 audit (task_plan-autonomous-qa.md): tiny call — 10 output tokens,
  // < 1k input — migration deferred behind the per-task call above so they
  // can be moved together. Documented exception, not a bug.
  if (process.env.CLAUDE_MAX_ONLY === '1') {
    return false // best-effort — assume no drift rather than blowing up the swarm
  }
  const { text } = await generateText({
    model:     anthropic(TACTICAL_MODEL),
    prompt:           `Original goal: "${goal.slice(0, 300)}"\n\nCompleted work so far:\n${completedWork.slice(0, 1000)}\n\nIs the completed work still aligned with the original goal? Answer with only "yes" or "no".`,
    maxOutputTokens:  10,
  })

  const drifted = text.toLowerCase().includes('no')
  if (drifted) {
    emit(evt(swarmId, 'drift', { message: 'AdaptiveQueen: drift detected — re-aligning' }))
  }
  return drifted
}

// ── Main swarm runner ─────────────────────────────────────────────────────────
export interface SwarmRunResult {
  phases:      SwarmPhase[]
  tasks:       Partial<SwarmTask>[]
  totalTokens: number
  totalCostUsd:number
  synthesis:   string
}

export async function runSwarm(params: {
  swarmId:         string
  goal:            string
  context:         string
  consensusType:   ConsensusType
  budgetUsd?:      number
  driftThreshold?: number
  checkpointEvery?:number
  emit:            EventEmitter
  /** A8 — archive the decomposed plan to PlanBank on success for future reuse. */
  userId?:         string
  /** A6 — link run_events when a persistent Run drove this swarm. */
  runId?:          string
}): Promise<SwarmRunResult> {
  const {
    swarmId, goal, context, consensusType,
    budgetUsd       = 5,
    driftThreshold  = 0.4,
    checkpointEvery = 5,
    emit,
    userId,
    runId,
  } = params

  const MODEL_COSTS: Record<string, { input: number; output: number }> = {
    'claude-opus-4-6':           { input: 15,  output: 75  },
    'claude-sonnet-4-6':         { input: 3,   output: 15  },
    'claude-haiku-4-5-20251001': { input: 0.8, output: 4   },
  }

  let totalTokens   = 0
  let totalCostUsd  = 0
  const allTasks:   Partial<SwarmTask>[] = []
  const phaseObjs:  SwarmPhase[]          = []
  const priorResults: Array<{ phase: number; title: string; result: string }> = []

  // ── 1. Strategic decomposition ──────────────────────────────────────────────
  const plan = await strategicDecompose(goal, context, emit, swarmId, { userId })

  // ── 2. Execute each phase ───────────────────────────────────────────────────
  for (const phaseSpec of plan.phases) {
    // Budget check
    if (totalCostUsd >= budgetUsd) {
      emit(evt(swarmId, 'status', { message: `Budget cap reached ($${budgetUsd.toFixed(2)}) — stopping at phase ${phaseSpec.phase}` }))
      break
    }

    emit(evt(swarmId, 'phase_start', { phase: phaseSpec.phase, title: phaseSpec.title }))

    // Tactical assignment
    const assignedTasks = await tacticalAssign(phaseSpec.tasks, phaseSpec.phase, swarmId)

    // Build swarm context from prior phase results
    const swarmCtx = buildSwarmContext(goal, priorResults, 6000)

    const phaseTaskIds: string[] = []
    const phaseTaskResults: Array<{ title: string; result: string }> = []

    // Execute tasks in parallel within the phase
    const taskResults = await Promise.allSettled(
      assignedTasks.map(async (task, idx) => {
        const taskId = `${swarmId}-p${phaseSpec.phase}-t${idx}`
        phaseTaskIds.push(taskId)

        const r = await executeTask(task, swarmCtx, swarmId, taskId, consensusType, emit, userId ? { userId, runId } : undefined)

        const costs = MODEL_COSTS[task.model] ?? MODEL_COSTS['claude-sonnet-4-6']
        const costUsd = (r.tokensUsed / 2 / 1_000_000) * costs.input +
                        (r.tokensUsed / 2 / 1_000_000) * costs.output

        totalTokens  += r.tokensUsed
        totalCostUsd += costUsd

        allTasks.push({
          id:          taskId,
          swarmId,
          phase:       phaseSpec.phase,
          title:       task.title,
          description: task.description,
          role:        task.role,
          status:      r.approved ? 'approved' : 'rejected',
          result:      r.result,
          votes:       r.votes,
          tokensUsed:  r.tokensUsed,
          model:       task.model,
          createdAt:   new Date().toISOString(),
          updatedAt:   new Date().toISOString(),
        })

        if (r.approved) {
          phaseTaskResults.push({ title: task.title, result: r.result })
        }

        return r
      })
    )

    // Aggregate approved results
    const approvedCount = taskResults.filter(
      r => r.status === 'fulfilled' && r.value.approved
    ).length

    phaseObjs.push({
      phase:   phaseSpec.phase,
      title:   phaseSpec.title,
      taskIds: phaseTaskIds,
      status:  approvedCount > 0 ? 'completed' : 'failed',
    })

    priorResults.push(
      ...phaseTaskResults.map(r => ({ phase: phaseSpec.phase, title: r.title, result: r.result }))
    )

    emit(evt(swarmId, 'phase_end', {
      phase:         phaseSpec.phase,
      approvedTasks: approvedCount,
      totalTasks:    assignedTasks.length,
    }))

    // Drift check at checkpoints
    if (phaseSpec.phase % checkpointEvery === 0 && priorResults.length > 0) {
      const summary = priorResults.map(r => r.result.slice(0, 300)).join('\n')
      await checkDrift(goal, summary, swarmId, emit, driftThreshold)
    }
  }

  // ── 3. Synthesis ────────────────────────────────────────────────────────────
  emit(evt(swarmId, 'status', { message: 'StrategicQueen: synthesising results…' }))

  const synthPrompt = buildSwarmContext(goal, priorResults, 10_000)
  const synthSystem = `You are synthesising the outputs of a multi-agent swarm into a single, coherent deliverable. Preserve all important information. Structure the output with clear headings.`
  const synthUser   = `## Original Goal\n${goal}\n\n## Phase Outputs\n${synthPrompt}`

  // Plan-billed first; fall through to Opus on the API.
  let synthesis = ''
  if (userId) {
    const gw = await tryGateway({
      userId,
      system:     synthSystem,
      prompt:     synthUser,
      sessionTag: 'swarm-synth',
      timeoutMs:  55_000,
    })
    if (gw.ok) synthesis = gw.text
  }
  if (!synthesis) {
    const result = await generateText({
      model:           anthropic(STRATEGIC_MODEL),
      system:          synthSystem,
      prompt:          synthUser,
      maxOutputTokens: 4000,
    })
    synthesis = result.text
  }

  // A8 — archive the plan + outcome so future swarms on similar goals get
  // the shortest matching plan injected as a few-shot example.
  if (userId) {
    const approvedTasks = allTasks.filter(t => t.status === 'approved').length
    const totalTasks    = allTasks.length || 1
    const outcomeScore  = approvedTasks / totalTasks
    // Fire-and-forget — swarm completion should not wait on analytics writes.
    void (async () => {
      try {
        const { storePlan } = await import('./PlanBank')
        await storePlan({
          userId,
          runId,
          goal,
          plan,
          outcomeScore,
          tokenCostUsd: totalCostUsd,
        })
      } catch (err) {
        console.warn('[runSwarm] storePlan failed:', err)
      }
    })()
  }

  return { phases: phaseObjs, tasks: allTasks, totalTokens, totalCostUsd, synthesis }
}

// ── Helper ────────────────────────────────────────────────────────────────────
function evt(swarmId: string, type: SwarmEvent['type'], payload: Record<string, unknown>): SwarmEvent {
  return { type, swarmId, payload, ts: Date.now() }
}
