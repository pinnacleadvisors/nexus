/**
 * NVIDIA NIM adapter — LIVE.
 *
 * NVIDIA NIM (https://build.nvidia.com) is NVIDIA's free-tier OpenAI-
 * compatible inference endpoint covering Llama 3.x, Mixtral, Gemma,
 * DeepSeek, and NVIDIA's own Nemotron family. The free tier is generous
 * enough to handle background tasks (failure-cluster scan, weekly
 * digest, content trend-scouting) at zero marginal cost.
 *
 * Operator brain-dump 2026-05-27 — added as one of the `LLM_PROVIDER`
 * enum values alongside claude / openrouter / mimo / ollama.
 *
 * Activation:
 *   1. Sign up at https://build.nvidia.com, generate an API key
 *   2. Set NVIDIA_NIM_API_KEY in Doppler
 *   3. (Optional) Set NVIDIA_NIM_DEFAULT_MODEL to override the built-in
 *      default (`meta/llama-3.3-70b-instruct` — best quality/cost trade)
 *   4. Set LLM_PROVIDER=nim in Doppler OR flip via /settings → AI
 *      providers (J1 dynamic provider) — the chat-route fallback
 *      will route via this adapter
 *
 * NIM is OpenAI-compatible, so we use `createOpenAI` with a custom
 * baseURL. No new npm dependency needed — same pattern as the
 * OpenRouter adapter.
 *
 * Model name conventions (NIM uses `<vendor>/<model>` slugs):
 *   - `meta/llama-3.3-70b-instruct`              — Llama 3.3 70B
 *   - `meta/llama-3.1-8b-instruct`               — Llama 3.1 8B (cheapest)
 *   - `mistralai/mixtral-8x22b-instruct-v0.1`    — Mixtral 8x22B
 *   - `nvidia/nemotron-3-8b-chat-4k-rlhf`        — NVIDIA's Nemotron
 *   - `google/gemma-2-9b-it`                     — Gemma 2 9B
 *   - `deepseek-ai/deepseek-r1`                  — DeepSeek R1 reasoning
 *
 * Full catalog: https://build.nvidia.com/models
 *
 * Use cases that fit NIM perfectly:
 *   - Background failure-cluster scanning (workflow-optimizer cron)
 *   - Trend scouting on volume (content-trend-scout nightly)
 *   - Daily digest summarisation
 *   - Lead-scoring on prospects (low-stakes, high-volume)
 *
 * Use cases NIM is NOT for:
 *   - Customer-facing chat (latency higher than Claude/Codex)
 *   - Strategic decisions (use the operator's primary provider)
 */

import type { LanguageModel } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'

export interface NimConfig {
  apiKey:    string
  baseUrl:   string
}

function getConfig(): NimConfig | null {
  const apiKey = process.env.NVIDIA_NIM_API_KEY
  if (!apiKey) return null
  return {
    apiKey,
    baseUrl: process.env.NVIDIA_NIM_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
  }
}

/**
 * Returns a NIM-backed `LanguageModel`.
 *
 * Throws ConfigError when NVIDIA_NIM_API_KEY is missing — callers in
 * the chat fallback path should catch and surface a friendly error
 * rather than crashing the route.
 */
export function getNimModel(model: string): LanguageModel {
  const cfg = getConfig()
  if (!cfg) {
    throw new Error(
      'NVIDIA NIM not configured — set NVIDIA_NIM_API_KEY in Doppler. ' +
      'See lib/llm/providers/nim.ts for activation steps.',
    )
  }

  const nim = createOpenAI({
    apiKey:  cfg.apiKey,
    baseURL: cfg.baseUrl,
  })

  return nim(model) as LanguageModel
}
