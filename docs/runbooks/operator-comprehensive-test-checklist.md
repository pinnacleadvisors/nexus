# Operator comprehensive-test checklist (2026-06-01)

Companion to the comprehensive Playwright + `npm run dev` sweep. Work top→bottom;
each item says **what**, **why**, and **how to verify**. Items marked **[KEY]**
are Doppler secrets; **[UI]** are clicks in the app; **[DEPLOY]** need a gateway
rebuild.

Check a Doppler key with:
```bash
doppler run -- node -e "console.log(process.env.NAME ? 'SET' : 'MISSING')"
# or, scoped: doppler secrets get NAME --config prd --plain
```

---

## A. Fixes shipped in this branch (no operator action — context)
- [x] **Random logout during chat** — client now retries transient 401s before redirecting (Clerk token-refresh race). No key needed.
- [x] **Agent-activity feed empty** — `/api/run-events` query fixed + chat turns merged into the heartbeat. No key needed.
- [x] **Model dropdown** — Opus 4.8 default, outdated models filtered, scrollable (prior PRs #458/#460).

## B. Slack notifications — **the reported "Slack not working"**
**✅ CODE-FIXED + verified live (this branch):** the real cause was `executeAction()`
omitting `user_id`, so Composio v3 400-ed every send ("User ID is required with
connected account"). Fixed — `/api/notifications/test` now returns `{ok:true}` and a
real Slack message lands. The items below are only needed for a FRESH setup; if
Slack worked once, your connection + keys are already present.
- [ ] **[KEY]** `COMPOSIO_API_KEY` set in Doppler (`prd`). *Why:* required for any Composio action. *Verify:* check command above.
- [ ] **[KEY]** `COMPOSIO_AUTH_CONFIG_SLACK` set in Doppler. *Why:* the Slack toolkit auth-config id from the Composio dashboard. *How:* https://app.composio.dev → New Auth Config → Slack → copy the `auth_config_id` → `doppler secrets set COMPOSIO_AUTH_CONFIG_SLACK=<id>`.
- [ ] **[UI]** Link Slack at **/settings/accounts → Slack → Connect** (creates the `connected_accounts` row the notifier resolves). *Verify:* the row turns "active".
- [ ] **[UI]** Pick the target channel + enable the categories you want at **/settings?tab=alerts**.
- [ ] **[VERIFY]** `POST /api/notifications/test` with `{ "channel": "slack", "category": "security-alert" }` → a message lands in Slack within a few seconds. (If it returns `skipped: 'unconfigured'`, the connection/keys above are missing.)
- [ ] **[KEY]** `ALLOWED_USER_IDS` includes your Clerk user id. *Why:* `notifyOperator` skips users not in the allowlist. *Verify:* you can access protected routes (you already can).

## C. Subscription billing (node-pty) — drains the Max plan, not API rate
Per the earlier finding: `claude -p` bills at **API rate**; the pty path bills the subscription. (June-15-2026 change makes `-p` API-metered.)
- [ ] **[KEY]** `CLAUDE_CODE_OAUTH_TOKEN` set on the **claude-gateway** container (Doppler). *Why:* Max-plan auth. *How:* `claude setup-token` on a dev machine → paste into Doppler. *Verify:* gateway boot log says "Using CLAUDE_CODE_OAUTH_TOKEN (Max plan)".
- [ ] **[DEPLOY]** Rebuild/redeploy **claude-gateway** (new `node-pty` dep + `spawnPty.ts` from PR #458).
- [ ] **[UI]** Set **/settings?tab=ai → Anthropic → Execution mode = `subscription`** (or `node-pty`). *Why:* routes turns through the pty path.
- [ ] **[KEY, optional]** `CLAUDE_DEFAULT_EXEC_MODE=pty` on the gateway to default ALL turns to subscription billing.
- [ ] **[VERIFY]** Run a chat turn, then confirm in the Anthropic console that API spend did **not** increment (it drew on the Max plan).

## D. Codex gateway (timeouts fixed in PR #458)
- [ ] **[DEPLOY]** Redeploy **codex-gateway** + **mcp-codex-delegate** to pick up `CODEX_JOB_TIMEOUT_MS=480s` / delegate `600s` defaults (no key change needed).
- [ ] **[KEY]** `CODEX_AUTH_JSON` fresh (rotates ~30 days). *Verify:* `npm run diagnose:codex` → `/health` passes, `authJsonValid: true`.

## E. Model auto-discovery (optional)
- [ ] **[KEY, optional]** `ANTHROPIC_API_KEY` set so `/api/models/available` can surface newer Claude releases automatically. Without it, the curated static list (incl. Opus 4.8) is served — still fully functional.

## F. Core platform keys (verify present — should already be set)
- [ ] **[KEY]** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` — auth.
- [ ] **[KEY]** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — DB.
- [ ] **[KEY]** `ENCRYPTION_KEY` — per-user secret encryption (provider prefs, user secrets).
- [ ] **[KEY]** `CLAUDE_CODE_GATEWAY_URL` + `CLAUDE_CODE_BEARER_TOKEN` — chat dispatch.
- [ ] **[KEY]** `STRIPE_WEBHOOK_SECRET` — revenue attribution (if testing payments).
- [ ] **[KEY, optional]** web-push (`VAPID_*`) — for the web-push notification channel (alternative to Slack).

## G. After the comprehensive test
- [ ] Review the crawl report (console/page errors per route) — file issues for any red routes.
- [ ] Clean up any test artifacts created during destructive tests (test businesses, test chat sessions) — the test agent proposes cleanup per item.
- [ ] Re-run `npm run check:all` locally (lint debt is pre-existing; tsc + check:* must be green).

---

### Notes
- This checklist is seeded from the three reported bugs + the platform's documented env (`memory/platform/SECRETS.md`). The live crawl appends any page-specific missing-config findings below as they're discovered.
- Doppler is the single source of truth — never paste secrets into Coolify/Vercel directly except `DOPPLER_TOKEN`.
