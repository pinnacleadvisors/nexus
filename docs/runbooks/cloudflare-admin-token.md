# Cloudflare admin token — click-by-click

> **TL;DR.** Platform-copilot already uses your existing `CLOUDFLARE_API_TOKEN` for tunnel + DNS work (see [`scripts/cloudflare-tunnel-add-hostname.mjs`](../../scripts/cloudflare-tunnel-add-hostname.mjs) and [`scripts/repair-codex-gateway-routing.mjs`](../../scripts/repair-codex-gateway-routing.mjs)). This runbook is for **creating or rotating** that token with the correct least-privilege scopes, and for setting client-IP filters.

## The token's job

| Operation | Cloudflare API endpoint | Permission required |
|---|---|---|
| List accounts / verify token validity | `/user/tokens/verify` | `User:User Details:Read` |
| List tunnels | `/accounts/<id>/cfd_tunnel` | `Account:Cloudflare Tunnel:Edit` (read part) |
| Read tunnel ingress config | `/accounts/<id>/cfd_tunnel/<tid>/configurations` | `Account:Cloudflare Tunnel:Edit` |
| Update tunnel ingress config | `PUT /accounts/<id>/cfd_tunnel/<tid>/configurations` | `Account:Cloudflare Tunnel:Edit` |
| List zones | `/zones?name=<root>` | `Zone:Zone:Read` (zone-scoped) |
| List DNS records | `/zones/<zid>/dns_records?name=<host>` | `Zone:DNS:Edit` (read part, zone-scoped) |
| Upsert DNS record | `POST/PUT /zones/<zid>/dns_records` | `Zone:DNS:Edit` (zone-scoped) |
| Look up account id | (implicit via zone response `account.id`) | `Account:Account Settings:Read` |

## The minimum scope set

When you click **Create Token** in Cloudflare Dashboard → My Profile → API Tokens, pick **Custom token** and add EXACTLY these permissions:

### Account permissions

| Resource | Permission | Scope |
|---|---|---|
| Account → Cloudflare Tunnel | Edit | The Account that owns your tunnels |
| Account → Account Settings | Read | Same account |

### Zone permissions

| Resource | Permission | Scope |
|---|---|---|
| Zone → DNS | Edit | **Specific zones** — pick each domain you manage. Do NOT use "All zones" |
| Zone → Zone | Read | **Same specific zones** |

### User permissions

| Resource | Permission | Scope |
|---|---|---|
| User → User Details | Read | (token-level, no scope to set) |

## What NOT to grant (least privilege)

These are tempting to add "just in case" — don't:

- ❌ **Workers Scripts:Edit** — gives the token the ability to deploy code that runs on Cloudflare's edge. Big blast radius.
- ❌ **Page Rules:Edit / Cache Rules:Edit** — production caching behaviour. One bad rule = global CDN outage for your domains.
- ❌ **Cache Purge:Edit** — can flush production caches. Low value for tunnel/DNS work.
- ❌ **Cloudflare Pages:Edit** — separate product, separate threat model.
- ❌ **Stream:Edit / R2:Edit / Images:Edit** — data products, not infrastructure.
- ❌ **Account → Workers KV Storage:Edit** — same reason as Workers.
- ❌ **"All zones" for Zone:DNS:Edit** — if the token leaks, every zone you own is at risk. Restrict to the specific zones you manage.

If the agent later needs one of these for a specific feature, mint a NEW token with that one extra permission. Don't pile capabilities onto the admin token.

## Recommended defense-in-depth

Cloudflare's token UI lets you add two non-permission restrictions — both highly recommended:

### Client IP filter

Restrict the token to known source IPs:

- Your **KVM4 server IP** (where claude-gateway runs the MCP)
- Your **dev-machine IP** (for manual ops via `doppler run --`)

That's it. Block everywhere else. If the token ever leaks via a public commit / log / screenshot, it's useless to the attacker.

You can find KVM4's egress IP via:

```bash
ssh kvm4 'curl -s ifconfig.me'
```

### TTL

Set a 90-day TTL. Rotate via Doppler:

```bash
# generate new token in CF dashboard, then:
doppler secrets set CLOUDFLARE_API_TOKEN="<new-token>" --project nexus --config prd --no-interactive
# redeploy claude-gateway to pick up the new env value
npm run deploy -- --claude
```

The 90-day rotation also forces you to re-verify the scope list above (Cloudflare periodically adds new permissions; don't accidentally collect them).

## Verifying the token is correctly scoped

After saving the token in Doppler, run:

```bash
doppler run -- bash -c 'curl -sH "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  https://api.cloudflare.com/client/v4/user/tokens/verify | jq .'
```

Expected: `success: true, status: "active"`. If 403 / 401 → token bad, recreate.

Then exercise the actual scopes via the dry-run repair script:

```bash
doppler run -- node scripts/repair-codex-gateway-routing.mjs --dry-run
```

If it can list tunnels + zones + DNS without 403s, the scopes are correct.

## Where the token is consumed

| Caller | When | What it does |
|---|---|---|
| [`scripts/cloudflare-tunnel-add-hostname.mjs`](../../scripts/cloudflare-tunnel-add-hostname.mjs) | Manual / CI | Adds a new public hostname to a tunnel + creates CNAME |
| [`scripts/repair-codex-gateway-routing.mjs`](../../scripts/repair-codex-gateway-routing.mjs) | Manual / on incident | Fixes stale tunnel ingress + DNS after a KVM migration |
| `platform-copilot` agent (future `mcp-cloudflare`) | Operator chat at /manage-platform | All of the above + log lookups + future read tools |

## When to mint a separate token

Use a different token (different `CLOUDFLARE_API_TOKEN_*` var in Doppler) when:

- The capability set diverges significantly (e.g. a Workers-deploy token)
- A specific business needs cloudflare-dns access scoped to ONLY their zone (use the `cloudflare-dns` connector at `/settings/accounts` — provisioned per-business)
- You want to revoke access for ONE caller without disrupting others

The two patterns coexist cleanly:

- **`cloudflare`** (admin scope) — shared admin token in Doppler, used by platform-copilot for cross-zone work
- **`cloudflare-dns`** (per-business) — per-business token in `connected_accounts.encrypted_api_key`, injected as `CLOUDFLARE_API_TOKEN` into ONLY that business's container

The provision route picks the right one automatically based on whether `manifest.requiredEnv` includes `CLOUDFLARE_API_TOKEN` for that business's niche.

## Common pitfalls

| Symptom | Likely cause | Fix |
|---|---|---|
| `403 Authentication error` on tunnel API | Token missing `Account:Cloudflare Tunnel:Edit` | Recreate with that permission |
| `403 Zone not found` on DNS API | Zone wasn't picked in `Zone:DNS:Edit` scope list | Edit token → add the zone |
| `9007 Could not route` on tunnel update | Token's account != tunnel's account | Make sure the Account scope matches |
| `Forbidden` from a specific IP | Client IP filter excluded that IP | Add the IP, or use `--allow-from-any` for manual ops (not recommended) |
| Token "expires soon" in dashboard | TTL approaching | Rotate; see the 90-day rotation block above |
