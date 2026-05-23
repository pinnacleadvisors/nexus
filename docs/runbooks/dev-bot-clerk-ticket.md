# Dev-bot Clerk ticket for platform-copilot autonomous UI verification

Phase 3 of [`task_plan-mobile-copilot.md`](../../task_plan-mobile-copilot.md) wires the platform-copilot agent to take a laptop + mobile screenshot pair before opening any UI-touching PR (see [ADR 008](../adr/008-platform-copilot-autonomous-ui-verify.md)). The agent does this by delegating to codex-operator, which boots `npm run dev` against the branch and drives Playwright against the local server. Playwright needs to be signed in — protected routes redirect to `/sign-in`.

The mechanism: a Clerk **sign-in ticket** minted on-demand by [`/api/admin/issue-bot-session`](../../app/api/admin/issue-bot-session/route.ts), redeemed by Playwright via `page.goto(ticket-url)`. The same bot user and the same endpoint that the autonomous QA runner already uses.

## Why one bot, not two

The qa-runner already mints tickets for `BOT_CLERK_USER_ID`. Adding a second bot user just for platform-copilot would:

- Double the Clerk seat count.
- Split audit trails — half the screenshots come from `qa-bot`, half from `dev-bot`. Operators have to remember which is which.
- Need a second Doppler secret for the issuer key.

So this runbook **reuses the qa-bot identity**. The same Clerk user signs in for post-deploy smoke + for platform-copilot screenshots. The audit log differentiates by `X-Nexus-Session-Tag` (qa-runner sets `smoke-<deploy-id>`; platform-copilot delegations set `platform-copilot-screenshot-<plan-id>`).

## One-time setup

If you haven't already provisioned the qa-bot, do that first per [`services/qa-runner/README.md`](../../services/qa-runner/README.md) §"Manual setup checklist":

1. **Create the Clerk user** — `qa-bot@<your-domain>` in the Clerk dashboard.
2. **Add to allowlist** — append the new user_id to `ALLOWED_USER_IDS` in Doppler (comma-separated).
3. **Store the secrets** in Doppler:
   ```bash
   doppler secrets set BOT_CLERK_USER_ID=user_<qa-bot-id>
   doppler secrets set BOT_API_TOKEN=$(openssl rand -hex 32)
   doppler secrets set BOT_ISSUER_SECRET=$(openssl rand -hex 32)
   ```
4. **Redeploy** the Vercel app so the new env vars are picked up.

Once those four secrets are in Doppler, the platform-copilot's delegation template works without any code changes.

## How platform-copilot uses it

The agent spec (`.claude/agents/platform-copilot.md` §4b) embeds the call shape inline. Summary of what runs inside the codex delegation:

```bash
# 1. Mint a one-time ticket (1 h TTL, single redemption)
BODY='{"userId":"'"$BOT_CLERK_USER_ID"'"}'
TS=$(date +%s%3N)
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$BOT_ISSUER_SECRET" -hex | cut -d' ' -f2)"

RESP=$(curl -sS -X POST "$NEXUS_BASE_URL/api/admin/issue-bot-session" \
  -H "X-Nexus-Signature: $SIG" \
  -H "X-Nexus-Timestamp: $TS" \
  -H 'Content-Type: application/json' \
  --data "$BODY")

TICKET_URL=$(echo "$RESP" | jq -r .url)

# 2. Boot dev server in the branch checkout (codex does this in /workspace)
cd /workspace/branch
npm install --silent
nohup npm run dev > /tmp/dev.log 2>&1 &
DEV_PID=$!

# Wait for it to be ready
until curl -sf http://localhost:3000 > /dev/null 2>&1; do sleep 1; done

# 3. Drive Playwright at two viewports
BASE_URL=http://localhost:3000 BOT_SESSION_TICKET_URL=$TICKET_URL \
  npx playwright test --project=iphone   tests/playwright/<route>.spec.ts
BASE_URL=http://localhost:3000 BOT_SESSION_TICKET_URL=$TICKET_URL \
  npx playwright test --project=chromium tests/playwright/<route>.spec.ts

# 4. For a quick ad-hoc screenshot (not a test), use the inline approach:
node -e '
  const { chromium, devices } = require("playwright")
  const fs = require("fs")
  ;(async () => {
    for (const [name, device] of [["laptop", devices["Desktop Chrome"]], ["mobile", devices["iPhone 12"]]]) {
      const browser = await chromium.launch()
      const context = await browser.newContext(device)
      const page    = await context.newPage()
      await page.goto(process.env.BOT_SESSION_TICKET_URL, { waitUntil: "networkidle" })
      await page.goto("http://localhost:3000/" + process.env.TARGET_PATH, { waitUntil: "networkidle" })
      await page.screenshot({ path: `/tmp/${name}.png`, fullPage: true })
      await browser.close()
    }
  })()
'

# 5. Upload to Vercel Blob, return URLs. (Upload mechanism is per the operator's
#    Blob credentials; codex's env carries BLOB_READ_WRITE_TOKEN when present.)
```

The agent receives the two URLs and embeds them in its next message:

```markdown
**Laptop preview** (1280×800)
![laptop](https://<vercel-blob>/laptop-<hash>.png)

**Mobile preview** (375×812)
![mobile](https://<vercel-blob>/mobile-<hash>.png)
```

## Failure modes + recovery

| Symptom | Probable cause | Fix |
|---|---|---|
| `issuer_not_configured` from `/api/admin/issue-bot-session` | `BOT_ISSUER_SECRET` missing | Set in Doppler, redeploy. |
| `bot_user_not_configured` | `BOT_CLERK_USER_ID` missing | Same — Doppler + redeploy. |
| `bad_signature` | HMAC mismatch — usually wrong body or wrong secret | Verify the body is byte-exact between signature computation and the POST. Pipe `--data` from the same variable you signed. |
| `userId_not_allowlisted` | The qa-bot user_id sent doesn't match `BOT_CLERK_USER_ID` | Sanity-check Clerk dashboard for the right user_id; update Doppler. |
| Playwright stalls on `/sign-in` after redemption | Ticket was already used (single-use) or expired (>1 h) | Mint a fresh ticket. Don't cache tickets across delegations. |
| `clerk_error: ...` | Clerk Backend API is rate-limiting or down | Check Clerk status; back off. The ticket endpoint returns 502 so codex sees a clean error. |

## Cost note

Each platform-copilot screenshot delegation costs:
- ~1 codex-delegate turn (Claude/codex usage): ~$0.02–0.10 depending on context.
- Vercel Blob storage: ~$0.00001 per screenshot (negligible).
- Clerk ticket: free (sign-in tokens are billed only when the Clerk plan caps are hit).

Daily ceiling: at ~20 UI edit-groups/day × 2 screenshots = 40 screenshots ≈ $1-3/day. Comfortably inside `USER_DAILY_USD_LIMIT`. The `checkKillSwitch(null)` call in the agent's delegation wrapper aborts when the cap is approaching.

## Operator action items (post-PR-merge)

The code/spec changes ship via [PR #280](https://github.com/pinnacleadvisors/nexus/pull/280) (or whatever the autonomy PR number is). After merge, the operator still needs to:

- [ ] Confirm `BOT_CLERK_USER_ID`, `BOT_ISSUER_SECRET`, and `BOT_API_TOKEN` are in Doppler.
- [ ] Confirm the qa-bot Clerk user_id is in `ALLOWED_USER_IDS`.
- [ ] Redeploy the claude-gateway container on Coolify so the new hooks block + the new spec take effect.
- [ ] Test the flow: ask platform-copilot to make a trivial UI change (e.g. swap a button label colour). Confirm step 4b's screenshot pair appears in chat before the PR opens.

This list is also surfaced as a `manual-task` block by the agent the first time the flow is invoked.
