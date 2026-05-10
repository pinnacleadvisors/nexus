# Shared Stripe + Vercel across businesses

One Stripe account, one Vercel team — used by every business. UX-isolated at the customer layer (Stripe statement descriptor + per-business Products/Prices) and the visitor layer (per-business Vercel projects with their own custom domains). No separate sub-accounts, no Stripe Connect, no Vercel team-per-business overhead.

## Why share

- **Vercel Pro = $20/mo flat.** With one team subscription you get unlimited projects, all the per-project benefits (preview deploys, edge functions, analytics) for free per business. Going personal-tier with one project per business pays $0 but caps you at Hobby limits per business; Pro-team-with-many-projects is strictly better once you have ≥ 2 businesses.
- **One Stripe = one tax form, one set of payouts.** You file 1099s / Schedule C's against one entity, not N. Audit-trail is a single dashboard.
- **One source of revenue truth.** Filter by `metadata.business_slug` to slice; aggregate by leaving the filter off. The plan-billing ledger ([D1](../../lib/experiments/plan-billing-ledger.ts)) treats each business's revenue as an isolated stream regardless.
- **Faster setup per new business.** Adding business N+1 = create a new Vercel project under the existing team + add Stripe Products with the new `business_slug` metadata. ~5 min vs ~1 hour for a fresh Stripe account activation.

## What stays per-business (UX isolation)

| Concern | How it stays scoped |
|---|---|
| Visitor sees | `<brand>.co` resolves to a per-business Vercel project. Vercel team identity is invisible to visitors. |
| Customer sees on bank statement | Stripe `statement_descriptor` is set per-PaymentIntent to the business brand (e.g. `LEDGERLANE`). The customer never sees the parent legal entity unless they look at the Stripe receipt's footer. |
| Customer sees on Stripe receipt | The receipt shows the Product name (per-business — e.g. "Tax Organizer Pro Bundle") and the storefront URL. Set Stripe's "Public business name" + branding to the business brand by setting it per-Customer when that's possible, or leave it neutral on the parent account. |
| Refund/subscription mgmt portal | Per-business Stripe Customer Portal config keyed by `business_slug` via Stripe's branding overrides. |
| Webhook routing | One Stripe webhook endpoint (`/api/stripe/webhook`); the handler dispatches by `metadata.business_slug` from the event payload. |

## Setup (one-time per stack, not per business)

### Stripe
1. Connect Stripe at `/settings/accounts` with the **Default** scope selected in the BusinessSwitcher (no `?businessSlug=`). Composio OAuth flow lands a row with `business_slug: NULL` in `connected_accounts`.
2. In the Stripe dashboard → Settings → Public details: set the **public business name** + logo to a neutral parent name (or to whichever business will dominate revenue — the receipts show this, so pick something the customer will recognize).
3. (Per business, but only the agent does this) when the agent creates a Product/Price/Customer/PaymentIntent it sets `metadata: { business_slug: '<slug>' }` so revenue attribution stays clean and the webhook can dispatch correctly.

### Vercel
1. Create one Vercel team (Pro tier — $20/mo). Use the same Gmail you use for the business email rotation policy.
2. Generate a team-scoped API token at https://vercel.com/account/tokens. Set the scope to the team (NOT "Personal Account") — copy it immediately, Vercel only shows it once.
3. Connect Vercel at `/settings/accounts` with the **Default** scope selected. Paste the token in the apiKeySetup form. Stored encrypted in `connected_accounts` under `business_slug: NULL`.
4. The provision route (`app/api/businesses/[slug]/provision/route.ts`) falls back to the user-default row when no per-business connected_accounts row exists, so every per-business Coolify container gets the shared `VERCEL_TOKEN` injected automatically. The agent uses it to create per-business projects.

## Agent-side rules (codified in the manifest + provider registry)

- `lib/oauth/providers.ts` Stripe entry: `sharePolicy: 'shareable'` + a comment explaining the metadata-attribution pattern.
- `lib/oauth/providers.ts` Vercel entry: `sharePolicy: 'shareable'` + apiKeySetup with `envVar: 'VERCEL_TOKEN'`.
- `lib/businesses/mcp-manifest.ts` `digital-products` profile env includes `VERCEL_TOKEN` so the per-business container starts with the shared token in env.
- `app/api/businesses/[slug]/provision/route.ts` `fetchDecryptedApiKey` does per-business → user-default fallback. Same pattern `executeBusinessAction()` already uses for Composio.

## Anti-patterns

- ❌ Creating a new Stripe account per business "for cleanliness". You'll lose the multi-business revenue view, file N tax forms, and burn ~1 hour activating each one.
- ❌ Forgetting `metadata.business_slug` on a Stripe object. Revenue attribution becomes guesswork after the fact. The plan-billing ledger ratio for the unattributed business will look perpetually broken. Consider a CI lint that greps Stripe action calls for the metadata.
- ❌ Setting the Stripe `statement_descriptor` to the parent legal entity. The customer's bank statement should show the brand they bought from, not your holding company name.
- ❌ Putting all businesses on one Vercel project under different routes. You lose per-business deploy isolation, custom-domain attachment, and the per-project preview deploy URLs.
- ❌ Generating per-business Vercel API tokens with personal scope. They'll only let the agent deploy to your personal projects, not the team. Always team-scoped.

## Cross-links

- Per-business container provisioning: [`per-business-container-rollout.md`](./per-business-container-rollout.md)
- Account-setup checklist for new businesses: [`pdf-experiment-account-setup.md`](./pdf-experiment-account-setup.md)
- Provider registry: `lib/oauth/providers.ts` (Stripe + Vercel entries with sharePolicy + comments)
- Provision route: `app/api/businesses/[slug]/provision/route.ts` (fetchDecryptedApiKey fallback)
