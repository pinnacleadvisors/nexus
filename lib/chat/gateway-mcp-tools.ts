/**
 * gateway-mcp-tools — fetch live MCP tool counts from the claude-gateway's
 * /admin/mcp-tools endpoint.
 *
 * Powers V2 of the chat MCP awareness strip (audit 2026-05-16 §6.6).
 * V1 (PR #202) shows the static manifest. V2 enriches each entry with
 * live `toolCount` + `liveStatus` when the gateway is reachable. Gateway
 * unreachable → callers fall back to manifest-only (graceful degrade).
 *
 * The fetcher resolves the gateway via `resolveClawConfig(userId, slug)`
 * — same chain the chat dispatch uses — so platform scope hits the admin
 * gateway and business scope hits the per-business gateway.
 *
 * 5 s timeout per call. The gateway-side cache is 5 min, so re-fetches are
 * cheap when the cache is warm and bounded when it isn't.
 */

import { resolveClawConfig } from '@/lib/claw/business-client'

export interface McpToolReport {
  id:                 string
  toolCount:          number | null
  toolNames:          string[]
  toolNamesTruncated: boolean
  status:             'ready' | 'timeout' | 'spawn_error' | 'protocol_error'
  error?:             string
  durationMs:         number
}

interface GatewayOkResp  { ok: true;  reports: McpToolReport[] }
interface GatewayErrResp { ok: false; error: string }

export interface LiveProbeResult {
  /** When the gateway returned a result. */
  reports?: McpToolReport[]
  /** When the gateway was unreachable / unauth'd / errored. UI falls back
   *  to manifest-only display. */
  error?:   string
}

export async function fetchLiveMcpTools(input: {
  userId:        string
  businessSlug?: string | null
}): Promise<LiveProbeResult> {
  const cfg = await resolveClawConfig(input.userId, input.businessSlug ?? null)
  if (!cfg) return { error: 'no gateway configured for this scope' }

  const url = `${cfg.gatewayUrl.replace(/\/+$/, '')}/admin/mcp-tools`
  try {
    const res = await fetch(url, {
      method:  'GET',
      headers: {
        'authorization':   `Bearer ${cfg.bearerToken}`,
        'x-nexus-user-id': input.userId,
      },
      // 5 s ceiling — gateway-side probe already caches for 5 min, so a slow
      // first hit is the worst case. AGENTS.md retry-storm rule.
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) {
      return { error: `gateway HTTP ${res.status}` }
    }
    const json = (await res.json()) as GatewayOkResp | GatewayErrResp
    if (!json.ok) return { error: json.error }
    return { reports: json.reports }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'gateway fetch failed' }
  }
}
