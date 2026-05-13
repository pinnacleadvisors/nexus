# Codex + Playwright — browser smoke tests

Phase 7 of `task_plan-chat.md`. Lets the **platform-copilot** delegate a quick browser smoke test against a Vercel preview URL (or any public URL) via the **codex-delegate** MCP tool, after pushing a feature branch and before requesting merge approval.

## How it fits together

```
┌──────────────────────┐       delegate_to_codex({task: "...", agent: "codex-operator"})
│ platform-copilot     │ ───────────────────────────────────────────────────────────────┐
│ (claude-gateway,     │                                                                │
│  KVM4)               │                                                                ▼
└──────────────────────┘                                              ┌──────────────────────────┐
                                                                      │ codex-operator           │
                                                                      │ (codex-gateway, KVM2)    │
                                                                      │                          │
                                                                      │ shell: nexus-smoke ...   │
                                                                      │                          │
                                                                      │ chromium headless ──▶ URL │
                                                                      └──────────────────────────┘
```

- `nexus-smoke` is a lightweight Playwright wrapper baked into the codex-gateway image at `/usr/local/bin/nexus-smoke` (source: `services/codex-gateway/scripts/nexus-smoke.mjs`).
- Codex's shell tool invokes it directly — no new HTTP endpoint required. The output is JSON, so codex can parse + summarise it for the operator.
- The chat UI renders the entire delegation as a `ToolCallCard`, showing the codex transcript with the JSON smoke result + screenshot path (if used).

## What `nexus-smoke` does

```
nexus-smoke <url> [--check=<substring>] [--screenshot=<path>] [--timeout-ms=<n>]
```

- Launches headless Chromium
- Navigates to `<url>` and waits for `load`
- Captures HTTP status, page title, load duration, and any console.error / pageerror events
- Optional: checks for a substring in the rendered HTML (`--check`)
- Optional: writes a viewport screenshot to a path (`--screenshot`)
- Emits JSON to stdout
- Exits **0** when status is 2xx/3xx and the optional `--check` substring is found; **1** when the smoke fails; **2** on a setup/navigation error

Default timeout is 30s — adjust with `--timeout-ms`.

## Example platform-copilot prompts

The operator can ask the platform-copilot directly:

> "I just pushed `feat/new-cta-button` — Vercel will have built a preview at `https://nexus-<hash>-pinnacleadvisors.vercel.app`. Smoke-test that the dashboard renders and the new CTA is visible."

Platform-copilot then calls `delegate_to_codex` with a brief like:

```
Run nexus-smoke against <preview-url>/dashboard with --check="New CTA" and a
--timeout-ms=20000. If the smoke passes, also run nexus-smoke against
<preview-url>/sign-in to confirm the sign-in page still 200s. Return both
JSON results plus a one-line summary.
```

Codex runs both commands via its shell tool and returns the combined JSON. The platform-copilot synthesises the results into a chat reply.

## Operator deploy steps

1. **Merge** the Phase 7 PR (this one).
2. **Rebuild the codex-gateway container** in Coolify so the new Dockerfile layers land. Two options:
    - Coolify dashboard → `codex-gateway` service → **Redeploy** (no env changes needed).
    - Or push a small no-op commit on `main` so Coolify's auto-deploy hook re-runs the build.
3. **Wait for the build to finish** — the Playwright + Chromium install adds ~5 minutes to the first build and ~200 MB to the image. Cached on subsequent rebuilds.
4. **Verify** by SSH'ing into the codex-gateway container OR by sending a one-shot test via the codex chat tab:
    ```
    Run `nexus-smoke https://nexus.vercel.app --check="Sign in" --timeout-ms=15000` and show me the JSON output.
    ```
   You should see something like:
   ```json
   {
     "url": "https://nexus.vercel.app",
     "status": 200,
     "title": "Sign in to Nexus",
     "loadedMs": 412,
     "consoleErrors": [],
     "checkPresent": true,
     "ok": true
   }
   ```

## Spend / risk

- Each browser smoke run uses ~30–60 MB of memory and finishes in <5s for a healthy preview. Bounded by `CODEX_DELEGATE_TIMEOUT_MS` (default 300 s) on the calling side.
- No external API costs — Playwright + Chromium are local. The only spend is the codex tick itself (drains the ChatGPT Pro plan).
- No secrets needed. `nexus-smoke` only sends a `NexusSmoke/0.1` user agent and otherwise hits the URL as an unauthenticated visitor would. Don't smoke-test pages that require auth without first writing a Playwright script that logs in — that's beyond `nexus-smoke`'s scope.
- The codex sandbox already excludes financial / secret-management secrets (per ADR 002), so even if the smoke task accidentally cURL'd something sensitive it wouldn't have credentials.

## When to fall back to a custom Playwright script

`nexus-smoke` covers the 80% case — "does this URL load + does it contain this text?" When the smoke needs to:

- Click a button and verify the next page
- Fill a form
- Wait for an API call to settle
- Auth as a test user

…ask the codex agent to write a one-off `test.mjs` using `playwright`'s API directly. Playwright is already installed globally on the gateway. Example brief:

```
Write a Playwright script that signs into <preview-url> as the test user
test@example.com / <password>, navigates to /dashboard, and asserts the
"Add idea" button is visible. Run it with `node`. Return the test exit
code plus any errors.
```

The codex sandbox can `node /tmp/test.mjs` directly — no need to invoke `npx playwright test` (which would want a config file).
