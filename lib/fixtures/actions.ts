/**
 * lib/fixtures/actions.ts
 *
 * Canned Composio-action responses surfaced when fixture mode is on.
 * When `executeBusinessAction()` is called with a (platform, action)
 * pair that has a fixture registered, the fixture function runs in
 * place of the Composio HTTP call.
 *
 * Each fixture function:
 *   - Receives the same `arguments` object the agent would pass to
 *     Composio (so behaviour matches what real call sites expect).
 *   - Returns a plain object shaped like the real Composio response,
 *     so downstream parsers don't need a code path for fixture mode.
 *   - Generates randomised IDs (Math.random — fixture mode is
 *     non-prod by definition, no need for crypto-grade entropy).
 *
 * Why functions rather than static objects:
 *   - Agents often pass through input fields verbatim (recipient,
 *     subject, amount). Echoing those back in the response lets the
 *     downstream UI render realistic-looking confirmation states.
 *   - Timestamps need to be current per call, not stuck at build time.
 *
 * To add a new verb:
 *   1. Add a key under the platform's record below.
 *   2. Shape the return roughly matching the real Composio response
 *      (look up via Composio's actions catalog or by capturing one
 *      real response in dev).
 *   3. No registration step — the lookup is direct.
 *
 * To add a whole new platform: add a top-level key to FIXTURE_ACTIONS.
 */

type FixtureFn = (args: Record<string, unknown>) => Record<string, unknown>

function rid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Action fixture registry. Keyed by platform.id (from OAUTH_PROVIDERS),
 *  then by Composio action slug (typically the verb the agent asked for). */
export const FIXTURE_ACTIONS: Record<string, Record<string, FixtureFn>> = {
  // ── Commerce / payments ────────────────────────────────────────────
  stripe: {
    create_payment_intent: (args) => ({
      id:               rid('pi_fixture'),
      object:           'payment_intent',
      amount:           args.amount ?? 0,
      currency:         args.currency ?? 'usd',
      status:           'requires_payment_method',
      client_secret:    'pi_fixture_secret',
      metadata:         args.metadata ?? {},
      created:          Math.floor(Date.now() / 1000),
      livemode:         false,
    }),
    refund: (args) => ({
      id:               rid('re_fixture'),
      object:           'refund',
      payment_intent:   args.payment_intent,
      amount:           args.amount ?? 100,
      status:           'succeeded',
      created:          Math.floor(Date.now() / 1000),
    }),
    list_charges: () => ({
      object: 'list',
      data: [
        { id: rid('ch_fixture'), amount: 5000, currency: 'usd', status: 'succeeded', created: Math.floor(Date.now() / 1000) - 86400 },
        { id: rid('ch_fixture'), amount: 1500, currency: 'usd', status: 'succeeded', created: Math.floor(Date.now() / 1000) - 172800 },
      ],
    }),
  },
  shopify: {
    list_products: () => ({
      products: [
        { id: 'sp_fix_1', title: 'Fixture Product A', price: '29.00', inventory: 12 },
        { id: 'sp_fix_2', title: 'Fixture Product B', price: '99.00', inventory: 4  },
        { id: 'sp_fix_3', title: 'Fixture Product C', price: '14.99', inventory: 88 },
      ],
    }),
    create_order: (args) => ({
      id:           rid('so_fixture'),
      order_number: Math.floor(Math.random() * 10000),
      total_price:  args.total ?? '29.00',
      financial_status: 'paid',
      created_at:   nowIso(),
    }),
  },

  // ── Email ─────────────────────────────────────────────────────────
  gmail: {
    send_email: (args) => ({
      message_id: rid('gm_fixture'),
      thread_id:  rid('gt_fixture'),
      to:         args.to,
      subject:    args.subject,
      sent_at:    nowIso(),
      labels:     ['SENT'],
    }),
    list_emails: () => ({
      emails: [
        { id: 'gm_fix_1', from: 'alice@example.com', subject: 'Welcome to fixture mode', snippet: 'Synthetic inbox row …', received_at: nowIso() },
        { id: 'gm_fix_2', from: 'bob@example.com',   subject: 'Test message',           snippet: 'Another synthetic row …', received_at: nowIso() },
        { id: 'gm_fix_3', from: 'charlie@example.com', subject: 'Re: thread fixture',   snippet: 'Third row …',           received_at: nowIso() },
      ],
    }),
  },
  convertkit: {
    add_subscriber: (args) => ({
      subscriber:    { id: rid('ck_fixture'), email_address: args.email, state: 'active', created_at: nowIso() },
    }),
    send_broadcast: (args) => ({
      broadcast: { id: rid('ck_b_fixture'), subject: args.subject, status: 'queued', sent_at: nowIso() },
    }),
  },
  resend: {
    send_email: (args) => ({
      id:      rid('rs_fixture'),
      from:    args.from,
      to:      args.to,
      subject: args.subject,
      created: nowIso(),
    }),
  },

  // ── Social / content ──────────────────────────────────────────────
  twitter: {
    create_tweet: (args) => ({
      data: { id: rid('tw_fixture'), text: args.text, created_at: nowIso() },
    }),
  },
  linkedin: {
    create_post: (args) => ({
      id:           `urn:li:share:fixture${Math.floor(Math.random()*1e9)}`,
      commentary:   args.content,
      visibility:   'PUBLIC',
      created_time: Date.now(),
    }),
  },
  youtube: {
    upload_video: (args) => ({
      kind:     'youtube#video',
      id:       rid('yt_fixture'),
      snippet:  { title: args.title, publishedAt: nowIso() },
      status:   { uploadStatus: 'uploaded', privacyStatus: 'unlisted' },
    }),
    list_videos: () => ({
      items: [
        { id: 'yt_fix_1', title: 'Fixture clip A', viewCount: 1230, publishedAt: nowIso() },
        { id: 'yt_fix_2', title: 'Fixture clip B', viewCount: 56,   publishedAt: nowIso() },
      ],
    }),
  },
  tiktok: {
    publish_video: (args) => ({ video_id: rid('tt_fixture'), share_url: 'https://tiktok.example/fixture', published_at: nowIso(), caption: args.caption }),
  },

  // ── Communication / productivity ──────────────────────────────────
  slack: {
    post_message: (args) => ({
      ok:      true,
      channel: args.channel ?? 'C_FIXTURE',
      ts:      String(Date.now() / 1000),
      message: { text: args.text, user: 'U_FIXTURE' },
    }),
    list_channels: () => ({
      channels: [
        { id: 'C_FIX_1', name: 'general',  is_private: false },
        { id: 'C_FIX_2', name: 'random',   is_private: false },
        { id: 'C_FIX_3', name: 'launches', is_private: false },
      ],
    }),
  },
  notion: {
    create_page: (args) => ({
      object:     'page',
      id:         rid('nt_fixture'),
      parent:     args.parent ?? { type: 'workspace' },
      properties: args.properties ?? {},
      created_time: nowIso(),
    }),
  },
  google_calendar: {
    create_event: (args) => ({
      id:          rid('gc_fixture'),
      summary:     args.summary,
      start:       args.start,
      end:         args.end,
      htmlLink:    'https://calendar.example/fixture',
      status:      'confirmed',
    }),
  },
}

/**
 * Look up the fixture function for a given (platform, action). Returns
 * null if no fixture is registered — caller falls through to real path.
 *
 * Action slug matching is case-insensitive on the action side because
 * different agents normalise verb names differently ("send_email" vs
 * "SEND_EMAIL"). The platform side stays case-sensitive — provider IDs
 * are canonical in OAUTH_PROVIDERS.
 */
export function getFixtureAction(platform: string, action: string): FixtureFn | null {
  const slot = FIXTURE_ACTIONS[platform]
  if (!slot) return null
  // Exact match first; then lowercase fallback.
  return slot[action] ?? slot[action.toLowerCase()] ?? null
}

/** Count of fixtures available — surfaced in the dev panel so the operator
 *  sees coverage growing as new verbs land. */
export function fixtureCoverage(): { platforms: number; verbs: number } {
  let verbs = 0
  for (const k of Object.keys(FIXTURE_ACTIONS)) verbs += Object.keys(FIXTURE_ACTIONS[k]).length
  return { platforms: Object.keys(FIXTURE_ACTIONS).length, verbs }
}
