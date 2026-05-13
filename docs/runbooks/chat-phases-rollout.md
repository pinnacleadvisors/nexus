# Chat phases rollout — manual operator guide

Step-by-step rollout for the chat surfaces shipped in PRs #165–#167 (Phases 5b / 2c / 7 of `task_plan-chat.md`). Walks through every click in Coolify + Vercel + the Nexus app so you can verify everything is wired end-to-end without guessing.

## What you're rolling out

| PR | Phase | Code change | Operator action |
|----|-------|-------------|-----------------|
| [#165](https://github.com/pinnacleadvisors/nexus/pull/165) | 5b | Per-business chat full parity (sidebar / multi-chat / delete / tool-call cards / streaming) | None — Nexus auto-deploys on Vercel |
| [#166](https://github.com/pinnacleadvisors/nexus/pull/166) | 2c | `delegate_to_codex` MCP tool baked into claude-gateway | Set 2 Coolify env vars + redeploy claude-gateway |
| [#167](https://github.com/pinnacleadvisors/nexus/pull/167) | 7 | Playwright + Chromium baked into codex-gateway image | Redeploy codex-gateway (no env changes) |
| [#168](https://github.com/pinnacleadvisors/nexus/pull/168) | — | protobufjs CVE-2026-44293 patch | None — Vercel auto-deploys |

All four merged. The operator-side work is configuring Coolify and verifying. Total time: ~10 min (excluding the ~5-min container build wait).

## TL;DR — the 4-step quick path

1. Open Coolify on KVM2 (http://72.62.244.75:8000) → `My first project` → `production` → **`codex-gateway`** → click **Redeploy**. Wait ~5 min for the Playwright/Chromium install.
2. Open Coolify on KVM4 (your KVM4 Coolify URL) → find the **`claude-gateway`** service → **Environment Variables** tab → add `CODEX_GATEWAY_URL` and `CODEX_GATEWAY_BEARER_TOKEN` (values are the same as the ones already set in Doppler for Vercel) → click **Save** → click **Redeploy** on the service.
3. In the Coolify boot log for claude-gateway, look for `[gateway] Wrote MCP config: composio-admin memory-hq codex-delegate`. If `codex-delegate` is missing, the env vars from step 2 didn't land.
4. Open https://nexus.vercel.app (or your prod URL) → sign in → `/manage-platform` Console tab → run the three verification prompts in `## Verification` below.

If you want the why behind each click, read the rest of this guide. If anything fails, jump to `## Troubleshooting`.

## Step 1 — Set Coolify env vars on claude-gateway (KVM4)

Phase 2c (PR #166) adds the `delegate_to_codex` MCP tool to the claude-gateway. The MCP server is built at boot from `/repo/services/mcp-codex-delegate/`, but only when both env vars are present.

### 1.1 — Open the claude-gateway service in Coolify

The claude-gateway lives on **KVM4**, not the same Coolify instance as codex-gateway. Use the bookmark / URL you saved when you provisioned it.

Once logged in:

1. Click your **project** in the left sidebar (whatever you named the project that holds the claude-gateway service — typically `nexus` or `production`).
2. Click the **environment** (probably `production`).
3. Click the **`claude-gateway`** service tile.

You should see a service detail page with tabs along the top: **Configuration**, **Environment Variables**, **Logs**, **Deployments**, etc. (Tab names may differ slightly in newer Coolify versions — look for the one labelled "Environment Variables" or just "Env".)

### 1.2 — Add the two new env vars

Click the **Environment Variables** tab. You'll see the existing rows for `CLAUDE_GATEWAY_BEARER`, `ALLOWED_USER_IDS`, `COMPOSIO_API_KEY`, `MEMORY_HQ_TOKEN`, etc.

Click **+ Add** (or **Add Variable** depending on Coolify version) **twice**, once for each:

| Name | Value | Notes |
|---|---|---|
| `CODEX_GATEWAY_URL` | _Same value as Nexus's Vercel `CODEX_GATEWAY_URL`_ | Doppler → `production` config → search for `CODEX_GATEWAY_URL` → copy the value. Looks like `https://codex-gw.<your-domain>` |
| `CODEX_GATEWAY_BEARER_TOKEN` | _Same value as Nexus's Vercel `CODEX_GATEWAY_BEARER_TOKEN`_ | Same Doppler config — long hex string |

> **Don't mark them as `Build Variable`** unless your Coolify service is set up that way for the others — these are runtime env vars read by the entrypoint script. Match the same checkbox configuration you used for `COMPOSIO_API_KEY` (which is also runtime).

Optional tuning vars (skip unless you have a reason):

| Name | Value | Purpose |
|---|---|---|
| `CODEX_DELEGATE_TIMEOUT_MS` | `300000` | Max ms before a `delegate_to_codex` call gives up. 5 min is sane for most smoke tests; bump to `600000` if you delegate long research tasks. |
| `CODEX_DELEGATE_POLL_MS` | `3000` | How often the MCP polls the codex-gateway job endpoint. Default 3s. |

Click **Save** at the top of the env-vars panel.

### 1.3 — Redeploy claude-gateway

The new env vars only take effect after a redeploy.

In the same service page, find the **Redeploy** button (usually top-right, sometimes hidden under a dropdown labelled "Actions" or "..."). Click it.

A modal will ask if you want to redeploy. Confirm. Coolify starts the build:

1. Pulls the latest `services/claude-gateway/` image (or rebuilds from Git if it's set up that way).
2. Stops the old container.
3. Boots the new container — entrypoint runs `npm install` + `npm run build` in `/repo/services/mcp-codex-delegate/`.
4. Health probe waits for `/health` to return 200.

You should see status flip to **Running** within ~30–60 s.

### 1.4 — Confirm codex-delegate registered

Still on the service page, click the **Logs** tab (or `Live Logs` in newer versions). Filter / scroll to find a recent line starting with `[gateway]`. You're looking for:

```
[gateway] Building codex-delegate MCP from /repo/services/mcp-codex-delegate...
[gateway] codex-delegate MCP built — will register.
...
[gateway] Wrote MCP config: composio-admin memory-hq codex-delegate
```

If the last line lacks `codex-delegate`, jump to `## Troubleshooting → claude-gateway didn't pick up the new MCP`.

## Step 2 — Redeploy codex-gateway (KVM2)

Phase 7 (PR #167) bakes Playwright + Chromium into the codex-gateway image. No env changes — just rebuild.

### 2.1 — Open codex-gateway in Coolify

Open Coolify on **KVM2**: http://72.62.244.75:8000

Navigate: left sidebar → **My first project** → **production** → **`codex-gateway`**.

### 2.2 — Redeploy

Click **Redeploy** (same place as for claude-gateway — top-right or under an "Actions" dropdown).

This time the build is **slow** — Playwright's `npx playwright install chromium` step downloads ~150 MB of browser binaries and the Dockerfile installs ~14 system packages for headless Chrome (libnss3, libcups2, libdrm2, etc.). Plan on **5–8 minutes** for the first build.

Subsequent rebuilds use the cached layer — back to ~30 s.

### 2.3 — Confirm the boot is healthy

When the build finishes and the new container starts, the service should flip back to **Running** with `/health` returning 200.

In the Logs tab, look for the standard codex-gateway boot lines:

```
[gateway] Using credentials from /root/.codex (persistent volume).
[gw] GET /health 200 ...
```

There's no Playwright-specific boot log — Playwright sits idle until the codex agent invokes `nexus-smoke`.

You can sanity-check from the codex chat tab (in Nexus) by asking codex directly:

> "Run `which nexus-smoke` and `nexus-smoke --help` and show me the output."

You should see `/usr/local/bin/nexus-smoke` and the wrapper's usage line.

## Step 3 — Verify each phase in the Nexus UI

Sign into Nexus (https://nexus.vercel.app or your custom domain). Make sure you're signed in as the user listed in `ALLOWED_USER_IDS`.

### Phase 5b (per-business chat full parity)

1. Click **Businesses** in the left sidebar.
2. Click any business tile (or create a test one if you don't have any yet).
3. On the business detail page, click the **Chat** tab.

You should see:

- Left rail labelled **+ New chat** + "No past chats. Click 'New chat' to start." empty state
- Right pane with header `<business name> copilot — scoped to this business…`
- Empty-state placeholder with example prompts

Send a test message: type `"What MCP tools do you have access to for this business?"` → press Enter.

Observe:

- ✅ The message appears in the right pane
- ✅ A "Working… (Ns)" indicator with a red **Cancel** button shows below
- ✅ After ~10–30 s, a streaming bubble appears with partial text
- ✅ The final assistant reply renders, replacing the streaming bubble
- ✅ Left rail shows the new session with an auto-derived title
- ✅ Tool-call cards (if the agent called any MCP) appear above the prose, collapsible

Reload the page (Cmd-R / Ctrl-R):

- ✅ Sidebar still shows the session
- ✅ Clicking it restores the full history including tool cards

Hover over the session row → click the trash icon → confirm → it disappears.

### Phase 2c (delegate_to_codex)

1. Click **Manage Platform** in the left sidebar (or navigate to `/manage-platform`).
2. Click the **Console** tab.
3. Send: `"Use the codex-delegate MCP tool to ssh into KVM2 and run 'uptime'. Show me the JSON output it gives back."`

Observe:

- ✅ A `ToolCallCard` titled `delegate_to_codex` (or `mcp__codex-delegate__delegate_to_codex` if Coolify hasn't picked up the friendly-name strip yet) appears in the assistant bubble
- ✅ Clicking the card expands it to show the `task` argument sent to codex
- ✅ Once the codex job finishes (1–3 min typically), the card's Output section shows the codex transcript including the `uptime` command output
- ✅ The assistant prose below summarises what codex did

If the card shows `error: Codex delegation failed: …`, jump to `## Troubleshooting → delegate_to_codex returns "gateway error"`.

### Phase 7 (Playwright smoke tests)

1. Still in `/manage-platform` Console.
2. Send: `"Smoke-test https://nexus.vercel.app using nexus-smoke. Check that the page contains 'Sign in' and timeout at 15 seconds. Return the JSON output."`

Observe:

- ✅ A `delegate_to_codex` tool card appears (Phase 2c chain)
- ✅ Inside, codex runs `nexus-smoke https://nexus.vercel.app --check="Sign in" --timeout-ms=15000`
- ✅ Output JSON shows `status: 200`, `title: "Sign in to Nexus"` (or similar), `checkPresent: true`, `ok: true`, `loadedMs: <under 2000>`

If `nexus-smoke: command not found` appears, the Phase 7 Dockerfile didn't land — the codex-gateway redeploy in **Step 2** didn't actually run with the new image. Re-trigger from Coolify.

## Verification — full end-to-end script

Paste this exactly into the platform-copilot chat:

```
Run a three-part end-to-end check:

1. List the MCP tools you have access to right now (composio-admin, memory-hq,
   and codex-delegate should all show up).

2. Use delegate_to_codex to ask codex-operator to run `uptime` on KVM2 and
   return the output verbatim.

3. Use delegate_to_codex to ask codex-operator to run `nexus-smoke
   https://example.com --timeout-ms=10000` and return the JSON.

Synthesise all three results into a short summary table.
```

Expected outcome:
- 3 tool cards in the final assistant message (one per phase)
- The summary table shows ✅ for each
- Total turn duration: 60–180 s

## Troubleshooting

### claude-gateway didn't pick up the new MCP (codex-delegate not in boot log)

Possible causes:

1. **Env vars typoed.** Open Coolify → claude-gateway → Environment Variables tab → double-check `CODEX_GATEWAY_URL` and `CODEX_GATEWAY_BEARER_TOKEN` are present (and not as `CODEX_GATEWAY_BEARER` without the `_TOKEN` suffix).
2. **Container hasn't restarted.** Adding env vars in Coolify doesn't restart by itself — you must click **Redeploy** after saving.
3. **`/repo/services/mcp-codex-delegate/` directory missing.** Means the entrypoint's `git clone` / `git fetch` didn't see the merged code. Force a fresh clone: in Coolify → claude-gateway → **Configuration** → find any toggle like `Pull latest on deploy` and ensure it's on. Or wipe the persistent `/repo` volume and redeploy.
4. **npm install failed.** Look earlier in the boot log for `npm install` errors. Often a transient registry timeout — just **Redeploy** again.

### delegate_to_codex returns "gateway error"

Open the codex-gateway logs on KVM2 (Coolify → `My first project` → production → `codex-gateway` → Logs). When platform-copilot delegates, you should see lines like `[gw] POST /api/jobs 200` and then `[gw] GET /api/jobs/job_xxx 200`. If you see 401s instead, the bearer token on KVM4 doesn't match the bearer on KVM2 — both must equal Doppler's `CODEX_GATEWAY_BEARER_TOKEN` (Nexus side) which equals `CODEX_GATEWAY_BEARER` (codex-gateway side).

If you see no requests at all, the URL in `CODEX_GATEWAY_URL` on claude-gateway points somewhere wrong. Curl it from a third box: `curl https://codex-gw.<your-domain>/health` should return 200.

### nexus-smoke fails with "browser not found" or "Chromium executable not found"

The Playwright install during Step 2 didn't write to `/usr/local/playwright-browsers`. Possible causes:

1. **Build cache reuse.** Coolify cached the layer from before the Dockerfile change. Force a rebuild: Coolify → codex-gateway → **Redeploy** → look for a "Clear build cache" or "Force rebuild" option in the modal. If not visible, push a no-op commit to `main` (e.g. add a comment to `services/codex-gateway/Dockerfile`) so the layer hash changes.
2. **Image still references the old Dockerfile.** Run `docker image ls` on KVM2 directly — the codex-gateway image's created-at timestamp should be after the PR #167 merge. If it's older, Coolify never rebuilt.

### Phase 5b sidebar is empty after sending a message

Check the browser console (F12) for the `/api/businesses/<slug>/chat/sessions` call:

- 401 → you're signed out. Sign back in.
- 200 with `sessions: []` → the session was created in `chat_sessions` but with scope `business:<wrong-slug>`. Check the URL slug matches the row's scope value.
- 500 → check Vercel function logs for `business-chat:sessions:list` errors.

### Sentry alerts about new pollers

The Phase 5b chat poll loop hits `/api/businesses/<slug>/chat/poll` every 2.5 s while a job is in-flight. This is the same pattern as `/api/platform-chat/poll` which is already in the Sentry sampler's `SKIP_PATTERNS` (`lib/sentry/sampler.ts`). If you see new poll-related spans dominating your Sentry usage, add `^/api/businesses/[^/]+/chat/poll$` to that file's skip list and redeploy.

## Reference — what env vars live where

| Env var | Vercel (Nexus) | claude-gateway (KVM4) | codex-gateway (KVM2) | Notes |
|---|---|---|---|---|
| `CLAUDE_CODE_GATEWAY_URL` | ✅ | — | — | Where Nexus reaches the claude-gateway |
| `CLAUDE_CODE_BEARER_TOKEN` | ✅ | matches `CLAUDE_GATEWAY_BEARER` | — | Nexus → claude-gateway auth |
| `CODEX_GATEWAY_URL` | ✅ | ✅ (**new in 2c**) | — | Both Nexus AND claude-gateway need it now |
| `CODEX_GATEWAY_BEARER_TOKEN` | ✅ | ✅ (**new in 2c**) | matches `CODEX_GATEWAY_BEARER` | All three carry the same value |
| `COMPOSIO_API_KEY` | ✅ | ✅ | — | claude-gateway MCP only |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ✅ | — | Used by mcp-composio-admin to scope-filter |
| `MEMORY_HQ_TOKEN` | ✅ | ✅ | — | claude-gateway memory-hq MCP |
| `ALLOWED_USER_IDS` | ✅ | ✅ | ✅ | Same value everywhere — defence-in-depth gate |

## When to revisit this guide

After every new chat-phase PR lands, refresh the phase table at the top and add a new step for whatever the operator action is. Don't let this drift — the operator workflow is the most fragile part of a multi-host setup.
