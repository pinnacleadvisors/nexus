# Cloudflare Access — gate the shell-capable public hostnames

> P0 Security Remediation **Task 3** (closeout item **1b**). Companion to
> [`p0-security-remediation.md`](p0-security-remediation.md) (Task 3) and
> [`cloudflare-admin-token.md`](cloudflare-admin-token.md).
> Source of truth for ingress: [`services/local-os/cloudflared/config.yml`](../../services/local-os/cloudflared/config.yml).

## Why

Four public hostnames on the `nexus-mac` tunnel are **shell-capable** (a leaked app
secret or gateway bearer alone could drive a shell):

| Hostname | Backs onto | Caller type |
|---|---|---|
| `code.coolifycloudtunnel.uk` | claudecodeui `/code` (host `:3010`) | **human / phone** |
| `n8n.coolifycloudtunnel.uk` | n8n `:5678` | **human / phone** |
| `claude-gw.coolifycloudtunnel.uk` | claude-gateway `:3000` | **machine-to-machine** (nexus-app, n8n) |
| `codex-gw.coolifycloudtunnel.uk` | codex-gateway `:3000` | **machine-to-machine** (nexus-app, n8n) |

Cloudflare Access puts a **network-layer auth gate in front of** each app — defense in
depth, independent of the app's own login / bearer. A leaked app password or gateway
bearer is then no longer sufficient.

> ⚠️ **Machine-to-machine caveat (read before gating the gateways).** `claude-gw.*` and
> `codex-gw.*` are called programmatically (nexus-app → gateway, n8n → gateway) with a
> `Bearer` token. An **interactive** Access policy (One-time PIN) will 302-redirect those
> programmatic callers to a login page and **break them**. For those two hostnames you
> MUST also add a **Cloudflare Access Service Token** to the Allow policy and inject the
> `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers on the callers (see
> [§4](#4-machine-to-machine-the-two-gateways)). `code.*` and `n8n.*` are human-interactive,
> so OTP-only is correct there.

## Who does this

**Operator-only.** Creating Access apps/policies needs the Cloudflare Zero-Trust
dashboard, or an API token with **`Account > Access: Apps and Policies > Edit`**. The
existing Doppler token `CLOUDFLARE_NEXUS_COOLIFY_MIGRATION` (alias `CLOUDFLARE_API_TOKEN`)
is deliberately scoped to **tunnel + DNS only** (see
[`cloudflare-admin-token.md`](cloudflare-admin-token.md)) and **cannot** create Access
apps. Do **not** bolt `Access:Edit` onto that token — mint a **separate** one (§2).

---

## 1. Dashboard path (recommended) — all four hostnames

Do this **once per hostname** (4 apps total). The policy is identical except for the
machine-callable gateways (§4 adds a service token to those two).

1. Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → **Add an
   application** → **Self-hosted**.
2. **Application name:** e.g. `nexus-code` (then `nexus-n8n`, `nexus-claude-gw`,
   `nexus-codex-gw`).
3. **Session Duration:** `24 hours` — suits phone-based ops (operator manages `/code`
   from a phone while travelling). Longer = fewer re-auths on mobile; 24h is a good
   balance.
4. **Application domain:** set the subdomain + domain:
   - App 1 → `code` . `coolifycloudtunnel.uk`
   - App 2 → `n8n` . `coolifycloudtunnel.uk`
   - App 3 → `claude-gw` . `coolifycloudtunnel.uk`
   - App 4 → `codex-gw` . `coolifycloudtunnel.uk`
   Leave **Path** empty (gate the whole host).
5. **Identity providers:** leave **One-time PIN** enabled (no extra IdP setup needed).
   (Optional: add Google login for a faster phone tap.)
6. **Next** → **Add a policy:**
   - **Policy name:** `owner-only`
   - **Action:** `Allow`
   - **Session duration:** inherit (24h)
   - **Configure rules → Include →** selector **Emails**, value
     `nguyendtrade@gmail.com`.
7. **Next** through the remaining defaults → **Add application**.
8. Repeat 1–7 for the other three hostnames.
9. For `claude-gw.*` and `codex-gw.*` only: go to **§4** and add a **Service Token** to
   each app's `owner-only` policy (Include → Service Token), so the programmatic callers
   still pass.

### Verify (per hostname)

```bash
# Expect a 302 redirect to <team>.cloudflareaccess.com (the Access login),
# NOT the app's own page, for an unauthenticated request:
for h in code n8n claude-gw codex-gw; do
  echo "== $h =="
  curl -sS -I "https://$h.coolifycloudtunnel.uk" | grep -iE '^HTTP|^location'
done
```

After logging in once via OTP from your phone, `code.*` should reach claudecodeui's own
login (defense in depth: Access first, then the app).

---

## 2. API path (alternative) — mint a scoped token first

Only if you prefer scripting over the dashboard. **Operator** mints a NEW token:

Cloudflare dashboard → **My Profile → API Tokens → Create Token → Custom token**:

| Resource | Permission | Scope |
|---|---|---|
| Account → Access: Apps and Policies | **Edit** | The account that owns `coolifycloudtunnel.uk` |
| Account → Account Settings | Read | Same account |
| Zone → Zone | Read | `coolifycloudtunnel.uk` (so the script can self-resolve the account id) |

Keep it **separate** from the tunnel/DNS token. Store in Doppler `prd`:

```bash
# operator, dev machine — value pasted interactively, never on the CLI:
doppler secrets set --project nexus --config prd CLOUDFLARE_ACCESS_API_TOKEN
```

Recommended defense-in-depth (same as the tunnel token): a **90-day TTL** + a **Client IP
filter** restricted to your dev-machine IP. See
[`cloudflare-admin-token.md`](cloudflare-admin-token.md).

---

## 3. API curl template (parameterized — NO secret values)

Run under `doppler run --` so `CLOUDFLARE_ACCESS_API_TOKEN` is injected from the vault.
The account id is **self-resolved** from the zone (same trick as
`scripts/cloudflare-tunnel-add-hostname.mjs`), so you never hardcode it.

```bash
#!/usr/bin/env bash
set -euo pipefail

# ── config ───────────────────────────────────────────────────────────────────
ROOT_DOMAIN="coolifycloudtunnel.uk"
OWNER_EMAIL="nguyendtrade@gmail.com"
SESSION="24h"                       # phone-friendly
HOSTNAMES=(
  "code.${ROOT_DOMAIN}"
  "n8n.${ROOT_DOMAIN}"
  "claude-gw.${ROOT_DOMAIN}"
  "codex-gw.${ROOT_DOMAIN}"
)
CF_API="https://api.cloudflare.com/client/v4"
TOKEN="${CLOUDFLARE_ACCESS_API_TOKEN:?set CLOUDFLARE_ACCESS_API_TOKEN (Access:Edit token)}"
AUTH=( -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" )

cf() { curl -sS "${AUTH[@]}" "$@"; }

# ── 1. resolve account id from the zone (no hardcoded id) ─────────────────────
ACCOUNT_ID="$(cf "${CF_API}/zones?name=${ROOT_DOMAIN}" | jq -r '.result[0].account.id')"
[ -n "${ACCOUNT_ID}" ] && [ "${ACCOUNT_ID}" != "null" ] \
  || { echo "could not resolve account id for ${ROOT_DOMAIN}" >&2; exit 1; }
echo "account: ${ACCOUNT_ID}"

# ── 2. create one self-hosted app + Allow(Emails) policy per hostname ─────────
for HOST in "${HOSTNAMES[@]}"; do
  NAME="nexus-${HOST%%.*}"
  echo "== ${NAME} (${HOST}) =="

  # 2a. create the self-hosted Access application
  APP_ID="$(cf -X POST "${CF_API}/accounts/${ACCOUNT_ID}/access/apps" \
    --data @- <<JSON | jq -r '.result.id'
{
  "name": "${NAME}",
  "domain": "${HOST}",
  "type": "self_hosted",
  "session_duration": "${SESSION}"
}
JSON
)"
  echo "  app: ${APP_ID}"

  # 2b. attach the owner-only Allow policy (Emails include rule, OTP login)
  cf -X POST "${CF_API}/accounts/${ACCOUNT_ID}/access/apps/${APP_ID}/policies" \
    --data @- <<JSON | jq -r '"  policy: " + .result.id'
{
  "name": "owner-only",
  "decision": "allow",
  "session_duration": "${SESSION}",
  "include": [ { "email": { "email": "${OWNER_EMAIL}" } } ]
}
JSON
done
```

> The above gives every app an **interactive** OTP gate. For `claude-gw.*` /
> `codex-gw.*` you must ALSO add a service-token rule to their policy (§4) or the
> programmatic callers break.

---

## 4. Machine-to-machine: the two gateways

`claude-gw.*` and `codex-gw.*` are hit by code, not humans. Add a **Service Token** and
include it in their Allow policy alongside the email rule.

### 4a. Create a service token (dashboard)
Zero Trust → **Access → Service Auth → Service Tokens → Create Service Token**
(`nexus-gateway-m2m`). Copy the **Client ID** and **Client Secret** ONCE (the secret is
shown only at creation). Store both in Doppler `prd`:

```bash
doppler secrets set --project nexus --config prd CF_ACCESS_GATEWAY_CLIENT_ID
doppler secrets set --project nexus --config prd CF_ACCESS_GATEWAY_CLIENT_SECRET
```

### 4b. Add the service token to each gateway policy
Edit the `owner-only` policy on `nexus-claude-gw` and `nexus-codex-gw`: **Include → add
rule → Service Token →** `nexus-gateway-m2m`. (API: PUT the policy with an additional
`{ "service_token": { "token_id": "<id>" } }` entry in `include`.)

### 4c. Wire the headers on the callers
Every programmatic request to `claude-gw.*` / `codex-gw.*` must send:

```
CF-Access-Client-Id:     <CF_ACCESS_GATEWAY_CLIENT_ID>
CF-Access-Client-Secret: <CF_ACCESS_GATEWAY_CLIENT_SECRET>
```

Callers to update (anywhere `CLAUDE_CODE_GATEWAY_URL` / `CODEX_GATEWAY_URL` is fetched):
nexus-app's gateway client, and the n8n gateway nodes. These headers ride **alongside**
the existing `Authorization: Bearer <gateway-bearer>` — Access strips the CF-Access-*
headers before forwarding, the app still sees its bearer.

> If you skip §4 the gateways will 302 to the Access login and every M2M call fails.
> Verify after wiring: `curl -H "CF-Access-Client-Id: …" -H "CF-Access-Client-Secret: …"
> https://claude-gw.coolifycloudtunnel.uk/health` returns the app's response, not a login.

---

## Rollback

Delete the Access apps (dashboard → Access → Applications → ⋯ → Delete, or
`DELETE ${CF_API}/accounts/${ACCOUNT_ID}/access/apps/${APP_ID}`). The hostnames revert to
app-login-only immediately; no `config.yml` or tunnel change is involved.

## Done when

- [ ] `code.*` and `n8n.*` show the Cloudflare Access OTP login before the app.
- [ ] `claude-gw.*` / `codex-gw.*` show the Access login to a browser BUT still answer
      programmatic callers that send the `CF-Access-Client-*` headers.
- [ ] The closeout `1b` line in `/Users/Shared/dylan-to-nexus-host-CLOSEOUT.md` is checked.
