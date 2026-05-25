# Operator golden-path walkthrough — 2026-05-26

The destructive sibling of `tests/playwright/golden-path-smoke.spec.ts`. The smoke spec asserts that every operator-facing page loads. This runbook walks the **full new-business creation lifecycle** — provisioning, account connection, first cron tick, first generated artefact, first approval — and asks you to record friction points as you go.

Estimated time: **35–55 minutes** for a clean run. Add 15 minutes if you've never connected Composio / Stripe / Slack from this account.

## Why this runbook exists

The 2026-05-26 brief's Phase D asks: "simulate operator opens Nexus for the first time and tries to spin up a profitable business." That's a flow Claude can't drive end-to-end (it requires real OAuth, real credentials, real money for Stripe). So this runbook captures the structured questions the smoke session would have asked — you drive, you observe, you write findings back to `docs/observations/e2e-2026-05-26.md`.

## Prerequisites — confirm before starting

- [ ] Nexus production URL is reachable (typically `https://nexus.<your-domain>`)
- [ ] You are signed in via Clerk with your operator user_id added to `ALLOWED_USER_IDS`
- [ ] Doppler has the full env set for the prod config (Composio, Stripe, Slack, Cloudflare, Resend at minimum)
- [ ] You have an empty test slug ready (e.g. `pdf-experiment-2026-05-26`) — don't reuse a live business
- [ ] Slack workspace where you can receive inline-button approvals
- [ ] (Optional) A Stripe test API key + Composio Stripe account if you want to dry-run revenue

## The walkthrough

For each numbered step: time-box, complete, write **one line of observation** in `docs/observations/e2e-2026-05-26.md` under the matching heading. Friction = ergonomic issue. Bug = something broken. Question = decision the operator made that the agent should have made.

### Step 1 — Landing (`/`)

1. Open the prod URL signed out.
2. Sign in. Observe redirect target.

**Record**:
- Time-to-dashboard (cold): ___ seconds
- Did the sign-in flow have any non-Clerk steps? Yes / No: ___
- After sign-in, did you land where you expected? Yes / No: ___

### Step 2 — Dashboard (`/dashboard`)

1. Sit on `/dashboard` for 30 seconds.
2. Note what the empty state communicates (or doesn't).

**Record**:
- What is the most obvious next action the dashboard suggests? ___
- Is "Create a business" discoverable from the dashboard alone? Yes / No / Sort-of: ___
- Any KPI cards that look broken or stuck? ___

### Step 3 — Create-business consultant agent (`/create-business`)

This is the agent that asks you about mission, niche, money model, brand voice, KPI targets. Per the brief, this is where the platform either earns trust or loses it on day one.

1. Navigate to `/create-business`. Start the chat.
2. Provide a brief description of a real business idea (or use the canned `pdf-experiment-2026-05-26` if no idea is on hand).
3. Answer every question the agent asks. **Record the QUESTIONS verbatim** — they're the test of whether the agent is asking the right things.

**Record**:
- Total questions asked: ___
- Questions you wished it had asked but didn't: ___
- Questions that felt vague / hard to answer: ___
- Did it ever ask anything where you wished it had picked a default for you? ___
- Did it summarise the brief clearly at the end? Yes / No / Mid: ___
- Did the consultant agent ever say something factually wrong about Nexus? Y/N: ___ (if Y, transcript)

### Step 4 — Approve provisioning items

The consultant agent emits an `approval-request` block with DNS, container, and Composio seed items.

1. Read every item before approving.
2. Approve item by item (the brief's "NEVER auto-provisions silently" invariant).

**Record**:
- How many items in the approval block: ___
- Were any items unclear? Yes / No, which: ___
- Did the UI distinguish "approve all" vs "approve item-by-item"? Y/N: ___
- Time from final approval to provisioning complete: ___
- Any items that failed silently? ___

### Step 5 — Connect 2–3 accounts (`/settings/accounts?businessSlug=<slug>`)

1. Connect Stripe (OAuth via Composio).
2. Connect one social (Twitter/LinkedIn/Instagram).
3. Connect Slack.

**Record**:
- Stripe connect time + click count: ___
- Did Composio OAuth land you back at the right page? Y/N: ___
- For ConvertKit / Cloudflare DNS (API-key paste), is the UI explanation clear? Y/N: ___
- Any account where the connect button silently failed (no error, no success)? ___

### Step 6 — Watch first cron tick fire

The `business-operator` cron runs daily; for an immediate smoke, manually invoke:

```
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://nexus.<your-domain>/api/cron/business-operator?businessSlug=<slug>&dryRun=false"
```

Or for solopreneur businesses: `/api/cron/solopreneur-tick?businessSlug=<slug>`.

**Record**:
- HTTP status of cron response: ___
- Errors array in response body: ___
- New rows in `run_events` for this slug: ___ (count)
- New rows in `tasks` for this slug: ___ (count)
- First card surfaced on `/board` — quality 1–5: ___

### Step 7 — Read first generated content card

Open `/board` and review the topmost card produced by step 6.

**Record**:
- Is the card content actionable as-is, or junk? Actionable / Junk / Mid: ___
- If the brief was "write a tweet about pdf templates", does the content match? Y/N: ___
- Did the agent include a recommended next-action? Y/N: ___
- Would you publish this without edits? Y/N: ___ (this is the Truth)

### Step 8 — Strategic decision via Slack inline button

If step 6 surfaced a strategic decision (niche-pick, money-model, pivot), it should have posted a Slack message with Approve / Reject buttons.

1. Find the Slack message.
2. Click Approve.
3. Re-fire the cron tick (`?businessSlug=<slug>`).

**Record**:
- Slack message landed within: ___ minutes
- Slack inline buttons rendered correctly? Y/N: ___
- After Approve, did the next tick proceed? Y/N: ___
- Where would you have looked FIRST if the Slack message didn't arrive — `/inbox` page, the Board, or Slack channel? ___

### Step 9 — `/cron-health`

The fleet health surface that landed in v6–v10.

1. Visit `/cron-health`.
2. Identify any red / yellow jobs.

**Record**:
- Time-to-render of the page: ___ seconds
- Any jobs in red state? ___ (list)
- Can you tell from the page WHY a job is red? Y/N: ___
- Did the re-enable button work, if you needed it? Y/N: ___ (or N/A)

### Step 10 — `/teams` — department roster + ecosystem bindings

The org-chart surface from v3–v8.

1. Visit `/teams` for the test business.
2. Check the default department roster.

**Record**:
- Number of departments listed: ___
- Are the ecosystem bindings sensible for this business's niche? Y/N: ___
- Did you want to re-parent or remove any department immediately? Y/N: ___

## After the walkthrough — find triage

Open `docs/observations/e2e-2026-05-26.md` (you've been writing as you went). Categorise each finding:

| Category | Definition | Action |
|---|---|---|
| **Quick fix** | < 20 LOC, no architecture change, no operator decision needed | File issue + claim, ship in next 1-2 PRs |
| **Architectural** | New flow, new component, requires planning | Add to `task_plan-platform-improvements.md` track + open `issues/` row |
| **UX confusion** | Page works but operator was confused | Add to `task_plan-platform-improvements.md` Track 1 (onboarding) |
| **Agent quality** | Consultant / business-operator agent said something wrong, missed a question, or gave bad output | Flag specific atom in memory-hq (`atoms/55bedf46-nexus/`) — these compound |

Submit the categorised list back into the next session's North Star planning conversation.

## Re-running this walkthrough

After significant operator-facing changes (new `/create-business` agent prompt, new department roster, new approval flow), re-walk this runbook. Time-to-walkthrough should decrease as the consultant agent learns the operator's preferences — track in `docs/observations/e2e-<date>.md` so progress shows up.

## Connection to the smoke spec

`tests/playwright/golden-path-smoke.spec.ts` is the automated half — it catches "did the page break" at 1280px AND 375px viewports for every protected route. This runbook is the manual half — it catches "is the UX still tolerable" + "does the agent still ask the right questions" + "is the first generated artefact still usable."

Both are needed. The spec runs nightly via the qa-runner cron. The runbook runs every time you (or a teammate) suspect operator-facing rot.
