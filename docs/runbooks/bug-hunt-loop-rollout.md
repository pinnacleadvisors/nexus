# Bug-hunt loop rollout — operator manual checklist

Step-by-step rollout for the operator-gated bug-hunt loop shipped in PRs #180 (scaffolding) + #181 (auditors). Read top-to-bottom — order matters because PR-2 stacks on PR-1 and the gateway redeploy depends on both branches landing first.

## What you'll have at the end

In `/manage-platform` → click **Views** → **Bug hunt**, you can:

- Start an operator-gated audit session (default: 33% of 5h Max plan window, 33% of Pro plan window, max 20 iterations)
- Type `/bug-hunt iterate` in chat → agent proposes an `iteration-plan` block → you click Approve → agent runs that one iteration (static audit / smoke / fix-PR)
- See findings as they're discovered, with severity pills + source paths + links to opened PRs
- Pause / Resume / Stop the session
- Watch the two-bar plan-window meter to know when you're squeezing your interactive chat's quota

The loop never auto-merges. Every PR opened is draft + tagged `bug-hunt` + base=main. You review and merge yourself.

## Prereq: confirm the upstream bugs are fixed

Two earlier PRs must be merged for the loop to actually function. **Don't skip this** — the loop's PR-opening flow uses the Composio wrapper, and that wrapper had a write-blocking bug.

- [ ] **PR #172 merged + claude-gateway redeployed** — adds `entity_id` to Composio executes (without this, the agent can call `GITHUB_LIST_*` but not `GITHUB_CREATE_*`). To verify in chat: ask platform-copilot _"Try GITHUB_LIST_PULL_REQUESTS_FOR_THE_AUTHENTICATED_USER via admin_execute_action."_ → if it returns rows instead of error 1811, the fix is live.
- [ ] **PR #175 merged + Vercel redeployed (and `GATEWAY_ALLOW_SELF_SIGNED_HOSTS=*.sslip.io,*.nip.io` in Doppler if you're using sslip.io)** — only needed if your per-business gateway is on sslip.io. Skip if you're already behind Cloudflare Tunnel.

## Step 1 — Merge the loop PRs

The PRs are **stacked**: PR #181 (auditors) was opened against PR #180 (scaffolding), not against main.

- [ ] **Merge PR #180 first.** Default `Merge` button is fine — squash or rebase, your call. Wait for Vercel to pick it up before the next step.
- [ ] **Retarget PR #181 to `main`.** Open PR #181 → click _Edit_ next to the title → change base branch from `feat/bug-hunt-pr1-scaffolding` to `main` → save. The diff should now show only PR-2's changes (auditor MCP, smoke flows, PR helpers, termination heuristic). Stacking complete.
- [ ] **Merge PR #181.** Same merge style as #180.

If you forget to retarget: PR #181's diff will look bigger than expected because it'll show PR-1's changes too. Merge order still works — GitHub deduplicates — but the PR description's "what changed" section is misleading. Retarget if you want the diff to read cleanly.

## Step 2 — Apply database migrations

Two new migrations land in #180.

- [ ] Open **Supabase dashboard** → SQL Editor → New query
- [ ] Open `supabase/migrations/039_gateway_turns.sql` from the merged main, paste, Run
- [ ] Verify: `select count(*) from gateway_turns` → returns 0 (table exists, no rows yet)
- [ ] Open `supabase/migrations/040_bug_hunt.sql`, paste, Run
- [ ] Verify: `select count(*) from bug_hunt_sessions` AND `select count(*) from bug_hunt_findings` → both return 0

If either query errors with "relation does not exist", the migration didn't apply — re-paste and re-Run.

## Step 3 — Redeploy claude-gateway (Coolify)

> **Note (2026-05-15)**: the `services/mcp-platform-audit/` MCP wrapper is **deferred** — the directory in `origin/main` currently contains only build artifacts (`dist/`, `node_modules/`, `package-lock.json`) with no `src/`. The bug-hunt-loop agent now invokes the three static checks directly via `Bash` (`cd /repo && npx tsc --noEmit`, `npm run check:retry-storm`, `npm run check:sentry-config`). Same coverage, same speed — just no MCP convenience wrapper. Path A (building the wrapper) is tracked in `task_plan-bug-hunt-loop.md` and can be picked up later if the Bash-direct approach gets noisy. See [GENERATION_PROTOCOL.md](../agents/GENERATION_PROTOCOL.md) for adding the wrapper if/when desired.

The redeploy is still required so the new `.claude/agents/bug-hunt-loop.md` spec and the chat poll routes' iteration-plan parsing land in the running container. NO new env vars required.

- [ ] Open Coolify on **KVM4** (the host with claude-gateway)
- [ ] Project → environment → click **`claude-gateway`** service
- [ ] Top-right (or under **Actions** dropdown) → **Redeploy**
- [ ] Confirm the modal
- [ ] Wait ~60–90 s for the rebuild
- [ ] Click **Logs** tab. Look for this line in the boot output:
    ```
    [gateway] Wrote MCP config: composio-admin memory-hq codex-delegate
    ```
    (Note: `platform-audit` is **not expected** in that list — the agent uses Bash directly.)
- [ ] Verify the agent spec was picked up: look earlier in the log for `[gateway] refreshing repo at /repo (main)` and `HEAD` matching the latest `origin/main` SHA from `git log -1 --format=%h` on your dev machine.

## Step 4 — (Optional) Tune the plan-window ceilings

Defaults (`MAX_PLAN_5H_TURNS_CEILING=150`, `PRO_PLAN_5H_TURNS_CEILING=100`) are empirical estimates. You can tune later, but if you want to start aggressive/conservative now:

- [ ] Open **Doppler** → nexus → production
- [ ] **Conservative** (recommend if you use a lot of interactive chat): `MAX_PLAN_5H_TURNS_CEILING=120`, `PRO_PLAN_5H_TURNS_CEILING=80`
- [ ] **Aggressive** (recommend if your interactive chat is light): `MAX_PLAN_5H_TURNS_CEILING=180`, `PRO_PLAN_5H_TURNS_CEILING=120`

Vercel auto-redeploys on Doppler push.

**Tuning recipe** (per ADR / plan): once a month, check your gateway throttling logs. If throttling kicks in below 80% of declared ceiling, lower by 10–15%. If you never hit throttling even on heavy days, raise by 10%.

## Step 5 — Smoke-test the loop

End-to-end verification. Each step should take ≤ 30 s.

### 5.1 — Open the Bug-hunt panel

- [ ] Visit `/manage-platform` (you may need to sign in)
- [ ] Top-right of the chat header: click the **Views** dropdown
- [ ] Click **Bug hunt** → side panel slides in
- [ ] You should see: empty state with "Start session" button
- [ ] Confirm: the operator-side migrations applied (if you see HTTP 500 or "session not found" weirdness, migration 040 didn't land)

### 5.2 — Start a session

- [ ] Click **Start session**
- [ ] Panel updates: shows the session id (`bh-2026-MM-DD-admin-000`), Active pill, iter 0/20, two empty plan-window meters
- [ ] In the chat itself, type:
    ```
    /bug-hunt iterate — propose iteration 1
    ```
- [ ] The platform-copilot should respond with an `iteration-plan` fenced block that renders as an ApprovalCard. Title example: _"Iteration 1 — static-audit"_. Items: 3 numbered actions.
- [ ] If it doesn't render as a card and you see raw JSON instead: the iteration-plan parser didn't pick it up. Most likely cause: the `.claude/agents/bug-hunt-loop.md` agent spec wasn't refreshed in the claude-gateway container — redo Step 3.

### 5.3 — Approve iteration 1

- [ ] Click **Approve all** in the iteration card
- [ ] Watch the chat — agent should fire 3 Bash tool calls in sequence (`npx tsc --noEmit`, `npm run check:retry-storm`, `npm run check:sentry-config`). Tool-call cards appear in chat with the command + truncated stdout.
- [ ] If findings exist, you'll see them appear in the panel's "Open" group (refreshes every 4 s)
- [ ] At end of turn, agent emits a fresh `iteration-plan` for iteration 2 (different scope — probably `dynamic-audit` or `triage`)
- [ ] **Panel meter**: Claude Max bar should now show ~3–4% session-share (one Opus turn = 5 weighted turns ÷ ceiling 150). Codex bar still 0%.

### 5.4 — Try a fix-PR iteration

- [ ] When the agent proposes an iteration with scope `fix-pr` (after a real finding is on the table), approve it
- [ ] Agent calls Composio: `GITHUB_CREATE_A_BRANCH` → `GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS` → `GITHUB_CREATE_A_PULL_REQUEST`
- [ ] **Expected**: a new PR appears in `pinnacleadvisors/nexus` open PRs, branch name like `fix/bug-hunt-bh-2026-MM-DD-admin-000-i3-...`, **draft**, **tagged `bug-hunt`**, base = `main`. Body includes the finding detail + a review checklist + a clear "Opened by bug-hunt-loop agent — agent CANNOT merge" warning.
- [ ] The corresponding finding in the panel should flip from `open` → `pr-opened` with a clickable PR link.

### 5.5 — Stop the session

- [ ] Click **Stop** (the red square) in the session header
- [ ] Panel updates: status pill flips to Stopped, ended_at populated
- [ ] You can leave the panel — session is preserved in the DB and can be reviewed via `GET /api/bug-hunt/<id>` later

## Step 6 — Triage what was found

After Step 5, you should have a couple of findings + maybe one or two draft PRs.

For each open finding:
- Review in the panel
- If it's spurious or you don't care: click "Mark wont-fix" (hover the row to reveal the button)
- If it's real but the auto-fix isn't right: leave the finding open, ask the agent to propose a different fix in the next iteration

For each draft PR:
- Open it in GitHub
- Review the diff like any other PR — the body's "Review checklist" is the agent's self-assessment, not a substitute for your read
- Merge if good, close if not
- If closed: optionally PATCH the finding to `status='wont-fix'` so it doesn't get re-proposed next session

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Panel shows "Start session" forever; clicking does nothing | API 401 | Sign-in expired — refresh, sign back in |
| Start session returns `code: 'no_plan_window_route'` | `force_plan_window=true` but no Max-plan gateway reachable | Either fix the claude-gateway routing (check `CLAUDE_CODE_GATEWAY_URL` env), or pass `{ "force_plan_window": false }` to the POST body to allow API-billed fallback |
| Start session returns `code: 'session_exists'` | An old session is still status=active | Open the existing session via panel → Stop it → start fresh |
| Agent runs iteration but no findings appear | Bash check returned non-zero but the agent didn't parse it as a finding | Click the tool-call card to see the raw stdout; if there's a TS error or retry-storm hit visible, reply asking the agent to "emit a `bug-hunt-finding` for each error in the tsc output". A future iteration can add a `mcp-platform-audit` wrapper with structured output if this parsing gets brittle (deferred per Step 3 note) |
| Agent emits findings but they don't show in panel | The session_id in the agent's blocks doesn't match an owned session | Look at the agent's reply text — block should reference the session id from the panel header. If it's making up an id, ask it to "use session id `<actual>` going forward" |
| PR-opening errors with 1811 | The Composio `entity_id` fix didn't land | Verify PR #172 is on main and the claude-gateway has been redeployed since the merge |
| Plan-window meter stays at 0% even after iterations | `gateway_turns` not being populated. Most likely the `platform-chat/poll` route's `insertGatewayTurn` call is failing silently | SQL: `select count(*) from gateway_turns where user_id = '<your-clerk-id>'` → if 0, the table is missing or RLS is blocking |

## When to revisit this guide

After every new `B<N>` phase ships (V-series for Views panels, or future bug-hunt extensions), update the corresponding section. Don't let this drift.

If you experiment with non-default values (e.g. `plan_window_share_pct=50`), note them here so we have a record of what's been tried.

## When this plan is done

A full bug-hunt session takes ~30 minutes of operator time spread across the day:

- Iteration 1: static audit + first proposal ≈ 2 min of your time
- Iteration 2: review + approve smoke run ≈ 1 min
- Iteration 3–N: review iteration-plan + approve OR pause ≈ 1 min each
- PR reviews: 5–10 min per PR (same as any review)

The agent does the busywork between approvals. Each session amortises the existing Max + Pro subscription costs against real platform-improvement output. Cost on the credit card: $0 (default config).
