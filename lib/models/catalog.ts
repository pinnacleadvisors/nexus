/**
 * Model catalog — hand-curated benchmark snapshots for every model the
 * Agentdex can route to. Add a row here, set `availableVia`, and the model
 * lights up automatically in the per-agent dropdown and the LLM-judge
 * recommender's candidate set.
 *
 * Benchmark scores are point-in-time. The `asOf` field tells the recommender
 * (and the UI tooltip) whether a score is stale. When a score is older than
 * 90 days the recommender de-prioritises it relative to fresher data.
 *
 * Sources: LiveBench (livebench.ai), SWE-bench (swebench.com), MMMU
 * (mmmu-benchmark.github.io), AIME (maa.org), Aider (aider.chat),
 * Artificial Analysis arenas (artificialanalysis.ai).
 *
 * Refresh cadence: bump scores when a new model lands or a fresh leaderboard
 * is published. A future `model-curator` agent can automate this.
 */

import type { ModelDefinition } from './types'

// ── Anthropic Claude ─────────────────────────────────────────────────────────
const ANTHROPIC: ModelDefinition[] = [
  {
    id:       'claude-opus-4-8',
    name:     'Claude Opus 4.8',
    provider: 'anthropic',
    tagline:  'Latest frontier flagship. Default for the hardest reasoning + long-horizon autonomy. (Public leaderboard scores pending — benchmarks will be filled when published.)',
    capabilities: ['reasoning', 'code', 'autonomy', 'content', 'research'],
    contextWindow: 1_000_000,
    // Same Opus tier pricing as 4.7 until Anthropic publishes 4.8 rates.
    inputCostPerMtok:  15,
    outputCostPerMtok: 75,
    latencyTier: 'slow',
    // Intentionally empty — do not fabricate scores for a just-released model.
    // The model-discovery merge + a future model-curator agent backfill these.
    benchmarks: [],
    availableVia: ['subscription', 'api'],
    docsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models',
  },
  {
    id:       'claude-opus-4-7',
    name:     'Claude Opus 4.7',
    provider: 'anthropic',
    tagline:  'Frontier reasoning + long-horizon autonomy. Default for complex multi-step work.',
    capabilities: ['reasoning', 'code', 'autonomy', 'content', 'research'],
    contextWindow: 1_000_000,
    inputCostPerMtok:  15,
    outputCostPerMtok: 75,
    latencyTier: 'slow',
    benchmarks: [
      { key: 'livebench',   label: 'LiveBench (avg)',    score: 78.3, unit: '%',   asOf: '2026-04-15', source: 'livebench.ai' },
      { key: 'swe-bench',   label: 'SWE-bench Verified', score: 72.1, unit: '%',   asOf: '2026-04-15', source: 'swebench.com' },
      { key: 'mmmu',        label: 'MMMU',               score: 81.5, unit: '%',   asOf: '2026-04-15', source: 'mmmu-benchmark.github.io' },
      { key: 'aider',       label: 'Aider polyglot',     score: 76.0, unit: '%',   asOf: '2026-04-15', source: 'aider.chat' },
    ],
    availableVia: ['subscription', 'api'],
    docsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models',
  },
  {
    id:       'claude-sonnet-4-6',
    name:     'Claude Sonnet 4.6',
    provider: 'anthropic',
    tagline:  'Balanced workhorse. Default for most agents — fast enough for tool use, smart enough for code.',
    capabilities: ['reasoning', 'code', 'content', 'research', 'autonomy'],
    contextWindow: 1_000_000,
    inputCostPerMtok:  3,
    outputCostPerMtok: 15,
    latencyTier: 'balanced',
    benchmarks: [
      { key: 'livebench',   label: 'LiveBench (avg)',    score: 71.2, unit: '%',   asOf: '2026-04-15', source: 'livebench.ai' },
      { key: 'swe-bench',   label: 'SWE-bench Verified', score: 65.4, unit: '%',   asOf: '2026-04-15', source: 'swebench.com' },
      { key: 'aider',       label: 'Aider polyglot',     score: 67.0, unit: '%',   asOf: '2026-04-15', source: 'aider.chat' },
    ],
    availableVia: ['subscription', 'api'],
    docsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models',
  },
  {
    id:       'claude-haiku-4-5',
    name:     'Claude Haiku 4.5',
    provider: 'anthropic',
    tagline:  'Cheap + fast glue. Cron summarisers, structured extraction, validators.',
    capabilities: ['fast', 'content', 'research'],
    contextWindow: 200_000,
    inputCostPerMtok:  0.8,
    outputCostPerMtok: 4,
    latencyTier: 'fast',
    benchmarks: [
      { key: 'livebench',   label: 'LiveBench (avg)',    score: 58.4, unit: '%',   asOf: '2026-04-15', source: 'livebench.ai' },
    ],
    availableVia: ['subscription', 'api'],
    docsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models',
  },
]

// ── OpenAI ───────────────────────────────────────────────────────────────────
const OPENAI: ModelDefinition[] = [
  {
    id:       'gpt-5.5',
    name:     'GPT-5.5',
    provider: 'openai',
    tagline:  'Frontier multi-modal. Strongest on math + vision-heavy reasoning.',
    capabilities: ['reasoning', 'code', 'vision', 'content', 'research', 'autonomy'],
    contextWindow: 400_000,
    inputCostPerMtok:  10,
    outputCostPerMtok: 40,
    latencyTier: 'balanced',
    benchmarks: [
      { key: 'livebench', label: 'LiveBench (avg)',    score: 79.1, unit: '%', asOf: '2026-04-30', source: 'livebench.ai' },
      { key: 'aime',      label: 'AIME 2025',          score: 92.0, unit: '%', asOf: '2026-04-30', source: 'OpenAI report' },
      { key: 'mmmu',      label: 'MMMU',               score: 83.8, unit: '%', asOf: '2026-04-30', source: 'mmmu-benchmark.github.io' },
      { key: 'swe-bench', label: 'SWE-bench Verified', score: 70.8, unit: '%', asOf: '2026-04-30', source: 'swebench.com' },
    ],
    availableVia: ['subscription', 'api'],
    docsUrl: 'https://platform.openai.com/docs/models',
  },
  {
    id:       'gpt-5-mini',
    name:     'GPT-5 mini',
    provider: 'openai',
    tagline:  'Cheap fast tier. Good fit for high-volume structured tasks.',
    capabilities: ['fast', 'content', 'research', 'code'],
    contextWindow: 200_000,
    inputCostPerMtok:  0.5,
    outputCostPerMtok: 3,
    latencyTier: 'fast',
    benchmarks: [
      { key: 'livebench', label: 'LiveBench (avg)', score: 63.2, unit: '%', asOf: '2026-04-30', source: 'livebench.ai' },
    ],
    availableVia: ['api'],
    docsUrl: 'https://platform.openai.com/docs/models',
  },
  {
    id:       'o4',
    name:     'o4 (reasoning)',
    provider: 'openai',
    tagline:  'Chain-of-thought specialist. Math, research, hard logic — slow but deep.',
    capabilities: ['reasoning', 'code', 'research'],
    contextWindow: 200_000,
    inputCostPerMtok:  20,
    outputCostPerMtok: 80,
    latencyTier: 'slow',
    benchmarks: [
      { key: 'aime', label: 'AIME 2025',    score: 95.5, unit: '%', asOf: '2026-04-30', source: 'OpenAI report' },
      { key: 'gpqa', label: 'GPQA Diamond', score: 82.0, unit: '%', asOf: '2026-04-30', source: 'OpenAI report' },
    ],
    availableVia: ['subscription', 'api'],
    docsUrl: 'https://platform.openai.com/docs/models',
  },
]

// ── Google Gemini ────────────────────────────────────────────────────────────
const GOOGLE: ModelDefinition[] = [
  {
    id:       'gemini-2.5-pro',
    name:     'Gemini 2.5 Pro',
    provider: 'google',
    tagline:  'Million-token context + native vision. Great for repo-wide analysis.',
    capabilities: ['reasoning', 'code', 'vision', 'research', 'content'],
    contextWindow: 2_000_000,
    inputCostPerMtok:  2.5,
    outputCostPerMtok: 10,
    latencyTier: 'balanced',
    benchmarks: [
      { key: 'livebench', label: 'LiveBench (avg)', score: 73.5, unit: '%', asOf: '2026-04-30', source: 'livebench.ai' },
      { key: 'mmmu',      label: 'MMMU',            score: 79.6, unit: '%', asOf: '2026-04-30', source: 'mmmu-benchmark.github.io' },
    ],
    availableVia: ['api'],
    docsUrl: 'https://ai.google.dev/gemini-api/docs/models',
  },
  {
    id:       'gemini-2.5-flash',
    name:     'Gemini 2.5 Flash',
    provider: 'google',
    tagline:  'Cheap glue with huge context. Indexing, RAG, batch summarisation.',
    capabilities: ['fast', 'content', 'research'],
    contextWindow: 1_000_000,
    inputCostPerMtok:  0.15,
    outputCostPerMtok: 0.6,
    latencyTier: 'fast',
    benchmarks: [
      { key: 'livebench', label: 'LiveBench (avg)', score: 60.8, unit: '%', asOf: '2026-04-30', source: 'livebench.ai' },
    ],
    availableVia: ['api'],
    docsUrl: 'https://ai.google.dev/gemini-api/docs/models',
  },
]

// ── xAI / DeepSeek (open + alternative frontier) ────────────────────────────
const ALTERNATIVE: ModelDefinition[] = [
  {
    id:       'grok-4',
    name:     'Grok 4',
    provider: 'xai',
    tagline:  'Real-time X feed access. Useful for trend-spotting + signal monitoring.',
    capabilities: ['research', 'content', 'reasoning'],
    contextWindow: 256_000,
    inputCostPerMtok:  5,
    outputCostPerMtok: 15,
    latencyTier: 'balanced',
    benchmarks: [
      { key: 'livebench', label: 'LiveBench (avg)', score: 70.0, unit: '%', asOf: '2026-04-30', source: 'livebench.ai' },
    ],
    availableVia: ['api'],
    docsUrl: 'https://docs.x.ai/',
  },
  {
    id:       'deepseek-v3.5',
    name:     'DeepSeek V3.5',
    provider: 'deepseek',
    tagline:  'Open-weights frontier. Strong code + math at a fraction of the cost.',
    capabilities: ['reasoning', 'code', 'fast'],
    contextWindow: 128_000,
    inputCostPerMtok:  0.27,
    outputCostPerMtok: 1.1,
    latencyTier: 'balanced',
    benchmarks: [
      { key: 'livebench', label: 'LiveBench (avg)', score: 67.4, unit: '%', asOf: '2026-04-30', source: 'livebench.ai' },
      { key: 'aider',     label: 'Aider polyglot',  score: 64.2, unit: '%', asOf: '2026-04-30', source: 'aider.chat' },
    ],
    availableVia: ['api'],
    docsUrl: 'https://api-docs.deepseek.com/',
  },
]

// ── NVIDIA NIM (free-tier hosted) + Ollama (local) ──────────────────────────
// Open-weights models reachable at $0 marginal cost: NIM via the free
// integrate.api.nvidia.com endpoint (lib/llm/providers/nim.ts), Ollama via a
// self-hosted server (lib/llm/providers/ollama.ts). Ideal for background /
// high-volume tasks where plan-window budget matters more than peak quality.
const LOCAL_OPEN: ModelDefinition[] = [
  {
    id:       'meta/llama-3.3-70b-instruct',
    name:     'Llama 3.3 70B (NIM)',
    provider: 'nim',
    tagline:  'NVIDIA-hosted Llama 3.3 70B. Free tier, OpenAI-compatible — strong glue + code at $0 marginal.',
    capabilities: ['code', 'fast', 'content', 'research', 'autonomy'],
    contextWindow: 128_000,
    inputCostPerMtok:  null,
    outputCostPerMtok: null,
    latencyTier: 'balanced',
    benchmarks: [
      { key: 'livebench', label: 'LiveBench (avg)', score: 55.1, unit: '%', asOf: '2026-04-30', source: 'livebench.ai' },
    ],
    availableVia: ['api'],
    docsUrl: 'https://build.nvidia.com/meta/llama-3_3-70b-instruct',
  },
  {
    id:       'deepseek-ai/deepseek-r1',
    name:     'DeepSeek R1 (NIM)',
    provider: 'nim',
    tagline:  'NVIDIA-hosted reasoning model. Chain-of-thought math + logic at free-tier cost.',
    capabilities: ['reasoning', 'code', 'research'],
    contextWindow: 128_000,
    inputCostPerMtok:  null,
    outputCostPerMtok: null,
    latencyTier: 'slow',
    benchmarks: [
      { key: 'aime', label: 'AIME 2025', score: 79.8, unit: '%', asOf: '2026-04-30', source: 'DeepSeek report' },
    ],
    availableVia: ['api'],
    docsUrl: 'https://build.nvidia.com/deepseek-ai/deepseek-r1',
  },
  {
    id:       'llama3.3',
    name:     'Llama 3.3 (Ollama)',
    provider: 'ollama',
    tagline:  'Local Llama 3.3 via a self-hosted Ollama server. Fully offline, no per-call cost.',
    capabilities: ['fast', 'code', 'content'],
    contextWindow: 128_000,
    inputCostPerMtok:  null,
    outputCostPerMtok: null,
    latencyTier: 'balanced',
    benchmarks: [
      { key: 'livebench', label: 'LiveBench (avg)', score: 54.0, unit: '%', asOf: '2026-04-30', source: 'livebench.ai' },
    ],
    availableVia: ['subscription'],
    docsUrl: 'https://ollama.com/library/llama3.3',
  },
]

// ── Image / Video / Voice (creative pipelines) ──────────────────────────────
const CREATIVE: ModelDefinition[] = [
  {
    id:       'flux-1.1-pro',
    name:     'FLUX 1.1 Pro',
    provider: 'replicate',
    tagline:  'Best-in-class photoreal image gen for ads, hero shots, product photos.',
    capabilities: ['image-gen'],
    contextWindow: 0,
    inputCostPerMtok:  null,
    outputCostPerMtok: null,
    latencyTier: 'balanced',
    benchmarks: [
      { key: 'image-arena', label: 'Artificial Analysis image arena', score: 1180, unit: 'Elo', asOf: '2026-04-30', source: 'artificialanalysis.ai' },
    ],
    availableVia: ['api'],
    docsUrl: 'https://replicate.com/black-forest-labs/flux-1.1-pro',
  },
  {
    id:       'kling-2.5',
    name:     'Kling 2.5',
    provider: 'replicate',
    tagline:  'Cinematic video gen. Product reels, narrative ads, motion graphics.',
    capabilities: ['video-gen'],
    contextWindow: 0,
    inputCostPerMtok:  null,
    outputCostPerMtok: null,
    latencyTier: 'slow',
    benchmarks: [
      { key: 'video-arena', label: 'Artificial Analysis video arena', score: 1240, unit: 'Elo', asOf: '2026-04-30', source: 'artificialanalysis.ai' },
    ],
    availableVia: ['api'],
    docsUrl: 'https://klingai.com/',
  },
  {
    id:       'elevenlabs-v3',
    name:     'ElevenLabs v3',
    provider: 'replicate',
    tagline:  'High-fidelity voice cloning + TTS. Voiceover, UGC narration.',
    capabilities: ['tts'],
    contextWindow: 0,
    inputCostPerMtok:  null,
    outputCostPerMtok: null,
    latencyTier: 'fast',
    benchmarks: [
      { key: 'tts-arena', label: 'TTS Arena', score: 1320, unit: 'Elo', asOf: '2026-04-30', source: 'huggingface.co/spaces/TTS-AGI/TTS-Arena' },
    ],
    availableVia: ['api'],
    docsUrl: 'https://elevenlabs.io/docs',
  },
]

const OTHER_MODELS: ModelDefinition[] = [...OPENAI, ...GOOGLE, ...ALTERNATIVE, ...LOCAL_OPEN, ...CREATIVE]

export const MODEL_CATALOG: readonly ModelDefinition[] = [...ANTHROPIC, ...OTHER_MODELS]

/** Lookup by id. */
export function getModelById(id: string): ModelDefinition | undefined {
  return MODEL_CATALOG.find(m => m.id === id)
}

/** All models published by a given provider. */
export function getModelsByProvider(provider: ModelDefinition['provider']): ModelDefinition[] {
  return MODEL_CATALOG.filter(m => m.provider === provider)
}

/** All non-deprecated models reachable via the given set of connected providers. */
export function getAvailableModels(connected: ReadonlyArray<ModelDefinition['provider']>): ModelDefinition[] {
  return MODEL_CATALOG.filter(m => connected.includes(m.provider) && !m.deprecated)
}
