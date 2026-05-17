/**
 * MCP summary — which MCP servers are mounted for a given chat scope.
 *
 * Addresses the 2026-05-16 audit (Section 6 #6) — the operator should see
 * what's powering the chat BEFORE typing. V1 returns the MANIFESTED MCP set
 * (what should be mounted based on static config) plus the gateway's
 * overall health. V2 (deferred) wires a real list_tools count per MCP via
 * a gateway-side endpoint.
 *
 * Two scopes:
 *   - 'platform' → the admin claude-gateway's MCP set (composio-admin,
 *     memory-hq, codex-delegate, permission-broker, coolify) — mirrors
 *     services/claude-gateway/entrypoint.sh `build_mcp_block`.
 *   - { business: <slug> } → the per-business container's MCP set from
 *     resolveManifest({ niche, moneyModel }).
 */

import { resolveManifest, type McpEntry } from '@/lib/businesses/mcp-manifest'

export interface McpSummaryEntry {
  id:           string
  name:         string
  summary:      string
  /** 'verified' MCPs are confirmed to install + run. 'placeholder' means the
   *  package name + env vars are best-guess until the operator first builds.
   *  'admin-builtin' is for the gateway's hand-built MCPs (composio-admin etc.)
   *  which don't appear in the per-business catalog. */
  status:       'verified' | 'placeholder' | 'admin-builtin'
  /** The runtime env vars the MCP needs to function — useful for the operator
   *  to debug a "tool not found" by checking Doppler scope. */
  envVars:      readonly string[]
}

export interface McpSummary {
  scope:        'platform' | { business: string }
  profile:      string          // 'admin' or the niche profile name
  entries:      McpSummaryEntry[]
  /** Bullet point the strip uses for the "live counts deferred" disclaimer. */
  note:         string
}

/**
 * Admin gateway's hand-built MCPs. Order here drives display order. Each
 * entry mirrors a JSON block in services/claude-gateway/entrypoint.sh
 * `build_mcp_block`. When that script gains or drops a server, update here.
 */
const ADMIN_BUILTIN: readonly McpSummaryEntry[] = [
  {
    id:      'composio-admin',
    name:    'Composio (admin)',
    summary: '500+ OAuth apps via hard-isolation wrapper — Vercel, GitHub, Slack, Stripe, Shopify, Canva, …',
    status:  'admin-builtin',
    envVars: ['COMPOSIO_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
  },
  {
    id:      'memory-hq',
    name:    'Memory HQ',
    summary: 'Atoms / entities / MOCs in pinnacleadvisors/memory-hq',
    status:  'admin-builtin',
    envVars: ['MEMORY_HQ_TOKEN', 'NEXUS_BASE_URL'],
  },
  {
    id:      'codex-delegate',
    name:    'Codex delegate',
    summary: 'Hand-off to GPT-5.5 codex-gateway for execution-heavy work (debugging, container setup, smoke tests)',
    status:  'admin-builtin',
    envVars: ['CODEX_GATEWAY_URL', 'CODEX_GATEWAY_BEARER_TOKEN'],
  },
  {
    id:      'permission-broker',
    name:    'Permission broker',
    summary: 'Surfaces Allow/Deny cards in chat instead of failing on unknown CLI tool perms',
    status:  'admin-builtin',
    envVars: ['SUPABASE_SERVICE_ROLE_KEY'],
  },
  {
    id:      'coolify',
    name:    'Coolify',
    summary: 'Coolify v4 REST API — list apps, redeploy, logs, env. Scope-aware (PR #193).',
    status:  'admin-builtin',
    envVars: ['COOLIFY_KVM4_URL', 'COOLIFY_KVM4_API_TOKEN'],
  },
]

/**
 * Resolve the MCP summary for the platform/admin chat scope.
 */
export function getPlatformMcpSummary(): McpSummary {
  return {
    scope:   'platform',
    profile: 'admin',
    entries: [...ADMIN_BUILTIN],
    note:    'Manifested admin-scope MCPs. Live tool counts deferred to V2 (needs gateway list_tools endpoint).',
  }
}

/**
 * Resolve the MCP summary for a per-business chat scope. Pulls from the
 * static `resolveManifest()` machinery used at container-build time, so
 * the answer here matches what `npm install` actually ran inside the
 * business's Coolify container.
 */
export function getBusinessMcpSummary(input: {
  slug:       string
  niche?:     string | null
  moneyModel?: string | null
}): McpSummary {
  const m = resolveManifest({ niche: input.niche, moneyModel: input.moneyModel })
  const entries: McpSummaryEntry[] = m.mcps.map((e: McpEntry) => ({
    id:      e.id,
    name:    e.name,
    summary: e.summary,
    status:  e.status ?? 'placeholder',
    envVars: e.env,
  }))
  return {
    scope:   { business: input.slug },
    profile: m.profile,
    entries,
    note:    `Manifested ${m.profile} profile (${m.mcps.length} MCPs). Live tool counts deferred to V2.`,
  }
}
