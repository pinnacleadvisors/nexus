/**
 * lib/fixtures/connected-accounts.ts
 *
 * Synthetic `connected_accounts`-shaped rows the dev fixture harness
 * surfaces when fixture mode is on. Each entry matches an `id` from
 * `lib/oauth/providers.ts` and follows the connected_accounts table
 * shape from migration 033 (id, user_id, business_slug, platform,
 * composio_account_id, status, metadata, created_at, last_used_at).
 *
 * Why an in-memory registry instead of seeded DB rows:
 *   - Zero state pollution. Flip fixture mode off → rows disappear.
 *   - Adding a new platform is a code edit, not a migration.
 *   - The "composio_account_id" looks like `fixture-<platform>` so the
 *     downstream action handler can distinguish fixture vs real (and
 *     short-circuit before calling Composio).
 *
 * Why all-fixture-for-all-businesses (no per-business scoping):
 *   - The operator's ask: "use dummy data for areas like connectors
 *     instead of having to actually connect real third party account".
 *     A single full-coverage set lets every test business behave as if
 *     fully wired without per-business setup.
 *
 * To add a platform:
 *   1. Add an entry to FIXTURE_CONNECTED_ACCOUNTS below.
 *   2. (Optional) Add canned action responses in lib/fixtures/actions.ts.
 *   3. Done — the dev panel auto-picks it up.
 */

import { OAUTH_PROVIDERS } from '@/lib/oauth/providers'

/** One row in the synthetic connected_accounts overlay. Mirrors the
 *  real table's column shape minus the auto-generated ones (id,
 *  created_at). */
export interface FixtureConnectedAccount {
  /** Matches OAUTH_PROVIDERS[].id */
  platform:             string
  /** Friendly label rendered in /settings/accounts */
  display_name:         string
  /** Synthetic identifier — always `fixture-<platform>` so action
   *  fixtures + downstream code can branch on prefix. */
  composio_account_id:  string
  /** Optional scopes string surfaced in UI for parity with real rows. */
  scopes?:              string[]
  /** Operator-friendly note about what this fixture does. */
  notes:                string
}

/**
 * V1 coverage — the 12 most common platforms across the niche set in
 * /api/businesses/[slug]/seed. Grows as new connectors land in
 * lib/oauth/providers.ts; the dev-loop spec encourages adding fixture
 * entries alongside any new provider PR.
 */
export const FIXTURE_CONNECTED_ACCOUNTS: FixtureConnectedAccount[] = [
  // Commerce / payments
  { platform: 'stripe',         display_name: 'Fixture Stripe (test mode)',     composio_account_id: 'fixture-stripe',         scopes: ['charges:read','charges:write','payment_intents'], notes: 'Returns canned payment_intent + refund responses without hitting Stripe.' },
  { platform: 'shopify',        display_name: 'Fixture Shopify Store',          composio_account_id: 'fixture-shopify',        scopes: ['read_products','write_orders'],                   notes: 'Returns a synthetic product catalog + order list.' },

  // Email
  { platform: 'gmail',          display_name: 'Fixture Gmail Inbox',            composio_account_id: 'fixture-gmail',          scopes: ['gmail.send','gmail.read'],                        notes: 'Send → canned message_id. List → 3 synthetic emails.' },
  { platform: 'convertkit',     display_name: 'Fixture ConvertKit List',        composio_account_id: 'fixture-convertkit',     scopes: ['subscribers:write','broadcasts:write'],           notes: 'Add subscriber + broadcast send respond with synthetic IDs.' },
  { platform: 'resend',         display_name: 'Fixture Resend Sender',          composio_account_id: 'fixture-resend',         scopes: ['email:send'],                                     notes: 'Email send → canned message_id.' },

  // Social / content
  { platform: 'twitter',        display_name: 'Fixture Twitter/X Handle',       composio_account_id: 'fixture-twitter',        scopes: ['tweet.write','users.read'],                       notes: 'Tweet posts return a synthetic tweet_id.' },
  { platform: 'linkedin',       display_name: 'Fixture LinkedIn Page',          composio_account_id: 'fixture-linkedin',       scopes: ['post:write','share:write'],                       notes: 'Posts → synthetic urn:li:share IDs.' },
  { platform: 'youtube',        display_name: 'Fixture YouTube Channel',        composio_account_id: 'fixture-youtube',        scopes: ['youtube.upload','youtube.readonly'],              notes: 'Upload → synthetic videoId. Stats → randomised view counts.' },
  { platform: 'tiktok',         display_name: 'Fixture TikTok Account',         composio_account_id: 'fixture-tiktok',         scopes: ['video.publish','user.info.basic'],                notes: 'Publish → synthetic video_id. List → 5 fake clips.' },

  // Communication / productivity
  { platform: 'slack',          display_name: 'Fixture Slack Workspace',        composio_account_id: 'fixture-slack',          scopes: ['chat:write','channels:read'],                     notes: 'Message → ok:true with synthetic ts. Channels list → 5 fake.' },
  { platform: 'notion',         display_name: 'Fixture Notion Workspace',       composio_account_id: 'fixture-notion',         scopes: ['blocks:write','databases:read'],                  notes: 'Page create → synthetic page_id. DB query → 3 fake rows.' },
  { platform: 'google_calendar', display_name: 'Fixture Google Calendar',       composio_account_id: 'fixture-google_calendar', scopes: ['calendar.events.write'],                         notes: 'Event create → synthetic event_id + iCal link.' },
]

/**
 * Filter the static set to only platforms that actually exist in the
 * OAuth provider registry. Guards against drift — if a provider is
 * removed from lib/oauth/providers.ts but the fixture entry lingers,
 * the orphan is silently dropped instead of showing a phantom card.
 */
export function activeFixtureAccounts(): FixtureConnectedAccount[] {
  const known = new Set(OAUTH_PROVIDERS.map(p => p.id))
  return FIXTURE_CONNECTED_ACCOUNTS.filter(f => known.has(f.platform))
}

/** True when the given composio_account_id is a synthetic fixture row. */
export function isFixtureAccountId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('fixture-')
}
