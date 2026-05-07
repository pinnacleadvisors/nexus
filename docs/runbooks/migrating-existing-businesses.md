# Migrating existing businesses to per-business containers

For businesses that exist in `business_operators` from before the per-business container architecture (Phase 5+ of the execution overhaul). Both seed businesses — `inkbound` (freelancer contract bundles) and `ledger-lane` (tax organizers for accountants) — fall in this bucket.

The full step-by-step is in [`pilot-rollout-walkthrough.md`](pilot-rollout-walkthrough.md). This doc just tightens it for the existing-business case.

## Helper script

```bash
# Print the migration plan for one business
doppler run -- npx --yes tsx scripts/migrate-business.ts ledger-lane

# Plan + auto-trigger the GHA image build
doppler run -- npx --yes tsx scripts/migrate-business.ts ledger-lane --build

# Run for both seeds at once
doppler run -- npx --yes tsx scripts/migrate-business.ts --all
```

The script reads `lib/business/seeds.ts`, resolves the MCP manifest from the business niche, prints the provision curl, and lists which OAuth platforms are per-business vs shareable for that profile. It does NOT call the provision endpoint (needs a Clerk session cookie) and does NOT open the Coolify UI (deploy step is manual by design).

## Per-business specifics

| Field | inkbound | ledger-lane |
|---|---|---|
| Slug | `inkbound` | `ledger-lane` |
| Niche text | Freelancer contract bundles (designer, dev, copywriter) | Tax organizers for solo accountants / bookkeepers / EAs |
| Suggested manifest profile | `digital-products` (auto-resolves) | `digital-products` (auto-resolves) |
| Image tag | `ghcr.io/pinnacleadvisors/nexus-business:inkbound` | `ghcr.io/pinnacleadvisors/nexus-business:ledger-lane` |
| Coolify FQDN | `inkbound.gateway.<your-domain>` | `ledger-lane.gateway.<your-domain>` |
| Slack channel | `#nexus-inkbound` | `#nexus-ledger-lane` |
| Seasonality | None — evergreen | Peak Jan–Apr (US tax season) |

> **Why `digital-products`?** Both seed niche strings match the profile's substrings (ledger-lane → "organizer", inkbound → "contract bundle"). Resolved MCP set: `[memory-hq, firecrawl, n8n, composio, muapi-ai, tavily]`. The single `composio` (Rube) entry covers Stripe, Canva, Gmail, Twitter, etc. — every OAuth platform in `lib/oauth/providers.ts` — through one managed MCP server, so we don't need per-platform packages.
>
> First build for the pilot: pass `mcp_override=none` regardless. Only `n8n-mcp` exists on npm today; the foundational `composio` and the `@nexus/mcp-*` placeholders need to be published or installed before the manifest's defaults will work in a real build.

## Running both, in order

Suggested order: **migrate `inkbound` first**.

- Inkbound is non-seasonal so a 7-day bake-in measures real steady-state traffic
- Ledger-lane peaks Jan–Apr; if you migrate it during peak you'll observe migration-quality entangled with seasonal-load behaviour. Migrate it in the off-season (May–Oct) so issues are diagnosable.

For each business, do these once:

```bash
# 1. Build the image (creates ghcr.io/pinnacleadvisors/nexus-business:<slug>)
gh workflow run per-business-image.yml \
  -f slug=inkbound -f niche=ecommerce -f mcp_override=none

# 2. Wait for the run to finish (`gh run watch` or check Actions tab),
#    then mark the package public if you went with that option (Step 4e of
#    the walkthrough). Do this once per package.

# 3. Provision (needs Clerk session cookie — run from browser DevTools)
curl -i -X POST "$NEXT_PUBLIC_APP_URL/api/businesses/inkbound/provision" \
  -H "content-type: application/json" \
  -H "cookie: __session=<paste>" \
  -d '{"niche":"digital-products"}'

# 4. Coolify dashboard → Projects → Nexus Businesses → nexus-business-inkbound
#    → Deploy → Terminal → `claude login` → paste OAuth code back

# 5. Smoke test
curl -i "https://inkbound.gateway.<your-domain>/health"
# Expect: { ok: true, loggedIn: true, queueDepth: 0 }

# 6. Connect per-business accounts in browser:
#    /settings/accounts?businessSlug=inkbound
#    (Stripe, Gmail, Google Analytics — own identity per business)
#    Shared accounts at /settings/accounts (no query):
#    (Canva — design assets pool fine to share)

# 7. Run a low-stakes maintain workflow, watch Vercel logs for
#    [claude-session/dispatch] resolved to inkbound.gateway.*
#    rather than the shared gateway

# 8. Bake for 7 days. Then repeat for ledger-lane.
```

## Verification queries

After both businesses migrate, sanity-check the state:

```sql
-- Each business should have a gateway secret
select kind from user_secrets
 where kind in ('business:inkbound', 'business:ledger-lane');
-- Expect 2 rows (gatewayUrl + bearerToken each = 4 row-pairs but kind is the same)

-- Connected accounts should show per-business connections
select platform, business_slug, status from connected_accounts
 where business_slug in ('inkbound', 'ledger-lane') and status = 'active'
 order by business_slug, platform;

-- Recent dispatches should resolve to per-business gateways (Vercel logs filter)
-- Search Vercel logs for: [claude-session/dispatch] resolved gateway: business:
```

## Rollback

If something goes wrong after migration (n8n workflow starts failing, dispatch routing weirdness, container OOM):

```bash
# Soft rollback — bypass JUST this business, keep others on the new path
doppler secrets set BUSINESS_GATEWAY_BYPASS_SLUGS=inkbound -p nexus -c prd

# Or both
doppler secrets set BUSINESS_GATEWAY_BYPASS_SLUGS=inkbound,ledger-lane -p nexus -c prd

# Hard rollback — revert ALL businesses to the shared gateway
doppler secrets set DISABLE_PER_BUSINESS_GATEWAY=1 -p nexus -c prd
```

Both flags are read by `lib/claw/business-client.ts:shouldBypassBusinessGateway()` at every dispatch — no redeploy needed beyond the Doppler push.

The Coolify containers keep running but receive no traffic. Stop them in the Coolify UI once you're sure rollback is permanent (or just let the scale-down cron pause them after 1 hour idle).
