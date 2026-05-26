/**
 * AI provider registry — single source of truth for the providers surfaced on
 * the Settings → AI Providers tab. Mirrors the shape of `lib/oauth/providers.ts`
 * so the cards reuse the same liquid-glass design language.
 *
 * Each provider can be connected via one of two modes:
 *   - subscription: the operator's CLI/gateway auth is reused. Calls run
 *     through the per-provider gateway (Claude Code gateway, Codex gateway).
 *     No per-call cost (plan-billed against the subscription).
 *   - api: encrypted API key stored on `connected_accounts.encrypted_api_key`.
 *     Per-token cost, applies to every business in scope.
 *
 * Adding a provider:
 *   1. Add a row below with `id`, `modes`, and `docsUrl`
 *   2. If it has an API mode, set `apiKeySetup.envVar` so the provision route
 *      injects the key into per-business containers
 *   3. If it has a subscription mode, document the gateway env var pair
 *      (gatewayUrl + bearer) in `memory/platform/SECRETS.md`
 *   4. Reference one or more rows in `lib/models/catalog.ts` so the model
 *      picker has something to show
 */

import type { AiProviderKey, ConnectionMode } from '@/lib/models/types'

export interface AiProviderSubscriptionMode {
  /** Env vars the operator must set to wire the subscription gateway. */
  envVars: string[]
  /** Short user-facing description of what to set up. */
  instructions: string
  /** Direct link to the gateway-setup doc (runbook, README). */
  setupUrl?: string
}

export interface AiProviderApiMode {
  /** Container env-var name the decrypted key gets injected as at provision. */
  envVar: string
  /** Short instructions for finding the key. */
  instructions?: string
  /** Direct link to the dashboard page where the key is generated. */
  credentialsUrl?: string
}

export interface AiProvider {
  id:       AiProviderKey
  name:     string
  /** Tagline shown on the card under the name. */
  tagline:  string
  /** Hex color used for the icon gradient. */
  accent:   string
  /** Lucide-react icon component name. */
  icon:     string
  /** Vendor docs link surfaced on the card footer. */
  docsUrl:  string
  /** Modes the provider supports — at least one. */
  modes:    ConnectionMode[]
  /** Subscription-mode config — required when modes includes 'subscription'. */
  subscription?: AiProviderSubscriptionMode
  /** API-key-mode config — required when modes includes 'api'. */
  api?:          AiProviderApiMode
}

export const AI_PROVIDERS: readonly AiProvider[] = [
  {
    id:       'anthropic',
    name:     'Anthropic Claude',
    tagline:  'Claude Opus + Sonnet + Haiku. Native runtime for autonomous agents.',
    accent:   '#d97757',
    icon:     'Sparkles',
    docsUrl:  'https://docs.anthropic.com',
    modes:    ['subscription', 'api'],
    subscription: {
      envVars:      ['CLAUDE_CODE_GATEWAY_URL', 'CLAUDE_CODE_BEARER_TOKEN'],
      instructions: 'Claude Max plan drained via the self-hosted Claude Code gateway (services/claude-gateway/). Plan-billed — no per-call cost. Set both env vars in Doppler then deploy the gateway container.',
      setupUrl:     '/manage-platform',
    },
    api: {
      envVar:         'ANTHROPIC_API_KEY',
      instructions:   'API-billed. Used when the subscription gateway is down or unconfigured.',
      credentialsUrl: 'https://console.anthropic.com/settings/keys',
    },
  },
  {
    id:       'openai',
    name:     'OpenAI / GPT',
    tagline:  'GPT-5.5, GPT-5 mini, o4. Strong on math + vision-heavy reasoning.',
    accent:   '#10a37f',
    icon:     'Bot',
    docsUrl:  'https://platform.openai.com/docs',
    modes:    ['subscription', 'api'],
    subscription: {
      envVars:      ['CODEX_GATEWAY_URL', 'CODEX_GATEWAY_BEARER_TOKEN'],
      instructions: 'ChatGPT Plus / Pro plan drained via the Codex CLI gateway on KVM4 (migrated from KVM2 on 2026-05-22 per ADR 006). Auth rotation ~30 days — see docs/runbooks/codex-gateway-auth-rotation.md.',  // topology-check: ignore
      setupUrl:     '/manage-platform',
    },
    api: {
      envVar:         'OPENAI_API_KEY',
      instructions:   'API-billed. Required when the Codex gateway isn\'t reachable or for non-CLI workflows.',
      credentialsUrl: 'https://platform.openai.com/api-keys',
    },
  },
  {
    id:       'google',
    name:     'Google Gemini',
    tagline:  'Gemini 2.5 Pro + Flash. Million-token context, native multi-modal.',
    accent:   '#4285f4',
    icon:     'Sparkles',
    docsUrl:  'https://ai.google.dev/gemini-api/docs',
    modes:    ['api'],
    api: {
      envVar:         'GOOGLE_API_KEY',
      instructions:   'AI Studio key (free tier available). Used by content + research agents for huge-context summarisation.',
      credentialsUrl: 'https://aistudio.google.com/apikey',
    },
  },
  {
    id:       'xai',
    name:     'xAI Grok',
    tagline:  'Real-time X feed access. Useful for trend / signal monitoring.',
    accent:   '#1da1f2',
    icon:     'Zap',
    docsUrl:  'https://docs.x.ai/',
    modes:    ['api'],
    api: {
      envVar:         'XAI_API_KEY',
      instructions:   'xAI console key. Niche but unique for X-aware research.',
      credentialsUrl: 'https://console.x.ai/',
    },
  },
  {
    id:       'deepseek',
    name:     'DeepSeek',
    tagline:  'Open-weights frontier. Strong code + math at a fraction of the cost.',
    accent:   '#5b8ff9',
    icon:     'Cpu',
    docsUrl:  'https://api-docs.deepseek.com/',
    modes:    ['api'],
    api: {
      envVar:         'DEEPSEEK_API_KEY',
      instructions:   'DeepSeek platform key. Great cost-perf for high-volume validators.',
      credentialsUrl: 'https://platform.deepseek.com/api_keys',
    },
  },
  {
    id:       'replicate',
    name:     'Replicate (image / video / voice)',
    tagline:  'Flux, Kling, ElevenLabs, and 20+ other creative models via one API.',
    accent:   '#ea4c89',
    icon:     'Wand2',
    docsUrl:  'https://replicate.com/docs',
    modes:    ['api'],
    api: {
      envVar:         'REPLICATE_API_TOKEN',
      instructions:   'One token unlocks Flux, Kling, ElevenLabs, Imagen, etc. Pay-per-prediction.',
      credentialsUrl: 'https://replicate.com/account/api-tokens',
    },
  },
  {
    id:       'meta',
    name:     'Meta Llama',
    tagline:  'Llama 4 (open weights). Run on Replicate, Groq, or self-hosted.',
    accent:   '#1877f2',
    icon:     'Cpu',
    docsUrl:  'https://llama.meta.com/',
    modes:    ['api'],
    api: {
      envVar:         'META_LLAMA_API_KEY',
      instructions:   'Use whichever Llama-compatible host you prefer (Groq, Together, Fireworks, Replicate).',
      credentialsUrl: 'https://llama.developer.meta.com/',
    },
  },
  {
    id:       'mistral',
    name:     'Mistral',
    tagline:  'Mistral Large / Codestral. EU-hosted alternative.',
    accent:   '#ff7000',
    icon:     'Cpu',
    docsUrl:  'https://docs.mistral.ai/',
    modes:    ['api'],
    api: {
      envVar:         'MISTRAL_API_KEY',
      instructions:   'Mistral console key. Used by EU-data-residency workflows.',
      credentialsUrl: 'https://console.mistral.ai/api-keys/',
    },
  },
  {
    id:       'openrouter',
    name:     'OpenRouter',
    tagline:  'One API key, 300+ models. GPT, Claude, Gemini, Llama, DeepSeek, Mixtral — all via a unified router.',
    accent:   '#a78bfa',
    icon:     'Sparkles',
    docsUrl:  'https://openrouter.ai/docs',
    modes:    ['api'],
    api: {
      envVar:         'OPENROUTER_API_KEY',
      instructions:   'OpenRouter unified-router key. Set LLM_PROVIDER=openrouter in Doppler to default the platform to it; per-call routing picks the model by slug (anthropic/claude-sonnet-4-6, openai/gpt-5, google/gemini-2.5-pro, …). See lib/llm/providers/openrouter.ts.',
      credentialsUrl: 'https://openrouter.ai/keys',
    },
  },
] as const

export function getProvider(id: AiProviderKey): AiProvider | undefined {
  return AI_PROVIDERS.find(p => p.id === id)
}
