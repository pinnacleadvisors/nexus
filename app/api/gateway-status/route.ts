/**
 * GET /api/gateway-status
 *
 * Returns at-a-glance state for the AI provider chain + the user's
 * day-to-date spend. Polled by `<GatewayStatusPill>` and the Mission
 * Control "Today's $" widget.
 *
 * Shape:
 *   {
 *     provider:   'gateway' | 'openclaw' | 'api' | 'none'
 *     gatewayUrl?:    string                     // present when provider==='gateway'
 *     gatewayHealthy: boolean
 *     loggedIn?:      boolean                    // gateway sub-detail
 *     queueDepth?:    number
 *     spentUsd:   number    // user's day-to-date
 *     capUsd:     number    // applicable cap
 *     scope:      'user' | 'business'
 *   }
 *
 * Auth: Clerk session. No rate-limit since this is polled — it's all
 * read-only and cheap.
 */

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { resolveClaudeCodeConfig } from '@/lib/claw/business-client'
import { getSecrets } from '@/lib/user-secrets'
import { isGatewayHealthy } from '@/lib/claw/health'
import { assertUnderCostCap } from '@/lib/cost-guard'

export const runtime = 'nodejs'

interface GatewayStatusResponse {
  provider:       'gateway' | 'openclaw' | 'api' | 'none'
  gatewayUrl?:    string
  gatewayHealthy: boolean
  loggedIn?:      boolean
  queueDepth?:    number
  /** Codex gateway probe — independent of the Claude path. */
  codexConfigured: boolean
  codexHealthy:    boolean
  /** OpenRouter API key configured — surfaced for the AI Providers list. */
  openrouterConfigured: boolean
  spentUsd:       number
  capUsd:         number
  scope:          'user' | 'business'
}

/**
 * Probe the codex gateway /health endpoint. Independent of the Claude
 * gateway probe — the codex CLI is its own service (KVM4 post-2026-05-22).
 * Returns false (not throw) on every error so a transient codex outage
 * doesn't crash the gateway-status route.
 */
async function probeCodex(): Promise<{ configured: boolean; healthy: boolean }> {
  const url = process.env.CODEX_GATEWAY_URL
  if (!url) return { configured: false, healthy: false }
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(1500),
    })
    return { configured: true, healthy: res.ok }
  } catch {
    return { configured: true, healthy: false }
  }
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // ── Provider detection ─────────────────────────────────────────────────
  let provider: GatewayStatusResponse['provider'] = 'none'
  let gatewayUrl: string | undefined
  let gatewayHealthy = false
  let loggedIn:    boolean | undefined
  let queueDepth:  number  | undefined

  const claudeCodeCfg = await resolveClaudeCodeConfig(userId)
  if (claudeCodeCfg) {
    provider       = 'gateway'
    gatewayUrl     = claudeCodeCfg.gatewayUrl
    gatewayHealthy = await isGatewayHealthy(claudeCodeCfg.gatewayUrl)
    if (gatewayHealthy) {
      // One-shot deep probe: parse the same /health JSON the smoke test reads.
      try {
        const probe = await fetch(claudeCodeCfg.gatewayUrl.replace(/\/$/, '') + '/health', {
          signal: AbortSignal.timeout(1500),
        })
        if (probe.ok) {
          const json = await probe.json() as { loggedIn?: boolean; queueDepth?: number }
          loggedIn   = Boolean(json.loggedIn)
          queueDepth = typeof json.queueDepth === 'number' ? json.queueDepth : undefined
        }
      } catch { /* swallow — surface healthy:true without sub-detail */ }
    } else {
      // Fall back: gateway down → next provider
      const ocFields = await getSecrets(userId, 'openclaw')
      if ((ocFields.gatewayUrl && ocFields.bearerToken) || (process.env.OPENCLAW_GATEWAY_URL && process.env.OPENCLAW_BEARER_TOKEN)) {
        provider = 'openclaw'
      } else if (process.env.ANTHROPIC_API_KEY) {
        provider = 'api'
      } else {
        provider = 'none'
      }
    }
  } else {
    const ocFields = await getSecrets(userId, 'openclaw')
    if ((ocFields.gatewayUrl && ocFields.bearerToken) || (process.env.OPENCLAW_GATEWAY_URL && process.env.OPENCLAW_BEARER_TOKEN)) {
      provider = 'openclaw'
    } else if (process.env.ANTHROPIC_API_KEY) {
      provider = 'api'
    }
  }

  // ── Codex gateway probe (independent of the Claude probe above) ────────
  const codex = await probeCodex()

  // ── OpenRouter — env-only check; we don't ping the API to avoid spending
  //    on a settings-page load.
  const openrouterConfigured = Boolean(process.env.OPENROUTER_API_KEY)

  // ── Spend ──────────────────────────────────────────────────────────────
  const cap = await assertUnderCostCap(userId)

  const body: GatewayStatusResponse = {
    provider,
    gatewayUrl,
    gatewayHealthy,
    loggedIn,
    queueDepth,
    codexConfigured: codex.configured,
    codexHealthy:    codex.healthy,
    openrouterConfigured,
    spentUsd: cap.spentUsd,
    capUsd:   cap.capUsd,
    scope:    cap.scope,
  }

  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
