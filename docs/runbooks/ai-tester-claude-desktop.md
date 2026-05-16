# AI tester — Claude Desktop + Playwright MCP

> Use Claude Desktop with the Microsoft-maintained Playwright MCP to drive your already-logged-in Chrome session against Nexus. The agent navigates the UI, captures screenshots and network traffic, correlates findings with your existing `memory-hq` + `n8n` MCPs, and files actionable bugs durably without you leaving the conversation.
>
> **Why this stack (vs Claude Code + raw Playwright):** same browser-driving capability, but Claude Desktop hosts your `memory-hq` and `n8n` MCPs in the *same* conversation — so "the UI says n8n is disconnected" and "the n8n MCP returns an empty tool list" are observable together. That cross-MCP correlation is the point. Stack A is better when you want the tester to also edit code; Stack B is better for diagnosis.

## What this gives you

- Plain-English test driving: *"open `/settings/accounts`, click each provider, tell me which OAuth flows fail to start"*
- Screenshots, accessibility-tree snapshots, full per-page network request lists
- Live correlation with your other MCPs (memory-hq for historical context + prior fixes, n8n for workflow state)
- All findings filed durably to memory-hq as atoms linked to a tester-findings MOC, so the next session inherits the backlog
- Zero new infrastructure — no container, no deploy, no Doppler entries

## What it does NOT replace

- **Real-user pay-intent validation.** This catches UX clarity, broken routes, busted API calls — not "will customers pay".
- **Server-side MCP probing.** Claude Desktop sees client-side requests (browser → `/api/chat`). It cannot see the server's outbound calls to Composio/Stripe/etc. You correlate via the chat agent's *reply* ("I called GMAIL_FETCH_INBOX and got 200") or via Vercel logs.
- **CI gate.** Operator-driven, opt-in, per-conversation. NOT a pre-deploy check — pair with the existing `bug-hunt-loop` and the retry-storm / tsc pre-commit hooks for the always-on layer.
- **Headless or cron mode.** Headed Chrome with your session cookie. Don't try to run this from a CI container.

## Prerequisites

| | Required | Verified by |
|---|---|---|
| Claude Desktop | installed + signed in | `~/Library/Application Support/Claude/claude_desktop_config.json` exists |
| Chrome | 148+ at default macOS path | `/Applications/Google Chrome.app/Contents/MacOS/Google\ Chrome --version` |
| Node | 20+ (24+ recommended) | `node --version` |
| Existing MCPs | `memory-hq` + `n8n` already in config | this guide adds `playwright` alongside, doesn't replace |

## Architecture

```
┌─────────────────────────┐      stdio MCP      ┌──────────────────────────┐
│   Claude Desktop chat   │────────────────────▶│  @playwright/mcp@latest  │
│  + memory-hq MCP        │                     │   (spawned via npx by    │
│  + n8n MCP              │                     │    Claude Desktop)       │
│  + playwright MCP (new) │                     └──────────────┬───────────┘
└─────────────────────────┘                                    │ CDP
                                                               ▼
                                                ┌──────────────────────────┐
                                                │ Chrome (your machine)    │
                                                │ --remote-debugging-port  │
                                                │   =9222                  │
                                                │ --user-data-dir=         │
                                                │   ~/.chrome-cdp-profile  │
                                                │  ↳ logged in to Nexus    │
                                                │    (Clerk cookie)        │
                                                └──────────────────────────┘
```

## Step 1 — Launch Chrome with CDP enabled

Use a **dedicated profile** so your main Chrome (with Claude-in-Chrome, extensions, regular tabs) stays untouched:

```bash
open -na 'Google Chrome' --args \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-cdp-profile" \
  --no-first-run \
  --no-default-browser-check
```

A fresh Chrome window opens backed by `~/.chrome-cdp-profile` (created on first run). The CDP endpoint binds to `http://localhost:9222`.

Verify it's listening:

```bash
curl -s http://localhost:9222/json/version | head
```

You should see a JSON blob with `Browser`, `Protocol-Version`, `webSocketDebuggerUrl`. If you get `connection refused`, the flag didn't apply — fully quit the new Chrome window and re-run the `open` command.

## Step 2 — Log in to Nexus once

In the new (CDP-controlled) Chrome window, navigate to your Nexus deployment and sign in normally:

```
https://nexus-ten-vert.vercel.app/sign-in
```

(Or your custom domain if you've attached one.)

The Clerk session cookie persists in `~/.chrome-cdp-profile` indefinitely. You sign in once; every future Claude Desktop tester run inherits the session.

**Don't sign in inside an incognito tab** — incognito state doesn't persist to the profile.

## Step 3 — Add the Playwright MCP to Claude Desktop

Your current `claude_desktop_config.json` already has `memory-hq` + `n8n`. We add a third entry under `mcpServers` (alongside, not replacing). Run this `jq` patch from your terminal — it adds the entry without touching your existing tokens or preferences:

```bash
CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
cp "$CFG" "$CFG.bak.$(date +%Y%m%d-%H%M%S)"
jq '.mcpServers.playwright = {
  "command": "npx",
  "args": ["-y", "@playwright/mcp@latest", "--cdp-endpoint", "http://localhost:9222"]
}' "$CFG" > "$CFG.tmp" && mv "$CFG.tmp" "$CFG"
```

The `.bak.<timestamp>` is your rollback. The patched entry looks like:

```jsonc
"playwright": {
  "command": "npx",
  "args": [
    "-y",
    "@playwright/mcp@latest",
    "--cdp-endpoint", "http://localhost:9222"
  ]
}
```

`-y` auto-accepts the npx install on first run. `--cdp-endpoint` tells Playwright MCP to attach to your logged-in Chrome instead of launching a fresh browser (which would have no session). After save, your config has three entries under `mcpServers`.

## Step 4 — Restart Claude Desktop + verify

Fully quit Claude Desktop (`⌘Q`, not close-window) and reopen. In a fresh conversation:

```
List the tools available from the playwright MCP.
```

You should see `browser_navigate`, `browser_click`, `browser_type`, `browser_snapshot`, `browser_take_screenshot`, `browser_network_requests`, `browser_console_messages`, plus a few more. If the list is empty or Claude says "no playwright MCP", check:

```bash
# Did the npx install land?
ls "$HOME/.npm/_npx" | head

# Is CDP still listening?
curl -s http://localhost:9222/json/version | head

# MCP startup errors?
tail -50 ~/Library/Logs/Claude/mcp*.log 2>/dev/null
```

## Step 5 — Run your first test session

Establish the contract up front so the agent doesn't go off-script:

```
You're acting as an AI tester for Nexus. We're attached to my real Chrome
session via the playwright MCP — I'm logged in. Goal: produce a comprehensive
list of broken or degraded surfaces.

Hard constraints:
- READ-ONLY. No form submissions, no destructive clicks, no payment actions,
  no deletes. If you'd need to mutate state, propose it and wait.
- Cap: ~30 minutes of testing this conversation.
- For every finding capture: URL, what you did, what you expected, what
  happened, severity (p0/p1/p2/p3), and a 1-line fix hypothesis.
- When done, file every finding to memory-hq as an atom linked to
  mocs/nexus-ai-tester-findings (create the MOC if missing). Use kind:
  "tester-finding" and importance matching severity.

Start with /settings/accounts. Tell me what you see.
```

The agent will navigate, snapshot the page (accessibility tree — much cheaper than screenshots), list network requests, narrate findings. When you steer it to a new surface ("now test /manage-platform/chat"), it repeats the pattern.

## Prompt library

Drop these into the same conversation after the Step-5 contract is established. Each is self-contained.

### Auth + route gating

```
Verify /manage-platform redirects unauthenticated users to /sign-in.
You're signed in — to test this, open an incognito tab via the playwright
MCP (browser_tab_new with isolated context), navigate to /manage-platform,
and capture the redirect. Restore the signed-in tab when done.
```

### Connected accounts surface

```
On /settings/accounts:
1. Snapshot — list every provider tile.
2. For each Composio-brokered tile, click "Connect" and capture the
   redirect URL (abort at the provider's auth page — don't authorize).
3. Confirm each redirect carries state + redirect_uri params.
4. For each API-key tile (ConvertKit, Cloudflare DNS, Vercel), click
   "Connect" and snapshot the paste form.
5. List any 4xx/5xx in network_requests.
6. Switch the BusinessSwitcher to a specific business slug. Re-snapshot.
   Note any provider that disappears or changes state.
```

### Platform chat (`/manage-platform/chat`)

```
Send "What's the platform's current Vercel deployment status?" and observe:
1. Does the stream complete or hang? (timeout = 60s; report exact ms)
2. Does the reply reference Vercel-shaped tool output (deployment IDs,
   status strings)?
3. Network: any 5xx on /api/chat or its dependencies?
4. Console: any client errors?
5. Final snapshot — does the FloatingActionBar appear if the agent emitted
   an approval-request block?
```

### Per-business chat

```
For each business in BusinessSwitcher (query memory-hq for [[mocs/businesses]]
to get the list):
1. Navigate to /businesses/<slug>/chat.
2. Send "list my connected platforms".
3. Capture which platforms the reply names vs which are actually in
   connected_accounts (cross-check via memory-hq atoms on the business).
4. Any mismatch = p1 finding.
```

### Health view

```
Open /manage-platform → Views dropdown → Health. Wait for the panel to
load (look for "Loading…" to clear). For each section (run errors, cron
status, Slack config, cost-guard):
- Read the rendered values into the finding log.
- Click any "Test webhook now" buttons — capture the response banner +
  HTTP code.
- A 404/403/network result from a webhook test is a finding by itself;
  include the UI's remediation hint verbatim.
```

### Coolify panel (scope-aware, PR #193)

```
In /settings/accounts:
1. BusinessSwitcher = Admin scope. Coolify panel renders in admin styling
   (purple pill labeled "ADMIN")? Snapshot.
2. Switch to a business scope. Does the panel re-fetch and render the
   blue business pill? Snapshot.
3. Switch to Default. Panel should hide entirely.
Any flicker, stuck loading state, or admin data leaking into the business
view = p1.
```

### Cross-MCP correlation (Stack B's superpower)

```
At /manage-platform/chat send "is n8n healthy?" — capture the reply.
Independently, call the n8n MCP (n8n_list_workflows) and report the count.
If the chat reply contradicts the MCP, file a p1.
```

```
Query memory-hq for atoms under mocs/memory-and-cost-incidents newer than
30 days. For each, navigate to the affected route and confirm the fix is
still present. Use each atom's fix-PR commit SHA to anchor what the code
should look like. Any regression = p0.
```

## Making findings durable

Default chat loses context across conversations. End every session with:

```
File every finding from this session to memory-hq as atoms:
- scope: { repo: "pinnacleadvisors/nexus" }
- title: "<finding title>"
- body: "<symptom · expected · actual · 1-line fix hypothesis>"
- kind: "tester-finding"
- importance: matches severity (p0→critical, p1→high, p2→normal, p3→low)
- locators: [{ kind: "url", href: "<page url>" }]
- links: ["[[mocs/nexus-ai-tester-findings]]"]

If mocs/nexus-ai-tester-findings doesn't exist yet, create it first.
```

Alternatively, for concrete findings that should flow into the existing review-feedback pipeline (so `workflow-optimizer` picks them up):

```
For finding <N>, use browser_evaluate to POST from the page context to
/api/workflow-feedback with:
{ agentSlug: "<producing-agent>",
  summary: "<title>",
  details: "<one-paragraph>",
  source: "ai-tester:claude-desktop" }
```

The route already accepts that shape (`app/api/workflow-feedback/route.ts` line 92, designed for non-human feedback sources). Prefer memory-hq atoms first — workflow-feedback rows are for findings that have a clear agent owner.

## Safety — prompt injection with co-resident MCPs

The Playwright MCP can read any page, including pages designed to manipulate the agent (a crafted Nexus support reply, a phishing email in Gmail, a malicious bookmarklet). Once the agent reads the malicious text, it can call your OTHER MCPs — memory-hq, n8n — on the attacker's behalf (e.g. writing a poisoned atom that future agents trust, or triggering an n8n workflow). Mitigations:

1. **Keep the CDP Chrome profile clean.** No email, no socials, no extensions. Only Nexus + sites you've explicitly told the agent to visit.
2. **Default to read-only.** Re-state it whenever the topic changes. The agent forgets constraints over long contexts.
3. **Don't browse from this profile.** Test fixture only, not a daily-driver.
4. **Reset between high-risk sessions.** `rm -rf ~/.chrome-cdp-profile && relaunch` if the profile got into a state you don't trust.
5. **Audit memory-hq writes weekly.** `ls -lt pinnacleadvisors/memory-hq/atoms/55bedf46-nexus/ | head` — check entries with `author: claude-desktop` for legitimacy.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "no playwright MCP" in fresh chat | npx didn't finish installing | `npx -y @playwright/mcp@latest --help` once in terminal to prime the cache |
| `ECONNREFUSED 127.0.0.1:9222` | Chrome not launched with the flag | re-run Step 1's `open` command; verify with `curl localhost:9222/json/version` |
| Browser launches fresh / no session | `--cdp-endpoint` arg missing or typo | check `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Clerk shows sign-in despite cookie | Different profile or expired cookie | re-sign-in inside the CDP Chrome window |
| Screenshots blank | Page hasn't rendered yet | tell the agent to `wait 2s` after navigate, or prefer `browser_snapshot` (accessibility tree) over screenshots — far faster anyway |
| Tokens leak into atoms | Agent quoted Authorization/Cookie from network_requests | bake into the contract prompt: "never include Authorization, Cookie, or x-* headers in atoms" |

## Operator finding: secret hygiene

During setup recon for this runbook, `MEMORY_HQ_TOKEN` was observed in plaintext at `~/Library/Application Support/Claude/claude_desktop_config.json`. Anthropic's tool has no config-secret manager today — this is how MCP env is stored. Two consequences:

1. Any process running as your user can read that token. FileVault protects at rest, not at runtime. Treat the file like a `.env`.
2. The token was visible to the assistant during recon for this PR — rotate it: GitHub → Settings → Developer settings → Personal access tokens → regenerate `MEMORY_HQ_TOKEN`, paste new value into the config (preserving the rest), restart Claude Desktop.

Filed as an atom under `mocs/secret-management` (will be created on first write if missing) so future sessions surface this as a known operational risk during recon work.
