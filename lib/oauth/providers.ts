/**
 * OAuth provider registry.
 *
 * Single source of truth for which third-party platforms Nexus can connect to
 * via Composio. To add a new platform:
 *   1. Verify Composio supports it (https://composio.dev/integrations)
 *   2. Add a row below
 *   3. The Settings → Accounts page will automatically render a "Connect
 *      <platform>" button
 *   4. Workflow agents can call `executeBusinessAction(slug, platform, action, args)`
 *      with any of the listed actions
 *
 * No per-platform code is required — Composio handles the OAuth dance,
 * token refresh, and rate limits.
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
  /** Composio integration id (e.g. "twitter_v2"). */
  integrationId: string
  category: OAuthCategory
  /** Path to a logo asset under /public, or an emoji fallback. */
  logo: string
  /** Composio action ids the agent layer can invoke once connected. */
  actions: readonly string[]
  /** Optional. When set, only businesses with these niches will see it featured. */
  featuredFor?: readonly string[]
}

export const OAUTH_PROVIDERS: readonly OAuthProvider[] = [
  // ── Social ──────────────────────────────────────────────────────────────
  {
    id: 'twitter',
    name: 'X (Twitter)',
    integrationId: 'twitter_v2',
    category: 'social',
    logo: '/logos/twitter.svg',
    actions: ['TWITTER_CREATE_TWEET', 'TWITTER_CREATE_THREAD', 'TWITTER_DELETE_TWEET', 'TWITTER_GET_USER_TWEETS'],
    featuredFor: ['marketing', 'content', 'agency'],
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    integrationId: 'linkedin',
    category: 'social',
    logo: '/logos/linkedin.svg',
    actions: ['LINKEDIN_CREATE_POST', 'LINKEDIN_CREATE_ARTICLE', 'LINKEDIN_GET_PROFILE'],
    featuredFor: ['b2b', 'saas', 'agency'],
  },
  {
    id: 'instagram',
    name: 'Instagram',
    integrationId: 'instagram',
    category: 'social',
    logo: '/logos/instagram.svg',
    actions: ['INSTAGRAM_CREATE_POST', 'INSTAGRAM_CREATE_REEL', 'INSTAGRAM_GET_INSIGHTS'],
    featuredFor: ['ecommerce', 'creator', 'agency'],
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    integrationId: 'tiktok',
    category: 'social',
    logo: '/logos/tiktok.svg',
    actions: ['TIKTOK_UPLOAD_VIDEO', 'TIKTOK_GET_VIDEO_ANALYTICS'],
    featuredFor: ['creator', 'ecommerce'],
  },
  {
    id: 'youtube',
    name: 'YouTube',
    integrationId: 'youtube',
    category: 'social',
    logo: '/logos/youtube.svg',
    actions: ['YOUTUBE_UPLOAD_VIDEO', 'YOUTUBE_UPDATE_VIDEO_METADATA', 'YOUTUBE_GET_VIDEO_STATS'],
    featuredFor: ['creator', 'content'],
  },

  // ── Email ───────────────────────────────────────────────────────────────
  {
    id: 'gmail',
    name: 'Gmail',
    integrationId: 'gmail',
    category: 'email',
    logo: '/logos/gmail.svg',
    actions: ['GMAIL_SEND_EMAIL', 'GMAIL_REPLY_TO_THREAD', 'GMAIL_LIST_MESSAGES', 'GMAIL_CREATE_DRAFT'],
  },
  {
    id: 'outlook',
    name: 'Outlook',
    integrationId: 'outlook',
    category: 'email',
    logo: '/logos/outlook.svg',
    actions: ['OUTLOOK_SEND_EMAIL', 'OUTLOOK_LIST_MESSAGES', 'OUTLOOK_CREATE_DRAFT'],
  },

  // ── Communication ───────────────────────────────────────────────────────
  {
    id: 'slack',
    name: 'Slack',
    integrationId: 'slack',
    category: 'communication',
    logo: '/logos/slack.svg',
    actions: ['SLACK_SEND_MESSAGE', 'SLACK_CREATE_CHANNEL', 'SLACK_LIST_CHANNELS'],
  },
  {
    id: 'discord',
    name: 'Discord',
    integrationId: 'discord',
    category: 'communication',
    logo: '/logos/discord.svg',
    actions: ['DISCORD_SEND_MESSAGE', 'DISCORD_CREATE_THREAD'],
    featuredFor: ['creator', 'community'],
  },

  // ── Productivity ────────────────────────────────────────────────────────
  {
    id: 'notion',
    name: 'Notion',
    integrationId: 'notion',
    category: 'productivity',
    logo: '/logos/notion.svg',
    actions: ['NOTION_CREATE_PAGE', 'NOTION_UPDATE_PAGE', 'NOTION_QUERY_DATABASE'],
  },
  {
    id: 'google_docs',
    name: 'Google Docs',
    integrationId: 'googledocs',
    category: 'productivity',
    logo: '/logos/google-docs.svg',
    actions: ['GOOGLEDOCS_CREATE_DOCUMENT', 'GOOGLEDOCS_GET_DOCUMENT', 'GOOGLEDOCS_UPDATE_DOCUMENT'],
  },
  {
    id: 'google_sheets',
    name: 'Google Sheets',
    integrationId: 'googlesheets',
    category: 'productivity',
    logo: '/logos/google-sheets.svg',
    actions: ['GOOGLESHEETS_APPEND_ROWS', 'GOOGLESHEETS_GET_VALUES', 'GOOGLESHEETS_UPDATE_VALUES'],
  },

  // ── Developer ───────────────────────────────────────────────────────────
  {
    id: 'github',
    name: 'GitHub',
    integrationId: 'github',
    category: 'developer',
    logo: '/logos/github.svg',
    actions: ['GITHUB_CREATE_ISSUE', 'GITHUB_CREATE_PR', 'GITHUB_LIST_REPOS'],
    featuredFor: ['saas', 'developer'],
  },
  {
    id: 'linear',
    name: 'Linear',
    integrationId: 'linear',
    category: 'developer',
    logo: '/logos/linear.svg',
    actions: ['LINEAR_CREATE_ISSUE', 'LINEAR_UPDATE_ISSUE', 'LINEAR_LIST_ISSUES'],
    featuredFor: ['saas', 'developer'],
  },

  // ── Commerce ────────────────────────────────────────────────────────────
  {
    id: 'stripe',
    name: 'Stripe',
    integrationId: 'stripe',
    category: 'commerce',
    logo: '/logos/stripe.svg',
    actions: ['STRIPE_LIST_CUSTOMERS', 'STRIPE_CREATE_PAYMENT_LINK', 'STRIPE_LIST_INVOICES'],
    featuredFor: ['saas', 'ecommerce'],
  },
  {
    id: 'shopify',
    name: 'Shopify',
    integrationId: 'shopify',
    category: 'commerce',
    logo: '/logos/shopify.svg',
    actions: ['SHOPIFY_CREATE_PRODUCT', 'SHOPIFY_LIST_ORDERS', 'SHOPIFY_UPDATE_PRODUCT'],
    featuredFor: ['ecommerce'],
  },

  // ── Design / Creative ───────────────────────────────────────────────────
  {
    id: 'canva',
    name: 'Canva',
    integrationId: 'canva',
    category: 'design',
    logo: '/logos/canva.svg',
    actions: ['CANVA_CREATE_DESIGN', 'CANVA_EXPORT_DESIGN', 'CANVA_LIST_DESIGNS'],
    featuredFor: ['marketing', 'agency', 'creator'],
  },

  // ── Analytics ───────────────────────────────────────────────────────────
  {
    id: 'google_analytics',
    name: 'Google Analytics',
    integrationId: 'googleanalytics',
    category: 'analytics',
    logo: '/logos/google-analytics.svg',
    actions: ['GA_RUN_REPORT', 'GA_GET_REALTIME'],
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
