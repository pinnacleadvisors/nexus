/**
 * Per-business AI gateway config resolution.
 *
 * Layered fallback (in order of precedence):
 *   1. business_secrets   user_secrets row keyed by `kind = 'business:<slug>'`
 *   2. user default       `kind = 'claude-code'` (self-hosted Claude Code on Hostinger/Coolify, drains the Max plan)
 *   3. user default       `kind = 'openclaw'`    (legacy / fallback)
 *   4. environment        `CLAUDE_CODE_GATEWAY_URL` + `CLAUDE_CODE_BEARER_TOKEN`
 *   5. environment        `OPENCLAW_GATEWAY_URL`     + `OPENCLAW_BEARER_TOKEN`
 *
 * Claude Code is preferred because it's plan-billed (Max subscription) instead
 * of API-billed. OpenClaw is retained as a fallback even when no instance is
 * deployed — its presence in this chain is what makes the priority order
 * documented in AGENTS.md a one-line config change rather than a code edit.
 *
 * The returned BusinessClawConfig has a stable shape so dispatchToOpenClaw and
 * the /api/chat route can treat both gateways identically — both speak the
 * HMAC-signed POST /api/sessions/:id/messages protocol.
 *
 * Slug constraints mirror agent slugs in /api/claude-session/dispatch:
 * lowercase, hyphenated, max 60 chars. Validated by `isBusinessSlug`.
 */

import { getSecrets } from '@/lib/user-secrets'
import { createServerClient } from '@/lib/supabase'

export const BUSINESS_KIND_PREFIX = 'business:'

export interface BusinessClawConfig {
  gatewayUrl:    string
  bearerToken:   string
  modelAlias?:   string
  anthropicKey?: string
}

export function isBusinessSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)
}

export function businessKind(slug: string): string {
  return `${BUSINESS_KIND_PREFIX}${slug}`
}

export async function listBusinessSlugs(userId: string): Promise<string[]> {
  const db = createServerClient()
  if (!db) return []
  const { data } = await (db.from('user_secrets' as never) as unknown as {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        like: (c: string, v: string) => Promise<{ data: Array<{ kind: string }> | null }>
      }
    }
  }).select('kind').eq('user_id', userId).like('kind', `${BUSINESS_KIND_PREFIX}%`)

  const uniq = new Set<string>()
  for (const row of data ?? []) uniq.add(row.kind.slice(BUSINESS_KIND_PREFIX.length))
  return [...uniq].sort()
}

export async function getBusinessClawConfig(
  userId: string,
  slug: string,
): Promise<BusinessClawConfig | null> {
  if (!isBusinessSlug(slug)) return null
  const fields = await getSecrets(userId, businessKind(slug))
  if (!fields.gatewayUrl || !fields.bearerToken) return null
  return {
    gatewayUrl:   fields.gatewayUrl,
    bearerToken:  fields.bearerToken,
    modelAlias:   fields.modelAlias,
    anthropicKey: fields.anthropicKey,
  }
}

/**
 * Resolves the Claude Code self-hosted gateway only — used by callers that
 * specifically want the plan-billed path and intend to fall back themselves
 * when it's not available.
 */
export async function resolveClaudeCodeConfig(
  userId: string,
): Promise<BusinessClawConfig | null> {
  const userDefault = await getSecrets(userId, 'claude-code')
  if (userDefault.gatewayUrl && userDefault.bearerToken) {
    return {
      gatewayUrl:  userDefault.gatewayUrl,
      bearerToken: userDefault.bearerToken,
      modelAlias:  userDefault.modelAlias,
    }
  }
  const envUrl    = process.env.CLAUDE_CODE_GATEWAY_URL
  const envBearer = process.env.CLAUDE_CODE_BEARER_TOKEN
  if (envUrl && envBearer) {
    return { gatewayUrl: envUrl, bearerToken: envBearer }
  }
  return null
}

/**
 * Phase 6 — feature flag escape hatches for the per-business container rollout.
 *
 * `DISABLE_PER_BUSINESS_GATEWAY=1` globally disables business-scoped lookups
 * (force-falls-through to user defaults). For emergency rollback.
 *
 * `BUSINESS_GATEWAY_BYPASS_SLUGS=foo,bar` skips business secrets only for
 * the listed slugs — used during pilot rollouts to keep specific businesses
 * on the shared gateway while others are migrated.
 *
 * Both default OFF — when no business secrets exist for a slug, the resolver
 * already falls through to user defaults, so this matters only when a slug
 * HAS been provisioned and we want to ignore it temporarily.
 */
function shouldBypassBusinessGateway(slug: string): boolean {
  if (process.env.DISABLE_PER_BUSINESS_GATEWAY === '1') return true
  const list = process.env.BUSINESS_GATEWAY_BYPASS_SLUGS
  if (!list) return false
  return list.split(',').map(s => s.trim()).filter(Boolean).includes(slug)
}

export async function resolveClawConfig(
  userId: string,
  businessSlug?: string | null,
): Promise<BusinessClawConfig | null> {
  if (businessSlug && isBusinessSlug(businessSlug) && !shouldBypassBusinessGateway(businessSlug)) {
    const cfg = await getBusinessClawConfig(userId, businessSlug)
    if (cfg) return cfg
  }
  const claudeCode = await resolveClaudeCodeConfig(userId)
  if (claudeCode) return claudeCode

  const userDefault = await getSecrets(userId, 'openclaw')
  if (userDefault.gatewayUrl && userDefault.bearerToken) {
    return {
      gatewayUrl:  userDefault.gatewayUrl,
      bearerToken: userDefault.bearerToken,
      modelAlias:  userDefault.modelAlias,
    }
  }
  const envUrl    = process.env.OPENCLAW_GATEWAY_URL
  const envBearer = process.env.OPENCLAW_BEARER_TOKEN
  if (envUrl && envBearer) {
    // Phase 7c — env-only fallback is deprecated. Once every business has its
    // own provisioned container, this branch should be unreachable. Logging
    // here lets us spot lingering env-only callers before the env fallback
    // is removed.
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[business-client] resolveClawConfig falling through to env-only OPENCLAW_GATEWAY_URL — ' +
        'deprecated. Provision a per-business container or set business:<slug> secrets. ' +
        'See docs/runbooks/per-business-container-rollout.md.',
      )
    }
    return { gatewayUrl: envUrl, bearerToken: envBearer }
  }
  return null
}
