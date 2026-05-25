/**
 * OpenRouter adapter — LIVE.
 *
 * OpenRouter (https://openrouter.ai) is a unified API that routes to GPT-5,
 * Claude, Gemini, Llama, Mistral, DeepSeek and ~200 other models behind one
 * OpenAI-compatible endpoint. Useful when:
 *   - Drainable subscriptions (Claude Max, ChatGPT Pro) are exhausted
 *   - The operator wants per-task model choice without juggling provider keys
 *   - A model is cheaper on OpenRouter than direct (e.g. older Claude models)
 *
 * Activation:
 *   1. Sign up at https://openrouter.ai, generate an API key
 *   2. Set OPENROUTER_API_KEY in Doppler
 *   3. (Optional) Set OPENROUTER_DEFAULT_MODEL to override the built-in default
 *   4. Set LLM_PROVIDER=openrouter in Doppler — the chat-route fallback path
 *      will route via this adapter
 *
 * OpenRouter is OpenAI-compatible, so we use `createOpenAI` with a custom
 * baseURL. No new npm dependency needed.
 *
 * Model name conventions (OpenRouter uses `<vendor>/<model>` slugs):
 *   - `openai/gpt-5`               — GPT-5
 *   - `anthropic/claude-sonnet-4-6`— Claude Sonnet 4.6 via OpenRouter
 *   - `meta-llama/llama-3.3-70b`   — Llama 3.3
 *   - `google/gemini-2.5-pro`      — Gemini 2.5 Pro
 *
 * Full catalog: https://openrouter.ai/models
 */

import type { LanguageModel } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'

export interface OpenRouterConfig {
  apiKey:    string
  baseUrl:   string
  appUrl?:   string
  appTitle?: string
}

function getConfig(): OpenRouterConfig | null {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null
  return {
    apiKey,
    baseUrl:  process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    appUrl:   process.env.OPENROUTER_APP_URL   ?? process.env.NEXT_PUBLIC_APP_URL,
    appTitle: process.env.OPENROUTER_APP_TITLE ?? 'Nexus',
  }
}

/**
 * Returns an OpenRouter-backed `LanguageModel`.
 *
 * Throws ConfigError when OPENROUTER_API_KEY is missing — callers in the chat
 * fallback path should catch and surface a friendly error rather than
 * crashing the route.
 */
export function getOpenRouterModel(model: string): LanguageModel {
  const cfg = getConfig()
  if (!cfg) {
    throw new Error(
      'OpenRouter not configured — set OPENROUTER_API_KEY in Doppler. ' +
      'See lib/llm/providers/openrouter.ts for activation steps.',
    )
  }

  const headers: Record<string, string> = {}
  if (cfg.appUrl)   headers['HTTP-Referer'] = cfg.appUrl
  if (cfg.appTitle) headers['X-Title']      = cfg.appTitle

  const openrouter = createOpenAI({
    baseURL: cfg.baseUrl,
    apiKey:  cfg.apiKey,
    headers,
  })

  return openrouter(model)
}
