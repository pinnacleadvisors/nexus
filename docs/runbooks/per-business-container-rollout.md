# Runbook — Per-business container rollout

Migrating a business from the **shared Claude gateway** to its **own Coolify container**. Targets the architecture in `task_plan-execution-overhaul.md`.

> **Pre-reqs:** Coolify access, GitHub Container Registry credentials, Doppler write, Composio admin. Doppler config `prd` or `dev` (whichever the user runs against).

## Sanity check before starting

```bash
# 1. Coolify is configured
echo "$COOLIFY_BASE_URL $COOLIFY_PROJECT_ID $COOLIFY_SERVER_UUID"
# 2. Connected accounts schema migrated
psql -c "\d connected_accounts"
# 3. Frontend-design + composio MCP packages reachable from npm
npm view @anthropic-ai/claude-code version
```

If any fail, stop and remediate — the runbook assumes Phase 1–5 have shipped to `main`.

## Phase A — Build and push the per-business image

The image is built once per business (or once per niche profile, if shared). Build args are resolved from `lib/businesses/mcp-manifest.ts`.

```bash
SLUG=acme-ads
NICHE="ad agency"
MANIFEST=$(node -e "
  const { resolveManifest } = require('./lib/businesses/mcp-manifest');
  const r = resolveManifest({ niche: '$NICHE' });
  console.log(r.mcps.map(m => m.pkg).join(' '));
")

docker build \
  --build-arg BUSINESS_SLUG=$SLUG \
  --build-arg "MCP_PACKAGES=$MANIFEST" \
  -f services/claude-gateway/Dockerfile.business \
  -t ghcr.io/pinnacleadvisors/nexus-business:$SLUG \
  services/claude-gateway/

docker push ghcr.io/pinnacleadvisors/nexus-business:$SLUG
```

Verify: `docker run --rm ghcr.io/pinnacleadvisors/nexus-business:$SLUG claude --version` prints a version.

## Phase B — Connect the OAuth accounts

Before provisioning the container, hook up Composio connections so `executeBusinessAction()` can find them.

1. Sign into the Nexus UI as the owner.
2. Navigate to **Settings → Accounts** with `?businessSlug=$SLUG`.
3. For each platform the business needs (Twitter, LinkedIn, Gmail, Stripe, …), click **Connect** and complete the Composio OAuth round-trip.
4. Confirm green checkmarks appear for each platform.
5. In the DB, verify rows exist:

```sql
select platform, status from connected_accounts where business_slug = 'acme-ads';
```

## Phase C — Provision the container

```bash
curl -X POST https://nexus.example.com/api/businesses/$SLUG/provision \
  -H "Cookie: __session=<owner clerk session>" \
  -H "content-type: application/json" \
  -d "{\"niche\":\"$NICHE\"}" | jq
```

Expected response:
```json
{ "ok": true, "uuid": "...", "fqdn": "acme-ads.gateway...", "manifest": { "profile": "ad-agency", "mcpIds": [...] } }
```

The endpoint persists `business:$SLUG` secrets to `user_secrets` so dispatch picks the new container up automatically.

## Phase D — Start the container in Coolify

The provisioner deliberately does NOT start the container. Open Coolify, navigate to the new app `nexus-business-$SLUG`, review:

- [ ] Image tag matches the slug
- [ ] Env vars include `CLAUDE_GATEWAY_BEARER` (from provisioner) + manifest env (from Doppler)
- [ ] FQDN points where DNS is configured
- [ ] Persistent volume `/root/.claude` exists (for Claude OAuth token)

Click **Start**. Watch logs until `claude login` completes (one-time interactive — log in via Coolify's terminal panel).

## Phase E — Smoke-test the container

```bash
curl -i https://acme-ads.gateway.nexus.example.com/health
# expect: { ok: true, loggedIn: true, queueDepth: 0 }
```

Trigger a low-stakes dispatch:

```bash
curl -X POST https://nexus.example.com/api/claude-session/dispatch \
  -H "Cookie: __session=..." \
  -H "content-type: application/json" \
  -d "{
    \"agentSlug\":     \"smoke-test\",
    \"capabilityId\":  \"consultant\",
    \"businessSlug\":  \"$SLUG\",
    \"inputs\":        { \"task\": \"return the string OK and exit\", \"tools\": [\"Bash\"] }
  }"
```

Expected: 200 with `gateway: 'business'` in metadata, response within 60s.

## Phase F — Run a full workflow

Pick the simplest n8n workflow the business has — typically a maintain workflow that doesn't post anywhere visible. Run it end-to-end and watch for:
- All dispatch nodes resolve via the new gateway (check Vercel logs for `[claude-session/dispatch] resolved gateway: business:$SLUG`)
- Tool budget is honoured (the chosen MCP appears in the agent's session log)
- Connected-account actions succeed (`executeBusinessAction` finds the right composio_account_id)

If anything fails, immediately roll back (Phase G) — don't try to debug in production.

## Phase G — Rollback

Two options, in order of severity:

**Soft rollback** — bypass this business only:
```bash
doppler secrets set BUSINESS_GATEWAY_BYPASS_SLUGS="$SLUG,$OTHER_BYPASSED" \
  -p nexus-prd -c prd
```
Effect: dispatch uses the shared gateway for `$SLUG` until you remove the entry. The container keeps running but receives no traffic.

**Hard rollback** — disable per-business routing globally:
```bash
doppler secrets set DISABLE_PER_BUSINESS_GATEWAY=1 -p nexus-prd -c prd
```
Effect: every dispatch uses the shared gateway regardless of business secrets. Use only if multiple businesses fail simultaneously.

Containers continue costing money while running — once you're confident, also stop the Coolify app from the UI.

## Phase H — Decommission the bypass

Once the business has been stable on its own container for ≥7 days:
```bash
doppler secrets unset BUSINESS_GATEWAY_BYPASS_SLUGS -p nexus-prd -c prd
# or remove this slug from the comma list
```

Move the next business through Phases A–G. Repeat until all businesses are migrated, then file a follow-up to remove the user-default `claude-code` config (only env-level fallback should remain).

## Failure modes worth knowing

| Symptom | Likely cause | Fix |
|---|---|---|
| Coolify create returns 422 | FQDN already in use OR project_uuid mismatch | Pick a unique FQDN; verify `COOLIFY_PROJECT_ID` |
| Dispatch hangs at 30s timeout | Container not started OR `claude login` not completed | Check Coolify logs; complete login interactively |
| Connected-account action throws `ConnectedAccountMissingError` | Phase B not complete OR business_slug mismatch | Re-run Phase B; verify the row in `connected_accounts` |
| Workflow validation fails repeatedly even after debugger pass | Stale n8n MCP version OR new node type the catalog doesn't know | Update `@nexus/mcp-n8n` in the manifest; rebuild image |
| `BUSINESS_GATEWAY_BYPASS_SLUGS` doesn't take effect | Vercel env not refreshed | Force-redeploy or roll the function via the dashboard |

## Memory-hq atom

After successful migration of one business, write an atom so the next session can learn from the run:

```bash
node .claude/skills/molecularmemory_local/cli.mjs --backend=github atom \
  "Per-business container rollout — $SLUG" \
  --fact "Migrated $SLUG to its own Coolify gateway. Profile=$NICHE, mcps=N, hiccups=…" \
  --moc per-business-containers
```
