/**
 * lib/models/providers.ts — detect which AI providers are reachable
 * for a given operator. Extracted from app/api/models/recommend so the
 * skill-recommend route can reuse the exact same detection.
 *
 * Returns the union of:
 *   • subscription-mode providers (Claude Code gateway, Codex gateway)
 *   • env-var-only providers (ANTHROPIC_API_KEY, OPENAI_API_KEY,
 *     OPENROUTER_API_KEY)
 *   • per-user connected_accounts api-key rows for the long-tail
 *     providers (google, xai, deepseek, replicate, meta, mistral)
 *   • legacy openclaw secret → anthropic
 */

import type { AiProviderKey } from '@/lib/models/types'
import { createServerClient } from '@/lib/supabase'
import { resolveClaudeCodeConfig } from '@/lib/claw/business-client'
import { getSecrets } from '@/lib/user-secrets'

export async function detectAvailableProviders(userId: string): Promise<AiProviderKey[]> {
  const out: AiProviderKey[] = []

  // Anthropic — subscription gateway OR env key OR connected_accounts row
  const claudeCfg = await resolveClaudeCodeConfig(userId).catch(() => null)
  if (claudeCfg) out.push('anthropic')
  if (!out.includes('anthropic') && process.env.ANTHROPIC_API_KEY) out.push('anthropic')

  // OpenAI / Codex — gateway env vars OR direct API key
  if (process.env.CODEX_GATEWAY_URL && process.env.CODEX_GATEWAY_BEARER_TOKEN) out.push('openai')
  if (!out.includes('openai') && process.env.OPENAI_API_KEY) out.push('openai')

  // OpenRouter — env-only (unified router; provides effectively all upstreams)
  if (process.env.OPENROUTER_API_KEY) out.push('openrouter')

  // Long-tail via connected_accounts (api-key flow)
  const db = createServerClient()
  if (db) {
    const { data } = await (db.from('connected_accounts' as never) as unknown as {
      select: (cols: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ data: Array<{ platform: string }> | null }> } }
    }).select('platform').eq('user_id', userId).eq('status', 'active')
    const seen = new Set<string>((data ?? []).map(r => r.platform))
    if (seen.has('google'))    out.push('google')
    if (seen.has('xai'))       out.push('xai')
    if (seen.has('deepseek'))  out.push('deepseek')
    if (seen.has('replicate')) out.push('replicate')
    if (seen.has('meta'))      out.push('meta')
    if (seen.has('mistral'))   out.push('mistral')
  }

  // Legacy openclaw → anthropic
  if (!out.includes('anthropic')) {
    const fields = await getSecrets(userId, 'openclaw').catch(() => null)
    if (fields?.gatewayUrl && fields.bearerToken) out.push('anthropic')
  }

  return Array.from(new Set(out))
}
