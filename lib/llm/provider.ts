/**
 * LLM provider abstraction — single entry point for picking an AI SDK 6
 * `LanguageModel` regardless of which provider is configured.
 *
 * Switching providers is a one-env-var change:
 *   LLM_PROVIDER=claude     (default — Anthropic via @ai-sdk/anthropic)
 *   LLM_PROVIDER=openrouter (OpenRouter unified router — GPT-5, Claude, Gemini, Llama, …)
 *   LLM_PROVIDER=mimo       (Mimo Pro 2.5 — see lib/llm/providers/mimo.ts)
 *   LLM_PROVIDER=ollama     (local Ollama — see lib/llm/providers/ollama.ts)
 *
 * Note: this abstraction wraps the Anthropic API path (the third fallback
 * tier in `app/api/chat/route.ts`). The PRIMARY path — self-hosted Claude
 * Code gateway — already calls Claude directly via HTTP and is unaffected
 * by `LLM_PROVIDER`. To use OpenRouter/Mimo/Ollama instead of Claude Max,
 * the chat route's gateway probe will fail-over to this provider abstraction.
 *
 * OpenRouter is live (requires OPENROUTER_API_KEY in Doppler). Mimo and
 * Ollama implementations are stubs — they throw "not yet wired" until
 * activation. The plan is to switch when the Claude Max subscription ends;
 * see task_plan-lean-mode.md Task 12-13.
 */

import type { LanguageModel } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'

export type LlmProvider = 'claude' | 'openrouter' | 'mimo' | 'ollama'

export interface GetLlmOptions {
  /** Model name for the active provider. Falls back to a sensible default. */
  model?: string
  /** Override the env-configured provider. */
  provider?: LlmProvider
}

const DEFAULT_MODELS: Record<LlmProvider, string> = {
  claude:     'claude-sonnet-4-6',
  // OpenRouter slugs are `<vendor>/<model>`. Default tracks the same Sonnet
  // generation as the Claude default so prompt behaviour stays consistent
  // when an operator flips LLM_PROVIDER without touching anything else.
  openrouter: process.env.OPENROUTER_DEFAULT_MODEL ?? 'anthropic/claude-sonnet-4-6',
  mimo:       'mimo-pro-2.5',
  ollama:     'llama3.3',
}

function resolveProvider(opts?: GetLlmOptions): LlmProvider {
  if (opts?.provider) return opts.provider
  // Dynamic setting from /settings UI (migration 083 + lib/llm/provider-
  // settings.ts) takes precedence over the Doppler env var. The sync
  // getter returns the cached value + fires a background DB refresh; first
  // call on a cold process falls through to env until the cache warms.
  // Wrapped in try/require so a missing settings module doesn't break the
  // resolver — env stays as the final fallback.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getActiveProviderSync } = require('./provider-settings') as typeof import('./provider-settings')
    const active = getActiveProviderSync()
    if (active?.source === 'db') return active.provider
  } catch {
    // provider-settings module unavailable — fall through to env.
  }
  const env = (process.env.LLM_PROVIDER ?? 'claude').toLowerCase()
  if (
    env === 'claude'     ||
    env === 'openrouter' ||
    env === 'mimo'       ||
    env === 'ollama'
  ) return env
  // Unknown values fall back to claude rather than throwing — keeps prod
  // safe if someone sets LLM_PROVIDER=foo. Logged at startup elsewhere.
  return 'claude'
}

/**
 * Get a configured `LanguageModel` for the active provider. Synchronous —
 * the underlying SDK constructors are cheap and don't touch the network.
 *
 * Throws when the active provider is selected but not yet wired (mimo/ollama).
 * Callers in the chat fallback path should catch and surface a friendly
 * error rather than crashing the route.
 */
export function getLlm(opts?: GetLlmOptions): LanguageModel {
  const provider = resolveProvider(opts)
  const model    = opts?.model ?? DEFAULT_MODELS[provider]

  switch (provider) {
    case 'claude':
      return anthropic(model)
    case 'openrouter': {
      const { getOpenRouterModel } = require('./providers/openrouter') as typeof import('./providers/openrouter')
      return getOpenRouterModel(model)
    }
    case 'mimo': {
      // Lazy require so the build doesn't fail until activation
      const { getMimoModel } = require('./providers/mimo') as typeof import('./providers/mimo')
      return getMimoModel(model)
    }
    case 'ollama': {
      const { getOllamaModel } = require('./providers/ollama') as typeof import('./providers/ollama')
      return getOllamaModel(model)
    }
  }
}

/** Convenience — read the active provider name without constructing a model. */
export function activeProvider(): LlmProvider {
  return resolveProvider()
}
