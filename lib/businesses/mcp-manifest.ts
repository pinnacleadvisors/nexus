/**
 * Per-business MCP manifest.
 *
 * Defines which MCP servers + Composio integrations get pre-installed in each
 * business's Coolify container. Selected by niche / money-model so an ad-agency
 * container ships with Higgsfield + Canva preinstalled, a SaaS container with
 * Linear + GitHub, etc.
 *
 * Used by:
 *   - services/claude-gateway/Dockerfile.business — reads MCP_MANIFEST_JSON at
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
}

export const MCP_CATALOG: readonly McpEntry[] = [
  // Foundational — every container ships these.
  { id: 'memory-hq',    name: 'Memory HQ',     pkg: '@nexus/mcp-memory-hq',    env: ['MEMORY_HQ_TOKEN', 'MEMORY_HQ_REPO'], summary: 'Atoms / entities / MOCs in pinnacleadvisors/memory-hq' },
  { id: 'firecrawl',    name: 'Firecrawl',     pkg: '@nexus/mcp-firecrawl',    env: ['FIRECRAWL_API_KEY'],                summary: 'Token-free web scrape / map / crawl' },
  { id: 'n8n',          name: 'n8n',           pkg: '@nexus/mcp-n8n',          env: ['N8N_BASE_URL', 'N8N_API_KEY'],      summary: 'n8n workflow CRUD + node schema lookup' },

  // Creative / design
  { id: 'canva',        name: 'Canva',         pkg: '@nexus/mcp-canva',        env: ['CANVA_API_KEY'],                    summary: 'Canva design create / export' },
  { id: 'higgsfield',   name: 'Higgsfield',    pkg: '@nexus/mcp-higgsfield',   env: ['HIGGSFIELD_API_KEY'],               summary: 'Cinematic AI video generation' },
  { id: 'runway',       name: 'Runway',        pkg: '@nexus/mcp-runway',       env: ['RUNWAY_API_KEY'],                   summary: 'Stylised AI video generation' },
  { id: 'kling',        name: 'Kling',         pkg: '@nexus/mcp-kling',        env: ['KLING_API_KEY'],                    summary: 'Cinematic AI video generation (alt)' },
  { id: 'muapi-ai',     name: 'MuAPI.ai',      pkg: '@nexus/mcp-muapi-ai',     env: ['MUAPI_AI_KEY'],                     summary: 'AI scene image generation' },
  { id: 'elevenlabs',   name: 'ElevenLabs',    pkg: '@nexus/mcp-elevenlabs',   env: ['ELEVENLABS_API_KEY'],               summary: 'AI voiceover synthesis' },
  { id: 'heygen',       name: 'HeyGen',        pkg: '@nexus/mcp-heygen',       env: ['HEYGEN_API_KEY'],                   summary: 'UGC / avatar video' },

  // Developer
  { id: 'github',       name: 'GitHub',        pkg: '@modelcontextprotocol/server-github',  env: ['GITHUB_PERSONAL_ACCESS_TOKEN'], summary: 'Repos, issues, PRs, files' },
  { id: 'linear',       name: 'Linear',        pkg: '@modelcontextprotocol/server-linear',  env: ['LINEAR_API_KEY'],               summary: 'Issues, projects, cycles' },
  { id: 'sentry',       name: 'Sentry',        pkg: '@nexus/mcp-sentry',                    env: ['SENTRY_AUTH_TOKEN'],            summary: 'Error tracking + performance' },

  // Commerce
  { id: 'stripe',       name: 'Stripe',        pkg: '@nexus/mcp-stripe',       env: ['STRIPE_SECRET_KEY'],                summary: 'Customers, payments, invoices' },
  { id: 'shopify',      name: 'Shopify',       pkg: '@nexus/mcp-shopify',      env: ['SHOPIFY_API_KEY', 'SHOPIFY_STORE'], summary: 'Products, orders, fulfilment' },

  // Analytics
  { id: 'tavily',       name: 'Tavily',        pkg: '@nexus/mcp-tavily',       env: ['TAVILY_API_KEY'],                   summary: 'Live web search' },
  { id: 'google-analytics', name: 'GA',        pkg: '@nexus/mcp-ga',           env: ['GA_SERVICE_ACCOUNT_JSON'],          summary: 'Property reports + realtime' },
] as const

/**
 * Niche profiles map a business's `niche` field to a curated MCP set.
 * Catch-all is "default". Niches are matched case-insensitively and may
 * be substrings ("ad-agency" matches "agency").
 */
export interface NicheProfile {
  niche:   string
  match:   readonly string[]  // substrings to match in business.niche or money_model
  mcps:    readonly string[]  // MCP IDs to install (in addition to foundational)
}

const FOUNDATIONAL = ['memory-hq', 'firecrawl', 'n8n']

export const NICHE_PROFILES: readonly NicheProfile[] = [
  { niche: 'ad-agency',     match: ['ad agency', 'advertising', 'marketing agency'],
    mcps: ['canva', 'higgsfield', 'runway', 'muapi-ai', 'elevenlabs', 'tavily'] },

  { niche: 'creator',       match: ['creator', 'influencer', 'youtuber', 'streamer'],
    mcps: ['canva', 'higgsfield', 'kling', 'elevenlabs', 'heygen'] },

  { niche: 'ecommerce',     match: ['ecommerce', 'e-commerce', 'shop', 'store', 'dropshipping'],
    mcps: ['shopify', 'stripe', 'canva', 'muapi-ai', 'google-analytics'] },

  { niche: 'saas',          match: ['saas', 'software', 'b2b'],
    mcps: ['github', 'linear', 'stripe', 'sentry', 'tavily', 'google-analytics'] },

  { niche: 'content',       match: ['content', 'blog', 'newsletter', 'media'],
    mcps: ['canva', 'tavily', 'elevenlabs'] },

  { niche: 'developer',     match: ['developer', 'dev tools', 'open source'],
    mcps: ['github', 'linear', 'sentry'] },
] as const

const DEFAULT_PROFILE = ['canva', 'tavily']

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
