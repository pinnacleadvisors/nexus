/**
 * OAuth provider registry.
 *
 * Single source of truth for which third-party platforms Nexus can connect to
 * via Composio. To add a new platform:
 *   1. Verify Composio supports it (https://app.composio.dev/toolkits)
 *   2. Add a row below using the canonical `toolkitSlug` from Composio's catalog
 *      (uppercase, snake_case — what shows in `composio toolkits list`)
 *   3. Create an Auth Config in the Composio dashboard for that toolkit
 *   4. Set env var `COMPOSIO_AUTH_CONFIG_<TOOLKIT_SLUG>` with the auth_config_id
 *   5. Settings → Accounts UI lights up automatically
 *
 * Action enum names follow Composio's APP_VERB_NOUN convention. They were
 * renamed across 1545 tools in 2026 — verify each against the live toolkit
 * page (https://docs.composio.dev/toolkits/<slug>) when adding new actions.
 */

export type OAuthCategory =
  | 'social'
  | 'email'
  | 'productivity'
  | 'communication'
  | 'storage'
  | 'developer'
  | 'analytics'
  | 'crm'
  | 'commerce'
  | 'design'

export interface OAuthProvider {
  /** URL-safe slug used as the `platform` column in connected_accounts. */
  id: string
  /** Display name in the UI. */
  name: string
  /** Composio toolkit slug — uppercase canonical (e.g. TWITTER, LINKEDIN, GMAIL). */
  toolkitSlug: string
  category: OAuthCategory
  /** Path to a logo asset under /public, or an emoji fallback. */
  logo: string
  /** Composio action slugs the agent layer can invoke once connected. */
  actions: readonly string[]
  /** Optional. When set, only businesses with these niches will see it featured. */
  featuredFor?: readonly string[]
  /**
   * When set, the auth-config-sync script SKIPS this toolkit. The operator must
   * create the Auth Config manually in app.composio.dev because the toolkit
   * needs credentials Composio can't broker (own OAuth app, API key, …).
   */
  manualSetup?: {
    /** Why automation can't handle this. Surfaced in script output + UI. */
    reason: string
    /** Where the operator gets the credentials they'll paste into Composio. */
    credentialsUrl?: string
  }
  /**
   * When set, this platform is **not** brokered through Composio at all — it
   * uses a static API key the operator pastes per business. Settings → Accounts
   * renders an inline paste form (POST /api/connected-accounts/api-key) instead
   * of the OAuth "Connect" button. The key is encrypted with ENCRYPTION_KEY
   * (lib/crypto.ts) and stored on `connected_accounts.encrypted_api_key`.
   *
   * Use for any vendor that lacks OAuth / a Composio toolkit but exposes a
   * REST API: ConvertKit, Cloudflare DNS, Beehiiv, MailerLite, etc. The
   * provision route walks `requiredEnv` per manifest and injects the decrypted
   * key into the per-business container as the named env var.
   */
  apiKeySetup?: {
    /** Short human-readable steps for finding the key. */
    instructions?: string
    /** Direct link to the dashboard page where the key is generated. */
    credentialsUrl?: string
    /**
     * Container env-var name the decrypted key gets injected as at provision
     * time. Must match the manifest's `requiredEnv` entry (profile-level OR
     * MCP-level) so the per-business container starts with the right secret in
     * env. The provision route walks `manifest.requiredEnv` and reverse-maps
     * each name to its provider via this field.
     *
     * Example: `convertkit` → `CONVERTKIT_API_KEY`; `cloudflare-dns` →
     * `CLOUDFLARE_API_TOKEN`. Without this field the provision route can't
     * locate the per-business stored key for the env var.
     */
    envVar?: string
  }
  /**
   * Sharing policy for connected_accounts. Drives UI guidance + helps reviewers
   * spot bad ideas (sharing a Stripe account commingles funds, sharing a
   * Higgsfield API key just shares quota).
   */
  sharePolicy?: 'shareable' | 'per-business'
}

export const OAUTH_PROVIDERS: readonly OAuthProvider[] = [
  // ── Social ──────────────────────────────────────────────────────────────
  {
    id: 'twitter',
    name: 'X (Twitter)',
    toolkitSlug: 'TWITTER',
    category: 'social',
    logo: '/logos/twitter.svg',
    actions: [
      'TWITTER_CREATION_OF_A_POST',
      'TWITTER_POST_DELETE_BY_POST_ID',
      'TWITTER_POST_LOOKUP_BY_POST_ID',
      'TWITTER_RECENT_SEARCH',
      'TWITTER_FOLLOW_USER',
    ],
    featuredFor: ['marketing', 'content', 'agency'],
    sharePolicy: 'per-business',
    manualSetup: {
      reason: 'Composio managed credentials for Twitter were removed 2026-02-12. Provide your own OAuth client_id + client_secret + bearer token from developer.twitter.com.',
      credentialsUrl: 'https://developer.twitter.com/en/portal/dashboard',
    },
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    toolkitSlug: 'LINKEDIN',
    category: 'social',
    logo: '/logos/linkedin.svg',
    actions: [
      'LINKEDIN_CREATE_LINKED_IN_POST',
      'LINKEDIN_GET_MY_INFO',
      'LINKEDIN_GET_COMPANY_INFO',
    ],
    featuredFor: ['b2b', 'saas', 'agency'],
    sharePolicy: 'per-business',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    toolkitSlug: 'INSTAGRAM',
    category: 'social',
    logo: '/logos/instagram.svg',
    actions: [
      'INSTAGRAM_CREATE_MEDIA_OBJECT',
      'INSTAGRAM_PUBLISH_MEDIA',
      'INSTAGRAM_GET_USER_MEDIA',
    ],
    featuredFor: ['ecommerce', 'creator', 'agency'],
    sharePolicy: 'per-business',
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    toolkitSlug: 'TIKTOK',
    category: 'social',
    logo: '/logos/tiktok.svg',
    actions: [
      'TIKTOK_VIDEO_PUBLISH_INIT',
      'TIKTOK_GET_VIDEO_LIST',
    ],
    featuredFor: ['creator', 'ecommerce'],
    sharePolicy: 'per-business',
    manualSetup: {
      reason: 'TikTok requires your own developer app + client_key + client_secret in Composio.',
      credentialsUrl: 'https://developers.tiktok.com/apps',
    },
  },
  {
    id: 'youtube',
    name: 'YouTube',
    toolkitSlug: 'YOUTUBE',
    category: 'social',
    logo: '/logos/youtube.svg',
    actions: [
      'YOUTUBE_VIDEOS_INSERT',
      'YOUTUBE_VIDEOS_UPDATE',
      'YOUTUBE_VIDEOS_LIST',
    ],
    featuredFor: ['creator', 'content'],
    sharePolicy: 'per-business',
  },

  // ── Email ───────────────────────────────────────────────────────────────
  {
    id: 'gmail',
    name: 'Gmail',
    toolkitSlug: 'GMAIL',
    category: 'email',
    logo: '/logos/gmail.svg',
    actions: [
      'GMAIL_SEND_EMAIL',
      'GMAIL_REPLY_TO_THREAD',
      'GMAIL_FETCH_EMAILS',
      'GMAIL_CREATE_EMAIL_DRAFT',
    ],
    sharePolicy: 'per-business',
  },
  {
    id: 'outlook',
    name: 'Outlook',
    toolkitSlug: 'OUTLOOK',
    category: 'email',
    logo: '/logos/outlook.svg',
    actions: [
      'OUTLOOK_OUTLOOK_SEND_EMAIL',
      'OUTLOOK_OUTLOOK_LIST_MESSAGES',
      'OUTLOOK_OUTLOOK_CREATE_DRAFT',
    ],
    sharePolicy: 'per-business',
  },
  {
    // Non-Composio API-key platform. ConvertKit (recently rebranded "Kit") V4
    // API uses a per-account bearer token; the agent calls REST directly. Key
    // is stored encrypted on the connected_accounts row (apiKeySetup pattern)
    // and injected as CONVERTKIT_API_KEY at provision time per business.
    id: 'convertkit',
    name: 'ConvertKit (Kit)',
    toolkitSlug: 'CONVERTKIT', // unused — not a Composio toolkit. Kept for shape compat.
    category: 'email',
    logo: '/logos/convertkit.svg',
    actions: [],
    featuredFor: ['creator', 'content', 'marketing'],
    sharePolicy: 'per-business',
    apiKeySetup: {
      instructions: 'ConvertKit dashboard → Settings → Advanced → API & Webhooks → V4 API Keys → Create new key. Paste the secret token below.',
      credentialsUrl: 'https://app.convertkit.com/account_settings/advanced_settings',
      envVar: 'CONVERTKIT_API_KEY',
    },
  },

  // ── Communication ───────────────────────────────────────────────────────
  {
    id: 'slack',
    name: 'Slack',
    toolkitSlug: 'SLACK',
    category: 'communication',
    logo: '/logos/slack.svg',
    actions: [
      'SLACK_SEND_MESSAGE_TO_A_CHANNEL',
      'SLACK_CREATE_A_NEW_CONVERSATION',
      'SLACK_LIST_ALL_CHANNELS',
    ],
    sharePolicy: 'per-business',
  },
  {
    id: 'discord',
    name: 'Discord',
    toolkitSlug: 'DISCORD',
    category: 'communication',
    logo: '/logos/discord.svg',
    actions: [
      'DISCORD_SEND_MESSAGE_TO_CHANNEL',
      'DISCORD_CREATE_THREAD',
    ],
    featuredFor: ['creator', 'community'],
    sharePolicy: 'per-business',
  },

  // ── Productivity ────────────────────────────────────────────────────────
  {
    id: 'notion',
    name: 'Notion',
    toolkitSlug: 'NOTION',
    category: 'productivity',
    logo: '/logos/notion.svg',
    actions: [
      'NOTION_CREATE_NOTION_PAGE',
      'NOTION_UPDATE_PAGE',
      'NOTION_QUERY_DATABASE',
    ],
    sharePolicy: 'per-business',
  },
  {
    id: 'google_docs',
    name: 'Google Docs',
    toolkitSlug: 'GOOGLEDOCS',
    category: 'productivity',
    logo: '/logos/google-docs.svg',
    actions: [
      'GOOGLEDOCS_CREATE_DOCUMENT',
      'GOOGLEDOCS_GET_DOCUMENT_BY_ID',
      'GOOGLEDOCS_UPDATE_EXISTING_DOCUMENT',
    ],
    sharePolicy: 'per-business',
  },
  {
    id: 'google_sheets',
    name: 'Google Sheets',
    toolkitSlug: 'GOOGLESHEETS',
    category: 'productivity',
    logo: '/logos/google-sheets.svg',
    actions: [
      'GOOGLESHEETS_BATCH_UPDATE',
      'GOOGLESHEETS_GET_SPREADSHEET_INFO',
      'GOOGLESHEETS_INSERT_DIMENSION',
    ],
    sharePolicy: 'per-business',
  },

  // ── Developer ───────────────────────────────────────────────────────────
  {
    id: 'github',
    name: 'GitHub',
    toolkitSlug: 'GITHUB',
    category: 'developer',
    logo: '/logos/github.svg',
    actions: [
      'GITHUB_CREATE_AN_ISSUE',
      'GITHUB_CREATE_A_PULL_REQUEST',
      'GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER',
    ],
    featuredFor: ['saas', 'developer'],
    sharePolicy: 'per-business',
  },
  {
    id: 'linear',
    name: 'Linear',
    toolkitSlug: 'LINEAR',
    category: 'developer',
    logo: '/logos/linear.svg',
    actions: [
      'LINEAR_CREATE_LINEAR_ISSUE',
      'LINEAR_UPDATE_AN_EXISTING_ISSUE',
      'LINEAR_LIST_LINEAR_ISSUES',
    ],
    featuredFor: ['saas', 'developer'],
    sharePolicy: 'per-business',
  },
  {
    // Non-Composio API-key platform. Cloudflare's official DNS MCP authenticates
    // via a zone-scoped API token (no IP allowlist), making it usable from any
    // per-business container. Key is injected as CLOUDFLARE_API_TOKEN at
    // provision time. Per-domain tokens are recommended — one row per
    // (business, zone) so revoking one domain doesn't bring down others.
    id: 'cloudflare-dns',
    name: 'Cloudflare DNS',
    toolkitSlug: 'CLOUDFLARE', // unused — not a Composio toolkit. Kept for shape compat.
    category: 'developer',
    logo: '/logos/cloudflare.svg',
    actions: [],
    featuredFor: ['saas', 'ecommerce', 'creator', 'agency'],
    sharePolicy: 'per-business',
    apiKeySetup: {
      instructions: 'Cloudflare dashboard → My Profile → API Tokens → Create Token → use the "Edit zone DNS" template. Restrict to the specific zone(s) this business owns. Copy the secret token (only shown once) and paste below.',
      credentialsUrl: 'https://dash.cloudflare.com/profile/api-tokens',
      envVar: 'CLOUDFLARE_API_TOKEN',
    },
  },
  {
    // Vercel is **shareable** — one Pro team subscription covers every
    // business. Per-business UX isolation is achieved via separate Vercel
    // *projects* under the same team (one project per business; custom
    // domain attached at the project level — visitors only see the business
    // brand, never the parent team identity). Connect once at Default scope.
    // The provision route falls back to the user-default row when no
    // per-business connected_accounts row exists (see provision/route.ts
    // fetchDecryptedApiKey).
    //
    // Vercel uses bearer API tokens, not OAuth — apiKeySetup pattern.
    // Tokens are scoped to the team; create one at /account/tokens and
    // restrict its scope to the team if you operate multiple teams.
    id: 'vercel',
    name: 'Vercel',
    toolkitSlug: 'VERCEL', // unused — not a Composio toolkit. Kept for shape compat.
    category: 'developer',
    logo: '/logos/vercel.svg',
    actions: [],
    featuredFor: ['saas', 'ecommerce', 'creator', 'agency'],
    sharePolicy: 'shareable',
    apiKeySetup: {
      instructions: 'Vercel dashboard → Account Settings → Tokens → Create Token. Set scope to your team (not "Personal Account") so the agent can deploy to per-business projects under that team. Copy the token immediately — Vercel only shows it once.',
      credentialsUrl: 'https://vercel.com/account/tokens',
      envVar: 'VERCEL_TOKEN',
    },
  },

  // ── Commerce ────────────────────────────────────────────────────────────
  {
    // Stripe is **shareable** — connect once at Default scope and reuse the
    // single account across every business. Per-business UX isolation is
    // achieved via Stripe primitives, not separate accounts:
    //   - Each business owns its own Products / Prices, all tagged with
    //     metadata.business_slug for revenue attribution
    //   - Statement descriptor on the PaymentIntent is set to the business
    //     brand so the customer's bank statement reads "<Brand>" not the
    //     parent account name
    //   - Webhooks are filtered server-side by metadata.business_slug
    // See docs/runbooks/shared-stripe-vercel.md for the full attribution
    // pattern + agent-side rules. Agents MUST set metadata.business_slug
    // on every Customer / Product / Price / PaymentIntent they create.
    id: 'stripe',
    name: 'Stripe',
    toolkitSlug: 'STRIPE',
    category: 'commerce',
    logo: '/logos/stripe.svg',
    actions: [
      'STRIPE_LIST_ALL_CUSTOMERS',
      'STRIPE_CREATE_A_PAYMENT_LINK',
      'STRIPE_LIST_ALL_INVOICES',
    ],
    featuredFor: ['saas', 'ecommerce'],
    sharePolicy: 'shareable',
  },
  {
    id: 'shopify',
    name: 'Shopify',
    toolkitSlug: 'SHOPIFY',
    category: 'commerce',
    logo: '/logos/shopify.svg',
    actions: [
      'SHOPIFY_CREATE_A_NEW_PRODUCT',
      'SHOPIFY_RETRIEVE_A_LIST_OF_ORDERS',
      'SHOPIFY_UPDATE_AN_EXISTING_PRODUCT',
    ],
    featuredFor: ['ecommerce'],
    sharePolicy: 'per-business',
    manualSetup: {
      reason: 'Shopify auth needs the shop subdomain + your custom app credentials (admin API access token).',
      credentialsUrl: 'https://help.shopify.com/en/manual/apps/app-types/custom-apps',
    },
  },

  // ── Design / Creative ───────────────────────────────────────────────────
  {
    id: 'canva',
    name: 'Canva',
    toolkitSlug: 'CANVA',
    category: 'design',
    logo: '/logos/canva.svg',
    actions: [
      'CANVA_CREATE_DESIGN',
      'CANVA_EXPORT_DESIGN',
      'CANVA_LIST_DESIGNS',
    ],
    featuredFor: ['marketing', 'agency', 'creator'],
    sharePolicy: 'shareable',
  },

  // ── Analytics ───────────────────────────────────────────────────────────
  {
    id: 'google_analytics',
    name: 'Google Analytics',
    // Composio's canonical toolkit slug uses the underscore form (matches what
    // the dashboard creates and what `GET /api/v3/auth_configs` returns).
    toolkitSlug: 'GOOGLE_ANALYTICS',
    category: 'analytics',
    logo: '/logos/google-analytics.svg',
    actions: [
      'GOOGLE_ANALYTICS_RUN_REPORT',
      'GOOGLE_ANALYTICS_RUN_REALTIME_REPORT',
    ],
    sharePolicy: 'per-business',
  },
] as const

export function getProvider(id: string): OAuthProvider | undefined {
  return OAUTH_PROVIDERS.find(p => p.id === id)
}

export function listProviders(filter?: { category?: OAuthCategory; featuredFor?: string }): readonly OAuthProvider[] {
  let out: readonly OAuthProvider[] = OAUTH_PROVIDERS
  if (filter?.category) out = out.filter(p => p.category === filter.category)
  if (filter?.featuredFor) out = out.filter(p => p.featuredFor?.includes(filter.featuredFor!))
  return out
}

export const PROVIDER_IDS = OAUTH_PROVIDERS.map(p => p.id)
