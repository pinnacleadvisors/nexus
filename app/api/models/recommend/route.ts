/**
 * POST /api/models/recommend
 *
 * Body: { agentSlug: string }
 *   or:  { agent: { slug, name, description, tools, currentModel } }
 *
 * Resolves the target agent (either from agent_library by slug, or directly
 * from the body when the caller already has the def in hand), figures out
 * which AI providers the user has currently connected, and runs the
 * LLM-judge recommender against the static catalog.
 *
 * Returns: 200 + { recommendation: ModelRecommendation }
 *          200 + { ok: false, error } on transient failure (retry-storm rule).
 *
 * Cost: ~$0.0008 per call. No server-side caching for v1 — the UI fires only
 * on explicit "Recommend" clicks. "Recommend all" issues N parallel calls
 * bounded by the agent count.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import { recommendModelForAgent } from '@/lib/models/recommender'
import { resolveClaudeCodeConfig } from '@/lib/claw/business-client'
import { getSecrets } from '@/lib/user-secrets'
import type { AiProviderKey, RecommendInput } from '@/lib/models/types'
import type { AgentDefinition } from '@/lib/types'

export const runtime  = 'nodejs'
export const maxDuration = 30

interface AgentRowSlim {
  slug:         string
  name:         string
  description:  string
  tools:        string[]
  model:        string
}

async function loadAgentBySlug(userId: string, slug: string): Promise<AgentRowSlim | null> {
  const db = createServerClient()
  if (!db) return null
  const { data, error } = await (db.from('agent_library' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => {
          single: () => Promise<{ data: AgentRowSlim | null; error: { message: string } | null }>
        }
      }
    }
  })
    .select('slug, name, description, tools, model')
    .eq('user_id', userId)
    .eq('slug', slug)
    .single()
  if (error || !data) return null
  return data
}

async function detectConnectedProviders(userId: string): Promise<AiProviderKey[]> {
  const out: AiProviderKey[] = []

  // Anthropic — subscription via Claude Code gateway, OR API key in env, OR
  // a connected_accounts api-key row for 'anthropic'.
  const claudeCfg = await resolveClaudeCodeConfig(userId).catch(() => null)
  if (claudeCfg) out.push('anthropic')
  if (!out.includes('anthropic') && process.env.ANTHROPIC_API_KEY) out.push('anthropic')

  // Codex / OpenAI — gateway is per-business container env, so we look for
  // the shared env vars as a proxy. Future: query connected_accounts.
  if (process.env.CODEX_GATEWAY_URL && process.env.CODEX_GATEWAY_BEARER) out.push('openai')
  if (!out.includes('openai') && process.env.OPENAI_API_KEY) out.push('openai')

  // Per-business / per-user keys via connected_accounts (api-key flow).
  const db = createServerClient()
  if (db) {
    const { data } = await (db.from('connected_accounts' as never) as unknown as {
      select: (cols: string) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => Promise<{ data: Array<{ platform: string }> | null }>
        }
      }
    })
      .select('platform')
      .eq('user_id', userId)
      .eq('status', 'active')
    const seen = new Set<string>((data ?? []).map(r => r.platform))
    if (seen.has('google'))    out.push('google')
    if (seen.has('xai'))       out.push('xai')
    if (seen.has('deepseek'))  out.push('deepseek')
    if (seen.has('replicate')) out.push('replicate')
    if (seen.has('meta'))      out.push('meta')
    if (seen.has('mistral'))   out.push('mistral')
  }

  // Legacy openclaw secrets imply Anthropic is reachable.
  if (!out.includes('anthropic')) {
    const fields = await getSecrets(userId, 'openclaw').catch(() => null)
    if (fields?.gatewayUrl && fields.bearerToken) out.push('anthropic')
  }

  return Array.from(new Set(out))
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let body: { agentSlug?: string; agent?: AgentDefinition } = {}
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 })
  }

  let agent: AgentRowSlim | null = null
  if (body.agent) {
    agent = {
      slug:        body.agent.slug,
      name:        body.agent.name,
      description: body.agent.description,
      tools:       body.agent.tools ?? [],
      model:       body.agent.model ?? 'claude-sonnet-4-6',
    }
  } else if (body.agentSlug) {
    agent = await loadAgentBySlug(userId, body.agentSlug)
  }
  if (!agent) {
    return NextResponse.json({ ok: false, error: 'agent not found — pass agentSlug or full agent body' }, { status: 404 })
  }

  const availableProviders = await detectConnectedProviders(userId)
  if (availableProviders.length === 0) {
    // 200 + ok:false — caller may keep retrying after the user connects something
    return NextResponse.json({
      ok:    false,
      error: 'No AI providers connected. Visit /settings?tab=ai to connect at least one.',
    })
  }

  const input: RecommendInput = {
    agent: {
      slug:         agent.slug,
      name:         agent.name,
      description:  agent.description,
      tools:        agent.tools,
      currentModel: agent.model,
    },
    availableProviders,
  }

  try {
    const recommendation = await recommendModelForAgent(userId, input)
    return NextResponse.json({ ok: true, recommendation })
  } catch (e) {
    return NextResponse.json({
      ok:    false,
      error: e instanceof Error ? e.message : 'recommendation failed',
    })
  }
}
