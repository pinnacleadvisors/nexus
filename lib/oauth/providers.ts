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

  // ── Commerce ────────────────────────────────────────────────────────────
  {
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
    sharePolicy: 'per-business',
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
    toolkitSlug: 'GOOGLEANALYTICS',
    category: 'analytics',
    logo: '/logos/google-analytics.svg',
    actions: [
      'GOOGLEANALYTICS_RUN_REPORT',
      'GOOGLEANALYTICS_RUN_REALTIME_REPORT',
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
