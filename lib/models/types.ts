/**
 * Model catalog types — single source of truth for the model registry used by
 * the AI Providers UI, the Agentdex, and the LLM-judge recommender.
 *
 * The catalog itself (lib/models/catalog.ts) is hand-curated and snapshot-based:
 * each model lists the benchmarks it's been scored on plus the date the score
 * was captured. A future `model-curator` agent + cron can refresh these scores
 * automatically; for now the operator bumps them when a new model lands.
 */

/** AI provider keys — matches `lib/ai/providers.ts` and the connection modes UI. */
export type AiProviderKey =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'xai'
  | 'deepseek'
  | 'meta'
  | 'mistral'
  | 'replicate'
  | 'openrouter'
  | 'nim'
  | 'ollama'

/** What sort of work the model is most useful for. Drives recommender pruning. */
export type ModelCapability =
  | 'reasoning'        // deep multi-step thinking, math, planning
  | 'code'             // SWE-bench-style, repo-aware coding
  | 'autonomy'         // long-horizon agentic loops, tool use
  | 'content'          // writing, marketing, copy
  | 'research'         // web-aware QA, summarisation
  | 'fast'             // low-latency / cheap glue
  | 'vision'           // image understanding
  | 'image-gen'        // image synthesis (Flux, Imagen, DALL-E)
  | 'video-gen'        // video synthesis (Kling, Runway, Sora)
  | 'tts'              // text-to-speech, voiceover
  | 'embedding'        // retrieval / similarity

/** Connection modes a provider supports. Subscription = gateway/CLI, Api = key. */
export type ConnectionMode = 'subscription' | 'api'

/** A benchmark snapshot for one model. */
export interface BenchmarkScore {
  /** Benchmark key (canonical lowercase: 'livebench', 'swe-bench', 'mmmu', ...) */
  key:   string
  /** Display label, e.g. "LiveBench (reasoning, 2026-04)". */
  label: string
  /** Score as published by the benchmark host. Units vary — see `unit`. */
  score: number
  /** "%", "Elo", "pass@1", etc. */
  unit:  string
  /** ISO date the score was captured. */
  asOf:  string
  /** Where the score came from. Visible in the UI tooltip. */
  source: string
}

/** One model in the catalog. */
export interface ModelDefinition {
  /** Vendor-canonical id, e.g. `claude-opus-4-7`, `gpt-5.5`, `gemini-2.5-pro`. */
  id:       string
  /** Display name, e.g. "Claude Opus 4.7". */
  name:     string
  /** Provider key — must match `AI_PROVIDERS` in lib/ai/providers.ts. */
  provider: AiProviderKey
  /** Short tagline shown on the agent card model dropdown. */
  tagline:  string
  /** Capabilities the recommender uses to filter candidates. */
  capabilities: ModelCapability[]
  /** Approx context window in tokens (operator-facing detail). */
  contextWindow: number
  /** Indicative $/Mtok input — null when subscription-only (gateway, no per-tok price). */
  inputCostPerMtok:  number | null
  /** Indicative $/Mtok output — null when subscription-only. */
  outputCostPerMtok: number | null
  /** Latency tier — informational. */
  latencyTier: 'fast' | 'balanced' | 'slow'
  /** Benchmark snapshots — most recent first. */
  benchmarks: BenchmarkScore[]
  /** Connection modes that surface this model. */
  availableVia: ConnectionMode[]
  /** Optional flag to nudge the recommender away (e.g. legacy / sunset). */
  deprecated?: boolean
  /** Vendor docs link surfaced on the card. */
  docsUrl?: string
}

/** A single recommendation returned by the LLM judge. */
export interface ModelRecommendation {
  agentSlug: string
  /** Recommended model id from the catalog. */
  model:     string
  /** Free-text rationale (2-4 sentences). */
  rationale: string
  /** Alternative picks the judge considered. */
  alternatives: Array<{ model: string; reason: string }>
  /** Generated at. */
  createdAt: string
}

/**
 * Inputs to the recommender. The caller normally constructs this from an
 * AgentDefinition plus the live "which providers are connected" set so the
 * judge only considers reachable models.
 */
export interface RecommendInput {
  agent: {
    slug:        string
    name:        string
    description: string
    tools:       string[]
    currentModel: string
  }
  /** Provider keys that have at least one active connection. */
  availableProviders: AiProviderKey[]
}
