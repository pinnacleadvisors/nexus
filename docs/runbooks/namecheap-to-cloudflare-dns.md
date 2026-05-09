# Namecheap → Cloudflare DNS migration runbook

> **One-line summary.** For each domain a Nexus business owns, delegate DNS hosting from Namecheap to Cloudflare. Domain registration stays at Namecheap; only the nameservers move. The per-business agent then manages DNS through the Cloudflare DNS MCP using a zone-scoped API token — no IP allowlist, no shared-credential friction.

## Why we're not using the Namecheap API

Namecheap's API requires a triple of `(API key + Namecheap username + IP allowlist)`. The IP allowlist is the blocker: per-business Coolify containers on KVM4 each egress through Cloudflare Tunnel and can have **different egress IPs** depending on the tunnel route. Pinning a static allowlist for every per-business container's egress is operationally fragile (IPs rotate, scaling adds new ones, troubleshooting is opaque).

Cloudflare's API uses **zone-scoped API tokens** — no IP allowlist required, the token alone is the credential, and it can be narrowed to a single zone with `Edit zone DNS` permission. This is a clean fit for the per-business `apiKeySetup` pattern (A5): operator pastes one token per business, the container env carries `CLOUDFLARE_API_TOKEN`, the Cloudflare DNS MCP picks it up, agent manages records.

Net result: domain registration (renewals, WHOIS, transfers) stays at Namecheap where it is. DNS hosting (A/AAAA/CNAME/TXT/MX records, propagation, edge caching) moves to Cloudflare. The two are independent — you don't have to transfer the registrar to use Cloudflare DNS.

## Per-domain steps (operator does this once per domain)

### (a) Sign up at Cloudflare (skip if you have an account)

1. Open https://dash.cloudflare.com/sign-up
2. Create a free account. The Free plan covers many zones — sufficient for the foreseeable Nexus business pipeline. (Recommendation per `task_plan-solopreneur-experiment.md` open questions: one Cloudflare account with multiple zones, not separate accounts per business.)
3. Verify the email Cloudflare sends.

### (b) Add the domain as a zone

1. Cloudflare dashboard → **Add a Site**
2. Enter the domain (e.g. `pdf-experiment-01.com`) and click **Continue**
3. Pick the **Free** plan and click **Continue**
4. Cloudflare auto-imports existing DNS records by querying public DNS. **Review the list for accuracy** — anything currently resolving (apex A record, www CNAME, MX records for email) should appear. Add anything missing now (it's much easier than scrambling post-cutover).

### (c) Cloudflare provides 2 nameservers

After import, Cloudflare shows the two nameservers assigned to the zone, e.g.:

```
ada.ns.cloudflare.com
bob.ns.cloudflare.com
```

The exact names are random per zone — copy **the values Cloudflare shows you**, not the example above.

### (d) Update Namecheap nameservers

1. Sign in at https://ap.www.namecheap.com → **Domain List**
2. Find the domain → click **Manage**
3. Scroll to the **Nameservers** dropdown (currently set to "Namecheap BasicDNS" or similar)
4. Change to **Custom DNS**
5. Paste the two Cloudflare NS values into the two fields
6. Click the **green checkmark icon** at the right of the field row to save (this is the easy-to-miss save action — there's no separate "Save" button)

### (e) Wait for propagation (15 min – 24 h)

Propagation time depends on the previous nameservers' TTL. Check from your laptop:

```bash
dig NS pdf-experiment-01.com +short
```

Once the output shows the Cloudflare nameservers (`ada.ns.cloudflare.com`, `bob.ns.cloudflare.com`), the cutover is done. Cloudflare also emails the account owner ("Your site is now active") at the same moment.

If after 24 h `dig` still shows old nameservers, recheck Namecheap's **Custom DNS** field — sometimes the green-checkmark save fails silently if one of the NS values has a typo.

### (f) Set the Cloudflare SSL/TLS encryption mode

1. Cloudflare dashboard → the zone → **SSL/TLS** tab → **Overview**
2. Choose:
   - **Full (strict)** — for origins with valid certificates (Vercel, Coolify behind Cloudflare Tunnel, anything with a real cert). This is the default for most Nexus businesses.
   - **Full** — origin has a self-signed cert (rare in our stack).
   - **Flexible** — only for legacy `http://` origins. Avoid; downgrades end-to-end encryption.
3. If the business is hosted on Vercel, **Full (strict)** is correct.

## Per-business token creation

Each Nexus business gets its own Cloudflare API token, scoped to **only its zone**, pasted via the apiKeySetup form (A5).

1. Cloudflare dashboard → **My Profile** (top-right avatar) → **API Tokens** → **Create Token**
2. Use the **Edit zone DNS** template (under "API token templates")
3. **Permissions**: leave as `Zone › DNS › Edit` (template default)
4. **Zone Resources**: change from "All zones" to **Include › Specific zone › `<this-domain>`**. Do **not** leave "All zones" — the whole point is per-business isolation.
5. **Client IP Address Filtering**: skip for per-business containers. Their egress IP varies (Cloudflare Tunnel routing) — adding an allowlist here re-creates the Namecheap problem we left behind.
6. **TTL**: optional. Leave indefinite for now; rotate manually if the operator suspects compromise.
7. Click **Continue to summary** → **Create Token**
8. **Copy the token** (Cloudflare shows it once; you cannot retrieve it later — only revoke and reissue)
9. Open `https://nexus.example.com/settings/accounts?businessSlug=<slug>` (replace `<slug>` with e.g. `pdf-experiment-01`)
10. Find the **Cloudflare** row in the apiKeySetup section → paste the token → **Save**

The A5 route encrypts the token with `ENCRYPTION_KEY` before persisting it on the `connected_accounts` row (`encrypted_api_key` bytea column). It's never stored in plaintext.

## Verification

After A5 + provisioning have wired the token into the per-business container env, the smoke test is a single curl:

```bash
# from inside the per-business Coolify container shell:
curl -s https://api.cloudflare.com/client/v4/zones \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  | jq '.result[].name'
```

Expected output: a single domain string — the zone the token is scoped to. If it returns an empty array, the token was scoped wrong (likely "All zones" + IP filter mismatch). If it returns multiple zones, the scoping is too wide — revoke and reissue with the correct single-zone scope.

For an end-to-end DNS write test (optional, do this once when first proving out the agent loop):

```bash
# create a transient TXT record via the API
curl -s -X POST https://api.cloudflare.com/client/v4/zones/<zone-id>/dns_records \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"type":"TXT","name":"_nexus-smoke","content":"ok","ttl":60}'
# delete it after verifying it appears in the dashboard
```

## When NOT to use this runbook

Most Nexus businesses will follow it as-is. Two edge cases:

- **TLDs Cloudflare doesn't support as DNS host**. Cloudflare supports the major gTLDs and most ccTLDs. For `.uk`, `.io`, and a handful of specialty TLDs that have historically had support quirks, double-check the zone-add flow completes. If Cloudflare refuses the zone, registrar **and** DNS stay at Namecheap and the per-business agent uses Namecheap's web UI manually (or skip DNS automation for that business).
- **Registrar-level operations** (WHOIS update, transfer-out, contact change). These remain at Namecheap regardless of where DNS is hosted — Cloudflare DNS hosting doesn't touch the registrar relationship.

### Optional — moving the registrar to Cloudflare too

Cloudflare Registrar offers **at-cost** TLD pricing (no markup, no upsell). If a business's domain is up for renewal and the TLD is Cloudflare-supported, an inbound transfer from Namecheap → Cloudflare Registrar saves money on every annual renewal (often $5–15/year per domain).

Caveats:
- Transfer takes 5–10 days; domain stays accessible throughout.
- Namecheap charges nothing extra for the transfer-out; Cloudflare charges the standard one-year renewal at transfer time (which extends the expiry by one year, so it's not a sunk cost).
- After transfer, Cloudflare Registrar is the registrar AND DNS host — one less moving part.

This is **optional and decoupled** from the DNS migration above. Do the DNS migration first; consider registrar transfer later as a cost-optimisation pass.

## Cross-links

- Parent task plan: [`task_plan-solopreneur-experiment.md`](../../task_plan-solopreneur-experiment.md) — full A6 spec and the open question on Cloudflare account scope at scale
- Related task A2: [`lib/businesses/mcp-manifest.ts`](../../lib/businesses/mcp-manifest.ts) — `cloudflare-mcp` entry in the `digital-products` profile
- Related task A5: [`lib/oauth/providers.ts`](../../lib/oauth/providers.ts) and `app/(protected)/settings/accounts/page.tsx` — `apiKeySetup: true` pattern that surfaces the per-business token paste form
- Cloudflare official docs: https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/
