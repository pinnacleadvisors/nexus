# Codex Gateway — non-interactive auth via `CODEX_AUTH_JSON`

> **One-line summary.** Take `~/.codex/auth.json` from your **local laptop** (where you can complete the browser OAuth via `codex login`) and paste it into the Coolify service env as `CODEX_AUTH_JSON`, then redeploy. Future container recreates / volume wipes auto-reauth without needing a working terminal websocket.

> **"Dev machine" terminology.** Throughout this runbook, "dev machine" / "your dev machine" / "your local machine" all mean **the laptop you're reading this on** (e.g. your Mac) — the only machine here with a browser. It is **not** KVM2 (the Hostinger VPS that hosts the codex-gateway container) or KVM4 (the VPS that hosts claude-gateway + per-business containers). Both KVMs are headless and that's exactly why we're shipping `auth.json` to them via env var.

This runbook ships alongside [PR #124](https://github.com/pinnacleadvisors/nexus/pull/124). It assumes the codex-gateway already exists (Phase 8) and is currently logged in.

## TL;DR — current state

```
$ curl -sS https://codex-gw.coolifycloudtunnel.uk/health
{"ok":true,"loggedIn":true,"queueDepth":0,"queueMax":4,"repoPath":"/repo","jobsTracked":0}
```

The gateway is fine right now. **Why bother setting `CODEX_AUTH_JSON`?** Because the existing creds live only in the persistent Coolify volume `codex_home` (mounted at `/root/.codex`). Three things invalidate them:

1. Volume gets recreated (Coolify "Reset volumes" button, accidental `docker volume rm`, KVM2 disk fail).
2. Container is migrated to a different KVM (e.g. KVM2 → KVM3 if you scale).
3. The codex CLI's automatic in-place token refresh fails (rare, but possible).

After any of those, you'd need to `docker exec -it codex-gateway codex login` to recover — and the Coolify terminal websocket has been unreliable behind Cloudflare Tunnel (WebSocket upgrades sometimes get stripped, surfacing as "Terminal websocket connection lost" mid-OAuth). With `CODEX_AUTH_JSON` set in Coolify env, recovery is "redeploy → done."

## Architecture context

| Piece | Where | What this runbook touches |
|---|---|---|
| Gateway server | KVM2 VPS at Hostinger, admin user **`nexus`** | One-line SSH-side check at the end |
| Container orchestrator | Coolify v4 at `https://coolify.coolifycloudtunnel.uk` | Service env vars + redeploy |
| Public ingress | Cloudflare Tunnel → `codex-gw.coolifycloudtunnel.uk` → `codex-gateway:3000` | Used only for `/health` smoke-test |
| Persistent volume | `codex_home` → `/root/.codex` inside the container | Already populated by previous `codex login` — we leave it alone |
| Secret store | Coolify service-level "Environment Variables" tab (NOT Doppler — Doppler is for the Vercel app, not this gateway) | Where `CODEX_AUTH_JSON` is set |

## Prerequisites on your local laptop (the "dev machine")

- `codex` CLI installed: `npm i -g @openai/codex` (or `npx --yes @openai/codex@latest`).
- `gh` CLI authed (only for verifying the PR merged).
- A working browser to complete the OAuth flow.
- ~5 minutes.

## Step 1 — Make sure PR #124 has merged

```bash
gh pr view 124 --json state,mergeCommit
# → state should be MERGED.
```

The change is already baked into `services/codex-gateway/entrypoint.sh` and `services/codex-gateway/docker-compose.yaml` on `main`. The gateway uses `CODEX_GATEWAY_REPO_REF=main` (default) so the next deploy pulls these changes automatically.

## Step 2 — Generate `auth.json` on your local laptop

```bash
# 1. Log in (browser opens — complete the ChatGPT OAuth flow).
codex login

# 2. Sanity-check it worked.
codex login status
# → "Logged in via Auth0 as <your-email>" (or similar)

# 3. Print the file you'll paste into Coolify.
cat ~/.codex/auth.json
# → JSON object, ~1–2 KB. Contains access token + refresh token + metadata.
```

Copy the **entire JSON output to clipboard** — including the outer braces. No transformation, no minification, no quoting tricks. The entrypoint reads the env var literally and writes it byte-for-byte to `/root/.codex/auth.json`.

> **Token sensitivity.** This payload is equivalent to your ChatGPT password — it lets anyone holding it drain your plan. Don't paste it into chat, tickets, gists, or anywhere outside the destination secret store.

## Step 3 — Set the env var in Coolify

The codex-gateway is deployed as a Coolify "Docker Compose" application, so service-level env vars live on the application page (NOT in a project-level shared variable):

1. Open `https://coolify.coolifycloudtunnel.uk`.
2. Navigate to: **Projects → Nexus → codex-gateway** (the application that points at `services/codex-gateway/docker-compose.yaml`).
3. Click the **Environment Variables** tab.
4. Click **+ Add** (or the equivalent "New Variable" button on your Coolify version).
5. Fill in:
   - **Name**: `CODEX_AUTH_JSON`
   - **Value**: paste the entire JSON from step 2.
   - **Is Build Variable**: **OFF** (this is a runtime var, not a build-time arg).
   - **Is Multiline**: **ON** (Coolify needs to know it's multi-line so it doesn't truncate at the first `\n`).
   - **Is Secret/Locked**: **ON** (treat it as a credential).
6. **Save**. Coolify shows the new var in the list with the value masked.

You do **not** need to add this to the docker-compose.yaml — the file already declares `CODEX_AUTH_JSON: "${CODEX_AUTH_JSON:-}"`, and Coolify substitutes the value at deploy time.

## Step 4 — Redeploy

In the Coolify UI, on the **codex-gateway** application page:

1. Click **Redeploy** (top-right). Coolify pulls the latest `main`, rebuilds if needed, and restarts the container.
2. Watch the **Deployment** logs. You should see — somewhere near the bottom of the boot sequence — one of these lines:

   ```
   [codex-gw] /root/.codex/auth.json already exists — keeping volume version (set CODEX_AUTH_JSON_FORCE=1 to overwrite).
   ```

   That's the **expected line** for the current state. The persistent volume already has a valid `auth.json` from the previous `codex login`, so the entrypoint correctly leaves it alone. Your env var is now sitting ready as a "warm spare" — it will activate the moment the volume becomes empty.

   If instead you see:
   ```
   [codex-gw] Hydrated /root/.codex/auth.json from CODEX_AUTH_JSON (plan-billed, non-interactive).
   ```
   That means the volume was empty (or got reset) and the env-var path actually fired. Equally good — you're now logged in via the new mechanism.

## Step 5 — Verify health

From your local laptop:

```bash
curl -sS https://codex-gw.coolifycloudtunnel.uk/health
# → {"ok":true,"loggedIn":true,"queueDepth":0, ...}
```

`loggedIn:true` confirms `/root/.codex` is populated (regardless of which path put it there).

End-to-end smoke test (validates bearer + HMAC + a real `codex exec` round-trip):

```bash
BEARER="$(doppler secrets get CODEX_GATEWAY_BEARER_TOKEN --plain -p nexus -c prd)" \
HOST=https://codex-gw.coolifycloudtunnel.uk \
  ./services/codex-gateway/scripts/smoke.sh
```

Expected: `loggedIn:true` line, an `unsigned POST correctly rejected` line, and a final `signed POST returned a result` line with the model's reply.

## (Optional) Step 6 — Validate the env-var path actually works

If you want to *prove* `CODEX_AUTH_JSON` would take over after a volume reset (so you're not relying on hope when the volume eventually fails), force one bootstrap:

1. In Coolify env vars, add a new var `CODEX_AUTH_JSON_FORCE=1`.
2. Redeploy.
3. Watch the deploy logs — you should now see:
   ```
   [codex-gw] Hydrated /root/.codex/auth.json from CODEX_AUTH_JSON (plan-billed, non-interactive).
   ```
4. **Immediately delete `CODEX_AUTH_JSON_FORCE`** from the env vars (don't redeploy yet — just delete).
5. Redeploy one more time. Logs should return to `already exists — keeping volume version`.

This proves the env-var bootstrap works AND your current volume contents are now equivalent to the Doppler value. If you skip this and the volume ever resets, you've at least got the credentials sitting in Coolify env ready to go.

## When the refresh token rotates (~30 days)

Codex's refresh token rotates periodically — usually within ~30 days, sometimes shorter if OpenAI invalidates a session. When this happens, the value sitting in your Coolify env goes stale. You'll notice it the next time the volume gets reset or a new container starts: hydration fails because the refresh token has been used / expired.

Recovery:

```bash
# On your local laptop (where you have a browser):
codex login                                # browser flow again
cat ~/.codex/auth.json                     # copy the new JSON
```

Then in Coolify:

1. Edit the existing `CODEX_AUTH_JSON` variable, paste the new JSON. Save.
2. Add `CODEX_AUTH_JSON_FORCE=1` (so the entrypoint overwrites the stale on-disk copy).
3. Redeploy.
4. Confirm logs show `Hydrated ... from CODEX_AUTH_JSON`.
5. **Delete `CODEX_AUTH_JSON_FORCE`** so it doesn't fire again on every restart.

If you'd rather avoid this rotation churn entirely, switch to the API-key fallback: set `CODEX_API_KEY=sk-…` (and remove `CODEX_AUTH_JSON`). That's pay-per-token billing, but the key never rotates.

## SSH-side sanity check (only if Coolify UI is unreachable)

If the Coolify UI itself is down or you're locked out, you can verify the gateway from the KVM2 host directly. The admin user is `nexus`:

```bash
ssh nexus@<your-kvm2-host>            # use the Hostinger VPS hostname/IP

# Find the container.
docker ps --format '{{.Names}}\t{{.Status}}' | grep codex-gateway

# Inspect the entrypoint's auth-mode log line directly.
docker logs --tail 200 <container-name> 2>&1 | grep -E '^\[codex-gw\]' | head -20

# Confirm /root/.codex has contents.
docker exec <container-name> ls -la /root/.codex
# Expected: auth.json (plus possibly a small cache file).
```

If `auth.json` is missing or zero-byte, recover via the Coolify UI flow (steps 3–5). Avoid editing the volume directly — Coolify-managed volumes can get desynchronised from the orchestrator's view.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `loggedIn:false` after redeploy | Coolify env var didn't reach the container | Confirm `CODEX_AUTH_JSON` is set on the **application's** Environment Variables tab (not a Project-level shared var). Multi-line OFF will truncate at the first `\n`. |
| `[codex-gw] Hydrated ...` log line never appears | Bootstrap-only check seeing an existing `auth.json` | Expected if the volume already had creds. To force-test, set `CODEX_AUTH_JSON_FORCE=1` for one redeploy. |
| Smoke test 502 with `codex CLI failed` | Hydration succeeded but token is no longer valid (rotated, revoked) | Re-run `codex login`, paste new `auth.json`, set `CODEX_AUTH_JSON_FORCE=1`, redeploy. |
| 401 `bad-signature` from `/api/sessions/.../messages` | Bearer mismatch between Vercel-side `CODEX_GATEWAY_BEARER_TOKEN` and gateway-side `CODEX_GATEWAY_BEARER` | Unrelated to this PR. See [services/codex-gateway/README.md §Debugging 401 bad-signature](../../services/codex-gateway/README.md#debugging-401-bad-signature-from-outside). |
| Coolify deploy logs show `[codex-gw] WARNING: codex CLI is not authenticated.` | Volume empty AND no env var set AND no API key | Set `CODEX_AUTH_JSON` per step 3, redeploy. |

## Why not Doppler for this var?

The codex-gateway is a Coolify-managed service running on KVM2; it doesn't have the Doppler CLI or a service token. Vercel-side env vars sync from Doppler automatically (that's what `scripts/sync-vercel-env.sh` is for), but the gateway's runtime env is owned by Coolify. Putting `CODEX_AUTH_JSON` in Doppler too would create a second copy with no auto-sync — better to keep one source of truth (Coolify) for gateway-side vars and document the rotation flow above.
