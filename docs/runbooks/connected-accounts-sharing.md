# Connected accounts — sharing strategy

When you have N businesses, every external integration falls into one of two buckets:

| Bucket | What it is | Example platforms | Connect strategy |
|---|---|---|---|
| **Quota / metered service** | Pay-per-call APIs where the only thing being divided is throughput | Higgsfield, Runway, Kling, MuAPI, ElevenLabs, HeyGen, Tavily, Firecrawl | **One shared account** — buy the highest tier you need, all businesses draw from the same quota |
| **Tenant data service** | Account is the data — connecting means "act as this entity" | Gmail, Slack, Twitter, LinkedIn, Instagram, TikTok, YouTube, Notion, GitHub, Linear, Stripe, Shopify, Google Analytics | **One per business** — sharing commingles posts/funds/customers and is usually wrong |

The architecture already supports both. You don't need new schema or new code — just know which URL to use.

## How sharing works (no code changes needed)

The `connected_accounts` table keys on `(user_id, business_slug, platform)`. `business_slug` can be `NULL`, which means "user-default — applies to all my businesses unless a specific one is connected."

`executeBusinessAction(userId, businessSlug, platform, action, args)` in [`lib/composio/actions.ts`](../../lib/composio/actions.ts) does the lookup in two passes:

1. Exact match on `(userId, businessSlug, platform)` — the business-scoped account
2. Fallback to `(userId, NULL, platform)` — the shared account

So:
- **Connect business-scoped:** open `/settings/accounts?businessSlug=<slug>` and click Connect. Row gets `business_slug = '<slug>'`.
- **Connect shared (all businesses):** open `/settings/accounts` (no query string). Row gets `business_slug = NULL`.

Each provider in [`lib/oauth/providers.ts`](../../lib/oauth/providers.ts) carries `sharePolicy: 'shareable' | 'per-business'` — used as UI guidance now and as a lint signal later (warn if you try to share a `per-business` provider).

## Non-Composio services — Higgsfield, Runway, Kling, etc.

These don't have OAuth — they use API keys. They're not in `OAUTH_PROVIDERS` and don't go through Composio at all. Two options:

### Option 1 (recommended) — single shared key in Doppler

The MCP manifest in [`lib/businesses/mcp-manifest.ts`](../../lib/businesses/mcp-manifest.ts) declares which env vars each MCP needs:

```typescript
{ id: 'higgsfield', pkg: '@nexus/mcp-higgsfield', env: ['HIGGSFIELD_API_KEY'], … }
```

When [`/api/businesses/:slug/provision`](../../app/api/businesses/[slug]/provision/route.ts) creates a per-business Coolify app, it copies every env var the manifest declares from the platform's process.env into the new container's environment.

So to share one Higgsfield account across every per-business container:

1. Buy the high-tier Higgsfield plan on one account
2. Get one API key
3. Doppler → set `HIGGSFIELD_API_KEY = <key>` once at the platform level
4. Provision new businesses normally — each gets that key injected automatically

Same pattern works for `RUNWAY_API_KEY`, `KLING_API_KEY`, `MUAPI_AI_KEY`, `ELEVENLABS_API_KEY`, `HEYGEN_API_KEY`, `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`.

### Option 2 — per-business override

If one business needs its own account (rare — usually for billing isolation), set `<NAME>_API_KEY` differently in Coolify's env for that specific app. Coolify env beats inherited Doppler env. The provision route's first call uses the shared Doppler value; you edit afterward in the Coolify UI.

### Option 3 — full per-business credentials in DB

Don't do this unless you have a real reason. Adds a new table, encryption, lookup helpers, UI. The shared-Doppler-key path covers 95% of cases without the schema cost.

## Why per-business for Stripe and Shopify

The user might be tempted to share these for "high tier subscription benefits". Don't:

| Platform | Why sharing is bad |
|---|---|
| **Stripe** | Funds commingle. Refunds, disputes, and tax reports become unworkable. Use [Stripe Connect](https://stripe.com/connect) — one platform account, one connected account per business. Each business gets its own Stripe dashboard and its own funds. |
| **Shopify** | Each store is its own entity. One Shopify Plus account can host multiple stores natively (multi-store organisations) — you don't need to share an account, you create N stores under one billing entity. Each store still gets its own connected_account row. |
| **Gmail / Outlook / Slack** | The connection IS the user. Sharing means every business sends mail "from" the same address — fine if all businesses are one brand, wrong otherwise. |
| **Twitter / LinkedIn / IG / TikTok / YouTube** | Same — the connection is a brand identity. Sharing means all businesses post under one handle. |

The [Composio Auth Config](https://app.composio.dev) layer doesn't enforce this — it'll let you connect Stripe at user-default scope and have every business charge the same Stripe account. **Don't.**

## What about the lookup-fallback pattern for tenant data?

`executeBusinessAction` falls back to user-default when no business-scoped row exists. For metered services this is the feature. For tenant data services it's a footgun — a workflow agent could accidentally post to the user-default Gmail when you meant to post from a business one.

Two safeguards we have today:
1. The `sharePolicy: 'per-business'` flag on the provider — the AccountList UI shows a warning if you try to connect a per-business provider at user-default scope (TODO if not yet implemented).
2. The `ConnectedAccountMissingError` — when called with `businessSlug` and no business-scoped row exists, the fallback fires silently. Workflow agents catch this error and surface a "connect <platform>" prompt to the owner via the Board, but they can't tell that the action actually fell back to a shared identity. **For high-stakes per-business operations** (sending mail, posting socially, charging cards), the calling code should explicitly skip the fallback by passing `businessSlug` and treating any user-default match as an error.

If we end up with frequent footguns here, the right fix is a third lookup mode — `executeBusinessActionStrict()` that errors if it had to fall back. Not built yet; add it the first time we get burned.

## Quick reference

| Want to… | Do this |
|---|---|
| Share Higgsfield/Runway/etc. | Set `HIGGSFIELD_API_KEY` etc. in Doppler once. Auto-injected into every container. |
| Share Canva across businesses | `/settings/accounts` (no query), connect Canva. |
| Connect a specific business to Gmail | `/settings/accounts?businessSlug=<slug>`, connect Gmail. |
| Take Stripe payments per business | Use [Stripe Connect](https://stripe.com/connect) at the platform level; each business is a connected account, not a separate Stripe account. |
| Run multiple Shopify stores under one Plus subscription | Create N stores in Shopify (multi-store), connect each separately at `/settings/accounts?businessSlug=<slug>`. |
| Audit which accounts are shared vs per-business | `select platform, business_slug, count(*) from connected_accounts where status='active' group by 1, 2 order by 1, 2;` |
