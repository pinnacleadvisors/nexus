/**
 * Ollama local-LLM adapter — LIVE.
 *
 * Purpose: cheap smoke tests for prompt/agent logic without burning Claude
 * Max budget. Local-only — Ollama runs on the same host as the rest of the
 * stack (or on the developer's machine for dev).
 *
 * Activation:
 *   1. Run an Ollama instance:
 *      - A container from the `ollama/ollama` image attached to the shared
 *        `coolify` network with alias `ollama`, or
 *      - `ollama serve` locally
 *   2. Pull a model: `ollama pull llama3.3` (or any other)
 *   3. Set OLLAMA_BASE_URL in Doppler if not the default
 *      (default: http://localhost:11434)
 *   4. Set LLM_PROVIDER=ollama in Doppler OR flip via /settings → AI providers
 *
 * Ollama serves an OpenAI-compatible API under `<baseUrl>/v1`, so we use
 * `createOpenAI` with that baseURL — same pattern as the OpenRouter / NIM
 * adapters, no new npm dependency. Ollama ignores the API key, but the SDK
 * requires a non-empty string, so we pass a sentinel.
 */

import type { LanguageModel } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'

export interface OllamaConfig {
  baseUrl: string
}

function getConfig(): OllamaConfig {
  return {
    baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  }
}

/**
 * Returns an Ollama-backed `LanguageModel`. The constructor is cheap and does
 * not touch the network — a wrong baseUrl surfaces as an upstream_error at
 * generate time, which the chat fallback path catches and downgrades to Claude.
 */
export function getOllamaModel(model: string): LanguageModel {
  const cfg = getConfig()

  const ollama = createOpenAI({
    // Ollama's OpenAI-compatible surface lives under /v1.
    baseURL: `${cfg.baseUrl.replace(/\/+$/, '')}/v1`,
    // Ollama ignores auth but the SDK requires a non-empty key.
    apiKey:  process.env.OLLAMA_API_KEY ?? 'ollama',
  })

  return ollama(model) as LanguageModel
}
