/**
 * Single chokepoint for "ask Claude something". Every server route that
 * generates text — `/api/agent`, `/api/idea/analyse`, `/api/content/*`,
 * `lib/swarm/Queen`, `lib/swarm/Consensus`, and friends — should call
 * `callClaude` instead of importing `@ai-sdk/anthropic` directly.
 *
 * Routing order:
 *   1. **Self-hosted Claude Code gateway** (`resolveClaudeCodeConfig`) when
 *      configured AND `isGatewayHealthy()` returns true. Plan-billed against
 *      the Max subscription. Single-worker FIFO — calls serialise.
 *   2. **Anthropic API key** fallback via `@ai-sdk/anthropic`. API-billed.
 *      Used when no gateway is configured, the gateway is down, or the
 *      caller passes `forceApi: true` (e.g. when streaming is required and
 *      the gateway's streaming endpoint isn't deployed yet).
 *
 * The gateway returns a whole-message reply, so this helper is non-streaming.
 * Streaming routes that need progressive UX should keep using the AI SDK
 * directly until the gateway's `/api/sessions/:id/stream` SSE endpoint is
 * shipped (see `services/claude-gateway/src/index.ts`).
 *
 * Cost telemetry: when the API-key path is used, `onTokenEvent` is called
 * with the AI SDK's usage object so the caller can write to `token_events`
 * and trigger cost-cap checks. Gateway calls log usage if the spawned CLI
 * surfaces it but skip the cost calculation — Max plan calls aren't
 * dollar-priced per-token.
 */

import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import type { LanguageModelUsage } from 'ai'

import { resolveClaudeCodeConfig } from './business-client'
import { callGateway } from './gateway-call'
import { isGatewayHealthy } from './health'

export interface CallClaudeOpts {
  /** Clerk user ID — required for both gateway gate (X-Nexus-User-Id) and cost telemetry. */
  userId:        string
  /** User-message text. The system prompt goes in `system`. */
  prompt:        string
  /** System prompt — appended to the agent spec when `agentSlug` is set. */
  system?:       string
  /** Default `claude-sonnet-4-6`. Used as-is for the API-key path; ignored by the gateway (the CLI's own default applies). */
  model?:        string
  /** Optional `.claude/agents/<slug>.md` to load as system prompt on the gateway. Ignored on the API path. */
  agentSlug?:    string | null
  /** URL-path tag identifying the caller — `agent`, `idea`, `content`, etc. */
  sessionTag?:   string
  /** Hard upper bound for output tokens on the API path. */
  maxOutputTokens?: number
  /** Sampling temperature on the API path. */
  temperature?:  number
  /** Force the API-key path even if a gateway is configured. Used by streaming callers. */
  forceApi?:     boolean
  /** Default 55 s — must stay under the Vercel `maxDuration`. */
  timeoutMs?:    number
}

export interface CallClaudeResult {
  text:        string
  via:         'gateway' | 'api'
  usage?:      LanguageModelUsage
  durationMs?: number
  error?:      string
}

const DEFAULT_MODEL    = 'claude-sonnet-4-6'
const DEFAULT_TIMEOUT  = 55_000

export async function callClaude(opts: CallClaudeOpts): Promise<CallClaudeResult> {
  const started = Date.now()

  // ── 1. Gateway (plan-billed) ────────────────────────────────────────────
  if (!opts.forceApi) {
    const cfg = await resolveClaudeCodeConfig(opts.userId)
    if (!cfg) {
      console.log('[callClaude] no gateway config — set CLAUDE_CODE_GATEWAY_URL + CLAUDE_CODE_BEARER_TOKEN')
    } else {
      const healthy = await isGatewayHealthy(cfg.gatewayUrl)
      if (!healthy) {
        console.warn(`[callClaude] gateway probe failed for ${cfg.gatewayUrl}/health — falling back to API`)
      } else {
        // Build a single prompt: system on top, user below. Mirrors what
        // /api/chat already does — the gateway has no separate "system"
        // channel and the agent spec is loaded via agentSlug instead.
        const message = opts.system
          ? `${opts.system}\n\n---\n\n${opts.prompt}`
          : opts.prompt

        const result = await callGateway({
          gatewayUrl:  cfg.gatewayUrl,
          bearerToken: cfg.bearerToken,
          sessionTag:  opts.sessionTag ?? 'llm',
          message,
          agentSlug:   opts.agentSlug ?? null,
          userId:      opts.userId,
          timeoutMs:   opts.timeoutMs ?? DEFAULT_TIMEOUT,
        })

        if (result.ok && result.text) {
          return {
            text:       result.text,
            via:        'gateway',
            durationMs: result.durationMs ?? Date.now() - started,
          }
        }
        // Fall through to API path on any gateway failure — visible in logs
        // so the operator can investigate, but the user's request still works.
        console.warn('[callClaude] gateway POST failed, falling back to API:',
          `status=${result.status} error=${result.error ?? 'unknown'}`)
      }
    }
  }

  // ── 2. Anthropic API key (token-billed) ─────────────────────────────────
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      text:  '',
      via:   'api',
      error: 'no Claude provider configured (gateway down + ANTHROPIC_API_KEY unset)',
    }
  }

  try {
    const { text, usage } = await generateText({
      model:           anthropic(opts.model ?? DEFAULT_MODEL),
      system:          opts.system,
      messages:        [{ role: 'user', content: opts.prompt }],
      maxOutputTokens: opts.maxOutputTokens,
      temperature:     opts.temperature,
    })
    return {
      text,
      via:        'api',
      usage,
      durationMs: Date.now() - started,
    }
  } catch (err) {
    return {
      text:       '',
      via:        'api',
      error:      err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    }
  }
}

/**
 * Convenience: pass a plain `system` + `prompt` and get back JUST the text.
 * Throws on failure so callers don't have to branch — use the full
 * `callClaude` when you want to inspect `via` / `usage`.
 */
export async function callClaudeText(opts: CallClaudeOpts): Promise<string> {
  const result = await callClaude(opts)
  if (result.error || !result.text) {
    throw new Error(result.error ?? 'callClaude returned empty text')
  }
  return result.text
}

export interface TryGatewayOpts {
  userId:     string
  prompt:     string
  system?:    string
  agentSlug?: string | null
  sessionTag?: string
  timeoutMs?: number
}

/**
 * Gateway-only short-circuit. Returns `{ ok: true, text }` when the Claude
 * Code gateway is configured AND healthy AND replies successfully; returns
 * `{ ok: false }` otherwise (including when no userId is allowlisted).
 *
 * Used by callers that already have a perfectly-tuned API-SDK code path
 * (prompt caching, structured messages, usage telemetry) and just want to
 * try the plan-billed route first without giving up that path. Anything
 * more involved should use `callClaude` directly.
 */
export async function tryGateway(
  opts: TryGatewayOpts,
): Promise<{ ok: true; text: string; durationMs?: number } | { ok: false }> {
  if (!opts.userId) return { ok: false }
  const cfg = await resolveClaudeCodeConfig(opts.userId)
  if (!cfg) return { ok: false }
  if (!(await isGatewayHealthy(cfg.gatewayUrl))) return { ok: false }

  const message = opts.system
    ? `${opts.system}\n\n---\n\n${opts.prompt}`
    : opts.prompt

  const result = await callGateway({
    gatewayUrl:  cfg.gatewayUrl,
    bearerToken: cfg.bearerToken,
    sessionTag:  opts.sessionTag ?? 'swarm',
    message,
    agentSlug:   opts.agentSlug ?? null,
    userId:      opts.userId,
    timeoutMs:   opts.timeoutMs ?? DEFAULT_TIMEOUT,
  })
  if (result.ok && result.text) {
    return { ok: true, text: result.text, durationMs: result.durationMs }
  }
  return { ok: false }
}
