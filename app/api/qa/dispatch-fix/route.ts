/**
 * POST /api/qa/dispatch-fix
 *
 * Provider-agnostic fix-attempt dispatcher for the qa-runner service.
 * Replaces qa-runner's direct hit on the Claude Code gateway so swapping
 * providers (Mimo, Ollama, OpenRouter, future) is a server-side
 * env-var change — qa-runner sends the same shape regardless.
 *
 * Body:
 *   {
 *     title:       string,        // headline (first line of the brief)
 *     brief:       string,        // markdown body
 *     attachments?: string[],     // optional screenshot/trace URLs
 *     agentSlug?:  string,        // .claude/agents/<slug>.md to use as system prompt
 *     sessionTag?: string,        // logging tag (defaults to 'qa-runner')
 *     provider?:   'claude'|'codex'|'openrouter'|'mimo'|'ollama'|'auto',
 *                                 // override LLM_PROVIDER env for one call
 *     model?:      string,        // override default model for the resolved provider
 *   }
 *
 * Returns: { ok, jobId?, provider, model?, error? }
 *
 * Auth: Bearer NEXUS_OPS_TOKEN OR BOT_API_TOKEN (qa-runner uses one of
 * these; both are operator-equivalent for this surface).
 *
 * Provider selection order:
 *   1. body.provider (if set + valid)
 *   2. LLM_PROVIDER env (defaults to 'claude')
 *   3. 'claude' fallback
 *
 * For `claude`, dispatches through the existing self-hosted Claude Code
 * gateway (services/claude-gateway). For `codex`, dispatches through the
 * codex-gateway. For `openrouter` / `mimo` / `ollama`, dispatches via the
 * AI SDK provider abstraction (lib/llm/provider.ts) and uses generateText —
 * the response is synthesised as a one-shot completion, NOT a session
 * the agent can iterate on. The trade-off: full provider portability for
 * the cost of multi-turn agency. The qa-runner's fix-attempts are
 * one-shot anyway (the runner files the agent's reply as a workflow-feedback
 * row + closes the lane), so this fits cleanly.
 *
 * Retry-storm safe (200 always; transient failures surface in `error`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateText } from 'ai'
import { callGateway } from '@/lib/claw/gateway-call'
import { dispatchToCodexGateway, isCodexGatewayConfigured } from '@/lib/claw/codex-gateway'
import { getLlm, type LlmProvider } from '@/lib/llm/provider'
import { authenticateOps } from '@/lib/auth/ops-auth'
import { authBotToken } from '@/lib/auth/bot'

export const runtime = 'nodejs'
export const maxDuration = 60

type ExtendedProvider = LlmProvider | 'codex' | 'auto'

interface DispatchBody {
  title?:       unknown
  brief?:       unknown
  attachments?: unknown
  agentSlug?:   unknown
  sessionTag?:  unknown
  provider?:    unknown
  model?:       unknown
}

const VALID_PROVIDERS: ReadonlySet<string> = new Set([
  'claude', 'codex', 'openrouter', 'mimo', 'ollama', 'auto',
])

function resolveProvider(raw: unknown): ExtendedProvider {
  if (typeof raw === 'string' && VALID_PROVIDERS.has(raw)) return raw as ExtendedProvider
  const env = (process.env.LLM_PROVIDER ?? '').toLowerCase()
  if (VALID_PROVIDERS.has(env)) return env as ExtendedProvider
  return 'claude'
}

function composeBriefMarkdown(opts: {
  title:       string
  brief:       string
  attachments: string[]
  agentSlug?:  string | null
}): string {
  const parts: string[] = [`# ${opts.title}`, '', opts.brief.trim()]
  if (opts.attachments.length > 0) {
    parts.push('', '## Attachments')
    for (const url of opts.attachments) parts.push(`- ${url}`)
  }
  if (opts.agentSlug) {
    parts.push('', `_Acting as agent: \`${opts.agentSlug}\`._`)
  }
  return parts.join('\n')
}

/** Pull an agent system prompt from .claude/agents/<slug>.md (when present). */
async function readAgentPrompt(agentSlug: string | null): Promise<string | null> {
  if (!agentSlug || !/^[a-z0-9-]{1,80}$/.test(agentSlug)) return null
  try {
    const { promises: fs } = await import('node:fs')
    const path             = await import('node:path')
    const file             = path.join(process.cwd(), '.claude', 'agents', `${agentSlug}.md`)
    const raw              = await fs.readFile(file, 'utf8')
    // Strip frontmatter — first --- ... --- block. The agent's body is the
    // system prompt for the one-shot path.
    return raw.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim()
  } catch {
    return null
  }
}

/**
 * Auth helper. qa-runner ships with NEXUS_OPS_TOKEN OR BOT_API_TOKEN in
 * its Doppler config. Either is operator-equivalent; we accept both.
 */
async function authQaRunner(req: NextRequest): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Try ops-auth first (NEXUS_OPS_TOKEN)
  const ops = await authenticateOps(req, {})
  if (!('response' in ops)) return { ok: true }
  // Try bot-token (BOT_API_TOKEN). authBotToken returns the bot userId
  // when valid, null when not — we only care about the boolean.
  if (authBotToken(req)) return { ok: true }
  return { ok: false, reason: 'unauthorized' }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authVerdict = await authQaRunner(req)
  if (!authVerdict.ok) {
    return NextResponse.json({ ok: false, error: 'unauthorized', reason: authVerdict.reason })
  }

  const body = await req.json().catch(() => ({})) as DispatchBody
  const title       = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : ''
  const brief       = typeof body.brief === 'string' ? body.brief.trim().slice(0, 50_000) : ''
  if (!title || !brief) {
    return NextResponse.json({ ok: false, error: 'title and brief required' })
  }
  const attachments = Array.isArray(body.attachments)
    ? body.attachments.filter((s): s is string => typeof s === 'string').slice(0, 16)
    : []
  const agentSlug   = typeof body.agentSlug === 'string' ? body.agentSlug : 'workflow-optimizer'
  const sessionTag  = typeof body.sessionTag === 'string' ? body.sessionTag : `qa-runner-${Date.now()}`
  const provider    = resolveProvider(body.provider)
  const modelOverride = typeof body.model === 'string' ? body.model : undefined

  const message = composeBriefMarkdown({ title, brief, attachments, agentSlug })

  // ── Branch 1 — Claude Code gateway (default + 'auto' path) ─────────────
  // The gateway already wraps the Claude Code CLI with full agent-spec
  // loading + tool routing. Use it when LLM_PROVIDER is unset or 'claude'.
  if (provider === 'claude' || provider === 'auto') {
    if (!process.env.CLAUDE_CODE_GATEWAY_URL || !process.env.CLAUDE_CODE_BEARER_TOKEN) {
      // Fall through to the AI SDK path if claude gateway not configured.
      // This is unusual in prod but happens in dev / lean-mode-light deploys.
      return await dispatchViaAiSdk('claude', modelOverride, message, agentSlug)
    }
    try {
      const result = await callGateway({
        gatewayUrl:  process.env.CLAUDE_CODE_GATEWAY_URL,
        bearerToken: process.env.CLAUDE_CODE_BEARER_TOKEN,
        sessionTag,
        message,
        agentSlug,
        env:         {},
        userId:      process.env.BOT_CLERK_USER_ID,
        timeoutMs:   45_000,
      })
      return NextResponse.json({
        ok:       result.ok,
        provider: 'claude',
        jobId:    sessionTag,
        text:     result.text,
        error:    result.ok ? undefined : (result.error ?? `gateway_${result.status}`),
      })
    } catch (err) {
      return NextResponse.json({
        ok:       false,
        provider: 'claude',
        error:    err instanceof Error ? err.message : 'claude_gateway_threw',
      })
    }
  }

  // ── Branch 2 — Codex gateway ─────────────────────────────────────────
  if (provider === 'codex') {
    if (!isCodexGatewayConfigured()) {
      return NextResponse.json({
        ok:       false,
        provider: 'codex',
        error:    'codex_gateway_unconfigured',
        hint:     'Set CODEX_GATEWAY_URL + CODEX_GATEWAY_BEARER_TOKEN in Doppler.',
      })
    }
    const result = await dispatchToCodexGateway({
      agentSlug,
      message,
      env:        {},
      userId:     process.env.BOT_CLERK_USER_ID,
      sessionTag,
      timeoutMs:  45_000,
    })
    return NextResponse.json({
      ok:       Boolean(result?.ok),
      provider: 'codex',
      jobId:    result?.sessionId,
      error:    result?.ok ? undefined : (result?.error ?? 'codex_dispatch_returned_null'),
    })
  }

  // ── Branch 3 — AI SDK provider (openrouter / mimo / ollama) ──────────
  return await dispatchViaAiSdk(provider as LlmProvider, modelOverride, message, agentSlug)
}

/**
 * Generic AI-SDK dispatch. Used for any provider that doesn't have a
 * self-hosted gateway in front of it. Issues a one-shot generateText call
 * with the agent spec body (when readable) as the system prompt + the
 * composed brief as the user message.
 *
 * Returns the same shape as the gateway branches so qa-runner can treat
 * every provider uniformly. `jobId` here is a synthesised correlation id
 * (sessionTag + timestamp) since the SDK call is synchronous + has no
 * remote queue to poll.
 */
async function dispatchViaAiSdk(
  provider:      LlmProvider,
  modelOverride: string | undefined,
  message:       string,
  agentSlug:     string,
): Promise<NextResponse> {
  try {
    const llm    = getLlm({ provider, model: modelOverride })
    const system = await readAgentPrompt(agentSlug)
    const synthJobId = `qa-${provider}-${Date.now()}`

    const res = await generateText({
      model:    llm,
      system:   system ?? undefined,
      prompt:   message,
      // No tools — qa-runner doesn't need the agent to call MCPs here; it
      // just needs the agent's analysis + proposed fix in plain text.
      // Cap output so a runaway prompt can't drain the plan.
      maxOutputTokens: 4_000,
      abortSignal:     AbortSignal.timeout(45_000),
    })

    return NextResponse.json({
      ok:       true,
      provider,
      jobId:    synthJobId,
      // Embed the synthesised text so qa-runner can file it as a workflow-
      // feedback row WITHOUT polling. The Claude-gateway path returns a
      // session reference instead — qa-runner handles both shapes.
      text:     res.text,
      usage:    res.usage,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'sdk_dispatch_failed'
    return NextResponse.json({
      ok:       false,
      provider,
      error:    msg,
      hint:     /not yet wired/i.test(msg)
        ? `Provider '${provider}' adapter is a stub. See lib/llm/providers/${provider}.ts to activate.`
        : undefined,
    })
  }
}
