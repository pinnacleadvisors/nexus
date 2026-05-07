# Pilot rollout walkthrough — first business migration

A more detailed companion to `per-business-container-rollout.md`. That file is the terse Phase A→H reference; this one is the first-time walkthrough with concrete copy-paste commands and current-UI screenshots-of-words.

> **Already done in this rollout:** Step 1 (Doppler env partially populated), Step 2 (`migration 033_connected_accounts.sql` applied via `doppler run -- npm run migrate`).
>
> **Status:** all platform code is on `main` and validated end-to-end — the GitHub Actions image build, the Composio v3 OAuth flow, and the per-business Coolify provisioning route all work as written below.

## Step 3 — Coolify env (find project + server UUIDs)

You already have `COOLIFY_BASE_URL` and `COOLIFY_API_TOKEN` for KVM2 and KVM4 in Doppler. The new per-business code reads four vars: `COOLIFY_BASE_URL`, `COOLIFY_API_TOKEN`, `COOLIFY_PROJECT_ID_NEXUS_BUSINESSES`, `COOLIFY_KVM4_SERVER_UUID`. Pick **one** Coolify instance (KVM4 is the assumed host based on the env var naming — businesses scale-to-zero so cost is bounded by active count).

### 3a. Pick the host instance and alias in Doppler

In Doppler, the cleanest pattern is to **alias** the chosen KVM-prefixed vars to the unprefixed ones the code expects, so you don't duplicate secrets:

```
COOLIFY_BASE_URL   = ${COOLIFY_KVM4_URL}
COOLIFY_API_TOKEN  = ${COOLIFY_KVM4_TOKEN}
```

Doppler resolves these at inject time. (Replace `KVM4` with `KVM2` if you pick that instance.) Doppler dashboard → Project: `nexus` → Config: `prd` → click **+ Add Secret** → use the reference syntax above.

### 3b. Find the project UUID

You need a Coolify project to hold the per-business apps. Either reuse an existing one (e.g. the project that holds the existing Claude/Codex gateways) or create a new "Nexus Businesses" project so per-business apps stay grouped.

**UI path:**
1. Open `https://${COOLIFY_KVM4_URL}` in a browser, sign in.
2. Left sidebar → **Projects**.
3. Click the project you want to use (or **+ New Project** → name "Nexus Businesses" → Create).
4. The URL bar now reads `https://${COOLIFY_KVM4_URL}/project/<UUID>` — the path segment after `/project/` is the **project UUID**.

**API path** (faster, scriptable):

```bash
doppler run -- bash -c 'curl -s -H "Authorization: Bearer $COOLIFY_KVM4_TOKEN" \
  "$COOLIFY_KVM4_URL/api/v1/projects" | jq ".[] | {uuid, name, description}"'
```

Each entry has `uuid`, `name`, `description`. Pick the one you want.

Set in Doppler:
```
COOLIFY_PROJECT_ID_NEXUS_BUSINESSES = <uuid>
```

### 3c. Find the server UUID

The Claude and Codex gateway UUIDs you already have in Doppler are *application* UUIDs (the gateways themselves), not *server* UUIDs. The server UUID identifies the Docker host Coolify deploys onto.

**UI path:**
1. Coolify dashboard → left sidebar → **Servers**.
2. Click the server that runs your existing gateways (usually "localhost" if you're on a single-VPS setup, or "kvm4" if it's named).
3. URL bar reads `https://${COOLIFY_KVM4_URL}/server/<UUID>` — that's the **server UUID**.

**API path:**

```bash
doppler run -- bash -c 'curl -s -H "Authorization: Bearer $COOLIFY_KVM4_TOKEN" \
  "$COOLIFY_KVM4_URL/api/v1/servers" | jq ".[] | {uuid, name, ip, is_reachable}"'
```

Pick the one whose `name` matches the box you want to host businesses on (or `is_reachable: true` and the IP that matches your KVM4).

Set in Doppler:
```
COOLIFY_KVM4_SERVER_UUID = <uuid>
```

### 3d. Verify

```bash
doppler run -- node -e "
  const { isConfigured, listApps } = require('./lib/coolify/client');
  if (!isConfigured()) { console.error('Coolify env incomplete'); process.exit(1); }
  listApps().then(a => console.log('OK — Coolify reachable, ' + a.length + ' apps')).catch(e => { console.error(e.message); process.exit(1); });
"
```

If this prints `OK — Coolify reachable, N apps`, Step 3 is done.

---

## Step 4 — Build + push the per-business image (Runbook Phase A)

You need a Docker image at `ghcr.io/pinnacleadvisors/nexus-business:<slug>` for the pilot business. Pick a **low-stakes** business — one that's already idle or that you can afford to break.

There are two ways to build+push this image. Pick one:

### Path 1 — GitHub Actions (recommended; zero local install)

A workflow at [`.github/workflows/per-business-image.yml`](../../.github/workflows/per-business-image.yml) does the entire build+push in CI. No Docker on your Mac, no PAT to manage (the workflow uses the built-in `GITHUB_TOKEN`), reproducible across operators.

1. Open https://github.com/pinnacleadvisors/nexus/actions
2. Left sidebar → **Build per-business gateway image**
3. Top-right → **Run workflow** dropdown
4. Fill in:
   - `slug`: pilot business slug (e.g. `pilot-creator`)
   - `niche`: niche string (e.g. `creator`, `ad agency`, `saas`)
   - `mcp_override`: three accepted values:
     - **leave empty** → resolve from `niche` via `lib/businesses/mcp-manifest.ts`
     - **`none`** (four letters, no quotes) → install only the Claude CLI base. **Use this for the very first pilot** — the `@nexus/mcp-*` packages in the catalog are placeholders and not yet published to npm
     - **`<pkg1> <pkg2> …`** → space-separated list of npm packages, used verbatim
5. Click **Run workflow**. Build takes ~3-5 min.
6. When it finishes, the run summary shows the image tag. Skip to **Step 4e**.

### Path 2 — Local Docker on your Mac

Use this if you need to iterate on the Dockerfile or test build args. Otherwise Path 1 is faster.

#### 4a-local. Install Docker

`zsh: command not found: docker` means Docker isn't installed. Two options:

- **OrbStack** (recommended for Mac — much lighter than Docker Desktop):
  ```bash
  brew install --cask orbstack
  open -a OrbStack
  # Wait for it to finish first-run setup, then verify:
  docker --version
  ```

- **Docker Desktop**: https://www.docker.com/products/docker-desktop — heavier but more conventional. Free for personal use; check licensing if your business has > 250 employees or > $10M revenue.

After install, `docker --version` should print something like `Docker version 27.x`.

> **The `cd nexus` doesn't matter for `docker login`** — login is a global Docker operation, not a project one. It does matter for the later `docker build` step (you need to be in the repo root so the Dockerfile can be found).

#### 4b-local. Authenticate to GHCR

GHCR auth for build+push needs a GitHub PAT with `write:packages` scope. The token lives **only on your dev machine** (in macOS Keychain via Docker); it's not secret enough for Doppler.

1. https://github.com/settings/tokens/new (classic token — fine-grained tokens don't yet support packages cleanly).
2. Note: "Nexus per-business image push", expiry: 90 days.
3. Scopes: check **`write:packages`** and **`read:packages`** only.
4. Generate, copy.
5. In your local terminal:
   ```bash
   echo 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxx' | docker login ghcr.io -u dylannguyen --password-stdin
   ```
   Expect `Login Succeeded`. Run anywhere — `cd nexus` not required.

> **Where the PAT does NOT go:** Hostinger root terminal (closed), Coolify localhost terminal (timing out, wrong place anyway), Doppler (this is a per-dev credential, not runtime), the Nexus repo (never commit a token), KVM4 (Coolify's pull credential is separate — see step 4e).

> The remaining 4b–4d steps below apply only to **Path 2 (local Docker)**. If you used GitHub Actions in Path 1, skip to **Step 4e**.

### 4b. Resolve the manifest for your pilot business

Pick the pilot slug + niche. Examples:
| Slug | Niche string |
|---|---|
| `acme-ads`         | "ad agency"  |
| `pilot-creator`    | "creator"    |
| `dev-saas`         | "saas"       |

Then resolve the package list deterministically:

```bash
SLUG=pilot-creator
NICHE="creator"
MCP_PACKAGES=$(node -e "
  const { resolveManifest } = require('./lib/businesses/mcp-manifest');
  const r = resolveManifest({ niche: '$NICHE' });
  console.log(r.mcps.map(m => m.pkg).join(' '));
")
echo "Will install: $MCP_PACKAGES"
```

> **Note:** the `@nexus/mcp-*` packages don't exist on npm yet (they're placeholder names in the catalog). For the very first pilot, override `MCP_PACKAGES=""` so only the Claude CLI base ships. Add real MCP packages incrementally as they're published. (Path 1 equivalent: `mcp_override=none`.)

### 4c. Build

```bash
docker build \
  --build-arg "BUSINESS_SLUG=$SLUG" \
  --build-arg "MCP_PACKAGES=$MCP_PACKAGES" \
  -f services/claude-gateway/Dockerfile.business \
  -t "ghcr.io/pinnacleadvisors/nexus-business:$SLUG" \
  --label "org.opencontainers.image.source=https://github.com/pinnacleadvisors/nexus" \
  services/claude-gateway/
```

The `org.opencontainers.image.source` label associates the package with the `pinnacleadvisors/nexus` repo so the image inherits the repo's collaborator access.

Verify locally before pushing:
```bash
docker run --rm "ghcr.io/pinnacleadvisors/nexus-business:$SLUG" claude --version
# expect: 2.x.x
```

### 4d. Push

```bash
docker push "ghcr.io/pinnacleadvisors/nexus-business:$SLUG"
```

After push, go to https://github.com/orgs/pinnacleadvisors/packages → find the `nexus-business` package.

### 4e. Make the image pullable from Coolify

This is where SSH access to KVM4 *would* matter — Coolify's documented approach is `docker login` on the server itself so its `~/.docker/config.json` has GHCR credentials. **You can't do that** with root SSH closed and the Coolify localhost terminal timing out. Three workable paths instead:

**Option A — make the package public (recommended for now).** The image contains only the public Claude CLI, npm-installed MCP packages, and the gateway TS code. Secrets are injected at runtime by Coolify env vars and aren't baked into the image. There's no real downside to public visibility.

1. https://github.com/orgs/pinnacleadvisors/packages → click `nexus-business` → **Package settings** (top-right gear).
2. Bottom of the page → **Danger Zone** → **Change visibility** → **Public** → confirm.
3. Coolify can now pull without credentials. Skip B and C.

**Option B — register a GitHub PAT in Coolify's UI.** Coolify v4 (≥ 4.0.0-beta.88) has a Container Registry / Private Registry resource. Where this lives in the dashboard varies by minor version; common locations to check (in order):
- **Servers → KVM4 → Settings → Container Registries** (newer versions)
- **Sources → New Source → Docker Registry** (mid-version)
- The official docs still describe the SSH `docker login` path because the dashboard feature shipped without doc coverage — search the dashboard for "registry" if neither path above exists.

If you find it, generate a **separate** `read:packages`-scoped PAT (don't reuse the build PAT — different blast radius), paste it as the password with your GitHub username, save. The per-business app's deploy config gains a "Private Registry" dropdown.

**Option C — restore SSH access for a one-time login.** The cleanest long-term fix. Hostinger panel → KVM4 → Manage → SSH access → re-enable root login (or add your SSH key to a non-root sudo user). Then once:
```bash
ssh user@kvm4 'echo "ghp_xxx" | docker login ghcr.io -u dylannguyen --password-stdin'
```
After that round-trip, close root SSH again. Coolify auto-detects `~/.docker/config.json` for all subsequent pulls. The credential persists across restarts as long as the volume holding the home dir is durable (it is, in default Coolify setups).

**Recommendation:** Use Option A for the pilot. The image has no secrets baked in and "Internal" visibility doesn't really protect anything that matters. If you decide later that the image should be private, do Option C after the pilot is stable so you don't conflate "image pull" failures with other deployment issues during the bake-in.

---

## Step 5 — Composio integrations

The Composio integration uses the v3 API: `POST /api/v3/connected_accounts/link` for OAuth init and `POST /api/v3/tools/execute/{action}` for action execution. The deprecated `/connected_accounts/initiate` endpoint is no longer in use.

### 5a. Confirm toolkit slugs in `lib/oauth/providers.ts`

The 2026 rename touched 1,545 tool slugs. The patched registry uses canonical APP_VERB_NOUN names (e.g. `TWITTER_CREATION_OF_A_POST`, not `TWITTER_CREATE_TWEET`). To verify a specific toolkit:

1. Open https://docs.composio.dev/toolkits/<slug-lower> (e.g. `https://docs.composio.dev/toolkits/twitter`).
2. The page header shows the canonical `Slug:` (e.g. `TWITTER`).
3. The Tools table lists every action enum.
4. Cross-check the entries in `lib/oauth/providers.ts` for that platform.

If a slug is wrong, edit the registry and re-deploy. The MCP / agent code reads the toolkit slug at runtime so a bad slug fails loudly at first execution.

### 5b. Create per-toolkit Auth Configs in Composio dashboard

Each toolkit you intend to support needs an **Auth Config** created once in your Composio account. The Auth Config tells Composio what OAuth credentials to use (your dev app keys) and produces an `auth_config_id` that Nexus passes when initiating a connection.

> **Automation available.** [`scripts/sync-composio-auth-configs.ts`](../../scripts/sync-composio-auth-configs.ts) creates all the Composio-managed Auth Configs for you and pushes their ids back to Doppler. Skips toolkits flagged with `manualSetup` in `lib/oauth/providers.ts` (currently Twitter, Shopify, TikTok — they need your own developer app credentials so Composio can't auto-broker them).
>
> Local one-off:
> ```bash
> doppler run -- npx --yes tsx scripts/sync-composio-auth-configs.ts --dry-run   # preview
> doppler run -- npx --yes tsx scripts/sync-composio-auth-configs.ts             # apply
> ```
>
> Monthly cron via [`.github/workflows/sync-composio-auth-configs.yml`](../../.github/workflows/sync-composio-auth-configs.yml) — runs the 1st of every month and on-demand. Picks up any new providers you add to `lib/oauth/providers.ts` and creates them automatically. Required GitHub Actions secrets: `COMPOSIO_API_KEY`, `DOPPLER_SERVICE_TOKEN`, `DOPPLER_PROJECT`, `DOPPLER_CONFIG`.
>
> The deferred toolkits below still need the manual flow.

**For each manual-setup platform** (Twitter, Shopify, TikTok, plus any toolkit not Composio-managed in your case):

1. Open https://app.composio.dev (sign in).
2. Left sidebar → **Auth Configs** (or **Integrations** in some UI versions).
3. Click **+ New Auth Config** (top right).
4. **Toolkit**: search and select (e.g. `Gmail`). The slug shown in the dropdown matches the `toolkitSlug` in the registry.
5. **Auth scheme**: pick **OAuth2** (default for Gmail/Twitter/LinkedIn/etc.) unless the toolkit only supports API key.
6. **Use Composio managed OAuth app**: toggle this **ON** for most toolkits. Exception: **Twitter** — managed credentials were removed 2026-02-12. For Twitter you must:
   - Toggle **OFF**.
   - Provide your own OAuth client_id + client_secret from https://developer.twitter.com/en/portal/dashboard.
   - Scopes Composio recommends: `tweet.read`, `tweet.write`, `users.read`, `offline.access`.
7. **Scopes**: leave default unless a workflow needs specific extra scopes.
8. **Save**. The detail page now shows the **Auth Config ID** (`ac_xxxxxxxxxxxxxxx`) — copy it.

### 5c. Add the Auth Config IDs to Doppler

For every Auth Config you created in 5b, add:
```
COMPOSIO_AUTH_CONFIG_<TOOLKIT_SLUG_UPPER> = <ac_id>
```

Examples:
```
COMPOSIO_AUTH_CONFIG_GMAIL    = ac_abc123…
COMPOSIO_AUTH_CONFIG_TWITTER  = ac_def456…
COMPOSIO_AUTH_CONFIG_LINKEDIN = ac_ghi789…
```

The slug must be the **uppercase canonical** value from `lib/oauth/providers.ts:OAuthProvider.toolkitSlug` (e.g. `TWITTER`, `GMAIL`, `GOOGLEDOCS`). The init route reads exactly `process.env[\`COMPOSIO_AUTH_CONFIG_${slug}\`]`.

> **Sharing strategy:** see [`connected-accounts-sharing.md`](connected-accounts-sharing.md). Quick version: connect at `/settings/accounts` (no businessSlug) for shared services like Canva, Higgsfield, Tavily; connect at `/settings/accounts?businessSlug=<slug>` for tenant-data services like Gmail, Stripe, Shopify.

### 5d. Connect end-to-end via /settings/accounts

After deploying the patched code:

1. Open Nexus → sign in as the owner.
2. Navigate to **Settings → Accounts** (new tab in the SettingsTabs).
3. Find the platform card you configured (e.g. Gmail) → click **Connect via Composio**.
4. Browser redirects to Composio's hosted OAuth → click through the third-party consent screen.
5. Composio redirects back to `/settings/accounts?connected=gmail` with a green banner.

Verify in the DB:
```bash
doppler run -- psql "$DATABASE_URL" -c \
  "select platform, status, composio_account_id, last_used_at from connected_accounts where status='active';"
```

If you see a row, `executeBusinessAction()` will work for that platform. If the OAuth click does **nothing** with a 503 error, the Auth Config env var name is wrong — double-check 5c.

---

## Step 6 — Pilot rollout (Runbook Phases B–F)

Sequential. Don't move forward until each phase is green.

### 6a. Phase B — Connect business-scoped accounts

The pilot business will run actions through the Composio connection. Do the OAuth round-trip a second time, this time **scoped to the pilot business**:

1. Settings → Accounts page → the URL needs `?businessSlug=<your-pilot-slug>`. Visit `/settings/accounts?businessSlug=pilot-creator`.
2. Click **Connect** for each platform the pilot business needs (e.g. Gmail for the maintain workflow, Twitter for posting, etc.).
3. Verify each connection lands with `business_slug = 'pilot-creator'`:
   ```sql
   select platform, status from connected_accounts where business_slug = 'pilot-creator';
   ```

**Why business-scope:** when an agent calls `executeBusinessAction(userId, businessSlug, 'twitter', 'TWITTER_CREATION_OF_A_POST', ...)`, the helper looks up `(user, businessSlug, platform)` exactly first, then falls back to user-default. Connecting once at user-default is fine for one business; for multiple isolated businesses, scope each.

### 6b. Phase C — Provision the container

```bash
SLUG=pilot-creator
curl -i -X POST "https://nexus.example.com/api/businesses/$SLUG/provision" \
  -H "content-type: application/json" \
  -H "cookie: __session=<your clerk session cookie>" \
  -d '{ "niche": "creator" }'
```

To get the Clerk session cookie: in your browser DevTools → Application → Cookies → `nexus.example.com` → copy `__session` value.

Expected response:
```json
{
  "ok": true,
  "uuid": "<coolify-app-uuid>",
  "fqdn": "pilot-creator.gateway.nexus.example.com",
  "gatewayUrl": "https://pilot-creator.gateway.nexus.example.com",
  "secretsWritten": true,
  "manifest": { "profile": "creator", "mcpIds": ["memory-hq", "firecrawl", "n8n", "canva", …] },
  "note": "Container created in Coolify but not started. Review the deployment in Coolify, then click Start."
}
```

If `secretsWritten: false`, the user-secrets table write failed — check Supabase service role key and `ENCRYPTION_KEY` env. Without those, `business:<slug>` lookups in `resolveClawConfig` won't find the new container.

### 6c. Phase D — Start the container in Coolify

1. Open Coolify → **Projects** → your project → find `nexus-business-$SLUG`.
2. **Configuration** tab — verify:
   - Image: `ghcr.io/pinnacleadvisors/nexus-business:$SLUG`
   - FQDN: `$SLUG.gateway.nexus.example.com` (or whatever you passed)
   - Environment variables include `CLAUDE_GATEWAY_BEARER`, `MCP_PACKAGES`, and the per-MCP env (e.g. `MEMORY_HQ_TOKEN`, `FIRECRAWL_API_KEY`, etc.)
3. **Storages** tab — check the persistent volume `/root/.claude` was created (this holds the `claude login` token across restarts).
4. Top-right → **Deploy**. Watch the logs.
5. Once **Status: Running**, open the **Terminal** tab (or shell into the container) and complete `claude login`:
   ```
   $ claude login
   # follow the OAuth URL, paste the code back
   ```
   The token persists in `/root/.claude/.credentials.json` thanks to the volume.

### 6d. Phase E — Smoke-test the gateway

```bash
curl -i "https://pilot-creator.gateway.nexus.example.com/health"
# expect: HTTP 200, body { "ok": true, "loggedIn": true, "queueDepth": 0 }
```

Then a low-stakes dispatch:

```bash
SLUG=pilot-creator
curl -i -X POST "https://nexus.example.com/api/claude-session/dispatch" \
  -H "content-type: application/json" \
  -H "cookie: __session=<your clerk session>" \
  -d "{
    \"agentSlug\":     \"smoke-test\",
    \"capabilityId\":  \"consultant\",
    \"businessSlug\":  \"$SLUG\",
    \"autoCreateAgent\": true,
    \"inputs\":        { \"task\": \"return the string OK and exit\", \"tools\": [\"Bash\", \"Read\"] }
  }"
```

In Vercel logs, grep for `[claude-session/dispatch]` — you should see the request resolve to the new gateway URL (`pilot-creator.gateway.nexus.example.com`), not the shared one.

### 6e. Phase F — Run a real workflow

Pick the simplest n8n workflow this pilot business has — typically a **maintain** workflow that runs weekly and doesn't post anywhere visible (e.g. "scrape competitor sites and summarise"). In n8n's UI, hit **Execute Workflow** manually. Watch:

- Each dispatch node should show a 200 in n8n's execution log.
- Open Vercel logs for `/api/claude-session/dispatch` — every dispatch's `gatewayUrl` should be the pilot's container.
- If the workflow has a Composio action (e.g. `GMAIL_SEND_EMAIL`), check `connected_accounts.last_used_at` — it should bump to "just now".

If anything fails, **immediately roll back** (Phase G in the main runbook):
```bash
doppler secrets set BUSINESS_GATEWAY_BYPASS_SLUGS="$SLUG" -p nexus -c prd
```
Effect: dispatch goes back to the shared gateway for this slug. The container keeps running but receives no traffic. Investigate, then remove the bypass.

### 6f. Bake time

Run the workflow on its normal schedule for **at least 7 days** before migrating any other business. Track:
- Container memory + CPU in Coolify (idle should be < 200MB; active < 1GB)
- Composio action success rate (DB query: `select platform, count(*) filter (where last_used_at is not null) from connected_accounts where business_slug='$SLUG' group by platform`)
- n8n execution log for any unhandled errors
- Vercel cost (per-business container shouldn't add meaningful Vercel cost; the gateway is on Coolify)

If 7 days are clean, repeat Steps 4–6 for the next business. Document anything weird in `memory/molecular/atoms/` so the next migration learns from it.

---

## Common gotchas

| Symptom | Cause | Fix |
|---|---|---|
| `503 No Composio Auth Config for Twitter` | Missing env var | Step 5c — add `COMPOSIO_AUTH_CONFIG_TWITTER` |
| `Composio /connected_accounts/link failed: 401` | API key wrong/missing | Verify `COMPOSIO_API_KEY` in Doppler |
| `Composio response missing redirect_url / connected_account_id` | Auth Config exists but is misconfigured (wrong scheme, missing scopes) | Open dashboard, edit Auth Config, re-save |
| OAuth click loops back with `error: invalid state` | Cookie SameSite issue (Vercel preview deployments) | Test on production URL or your staging domain that matches `NEXT_PUBLIC_APP_URL` |
| Coolify create returns 422 `name already in use` | Already provisioned this slug | `curl DELETE /api/v1/applications/<uuid>` (lookup via list) and re-run provision |
| Dispatch hangs 30s timeout to new gateway | Container running but `claude login` never done | Phase D step 5 — shell in and run `claude login` |
| `connection_id` missing on callback | Composio's redirect query param name varies (`connected_account_id`, `connection_id`, `connectedAccountId`) | The callback already handles all three — if still failing, check Composio's redirect URL in the dashboard event log |
| MCP package install fails during Docker build | Placeholder `@nexus/mcp-*` doesn't exist on npm | Path 1: set `mcp_override=none`. Path 2: set `MCP_PACKAGES=""`. Add real packages incrementally as they're published |
| GHA workflow fails with `[: too many arguments` | Old workflow had inline `${{ }}` substitution into shell | Fixed in PR #106 — sync `main`. Inputs now flow through `env:` and the sentinel is `none` (not `" "`) |
| GHA workflow fails with `Cannot find module './lib/businesses/mcp-manifest'` | Old workflow used `node -e` which can't load TS | Fixed in PR #106 — workflow now uses `npx --yes tsx -e` |
