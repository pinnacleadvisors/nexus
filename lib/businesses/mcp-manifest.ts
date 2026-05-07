/**
 * Per-business MCP manifest.
 *
 * Defines which MCP servers get pre-installed in each business's Coolify
 * container. Selected by niche / money-model so an ad-agency container ships
 * with Higgsfield + Runway preinstalled, a SaaS container with Sentry, etc.
 *
 * **Composio MCP covers most OAuth platforms.** The `composio` foundational
 * entry uses Composio's Rube MCP server which exposes 500+ toolkits (Twitter,
 * LinkedIn, Gmail, Slack, Notion, GitHub, Linear, Stripe, Shopify, Canva,
 * Google Analytics, etc.) through a single managed endpoint. Per-platform MCPs
 * are only needed for services Composio doesn't cover — which is mostly the
 * generative-media space (Higgsfield, Runway, Kling, MuAPI, ElevenLabs,
 * HeyGen) plus a handful of dev/observability tools.
 *
 * Used by:
 *   - services/claude-gateway/Dockerfile.business — reads MCP_PACKAGES at
 *     build time to choose which tarballs to npm-install
 *   - lib/coolify/client.ts — sends the resolved manifest as an env var when
 *     creating the per-business app
 *
 * To add a new MCP: append to MCP_CATALOG. To onboard a new niche: add to
 * NICHE_PROFILES.
 */

export interface McpEntry {
  id:    string
  name:  string
  /** npm package or local tarball path (the entrypoint script the CLI registers). */
  pkg:   string
  /** Env vars the MCP needs at runtime — must be supplied by Doppler. */
  env:   readonly string[]
  /** One-line summary used in the agent's tool budget. */
  summary: string
  /**
   * `verified` — package exists on npm and the env-var contract is confirmed.
   * `placeholder` — package name + env vars are best-guess; the operator must
   * verify and patch when first publishing.
   */
  status?: 'verified' | 'placeholder'
}

export const MCP_CATALOG: readonly McpEntry[] = [
  // ── Foundational — every container ships these ─────────────────────────
  {
    id: 'memory-hq',  name: 'Memory HQ',  pkg: '@nexus/mcp-memory-hq',
    env: ['MEMORY_HQ_TOKEN', 'MEMORY_HQ_REPO'],
    summary: 'Atoms / entities / MOCs in pinnacleadvisors/memory-hq',
    status: 'placeholder',
  },
  {
    id: 'firecrawl', name: 'Firecrawl', pkg: '@nexus/mcp-firecrawl',
    env: ['FIRECRAWL_API_KEY'],
    summary: 'Token-free web scrape / map / crawl',
    status: 'placeholder',
  },
  {
    id: 'n8n', name: 'n8n', pkg: 'n8n-mcp',
    env: ['N8N_BASE_URL', 'N8N_API_KEY'],
    summary: 'n8n workflow CRUD + node schema lookup',
    status: 'verified',
  },
  {
    // Single MCP that covers every OAuth platform in lib/oauth/providers.ts.
    // Auth Configs created by scripts/sync-composio-auth-configs.ts; per-user
    // connections live in connected_accounts.composio_account_id. The agent
    // calls these through Rube without each platform needing its own MCP.
    id: 'composio', name: 'Composio (Rube)', pkg: '@composio/rube-mcp',
    env: ['COMPOSIO_API_KEY', 'COMPOSIO_USER_ID'],
    summary: '500+ OAuth apps via Composio — Twitter, LinkedIn, Gmail, Slack, Notion, GitHub, Linear, Stripe, Shopify, Canva, Google Analytics, …',
    status: 'verified',
  },

  // ── Generative media (Composio doesn't cover these) ────────────────────
  {
    id: 'higgsfield', name: 'Higgsfield', pkg: '@nexus/mcp-higgsfield',
    env: ['HIGGSFIELD_API_KEY'],
    summary: 'Cinematic AI video generation',
    status: 'placeholder',
  },
  {
    id: 'runway', name: 'Runway', pkg: '@nexus/mcp-runway',
    env: ['RUNWAY_API_KEY'],
    summary: 'Stylised AI video generation',
    status: 'placeholder',
  },
  {
    id: 'kling', name: 'Kling', pkg: '@nexus/mcp-kling',
    env: ['KLING_API_KEY'],
    summary: 'Cinematic AI video generation (alt)',
    status: 'placeholder',
  },
  {
    id: 'muapi-ai', name: 'MuAPI.ai', pkg: '@nexus/mcp-muapi-ai',
    env: ['MUAPI_AI_KEY'],
    summary: 'AI scene image generation',
    status: 'placeholder',
  },
  {
    id: 'elevenlabs', name: 'ElevenLabs', pkg: '@nexus/mcp-elevenlabs',
    env: ['ELEVENLABS_API_KEY'],
    summary: 'AI voiceover synthesis',
    status: 'placeholder',
  },
  {
    id: 'heygen', name: 'HeyGen', pkg: '@nexus/mcp-heygen',
    env: ['HEYGEN_API_KEY'],
    summary: 'UGC / avatar video',
    status: 'placeholder',
  },

  // ── Specialised non-Composio tools ─────────────────────────────────────
  {
    id: 'sentry', name: 'Sentry', pkg: '@sentry/mcp-server',
    env: ['SENTRY_AUTH_TOKEN'],
    summary: 'Error tracking + performance',
    status: 'placeholder',
  },
  {
    id: 'tavily', name: 'Tavily', pkg: '@nexus/mcp-tavily',
    env: ['TAVILY_API_KEY'],
    summary: 'Live web search (deeper than Composio coverage)',
    status: 'placeholder',
  },
  {
    id: 'supabase', name: 'Supabase', pkg: '@supabase/mcp-server-supabase',
    env: ['SUPABASE_ACCESS_TOKEN'],
    summary: 'Project CRUD, schema introspection, edge functions',
    status: 'placeholder',
  },
] as const

/**
 * Niche profiles map a business's `niche` field to a curated MCP set.
 * Profiles only need to list the SPECIALISED add-ons — every container also
 * gets the FOUNDATIONAL set (which already includes Composio for all OAuth
 * platforms).
 *
 * Niches are matched case-insensitively and may be substrings ("agency"
 * matches "ad agency").
 */
export interface NicheProfile {
  niche:   string
  match:   readonly string[]  // substrings to match in business.niche or money_model
  mcps:    readonly string[]  // MCP IDs to install (in addition to foundational)
}

const FOUNDATIONAL = ['memory-hq', 'firecrawl', 'n8n', 'composio']

export const NICHE_PROFILES: readonly NicheProfile[] = [
  // Heavy creative output — video + image generation
  { niche: 'ad-agency',         match: ['ad agency', 'advertising', 'marketing agency'],
    mcps: ['higgsfield', 'runway', 'muapi-ai', 'elevenlabs', 'tavily'] },

  { niche: 'creator',           match: ['creator', 'influencer', 'youtuber', 'streamer'],
    mcps: ['higgsfield', 'kling', 'elevenlabs', 'heygen'] },

  // Digital products + ecommerce — rely heavily on product imagery + research
  { niche: 'ecommerce',         match: ['ecommerce', 'e-commerce', 'shop', 'store', 'dropshipping'],
    mcps: ['muapi-ai', 'tavily'] },

  { niche: 'digital-products',  match: ['etsy', 'printable', 'template', 'organizer', 'contract bundle', 'digital product'],
    mcps: ['muapi-ai', 'tavily'] },

  // SaaS — needs deep observability + research
  { niche: 'saas',              match: ['saas', 'software', 'b2b'],
    mcps: ['sentry', 'tavily', 'supabase'] },

  // Content-heavy (blogs, newsletters)
  { niche: 'content',           match: ['content', 'blog', 'newsletter', 'media'],
    mcps: ['tavily', 'elevenlabs'] },

  // Pure dev tooling
  { niche: 'developer',         match: ['developer', 'dev tools', 'open source'],
    mcps: ['sentry', 'supabase'] },
] as const

const DEFAULT_PROFILE = ['tavily']

export interface ResolvedManifest {
  profile:    string
  mcpIds:     string[]
  /** Full McpEntry rows for the resolved IDs, including foundational. */
  mcps:       McpEntry[]
  /** Union of every env var any of the resolved MCPs declare. Container build sources these from Doppler. */
  envVars:    string[]
}

export function resolveManifest(input: { niche?: string | null; moneyModel?: string | null }): ResolvedManifest {
  const haystack = [input.niche, input.moneyModel].filter(Boolean).join(' ').toLowerCase()
  const profile = haystack
    ? NICHE_PROFILES.find(p => p.match.some(m => haystack.includes(m.toLowerCase())))
    : undefined

  const profileMcps = profile?.mcps ?? DEFAULT_PROFILE
  const allIds = [...new Set([...FOUNDATIONAL, ...profileMcps])]

  const mcps = allIds
    .map(id => MCP_CATALOG.find(m => m.id === id))
    .filter((m): m is McpEntry => Boolean(m))

  const envVars = [...new Set(mcps.flatMap(m => m.env))].sort()

  return {
    profile:  profile?.niche ?? 'default',
    mcpIds:   allIds,
    mcps,
    envVars,
  }
}

/** For docs / debugging — show what installs for a given niche. */
export function describeManifest(niche: string | null): string {
  const r = resolveManifest({ niche })
  return `${r.profile} (${r.mcpIds.length} MCPs): ${r.mcpIds.join(', ')}\n` +
         `Env: ${r.envVars.join(', ')}`
}
