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
  /** V2 (PR #204+): live tool count from the gateway. null when probe
   *  failed, undefined when no probe was attempted (manifest-only render). */
  toolCount?:   number | null
  /** V2: live status from the gateway probe. undefined when no probe was
   *  attempted. */
  liveStatus?:  'ready' | 'timeout' | 'spawn_error' | 'protocol_error' | 'not-in-config'
  /** First N tool names — surfaces in the expanded detail row. */
  toolNames?:   string[]
  /** Live-status error message, for the expanded row. */
  liveError?:   string
}

export interface McpSummary {
  scope:        'platform' | { business: string }
  profile:      string          // 'admin' or the niche profile name
  entries:      McpSummaryEntry[]
  /** Bullet point the strip uses for the "live counts deferred" disclaimer. */
  note:         string
  /** V2 (this PR): whether live counts were merged. 'live' = gateway probe
   *  succeeded, 'manifest' = static manifest only (gateway unreachable). */
  source:       'live' | 'manifest'
  /** When source='manifest', the reason the gateway probe wasn't used. */
  liveError?:   string
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
    note:    'Manifested admin-scope MCPs.',
    source:  'manifest',
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
    note:    `Manifested ${m.profile} profile (${m.mcps.length} MCPs).`,
    source:  'manifest',
  }
}

/**
 * V2 (PR D V2): merge live tool counts from the gateway into a manifest-
 * derived summary. Idempotent — pass the manifest summary plus the
 * gateway reports and you get back a copy with toolCount + liveStatus
 * populated per entry.
 *
 * Entries in the manifest but missing from the live reports get
 * liveStatus='not-in-config' (the gateway's mcp.json doesn't list them
 * — usually a build-time / Doppler env issue).
 *
 * Entries in the live reports but not in the manifest are appended at
 * the end as 'admin-builtin' so the operator still sees them.
 */
export function mergeLiveMcpReports(
  summary: McpSummary,
  reports: Array<{
    id:                 string
    toolCount:          number | null
    toolNames:          string[]
    toolNamesTruncated: boolean
    status:             'ready' | 'timeout' | 'spawn_error' | 'protocol_error'
    error?:             string
  }>,
): McpSummary {
  const reportById = new Map(reports.map(r => [r.id, r]))
  const seenIds    = new Set<string>()

  const enrichedEntries: McpSummaryEntry[] = summary.entries.map(e => {
    seenIds.add(e.id)
    const r = reportById.get(e.id)
    if (!r) {
      return { ...e, liveStatus: 'not-in-config' as const }
    }
    return {
      ...e,
      toolCount:  r.toolCount,
      liveStatus: r.status,
      toolNames:  r.toolNames,
      liveError:  r.error,
    }
  })

  // MCPs the gateway has running but the manifest doesn't list (e.g. extra
  // hand-built admin servers that haven't been added to the lib catalog).
  for (const r of reports) {
    if (seenIds.has(r.id)) continue
    enrichedEntries.push({
      id:         r.id,
      name:       r.id,   // unknown display name — show id verbatim
      summary:    '(not in manifest — running in gateway only)',
      status:     'admin-builtin',
      envVars:    [],
      toolCount:  r.toolCount,
      liveStatus: r.status,
      toolNames:  r.toolNames,
      liveError:  r.error,
    })
  }

  const totalLive = reports.filter(r => r.status === 'ready')
    .reduce((sum, r) => sum + (r.toolCount ?? 0), 0)

  return {
    ...summary,
    entries: enrichedEntries,
    note:    `Live from gateway — ${reports.filter(r => r.status === 'ready').length}/${reports.length} probes ready · ${totalLive} tools total`,
    source:  'live',
  }
}
