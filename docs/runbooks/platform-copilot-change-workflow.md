# Platform-copilot — change-and-preview workflow

The platform-copilot at `/manage-platform` can investigate AND make changes to the Nexus codebase when you approve them. Every change goes through a branch → preview deploy → operator-verification → merge loop, so nothing lands in production without you clicking around on a real preview URL first.

## Architecture

```
                   ┌─────────────────────────────────────────────────┐
   You ──────────► │  /manage-platform chat (Opus on claude-gateway) │
                   └────────────────────────┬────────────────────────┘
                                            │ MCP tools (admin-scope only)
                            ┌───────────────┼───────────────────────────┐
                            ▼               ▼                           ▼
                   composio-admin     memory-hq MCP            Read/Edit/Bash
                    (Vercel/GitHub/   (atoms,                   (against /repo
                     Stripe/Slack)     entities, MOCs)           clone)
                            │
                            ▼
                   ┌──────────────┐
                   │   GitHub     │ ◄─── feature branch (pushed via Composio)
                   └──────┬───────┘
                          │
                          ▼
                   ┌──────────────────────┐
                   │  Vercel auto-deploy  │ ◄─── preview URL
                   │  (per branch)        │
                   └──────────┬───────────┘
                              │
              You click around in browser ✓ / 🚫
                              │
                              ▼
                   ┌──────────────────────┐
                   │  Approve merge       │ ◄─── you say "merge it"
                   │  → main branch       │
                   │  → production deploy │
                   └──────────────────────┘
```

## The 7-step loop

The platform-copilot agent spec at [`.claude/agents/platform-copilot.md`](../../.claude/agents/platform-copilot.md) carries the full version. Quick reference:

| Step | What | Approval gate? |
|---|---|---|
| 1 | Investigate (Read/Grep + Composio reads + memory_search) | No — read-only |
| 2 | Propose plan: numbered file list, why, risks, est. diff size | **Yes** — explicit "go ahead" |
| 3 | Create feature branch + commit files via `GITHUB_CREATE_A_REFERENCE` + `GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS` | No — falls under step 2 approval |
| 4 | Verify locally: `tsc --noEmit`, `npm run check:retry-storm` | No — read-only checks |
| 5 | Open PR via `GITHUB_CREATE_A_PULL_REQUEST`. Surface PR URL + Vercel preview URL | **Yes** — small, usually instant |
| 6 | You open the preview URL and test the change in browser. Agent helps via `VERCEL_LIST_DEPLOYMENTS` + `WebFetch` on key routes | Your testing IS the gate |
| 7 | Merge via `GITHUB_MERGE_A_PULL_REQUEST` (squash or merge). Vercel auto-deploys main → production | **Yes** — explicit "merge it" |

Memory-hq atom written at the end for any non-obvious learning.

## Why this works for solo-operator preview testing

Vercel's per-branch preview deploys are the leverage point. Every push to a non-main branch:

1. Triggers a new Vercel deployment scoped to that branch
2. Gets a unique preview URL (visible in the PR's "Deployments" sidebar)
3. Has its own isolated env vars (preview env, not production)
4. Runs the full Next.js app — same code path users hit in production

You open the preview URL in any browser, sign in (Clerk supports preview-URL origins automatically because they're under your team's Vercel domain), and click around. If something breaks, you tell the agent in chat; the agent pushes another commit to the same branch; Vercel rebuilds the preview; you re-test. Loop until clean.

## What automated preview testing would look like (NOT shipped — Phase 2)

For changes that need verification beyond eyeball testing, the proper escalation is delegating Playwright runs to the codex-gateway:

```
You: "this PR changes the /settings/accounts page — verify the OAuth
      flow still works against the preview URL before I merge"

Agent → delegates to codex-operator → codex spawns Playwright →
        navigates preview URL, clicks 'Connect Slack', completes OAuth in a
        headless browser, asserts redirect lands at /settings/accounts?
        connected=slack, screenshots if any assertion fails → reports back

Agent: "Codex ran the Slack-connect flow on the preview URL. All
        assertions passed. Screenshot at /tmp/preview-slack-ok.png."
```

This requires:
- Playwright + headless Chromium installed on the codex-gateway
- A codex-side smoke-test harness (CLI or HTTP) the agent can invoke
- Test credentials for Clerk (a "preview operator" user)

We can build this when manual eyeballing becomes the bottleneck. For now, the human-in-the-loop is fine — most changes the copilot makes are small (1-3 files, <100 lines) and visual.

## Operator settings to enable / verify

In Coolify (KVM4 → Nexus Platform → claude-gateway → Environment Variables), set:

| Var | Why | Where else it lives |
|---|---|---|
| `COMPOSIO_API_KEY` | Composio MCP | Doppler |
| `SUPABASE_SERVICE_ROLE_KEY` | mcp-composio-admin reads admin-scope rows | Doppler |
| `NEXT_PUBLIC_SUPABASE_URL` | mcp-composio-admin REST target | Doppler |
| `NEXUS_OPERATOR_USER_ID` | Optional — defaults to first `ALLOWED_USER_IDS` | Operator's Clerk user_id |
| `MEMORY_HQ_TOKEN` | memory-hq MCP for cross-session learnings | Doppler |
| `NEXUS_BASE_URL` | memory-hq writes target | Doppler |

After setting / changing any of these: **Coolify → Redeploy claude-gateway** (image rebuild + entrypoint re-run). The deploy logs print which MCP servers registered:

```
[gateway] Wrote MCP config: composio-admin memory-hq
```

If you see only one or neither, the corresponding env var is missing or the build failed — check the lines above in the same log.

## When NOT to use the platform-copilot for changes

- **Migrations** — DB schema changes need careful review + manual application via Supabase Studio. The agent can DRAFT the SQL but you apply it.
- **Secret rotation** — admin scope tokens, encryption keys, etc. Manual via Doppler.
- **Coolify infra mutations** — destroying/restarting containers, changing volume mounts. Manual.
- **Anything billable past your daily cap** — the cost guard will 402 the chat before this happens, but worth knowing.
- **Force-pushes / history rewrites** — out of bounds. If you need to rewrite history, do it manually.

For everything else (feature additions, bug fixes, refactors, doc updates, ADR drafts, CSP tweaks, env additions, MCP additions, UI changes, copy edits), the workflow above is the path.
