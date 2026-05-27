/**
 * Model recommender — an LLM-judge wrapper around the static catalog.
 *
 * `recommendModelForAgent` is called by POST /api/models/recommend. Given the
 * target agent's spec + the providers currently connected, it asks
 * claude-sonnet-4-6 (via the shared `callClaude` chokepoint) to pick the best
 * model from the catalog and explain why in 2-3 sentences.
 *
 * Why a per-click judge instead of a static scoring function:
 *   - Benchmarks alone don't capture an agent's actual job — a coding agent
 *     might need long-context more than peak SWE-bench
 *   - A real LLM can reason about tradeoffs (cost vs latency vs context)
 *   - The catalog is the ground truth; the judge can only pick from it,
 *     so hallucination is bounded to "wrong rationale", not "wrong model"
 *
 * Cost: ~$0.0008 per recommendation (sonnet 4.6, ~500 input tokens, ~150 output).
 *
 * v2 (2026-05-27): server-side smart caching via `lib/agents/cache.ts`. The
 * judge's output is deterministic given the same (agent-spec, candidate-set,
 * judge-model) tuple, so the same agent's recommendation is computed at
 * most once per 24h. "Recommend all" with 20 unchanged agents now spawns
 * 20 parallel cache HITs (free + near-instant) after the first warm-up.
 * The fallback path (judge timed out / hallucinated a non-catalog model)
 * still fires uncached — we only persist real judgements.
 */

import { callClaude } from '@/lib/claw/llm'
import { cacheLookup, cacheStore } from '@/lib/agents/cache'
import { MODEL_CATALOG, getAvailableModels } from './catalog'
import type {
  ModelDefinition,
  ModelRecommendation,
  RecommendInput,
} from './types'

/**
 * Model used BY the recommender to pick models FOR agents. Sonnet 4.6 is
 * the default (fast + cheap + smart enough). Operator can switch to
 * haiku-4-5 for ~5x cheaper / faster via the env var.
 */
const JUDGE_MODEL = process.env.RECOMMENDER_MODEL_ID?.trim() || 'claude-sonnet-4-6'
const MAX_LATENCY_MS = 12_000

/** Slim catalog representation for the prompt — leaves out long benchmark detail. */
function summariseModel(m: ModelDefinition): string {
  const topBenchmarks = m.benchmarks
    .slice(0, 4)
    .map(b => `${b.label} ${b.score}${b.unit}`)
    .join(', ')
  const cost =
    m.inputCostPerMtok != null && m.outputCostPerMtok != null
      ? `$${m.inputCostPerMtok}/$${m.outputCostPerMtok} per Mtok`
      : 'subscription'
  return [
    `- id: ${m.id}`,
    `  provider: ${m.provider}`,
    `  capabilities: ${m.capabilities.join(', ')}`,
    `  context: ${m.contextWindow.toLocaleString()} tokens`,
    `  cost: ${cost}`,
    `  latency: ${m.latencyTier}`,
    `  benchmarks: ${topBenchmarks || '—'}`,
    `  tagline: ${m.tagline}`,
  ].join('\n')
}

function buildPrompt(input: RecommendInput, candidates: ModelDefinition[]): string {
  const candidateBlock = candidates.map(summariseModel).join('\n\n')
  return [
    'You are a model-routing specialist for a multi-agent platform.',
    'Pick the single best model for this agent from the candidates below.',
    'Optimise for the agent\'s declared work — read tools + description carefully.',
    'Prefer Claude when the agent\'s work is "autonomous loops with tool use" (Claude is the native runtime).',
    'Prefer cheaper / faster models for high-volume validators or glue agents.',
    '',
    `## Agent`,
    `slug:        ${input.agent.slug}`,
    `name:        ${input.agent.name}`,
    `description: ${input.agent.description}`,
    `tools:       ${input.agent.tools.join(', ') || '(none declared)'}`,
    `current:     ${input.agent.currentModel}`,
    '',
    '## Candidates',
    candidateBlock,
    '',
    '## Output',
    'Reply with strict JSON only — no prose, no markdown fence:',
    '{',
    '  "model":     "<candidate id>",',
    '  "rationale": "<2-3 sentences explaining the pick>",',
    '  "alternatives": [',
    '    { "model": "<id>", "reason": "<one sentence>" },',
    '    { "model": "<id>", "reason": "<one sentence>" }',
    '  ]',
    '}',
  ].join('\n')
}

function parseJudgeOutput(raw: string): {
  model:     string
  rationale: string
  alternatives: Array<{ model: string; reason: string }>
} {
  // The judge may wrap the JSON in a fence even though we asked it not to.
  const cleaned = raw
    .replace(/^```(?:json)?\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim()
  const parsed = JSON.parse(cleaned) as {
    model?:     string
    rationale?: string
    alternatives?: Array<{ model?: string; reason?: string }>
  }
  if (!parsed.model || !parsed.rationale) {
    throw new Error('judge output missing model or rationale')
  }
  return {
    model:        parsed.model,
    rationale:    parsed.rationale,
    alternatives: (parsed.alternatives ?? [])
      .filter((a): a is { model: string; reason: string } => !!a.model && !!a.reason)
      .slice(0, 3),
  }
}

/** Fallback when the judge times out or replies malformed JSON. Picks the
 *  highest LiveBench score from candidates whose capabilities overlap the
 *  agent's likely task tags (extracted from description heuristically). */
function pickStaticFallback(input: RecommendInput, candidates: ModelDefinition[]): {
  model:     string
  rationale: string
  alternatives: Array<{ model: string; reason: string }>
} {
  const descLower = input.agent.description.toLowerCase()
  const preferredCaps: Array<ModelDefinition['capabilities'][number]> = []
  if (/research|search|web|firecrawl|tavily/.test(descLower)) preferredCaps.push('research')
  if (/code|refactor|implement|debug|review/.test(descLower))  preferredCaps.push('code')
  if (/plan|design|architect|decision|reasoning/.test(descLower)) preferredCaps.push('reasoning')
  if (/content|write|copy|marketing|blog/.test(descLower))     preferredCaps.push('content')
  if (/image|video|render|design/.test(descLower))             preferredCaps.push('vision')
  if (preferredCaps.length === 0) preferredCaps.push('autonomy')

  const scored = candidates
    .filter(c => c.capabilities.some(cap => preferredCaps.includes(cap)))
    .map(c => {
      const livebench = c.benchmarks.find(b => b.key === 'livebench')?.score ?? 0
      return { c, score: livebench }
    })
    .sort((a, b) => b.score - a.score)

  const winner = scored[0]?.c ?? candidates[0]
  return {
    model:        winner.id,
    rationale:    `Static fallback — judge timed out. Highest LiveBench score among models whose capabilities (${preferredCaps.join(', ')}) match the agent description.`,
    alternatives: scored.slice(1, 3).map(s => ({ model: s.c.id, reason: `LiveBench ${s.score}%` })),
  }
}

export async function recommendModelForAgent(
  userId: string,
  input: RecommendInput,
): Promise<ModelRecommendation> {
  const candidates = getAvailableModels(input.availableProviders)
  if (candidates.length === 0) {
    throw new Error('No models available — connect at least one AI provider first')
  }
  if (candidates.length === 1) {
    return {
      agentSlug: input.agent.slug,
      model:     candidates[0].id,
      rationale: 'Only one model available given the currently-connected providers. Connect more providers for alternatives.',
      alternatives: [],
      createdAt: new Date().toISOString(),
    }
  }

  // Smart-cache key: the inputs the LLM judge actually sees. We deliberately
  // do NOT include userId (the judgement doesn't depend on which operator
  // clicked Recommend) — that lets multi-operator deployments share cache
  // rows. Candidate IDs are sorted so connecting providers in a different
  // order doesn't shatter the cache. 24h TTL — the static catalog changes
  // rarely and providers connecting/disconnecting flips a cache key.
  const cacheArgs = {
    judge:       JUDGE_MODEL,
    agentSlug:   input.agent.slug,
    description: input.agent.description.trim(),
    tools:       [...input.agent.tools].sort(),
    candidates:  candidates.map(c => c.id).sort(),
  }
  const cached = await cacheLookup<{ model: string; rationale: string; alternatives: Array<{ model: string; reason: string }> }>(
    'model-recommender', cacheArgs,
  )
  if (cached) {
    return {
      agentSlug: input.agent.slug,
      ...cached.output,
      createdAt: cached.cached_at,
    }
  }

  const prompt = buildPrompt(input, candidates)
  let parsed: ReturnType<typeof parseJudgeOutput>
  let isFallback = false
  try {
    const reply = await callClaude({
      userId,
      prompt,
      system:     'You are a precise model-routing assistant. Output strict JSON only.',
      model:      JUDGE_MODEL,
      sessionTag: 'model-recommend',
      timeoutMs:  MAX_LATENCY_MS,
      maxOutputTokens: 600,
      temperature: 0.2,
    })
    if (reply.error) throw new Error(reply.error)
    parsed = parseJudgeOutput(reply.text)
    // Validate: the judge can only pick from candidates.
    if (!candidates.some(c => c.id === parsed.model)) {
      console.warn(`[recommender] judge picked unknown model ${parsed.model} — falling back`)
      parsed = pickStaticFallback(input, candidates)
      isFallback = true
    }
  } catch (e) {
    console.warn('[recommender] judge failed — using static fallback', e)
    parsed = pickStaticFallback(input, candidates)
    isFallback = true
  }

  // Only cache real judgements. The fallback is a degenerate result the
  // operator probably wants to retry on next click, not persist for 24h.
  if (!isFallback) {
    await cacheStore('model-recommender', cacheArgs, parsed, { ttlMinutes: 60 * 24 })
  }

  return {
    agentSlug: input.agent.slug,
    ...parsed,
    createdAt: new Date().toISOString(),
  }
}

/** Convenience: returns the catalog row for the recommended model. */
export function resolveModelDef(modelId: string): ModelDefinition | undefined {
  return MODEL_CATALOG.find(m => m.id === modelId)
}
